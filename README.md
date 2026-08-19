# Quizatz

Quizatz is a temporary collaborative live-questioning application. This first slice lets an authenticated organizer create a live session and lets an anonymous participant join its real-time lobby by short code or share URL.

## Local development

Requires Node.js 22 or newer.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

The Vue application runs at `http://localhost:5173`; PartyKit runs at `http://localhost:1999`.

For Microsoft sign-in, register a single-tenant Entra SPA and resource API:

1. Add `http://localhost:5173/auth-callback.html` and the deployed Pages callback URL (for example, `https://<owner>.github.io/quizatz/auth-callback.html`) as SPA redirect URIs.
2. Expose a delegated API scope such as `access_as_user`.
3. Set the API manifest's `requestedAccessTokenVersion` to `2`. PartyKit validates the v2 issuer and audience.
4. Put the browser-visible client ID, tenant ID, and complete API scope in `.env.local` using `.env.example`. Keep the local PartyKit host at `localhost:1999`, its protocol at `ws`, and `VITE_BASE_PATH=/`; the Pages workflow supplies the deployed host and repository path.
5. Provide PartyKit with `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `ENTRA_API_SCOPE`, and `ALLOWED_ORIGINS`. `ENTRA_API_CLIENT_ID` is the application client-ID GUID used by the v2 token's `aud` claim. `ENTRA_API_SCOPE` is the scope claim name, such as `access_as_user`.

Client secrets and certificates are neither required nor supported. Do not put credentials in `VITE_*` values.

## Verification

```powershell
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

The browser test starts local Vue and PartyKit servers, creates a live session with an ephemeral server-side test token, joins through an independent anonymous browser context, and verifies the participant count in real time.

## Deployment

The Pages workflow expects repository variables `ENTRA_CLIENT_ID`, `ENTRA_TENANT_ID`, `ENTRA_API_SCOPE`, and `PARTYKIT_HOST`.

The PartyKit workflow expects repository variables `ENTRA_CLIENT_ID`, `ENTRA_TENANT_ID`, `ENTRA_API_SCOPE_NAME`, and `ALLOWED_ORIGINS`, plus the secrets `PARTYKIT_LOGIN` and `PARTYKIT_TOKEN`. `ALLOWED_ORIGINS` is a comma-separated list containing the deployed Pages origin.

Enable GitHub Pages with **GitHub Actions** as its source. PartyKit must be deployed before the Pages application can create live sessions.
