# Quizatz

Quizatz is a temporary collaborative live-questioning application. This first slice lets an authenticated organizer create a live session and lets an anonymous participant join its real-time lobby by short code or share URL.

## Architecture

The approved MVP architecture is:

- A TypeScript and Vue single-page application on GitHub Pages.
- An authoritative Node WebSocket backend on Azure Container Apps Consumption.
- Live-session persistence in Azure Table Storage, using ETags for optimistic concurrency.
- Single-tenant Microsoft Entra authentication for organizers and named participants.

The Container App scales from zero to one replica for the MVP. Its process is a
connection hub and cache; Table Storage remains authoritative. Clients reconnect
and rehydrate after cold starts, deployments, or restarts. Multiple replicas
require a backplane or another coordination design and are outside the MVP.

See [the accepted architecture decision](docs/adr/0001-host-live-session-backend-on-azure-container-apps.md)
and [the provider research](docs/research/state-sync-provider-alternatives.md).

## Local development

Requires Node.js 22 or newer.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

This starts the Vue application at `http://localhost:5173`, the Node backend at
`http://localhost:3000`, and an Azurite Table service. `.env` is shared by Vite
and the local backend; only `VITE_*` values are included in browser code.

For Microsoft sign-in, register a single-tenant Entra SPA and resource API:

1. Add `http://localhost:5173/auth-callback.html` and the deployed Pages callback URL (for example, `https://<owner>.github.io/quizatz/auth-callback.html`) as SPA redirect URIs.
2. Expose a delegated API scope such as `access_as_user`.
3. Set the API manifest's `requestedAccessTokenVersion` to `2`. The backend validates the v2 issuer and audience.
4. Put the browser-visible client ID, tenant ID, and complete API scope in `.env.local` using `.env.example`.
5. Configure the backend with `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `ENTRA_API_SCOPE`, and `ALLOWED_ORIGINS`. `ENTRA_API_CLIENT_ID` is the application client-ID GUID used by the v2 token's `aud` claim. `ENTRA_API_SCOPE` is the scope claim name, such as `access_as_user`.

Client secrets and certificates are neither required nor supported. Do not put credentials in `VITE_*` values.

## Verification

```powershell
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

The browser test starts Azurite, the Node backend, and Vue. It creates a live
session with an ephemeral server-side test token, joins through an independent
anonymous browser context, verifies the participant count in real time, then
discards the process-local connection hub and proves both clients reconnect and
rehydrate from Table Storage.

## Deployment

Azure resources are isolated in `rg-quizatz-prod` in subscription
`b75faa02-db01-487a-bf96-156a8fc08879`. The checked-in Bicep creates a
Consumption Container App environment, a Container App constrained to zero or
one replica, a Storage account and `LiveSessions` table, and a system-assigned
identity with Storage Table Data Contributor access.

To provision the foundation and configure GitHub OIDC plus repository
variables, put the Entra values from `.env.example` in `.env`, authenticate
`az` and `gh`, then run:

```powershell
./scripts/setup-deployment.ps1
```

The script always selects and verifies the approved subscription before making
changes. It creates the GitHub deployment principal with `Contributor` and
`Role Based Access Control Administrator` scoped only to `rg-quizatz-prod`.

The GitHub Actions flow tests the application, publishes the public
`ghcr.io/carl-else/quizatz-backend` image, deploys it through OIDC, and then
builds Pages with the resulting backend URL. No Azure client secret, Storage
key, or registry pull credential is used. The first published GHCR package must
be set to public in its GitHub package settings so Container Apps can pull it.
Azure credentials and server configuration must never be exposed through
`VITE_*` values.

Keep the Visual Studio subscription spending limit enabled and configure Cost
Management alerts at `$10` and `$15`. Azure budgets notify but do not stop
resources.
