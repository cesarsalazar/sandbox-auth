# sandbox-auth

Sign in with Sandbox, for any property. A property authenticates the person, not
itself — it is a public client, so there is **no secret**. Its whole integration
is three things.

## 1. The button

Served from auth; it does all the preparation and goes straight to auth.

```html
<div data-sandbox-signin data-client="your-client-id"></div>
<script src="https://auth.sandbox.is/button.js"></script>
```

Optional: `data-next="/somewhere"` to return there after signing in.

## 2. The callback

The one route the property mounts. It receives the redirect and sets the
property's own session cookie.

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

## 3. Configuration

Environment, no code:

```
SANDBOX_CLIENT_ID        your public client id, registered with auth
SANDBOX_SESSION_SECRET   any long random string — signs your own session cookie
SANDBOX_AUTH_ORIGIN      optional, defaults to https://auth.sandbox.is
```

## Reading who is signed in

**Next.js:**

```ts
import { getSession } from "sandbox-auth/next";
const member = await getSession();   // { sub, name, email } | null
```

**Node:**

```js
const member = await sandbox.getSession(req);
```

`member.sub` is the Sandbox member id. Roles are yours: look them up in your own
records, keyed on the id. Nothing about permissions comes from Sandbox.

## Signing out

```js
const authSignOut = sandbox.signOut(req, res); // clears the local session,
                                               // returns the auth sign-out URL
```

Signing out of your property is not the same as signing out of Sandbox — offer
`authSignOut` if the member meant the latter.

## What this is not

- **Not a session you share.** Each property keeps its own host-only cookie; a
  hostile subdomain can neither read nor set it.
- **Not a place for roles.** Identity is central; permissions are local.
- **Not holding a secret.** PKCE and the exact return URL do what a client
  secret used to.
