# sandbox-auth

The drop-in a property uses to consume **[auth.sandbox.is](https://auth.sandbox.is)** — "Sign in with Sandbox".

A property authenticates the *person*, not itself. It is a **public client**: there is no client secret. PKCE and an exact registered return URL do what a secret used to. Identity is central; **permissions are yours** — you read a member's roles from your own records, keyed on the Sandbox member id. Nothing about what anyone may do comes from Sandbox.

Your whole integration is small: a button, one callback route, some configuration, and — if you gate pages — one middleware check.

---

## Install

Not on npm (deliberately — so it can't be picked up by accident). Depend on it from the public repo, pinned to a tag:

```json
{
  "dependencies": {
    "sandbox-auth": "git+https://github.com/cesarsalazar/sandbox-auth.git#v0.4.0",
    "jose": "^5"
  }
}
```

`jose` is a peer dependency (used for the JWT it signs and verifies). Most apps already have it; add it if not.

---

## 1. The button

Served from auth. It does all the preparation — PKCE, state, nonce — and sends the browser straight to auth. The property builds no login-start of its own. Put it on your login page:

```html
<div data-sandbox-signin data-client="your-client-id"></div>
<script src="https://auth.sandbox.is/button.js"></script>
```

| attribute | |
|---|---|
| `data-client` | **required** — your registered client id |
| `data-next` | optional — where to land after signing in, e.g. `/dashboard` |

(`data-callback` and `data-scope` exist for advanced use; the defaults — `<origin>/api/auth/callback` and `openid` — are what you want.)

**Next.js** login page:

```tsx
import Script from "next/script";

export default function Login() {
  return (
    <>
      <div data-sandbox-signin data-client="your-client-id" />
      <Script src="https://auth.sandbox.is/button.js" strategy="afterInteractive" />
    </>
  );
}
```

## 2. The callback

The one route you mount. It receives the redirect back from auth, exchanges the code, verifies the identity token, and sets **your own** session cookie (a `__Host-`-prefixed, host-only cookie auth never sees).

**Next.js** — `app/api/auth/callback/route.ts`:

```ts
export { GET } from "sandbox-auth/next";
```

**Plain Node http:**

```js
import { sandboxAuth } from "sandbox-auth/node";
const sandbox = sandboxAuth();

// in your request handler:
if (path === "/api/auth/callback") return sandbox.handleCallback(req, res);
```

The callback must live at the path you registered with auth. The default is `/api/auth/callback`; to use another, set `callbackPath` in config **and** register that URL.

## 3. Configuration

Environment, no code:

| variable | |
|---|---|
| `SANDBOX_AUTH_CLIENT_ID` | **required** — your public client id, registered with auth |
| `SANDBOX_AUTH_CLIENT_SESSION_SECRET` | **required** — a long random string that signs your own session cookie (auth never sees it) |
| `SANDBOX_AUTH_ORIGIN` | optional — defaults to `https://auth.sandbox.is` |
| `SANDBOX_AUTH_CLIENT_SESSION_TTL` | optional — session lifetime in seconds; defaults to 30 days |
| `SANDBOX_AUTH_BYPASS` | optional — only for reaching a protection-gated **preview** auth in testing; never set against production |

Your property is a client of Sandbox Auth, so both required names are `SANDBOX_AUTH_CLIENT_*`: the id auth knows you by, and the secret for the session you keep on your own side. Any of these can also be passed in code — every entry point takes an optional overrides object (`{ clientId, sessionSecret, authOrigin, sessionTtl, cookieName, callbackPath }`).

---

## Reading who is signed in

**Next.js** — in a server component, route handler, or server action:

```ts
import { getSession } from "sandbox-auth/next";

const member = await getSession(); // { sub, name, email, iat } | null
```

**Node:**

```js
const member = await sandbox.getSession(req);
```

`member.sub` is the Sandbox member id. Look up roles in your own records, keyed on it:

```ts
const member = await getSession();
if (!member) return redirect("/login");
const { role } = await db.members.findBySub(member.sub); // your table, your rules
```

`getSession` also honors a Sandbox sign-out (see below) — a session the member has since signed out of is returned as `null`.

## Protecting pages (middleware)

`getSession` reads cookies via `next/headers`, which middleware can't use — so in middleware use the core primitives directly. This also lets you run the sign-out check (`revoked`) at the edge, before a page renders:

```ts
// middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { resolveConfig, readSession, revoked, cookieName } from "sandbox-auth/core";

const PUBLIC = ["/login", "/api/auth"];

let cfg: ReturnType<typeof resolveConfig> | null = null;
const getCfg = () => (cfg ??= resolveConfig());

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const token =
    request.cookies.get(cookieName(getCfg(), true))?.value ??
    request.cookies.get(cookieName(getCfg(), false))?.value;
  const session = await readSession(getCfg(), token);
  const signedOut = session ? await revoked(getCfg(), session) : false;

  if (!session || signedOut) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + request.nextUrl.search);
    const res = NextResponse.redirect(login);
    if (signedOut) {
      for (const secure of [true, false]) {
        res.cookies.set(cookieName(getCfg(), secure), "", { path: "/", maxAge: 0 });
      }
    }
    return res;
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

---

## Signing out

There are two different things a person can mean by "sign out."

**Sign out of your property** — end the local session:

**Next.js** — in a route handler:

```ts
import { NextResponse } from "next/server";
import { signOut, signOutUrl } from "sandbox-auth/next";

export async function POST() {
  const endSessionUrl = signOutUrl({}, "https://your-property/");
  const res = NextResponse.json({ ok: true, endSessionUrl });
  signOut(res, {}, "https://your-property/"); // clears the session cookie on `res`
  return res;
}
```

**Node:**

```js
const authSignOutUrl = sandbox.signOut(req, res); // clears the cookie, returns the auth sign-out URL
```

**Sign out of Sandbox too** — send the browser to the returned URL. Auth shows a "Sign out of Sandbox?" screen and ends the central session. Offer this as the next step when the member meant "everywhere":

```ts
const { endSessionUrl } = await (await fetch("/api/auth/logout", { method: "POST" })).json();
window.location.href = endSessionUrl;
```

You can also get that URL directly with `signOutUrl(overrides?, postLogout?)`.

### Sign-out-everywhere (revocation)

*Since v0.4.0.* Each property keeps its own cookie, so on its own a Sandbox sign-out could not reach into a property and end its session. It does now: auth records each sign-out, and `getSession` (and the `revoked()` check in your middleware) asks auth whether the member signed out *after* this session was issued. If so, the session is rejected and the cookie dropped.

- **Automatic** in `getSession`. In middleware, call `revoked(cfg, session)` yourself, as shown above.
- **Fail-open.** The check is a fetch of a short-lived, CDN-cached endpoint on auth; any error or timeout returns "not revoked," so an auth blip never locks your property. The session's own expiry is the backstop.
- **Prompt, not instant.** Global effect lands within the cache window (~15 seconds). A fresh login afterward has a newer issued-at and survives.

This also means an admin revoking a member in auth signs them out of every property, by the same mechanism.

---

## API reference

### `sandbox-auth/next`

| | |
|---|---|
| `GET(request)` | the default callback handler — `export { GET } from "sandbox-auth/next"` |
| `callback(overrides?)` | build a callback handler with explicit config |
| `getSession(overrides?)` | the signed-in member, or `null` (revocation-aware) |
| `signOut(response, overrides?, postLogout?)` | clear the local cookie on `response`; returns the auth sign-out URL |
| `signOutUrl(overrides?, postLogout?)` | the auth sign-out URL, without touching a response |

### `sandbox-auth/node`

`sandboxAuth(overrides?)` returns `{ cfg, handleCallback(req, res), getSession(req), signOut(req, res) }`.

### `sandbox-auth/core`

Framework-free building blocks (used by the adapters, and by middleware):

| | |
|---|---|
| `resolveConfig(overrides?)` | resolve env + overrides into a config object |
| `cookieName(cfg, secure)` | the session cookie name (`__Host-` prefixed when secure) |
| `readSession(cfg, token)` | verify a session token → member or `null` |
| `revoked(cfg, session)` | has this session been signed out of Sandbox? (fail-open) |
| `completeSignIn({ cfg, query, cookies, redirectUri })` | the callback exchange, as pure data in/out |
| `endSessionUrl(cfg, postLogout?)` | the auth sign-out URL |

---

## Requirements

- Your **client id and redirect URI must be registered with auth** — the exact return-URL allowlist is the security boundary that stands in for a client secret. A property talks to auth only after it's registered.
- Serve the property over **HTTPS** in production. The session cookie is `__Host-`-prefixed (host-only, secure, root path), which a plain-http dev server cannot set — the name falls back there, so local development still works.

## What this is not

- **Not a shared session.** Each property keeps its own host-only cookie; a hostile subdomain can neither read nor set it.
- **Not a place for roles.** Identity is central; permissions are local to each property.
- **Not holding a secret.** PKCE and the exact return URL do what a client secret used to.
