// The Next.js adapter. The whole of a property's callback route is:
//
//   export { GET } from "sandbox-auth/next";
//
// and where it needs the member:  const member = await getSession();
import { NextResponse } from 'next/server';
import { cookies as nextCookies } from 'next/headers';
import { resolveConfig, completeSignIn, readSession, revoked, endSessionUrl, cookieName, sessionToken } from './core.mjs';

function cfgOnce(overrides) {
  return resolveConfig(overrides);
}

function originOf(request) {
  const h = request.headers;
  const proto = h.get('x-forwarded-proto') || 'https';
  const host = h.get('x-forwarded-host') || h.get('host');
  return `${proto}://${host}`;
}

// The one-line callback route mounts this.
export function callback(overrides = {}) {
  const cfg = cfgOnce(overrides);
  return async function GET(request) {
    const origin = originOf(request);
    const secure = origin.startsWith('https://');
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const cookies = Object.fromEntries((request.cookies.getAll?.() ?? []).map((c) => [c.name, c.value]));
    const result = await completeSignIn({ cfg, query, cookies, redirectUri: `${origin}${cfg.callbackPath}` });

    // Back to the sign-in page, saying why, so the app can tell the member and
    // the builder can tell what broke. access_denied is the member choosing
    // Cancel on auth's consent screen; the rest are listed in the README.
    if (result.error) {
      const retry = new URL(overrides.retryPath || '/login', origin);
      retry.searchParams.set('error', result.error);
      const res = NextResponse.redirect(retry);
      res.cookies.delete(cfg.txCookie);
      return res;
    }
    const res = NextResponse.redirect(new URL(result.next, origin));
    res.cookies.set(cookieName(cfg, secure), result.token, {
      httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: cfg.sessionTtl,
    });
    res.cookies.delete(cfg.txCookie);
    return res;
  };
}

// Default handler, resolved lazily on first request so importing this module —
// which Next does at build time — never needs the env to be present yet.
let defaultHandler;
export async function GET(request) {
  if (!defaultHandler) defaultHandler = callback();
  return defaultHandler(request);
}

// Read the member in a server component / route / middleware.
//
// Cookies first, config second. Reading cookies is what tells Next the page
// is dynamic, so a build never pre-renders it — and someone with no session
// is simply nobody, whatever is configured. Together those let a first deploy
// build and run before the app has its client id.
export async function getSession(overrides = {}) {
  const token = sessionToken(await nextCookies(), overrides);
  if (!token) return null;
  const cfg = cfgOnce(overrides);
  const session = await readSession(cfg, token);
  // A session the member has since signed out of Sandbox is no session here.
  if (session && await revoked(cfg, session)) return null;
  return session;
}

export function signOutUrl(overrides = {}, postLogout) {
  return endSessionUrl(cfgOnce(overrides), postLogout);
}

// Clears the property's session cookie on the given response and returns the
// auth sign-out URL to offer.
export function signOut(response, overrides = {}, postLogout) {
  const cfg = cfgOnce(overrides);
  for (const secure of [true, false]) {
    response.cookies.set(cookieName(cfg, secure), '', { path: '/', maxAge: 0, httpOnly: true, secure, sameSite: 'lax' });
  }
  return endSessionUrl(cfg, postLogout);
}
