<!-- markdownlint-disable MD034 -->

# Fixed GitHub Pages, PartyKit, and Microsoft Sign-In Feasibility

Date: 2026-08-19

> **Status: Superseded on 2026-08-19.** This report established that the original
> stack was technically feasible, but managed PartyKit deployment later became
> unavailable. The PartyKit platform conclusion is replaced by
> [ADR 0001](../adr/0001-host-live-session-backend-on-azure-container-apps.md).
> The GitHub Pages and Microsoft Entra security findings remain applicable to
> the Azure Container Apps backend.

## Historical Decision (Superseded)

**Feasible, with required specification constraints.** A TypeScript/Vue static
client on GitHub Pages can obtain Microsoft Entra work/school identities in the
browser and connect directly to a PartyKit room. PartyKit can authenticate the
connection before it reaches room logic, and persistent room state can recover
organizer authorization after server or browser reconnects. No material blocker
requires replacing GitHub Pages or PartyKit. [GitHub Pages: About](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages) [PartyKit: Authentication](https://docs.partykit.io/guides/authentication/) [PartyKit: Persisting state](https://docs.partykit.io/guides/persisting-state-into-storage/) [Microsoft: SPA configuration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-spa-app-registration)

This conclusion assumes one Microsoft Entra tenant for the internal-company MVP.
Supporting several tenants is possible, but then issuer and tenant validation
must follow Microsoft's multitenant rules. [Microsoft: Access-token validation](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens)

## Evidence And Findings

### Static client and sign-in

GitHub Pages publishes HTML, CSS, and JavaScript from a repository, including
build output, so it can host a Vue single-page application but cannot act as a
confidential server component. Its project-site URL is normally
`https://<owner>.github.io/<repository>`, which must be accounted for in the
Entra redirect URI and Vue base path. [GitHub Pages: About](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages)

Microsoft supports JavaScript single-page applications through `msal-browser`.
The Entra application registration must configure the deployed GitHub Pages URL
as a redirect URI of type `spa`; Microsoft recommends authorization code flow
with PKCE for SPAs. [Microsoft: SPA configuration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-spa-app-registration) [Microsoft: Authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)

The client is a public client: it must not contain a client secret or certificate.
Microsoft explicitly says public clients, including SPAs, must not use them when
redeeming authorization codes. The Entra application (client) ID and tenant ID
are configuration values, not secrets. [Microsoft: Authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)

GitHub warns that Pages should not be used for sensitive transactions such as
sending passwords. Quizatz must therefore never collect a Microsoft password or
publish a secret in its Pages assets; the browser redirects to Microsoft for
authentication. [GitHub Pages: Limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

### Browser-to-PartyKit without a client secret

PartyKit rooms accept standard HTTP and WebSocket connections from browsers, and
the PartySocket TypeScript client supports an asynchronous `query` function for
attaching a freshly acquired token. PartySocket also reconnects automatically.
[PartyKit: How it works](https://docs.partykit.io/how-partykit-works/) [PartySocket API](https://docs.partykit.io/reference/partysocket-api/)

PartyKit documents passing a session token on the initial WebSocket request and
using `onBeforeConnect` to verify it before the connection reaches `onConnect`.
That handler may reject the connection with HTTP 401. This gives the PartyKit
server, rather than the Vue client, the authorization boundary. [PartyKit: Authentication](https://docs.partykit.io/guides/authentication/)

For named participants and organizers, the Vue client must request an **access
token for a Quizatz API registered in Entra**, not reuse a Microsoft Graph token
or treat an ID token as an authorization credential. The PartyKit server is the
resource API and must accept only a token whose `aud` matches its configured App
ID URI, validate its signature and issuer through Entra OpenID metadata/JWKS,
and enforce the expected scope and configured tenant. Microsoft states that web
APIs must validate access tokens and accept only tokens bearing one of their App
ID URIs as `aud`; it also documents API scope registration and the `scp` claim.
[Microsoft: Access tokens](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens) [Microsoft: Expose a web API](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-configure-app-expose-web-apis)

The same PartyKit authentication boundary may permit an anonymous connection
only when the stored session access policy allows anonymous participation. Such
a connection receives a server-generated anonymous participant identity and no
organizer privileges. This is an application policy built on PartyKit's
pre-connection authorization hook. [PartyKit: Authentication](https://docs.partykit.io/guides/authentication/)

### Organizer authorization recovery

The room must store the verified organizer principal and role as session state,
not a browser-local flag or a bearer token. PartyKit provides transactional room
storage that survives server restarts; PartyKit also guarantees that connections
using the same room ID route to the same room. On every connect or reconnect,
the server can validate the submitted Entra access token and compare its trusted
tenant-scoped principal with the stored organizer principal before allowing
organizer commands. [PartyKit: Persisting state](https://docs.partykit.io/guides/persisting-state-into-storage/) [PartyKit: How it works](https://docs.partykit.io/how-partykit-works/) [Microsoft: Access tokens](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens)

The client should reacquire an access token before each PartySocket connection.
MSAL caches sign-in state and tokens for the application domain and supports
silent sign-in, but browsers blocking third-party cookies can require an
interactive Microsoft sign-in. Token-expiry or an interactive-login requirement
therefore pauses organizer recovery; it does not transfer organizer control to
another participant. [Microsoft: MSAL.js SSO](https://learn.microsoft.com/en-us/entra/identity-platform/msal-js-sso) [Microsoft: Authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)

### Temporary live-session and room lifetime

The repository's existing statement that PartyKit deletes rooms after 24 hours
of inactivity is **not substantiated by the reviewed PartyKit documentation**.
The documented behavior is different: room state stored only in memory can be
lost on restart; `Room.storage` persists state across restarts; and hibernation
can unallocate the server instance after seconds of inactivity while preserving
open connections and requiring state to be reloaded. Hibernation is not live
session expiry or storage deletion. [PartyKit: Persisting state](https://docs.partykit.io/guides/persisting-state-into-storage/) [PartyKit: Hibernation](https://docs.partykit.io/guides/scaling-partykit-servers-with-hibernation/)

The temporary-product requirement is still feasible, but it must be explicit:
store `expiresAt` and terminal session state in room storage; reject joins,
reconnects, and commands after expiry; expose the configured closed state; and
delete session data through controlled application cleanup. Do not use WebSocket
disconnect, server restart, or hibernation as the expiry signal. This follows
from PartyKit's documented separation of persistent storage, restarts, and
hibernation. [PartyKit: Persisting state](https://docs.partykit.io/guides/persisting-state-into-storage/) [PartyKit: Hibernation](https://docs.partykit.io/guides/scaling-partykit-servers-with-hibernation/)

## Required Specification Constraints

1. Register a single-tenant Entra SPA with every production and local redirect
   URI as `spa`; use MSAL authorization code flow with PKCE. Do not put a
   client secret, certificate, password, or tenant-private server credential in
   GitHub Pages output. [Microsoft: Authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
2. Register a Quizatz resource API and scope. Named participants and organizers
   request that scope. In `onBeforeConnect`, PartyKit validates signature,
   issuer, expiry, tenant, audience, and scope before trusting a named identity.
   It must reject access tokens for other resources. [PartyKit: Authentication](https://docs.partykit.io/guides/authentication/) [Microsoft: Access tokens](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens)
3. Make authorization server-enforced. Store the organizer's verified,
   tenant-scoped principal in room storage and compare it on each authenticated
   connection; never decide organizer status from a client-sent role, display
   name, or persisted browser flag. [PartyKit: Persisting state](https://docs.partykit.io/guides/persisting-state-into-storage/) [Microsoft: Access tokens](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens)
4. Keep anonymous participation separate. Allow it only when the stored session
   access policy permits it, assign only anonymous participant permissions, and
   do not silently upgrade it from an unverified client claim. [PartyKit: Authentication](https://docs.partykit.io/guides/authentication/)
5. Define application-level live-session retention: an `expiresAt` value,
   closed-state behavior, cleanup responsibility, and whether a closed session
   remains viewable. The specification must not claim a PartyKit 24-hour
   inactivity deletion guarantee without a current contractual source.
   [PartyKit: Persisting state](https://docs.partykit.io/guides/persisting-state-into-storage/) [PartyKit: Hibernation](https://docs.partykit.io/guides/scaling-partykit-servers-with-hibernation/)
6. Specify reconnect UX: PartySocket reconnects with a newly acquired token;
   when MSAL cannot renew silently, show an organizer sign-in action and retain
   the organizer role for the matching principal only. [PartySocket API](https://docs.partykit.io/reference/partysocket-api/) [Microsoft: MSAL.js SSO](https://learn.microsoft.com/en-us/entra/identity-platform/msal-js-sso)

## Historical Product Decision (Superseded)

At the time of this investigation, no platform decision needed reopening. The
later deployment failure and cost comparison superseded that conclusion. Do not
use this section as current platform guidance; use ADR 0001. The report's
retention finding remains valid: Quizatz requires explicit live-session expiry
and cleanup rather than relying on infrastructure inactivity.

## Primary Sources

- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- PartyKit authentication: https://docs.partykit.io/guides/authentication/
- PartyKit persistence: https://docs.partykit.io/guides/persisting-state-into-storage/
- PartyKit hibernation: https://docs.partykit.io/guides/scaling-partykit-servers-with-hibernation/
- PartyKit architecture: https://docs.partykit.io/how-partykit-works/
- PartySocket client API: https://docs.partykit.io/reference/partysocket-api/
- Microsoft Entra SPA configuration: https://learn.microsoft.com/en-us/entra/identity-platform/scenario-spa-app-registration
- Microsoft Entra authorization code flow: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- Microsoft Entra access tokens: https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens
- Microsoft Entra API scopes: https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-configure-app-expose-web-apis
- Microsoft Entra MSAL.js SSO: https://learn.microsoft.com/en-us/entra/identity-platform/msal-js-sso

<!-- markdownlint-enable MD034 -->