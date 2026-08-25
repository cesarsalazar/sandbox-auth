// sandbox-auth — the drop-in a property uses to consume auth.sandbox.is.
//
// A property authenticates the person, not itself: it is a public client, so
// there is no secret here. What it does need is on its own origin — receive the
// redirect the button sent, and set its own session cookie. This core is the
// logic of that, with no framework in it; the node and next adapters are a
// dozen lines each on top.
import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';

const DEFAULT_AUTH = 'https://auth.sandbox.is';
const CALLBACK_PATH = '/api/auth/callback';
const TX_COOKIE = 'sbx_auth';                 // the button sets this on the property's origin
const DEFAULT_SESSION_TTL = 30 * 24 * 60 * 60;

const jwks = new Map();
function keysFor(authOrigin, headers) {
  const key = authOrigin + (headers ? ':bypass' : '');
  if (!jwks.has(key)) jwks.set(key, createRemoteJWKSet(new URL(`${authOrigin}/jwks`), headers ? { headers } : undefined));
  return jwks.get(key);
}

export function resolveConfig(o = {}) {
  const authOrigin = (o.authOrigin ?? process.env.SANDBOX_AUTH_ORIGIN ?? DEFAULT_AUTH).replace(/\/$/, '');
  // Named for the systems they belong to. The client id is the property's id
  // for Sandbox Auth. The session secret is the property's own — it signs the
  // property's session cookie, which auth never sees — so it is named for the
  // property, derived from the client id: SANDBOX_MEMBERS_SESSION_SECRET,
  // SANDBOX_FINANCE_SESSION_SECRET, and so on.
  const clientId = o.clientId ?? process.env.SANDBOX_AUTH_CLIENT_ID;
  if (!clientId) throw new Error('sandbox-auth: set SANDBOX_AUTH_CLIENT_ID (or pass clientId)');
  const slug = String(clientId).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const secretVar = `SANDBOX_${slug}_SESSION_SECRET`;
  const ttlVar = `SANDBOX_${slug}_SESSION_TTL`;
  const sessionSecret = o.sessionSecret ?? process.env[secretVar];
  if (!sessionSecret) throw new Error(`sandbox-auth: set ${secretVar} (or pass sessionSecret)`);
  return {
    authOrigin,
    clientId,
    sessionSecret,
    cookieBase: o.cookieName ?? 'sandbox_session',
    sessionTtl: o.sessionTtl ?? (process.env[ttlVar] ? Number(process.env[ttlVar]) : DEFAULT_SESSION_TTL),
    callbackPath: o.callbackPath ?? CALLBACK_PATH,
    txCookie: TX_COOKIE,
    // Only for reaching a protection-gated preview auth in testing; a property
    // talking to production auth never sets this.
    bypass: o.bypass ?? process.env.SANDBOX_AUTH_BYPASS,
  };
}

// __Host- is host-only and needs Secure and a root path, which https gives; a
// plain http dev server cannot set it, so the name falls back there.
export function cookieName(cfg, secure) {
  return secure ? `__Host-${cfg.cookieBase}` : cfg.cookieBase;
}

const secretBytes = (cfg) => new TextEncoder().encode(cfg.sessionSecret);
const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/');

// The callback, as pure data in and out: the button's cookie and the query
// become either a session token (and where to go next) or an error.
export async function completeSignIn({ cfg, query, cookies, redirectUri }) {
  let tx;
  try { tx = JSON.parse(decodeURIComponent(cookies[cfg.txCookie] || '')); } catch { tx = null; }
  if (!tx || !tx.verifier) return { error: 'no_transaction' };
  if (query.error) return { error: String(query.error) };
  if (query.state !== tx.state) return { error: 'state_mismatch' };
  if (!query.code) return { error: 'no_code' };

  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  if (cfg.bypass) headers['x-vercel-protection-bypass'] = cfg.bypass;
  const res = await fetch(`${cfg.authOrigin}/token`, {
    method: 'POST',
    headers,
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: cfg.clientId,
      code: query.code,
      redirect_uri: redirectUri,
      code_verifier: tx.verifier,
    }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.id_token) return { error: body.error || 'exchange_failed' };

  let claims;
  try {
    ({ payload: claims } = await jwtVerify(
      body.id_token,
      keysFor(cfg.authOrigin, cfg.bypass ? { 'x-vercel-protection-bypass': cfg.bypass } : null),
      { issuer: cfg.authOrigin, audience: cfg.clientId },
    ));
  } catch {
    return { error: 'token_invalid' };
  }
  if (claims.nonce !== tx.nonce) return { error: 'nonce_mismatch' };

  const member = { sub: String(claims.sub), name: claims.name, email: claims.email };
  const token = await new SignJWT({ name: member.name, email: member.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(member.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + cfg.sessionTtl)
    .sign(secretBytes(cfg));

  return { member, token, next: safeNext(tx.next) };
}

// The verified member behind a session token, or null. Identity only — a
// property reads its own roles from its own records, never from here.
export async function readSession(cfg, token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretBytes(cfg));
    return { sub: String(payload.sub), name: payload.name, email: payload.email, iat: payload.iat };
  } catch {
    return null;
  }
}

export function endSessionUrl(cfg, postLogout) {
  const url = new URL(`${cfg.authOrigin}/session/end`);
  if (postLogout) url.searchParams.set('post_logout_redirect_uri', postLogout);
  return url.href;
}
