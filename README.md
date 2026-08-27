# sandbox-auth

sandbox-auth lets your web app sign people in with their Sandbox account, through **[auth.sandbox.is](https://auth.sandbox.is)**.

When someone signs in, you find out who they are: their Sandbox member id, name, and email. What they're allowed to do is up to you — keep roles in your own database and look them up by the member id. Sandbox handles identity; your app handles permissions.

Each app gets its own session, tied to its own domain, so one Sandbox site can't read another's.

There are two adapters, plus a framework-free core to build on for anything else:

- **Next.js** (App Router) → `sandbox-auth/next`
- **Node** (plain `http` server) → `sandbox-auth/node`
- **anything else** → `sandbox-auth/core`

The examples below cover Next.js and Node. Setting it up is four small steps:

1. [the button](#1-the-button) on your login page
2. [one callback route](#2-the-callback)
3. [configuration](#3-configuration)
4. [reading who's signed in](#read-whos-signed-in) — plus a [middleware check](#gate-pages) if you protect pages

---

## Install

Install it from GitHub, pinned to a version tag. It isn't published to npm.

```json
{
  "dependencies": {
    "sandbox-auth": "git+https://github.com/cesarsalazar/sandbox-auth.git#v0.4.0",
    "jose": "^5"
  }
}
```

`jose` does the signing and checking of the session token. Install it alongside if your app doesn't already use it.

---

## 1. The button

The button comes from auth: a snippet of HTML and a script tag that work on any page. The script sets up the sign-in and sends the person to auth to log in. Add it to your login page:

```html
<div data-sandbox-signin data-client="your-client-id"></div>
<script src="https://auth.sandbox.is/button.js"></script>
```

To send them to a particular page after they sign in, add `data-next`:

```html
<div data-sandbox-signin data-client="your-client-id" data-next="/dashboard"></div>
```

| attribute | | |
|---|---|---|
| `data-client` | **required** | your registered client id |
| `data-next` | optional | where to land after signing in |

In a Next.js app, use the same two tags and load the script with `next/script`:

```tsx
// app/login/page.tsx
import Script from "next/script";

export default function Login() {
  return (
    <>
      <div data-sandbox-signin data-client="your-client-id" data-next="/dashboard" />
      <Script src="https://auth.sandbox.is/button.js" strategy="afterInteractive" />
    </>
  );
}
```

## 2. The callback

You add one route. It handles the person coming back from auth: it checks them and sets your app's session cookie.

**Next.js** — the whole route file, `app/api/auth/callback/route.ts`:

```ts
export { GET } from "sandbox-auth/next";
```

**Node** — one method on your server:

```js
import { sandboxAuth } from "sandbox-auth/node";
const sandbox = sandboxAuth();

// in your request handler:
if (path === "/api/auth/callback") return sandbox.handleCallback(req, res);
```

Put it at the path you registered with auth. The default is `/api/auth/callback`; to use a different one, set `callbackPath` in your config and register that URL instead.

## 3. Configuration

Set these in your environment. They work the same for both adapters.

| variable | | |
|---|---|---|
| `SANDBOX_AUTH_CLIENT_ID` | **required** | your client id, registered with auth |
| `SANDBOX_AUTH_CLIENT_SESSION_SECRET` | **required** | a long random string that signs your session cookie |
| `SANDBOX_AUTH_ORIGIN` | optional | defaults to `https://auth.sandbox.is` |
| `SANDBOX_AUTH_CLIENT_SESSION_TTL` | optional | how long a session lasts, in seconds; defaults to 30 days |
| `SANDBOX_AUTH_BYPASS` | optional | for testing against a protected preview of auth; leave unset in production |

Both required names start with `SANDBOX_AUTH_CLIENT_` because your app is a client of Sandbox Auth: `CLIENT_ID` is how auth knows you, and `CLIENT_SESSION_SECRET` signs the session cookie you keep on your own side.

You can also pass any of these in code instead of the environment. Every entry point accepts an overrides object: `{ clientId, sessionSecret, authOrigin, sessionTtl, cookieName, callbackPath }`.

---

## Read who's signed in

**Next.js** — in a server component, route handler, or server action:

```ts
import { getSession } from "sandbox-auth/next";

const member = await getSession(); // { sub, name, email, iat } | null
```

**Node** — from the request:

```js
const member = await sandbox.getSession(req); // { sub, name, email, iat } | null
```

`member.sub` is the person's Sandbox id. Use it to find their role in your own data:

```ts
const member = await getSession();
if (!member) return redirect("/login");
const { role } = await db.members.findBySub(member.sub); // your table, your rules
```

## Gate pages

In **Next.js**, protect pages with middleware. It does three things: let public paths through, read the session from the cookie, and send anyone without one to `/login`. Because it runs on every request, it's also where a Sandbox sign-out gets caught, before the page loads.

Middleware can't use `next/headers`, so it reaches for the `core` functions directly. Copy this and edit `PUBLIC` for your app:

```ts
// middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { resolveConfig, readSession, revoked, cookieName } from "sandbox-auth/core";

const PUBLIC = ["/login", "/api/auth"];

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const cfg = resolveConfig();
  const token =
    request.cookies.get(cookieName(cfg, true))?.value ??
    request.cookies.get(cookieName(cfg, false))?.value;
  const session = await readSession(cfg, token);

  // No session, or one from before a Sandbox sign-out → back to login.
  if (!session || (await revoked(cfg, session))) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

On a plain **Node** server there's no separate step. Call `sandbox.getSession(req)` at the top of each protected handler — it runs the same sign-out check — and redirect when it returns `null`.

---

## Sign out

Signing out can mean two things: leaving your app, or leaving Sandbox entirely.

**Leave your app** — clear the local session cookie. In a Next.js route handler, `signOut` clears it on the response, and `signOutUrl` gives you the Sandbox sign-out URL to hand back:

```ts
import { NextResponse } from "next/server";
import { signOut, signOutUrl } from "sandbox-auth/next";

export async function POST() {
  const home = "https://your-property/";
  const res = NextResponse.json({ endSessionUrl: signOutUrl({}, home) });
  signOut(res, {}, home); // clears the session cookie
  return res;
}
```

Node:

```js
const authSignOutUrl = sandbox.signOut(req, res); // clears the cookie, returns the auth sign-out URL
```

**Leave Sandbox too** — send the person to the URL those calls return. Auth shows a "Sign out of Sandbox?" page and ends the central session. Offer it as a second step, once your app's logout finishes:

```ts
const { endSessionUrl } = await (await fetch("/api/auth/logout", { method: "POST" })).json();
window.location.href = endSessionUrl;
```

### Signing out of Sandbox signs out everywhere

When someone signs out of Sandbox, their session ends in every app, not just the one they were in. Auth records the sign-out, and both `getSession` and the middleware check reject any session created before it, clearing the cookie. The same thing happens when an admin removes a member.

- `getSession` does this automatically, in both adapters. In Next.js middleware, call `revoked(cfg, session)` yourself, as shown above.
- The check calls a small, cached endpoint on auth, so it's fast and rarely reaches auth itself.
- If it can't reach auth, it treats the session as still valid — an auth outage never locks people out of your app. The session's normal expiry is the backstop.
- It takes effect within about 15 seconds. A login after the sign-out is newer, so it isn't affected.

*Requires v0.4.0.*

---

## API

**`sandbox-auth/next`**

| | |
|---|---|
| `GET(request)` | the default callback handler — `export { GET } from "sandbox-auth/next"` |
| `callback(overrides?)` | a callback handler with explicit config |
| `getSession(overrides?)` | the signed-in member, or `null` |
| `signOut(response, overrides?, postLogout?)` | clears the cookie on `response`, returns the auth sign-out URL |
| `signOutUrl(overrides?, postLogout?)` | the auth sign-out URL |

**`sandbox-auth/node`** — `sandboxAuth(overrides?)` returns `{ cfg, handleCallback(req, res), getSession(req), signOut(req, res) }`.

**`sandbox-auth/core`** — the building blocks the adapters use, and what you reach for in middleware: `resolveConfig`, `cookieName`, `readSession`, `revoked`, `completeSignIn`, `endSessionUrl`.

---

## Before you start

- **Register your app with auth.** Your client id and return URL have to be added to auth's client list first. Auth only sends people back to a URL you registered, which is what keeps a public client safe.
- **Serve over HTTPS in production.** The session cookie uses the `__Host-` prefix, which requires it. On a plain http dev server the cookie name changes automatically, so local development still works.

## How it's designed

- **No client secret.** Your app doesn't hold one. Auth only returns people to a URL you registered ahead of time, and the sign-in uses PKCE — together those keep it secure.
- **Identity is central, permissions are local.** Auth says who someone is; your app decides what they can do.
- **Separate sessions.** Each app has its own session cookie, tied to its own domain. One subdomain can't read or change another's.
