<!-- markdownlint-disable MD024 MD034 -->

# State Synchronization Provider Alternatives for Quizatz

Date: 2026-08-19

## Decision Summary

**Decision:** remove PartyKit and host the authoritative Node WebSocket backend
on **Azure Container Apps Consumption**, with live-session state in **Azure
Table Storage**. Use one replica at most for the MVP, scale to zero when idle,
and use ETag-based optimistic concurrency for persisted state. The accepted
decision is recorded in
[ADR 0001](../adr/0001-host-live-session-backend-on-azure-container-apps.md).

This option was selected because it supports the 50-participant target without
Azure Web PubSub Free's 20-connection ceiling, preserves the current custom
WebSocket protocol, aligns with Microsoft Entra, and fits the available
`$10-15/month` Azure-credit allowance. The trade-off is deliberate single-replica
availability: clients must reconnect and rehydrate after cold starts,
deployments, or restarts.

PartyKit, PartyServer, Azure Web PubSub, Convex, Supabase, Ably, and Pusher are
not the MVP deployment target. Their evaluations remain below as decision
history.

## Budget-Adjusted Decision

The additional constraint is a `$0` target with up to `$10-15/month` of an
existing `$50/month` Visual Studio Azure credit available to Quizatz.

### Verified Azure economics

- Azure Web PubSub Free includes one unit with **20 concurrent connections**
  and **20,000 messages/day**. Standard provides 1,000 connections per unit at
  approximately **$1.61/unit/day**, billed per second, before regional,
  currency, and offer differences.
  [Web PubSub pricing](https://azure.microsoft.com/en-us/pricing/details/web-pubsub/)
- At the published US estimate, continuously running one Standard unit is about
  `$49.11` for a 30.5-day month. A `$10-15` allowance buys only about 6.2-9.3
  Standard-unit days per month, not an always-available deployment.
- Azure Functions Flex Consumption has a monthly free grant of 250,000
  on-demand executions and 100,000 GB-s per paid consumption subscription.
  The legacy Consumption plan has a larger free grant, but Microsoft recommends
  Flex Consumption for new serverless function apps.
  [Functions pricing](https://azure.microsoft.com/en-us/pricing/details/functions/)
  [Functions hosting](https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale)
- Cosmos DB serverless has no minimum throughput charge and is billed for
  consumed request units and storage. Published US estimates are `$0.25` per
  million request units and `$0.25/GB-month` of transactional storage.
  [Cosmos DB pricing](https://azure.microsoft.com/en-us/pricing/details/cosmos-db/serverless/)
- Durable Entities persist state and serialize operations for each entity;
  durable timers wake a scaled-to-zero function app when their timer becomes
  visible. These are a closer match to PartyKit's per-session authority and
  alarm than a general database plus polling timer, though Microsoft notes that
  Durable Entities prioritize durability over latency.
  [Durable Entities](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-entities)
  [Durable timers](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-timers)
- Visual Studio subscriptions normally have a spending limit equal to the full
  monthly credit, not a custom `$10-15` hard cap. Cost Management budgets alert
  but do not stop resources, and cost data can lag by 8-24 hours.
  [Azure spending limit](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/spending-limit)
  [Azure budgets](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets)

### Azure Container Apps alternative

Web PubSub is not required. Azure Container Apps Consumption can host a normal
Node WebSocket server behind managed HTTP ingress:

- HTTP ingress explicitly supports WebSockets, TLS termination, a managed FQDN,
  custom domains, and optional session affinity.
  [Container Apps ingress](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview)
- Consumption includes 180,000 vCPU-seconds, 360,000 GiB-seconds, and 2 million
  requests per subscription per month. It can scale to zero, where compute has
  no usage charge.
  [Container Apps pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/)
  [Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing)
- With one `0.25` vCPU/`0.5 GiB` replica active continuously for a 30.5-day
  month, a deliberately conservative calculation that charges every allocated
  second at the published active rate is about `$14.36` after the monthly free
  grant. Intermittent quiz use with scale-to-zero should be substantially less.
  Storage, logs, outbound traffic, and exchange/offer differences remain extra.
- A scheduled Container Apps job can perform expiry cleanup, although checking
  expiry when state is read or mutated may be enough for the MVP.
  [Container Apps jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs)

For the MVP, set `minReplicas: 0` and `maxReplicas: 1`, persist each session in
Azure Table Storage with ETag-based optimistic concurrency, and treat the
process as a cache and connection hub. This avoids distributed fan-out and room
ownership while preserving the existing custom WebSocket protocol. A restart,
deployment, or scale-to-zero event disconnects clients, so clients must reconnect
and rehydrate state. The first connection after scale-to-zero also pays a cold
start. Multiple replicas would require a backplane or managed realtime service
and are outside this low-cost design.

### Engineering judgment

The credits make a small Azure-hosted WebSocket server viable and therefore do
change the recommendation:

1. **Preferred Azure MVP:** one Azure Container Apps Consumption replica plus
  Azure Table Storage. It has no 20-connection product-tier ceiling, should
  remain `$0` for intermittent use, and has a conservative continuous-active
  compute estimate inside the `$10-15` allowance. It also entails more server
  and persistence ownership than PartyKit or Durable Objects.
2. **At most 20 simultaneous browser connections:** Azure Web PubSub Free plus
  Functions and Durable Entities remains viable. Reserve one connection for
  the organizer, giving a practical cap of **19 participants**. This is more
  managed but introduces more services and changes the current protocol.
3. **More than 20 connections requiring multi-replica resilience:** use
  Cloudflare Durable Objects or Convex Free at `$0`. Continuously running Web
  PubSub Standard is about `$49/month`, and a robust multi-replica Container
  Apps design requires a backplane, making neither the simple budget choice.
4. **Occasional scheduled use of Web PubSub Standard:** Standard can fit the
  allowance for roughly 6-9 aggregate service-days per month because billing
  is per second. Treat this as a workshop deployment mode, not normal
  production: infrastructure must be provisioned or scaled deliberately, and
  availability outside those windows is sacrificed.

Azure SignalR does not improve this result. Its published Free and Standard
connection, message, and unit prices match Web PubSub, while its programming
model is less natural for Quizatz's current TypeScript custom-message protocol.
[SignalR pricing](https://azure.microsoft.com/en-us/pricing/details/signalr-service/)

### Zero-dollar comparison

| Stack | Relevant free capacity | Budget conclusion |
| --- | --- | --- |
| Azure Container Apps + Table Storage | 180,000 vCPU-s, 360,000 GiB-s, 2 million requests/month | Best Azure MVP; single replica is an architectural constraint |
| Azure Web PubSub + Functions | 20 connections, 20,000 messages/day | Good only with an explicit 19-participant cap |
| Cloudflare Workers + Durable Objects | 100,000 Worker and DO requests/day; 13,000 DO GB-s/day; SQLite storage quotas | Best fit at `$0`, but limits hard-fail and Entra JWT CPU usage must be load-tested |
| Convex Free | 1,000 concurrent sessions, 1 million function calls/month, 0.5 GB database | Best non-Cloudflare `$0` capacity; largest model rewrite and high lock-in |
| Supabase Free | 200 peak realtime connections and 2 million messages/month | Capacity fits, but inactivity pausing and auth/RLS redesign weaken the fit |

[Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/)
[Convex limits](https://docs.convex.dev/production/state/limits)
[Supabase pricing](https://supabase.com/pricing)

## Prototype Baseline (Repository Evidence)

At the time of this decision, the checked-in first slice used
Party.Server/PartySocket. Issue #5 replaces this prototype and removes its
dependencies, configuration, and deployment workflow:

- Static Vue frontend on GitHub Pages workflow. (`.github/workflows/pages.yml`)
- Browser direct realtime via PartySocket. (`src/lobby.ts`)
- Authoritative per-live-session state in room storage. (`party/index.ts`)
- Server-enforced organizer auth via Entra JWT validation in `onBeforeConnect` and `onConnect`. (`party/index.ts`)
- Unique 6-char codes with collision retry on create. (`src/lobby.ts`)
- Alarm-based 24-hour lease expiry and cleanup. (`party/index.ts`)
- PartyKit deploy workflow using PartyKit token secrets. (`.github/workflows/partykit.yml`)

This baseline strongly favors alternatives that preserve:

- HTTP + WebSocket room endpoint model
- per-room authoritative state object
- alarm/scheduled callback semantics

## Trigger Event: Managed PartyKit Block

### Verified facts

- `partykit/partykit#985` reports `partykit.dev` deployment failures due to Cloudflare custom-domain limits on the shared zone; comments report existing deployments continue but new deployments fail. [partykit/partykit#985](https://github.com/partykit/partykit/issues/985)
- A PartyKit maintainer comment in that issue gives workaround direction: deploy PartyServer directly to your own Cloudflare account. [partykit/partykit#985](https://github.com/partykit/partykit/issues/985)

### Engineering judgment

- This is sufficient to treat managed PartyKit new deployment as unreliable for MVP planning until upstream status changes.

## Candidate Evaluations

## 1) PartyServer on own Cloudflare account (Wrangler + Durable Objects + workers.dev)

### Architectural fit

### Verified facts

- PartyServer supports the lifecycle hooks Quizatz needs (`onRequest`,
  `onConnect`, `onClose`, and `onAlarm`), Durable Object storage through
  `this.ctx.storage`, connection enumeration, broadcasting, connection state,
  and PartyKit-style routing through `routePartykitRequest()`.
  [PartyServer](https://github.com/cloudflare/partykit/tree/main/packages/partyserver)
- PartyServer is a Durable Objects-backed room runtime and PartySocket remains
  a supported browser client.
  [PartyServer](https://github.com/cloudflare/partykit/tree/main/packages/partyserver)
- Durable Objects provide stateful compute + durable storage + alarms with at-least-once semantics. [Durable Objects](https://developers.cloudflare.com/durable-objects/) [DO alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- workers.dev provides deployable endpoint without custom domain onboarding. [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- PartyKit “deploy to own Cloudflare account” guide exists, but is cloud-prem/domain-oriented and explicitly calls out future wrangler integration (indicating potential doc staleness vs current workaround patterns). [Deploy to your own Cloudflare account](https://docs.partykit.io/guides/deploy-to-cloudflare/)

### Engineering judgment

- Quizatz's current `party/index.ts` is already aligned with Durable Object
  semantics, making a migration to PartyServer the smallest provider change.
- This is a source migration, not only a deployment switch: the class must
  extend PartyServer's `Server`, use its context/storage properties, and be
  exported through a Wrangler Worker handler using `routePartykitRequest()`.

### Room storage/alarm/hooks replacement

- Replacement is conceptually close: `room.storage` -> `this.ctx.storage`,
  `room.broadcast()` -> `this.broadcast()`, `room.getConnections()` ->
  `this.getConnections()`, and the static pre-connect hook ->
  `routePartykitRequest()`'s `onBeforeConnect` option.

### Entra + anonymous auth fit

- Existing Entra JWT verification and anonymous gating policy can remain server-enforced in room logic (same trust boundary).

### Deployment prerequisites

- Cloudflare account, Durable Object bindings/migrations, Wrangler-based CI deployment, workers.dev or custom domain routing.

### Migration shape / blast radius

- Low to medium.
- Keep the app protocol intact (`SessionCreated`, `LobbySnapshot`, `expired`),
  retain PartySocket and its `/parties/:party/:room` URL shape, and port the room
  logic to the closely related PartyServer lifecycle.
- Replace `partykit.json` and managed-PartyKit CI credentials with
  `wrangler.jsonc`, Durable Object bindings/migrations, and Cloudflare CI
  credentials. Update the production host variable to the deployed
  `workers.dev` or custom-domain host.

### Operational burden and lock-in

- Low ops burden (managed edge runtime); lock-in remains Cloudflare runtime semantics.

### Pricing/limits notes (verified)

- Durable Objects available on Workers Free/Paid plans with platform limits/pricing docs. [Durable Objects overview](https://developers.cloudflare.com/durable-objects/)
- workers.dev is intended as quick-start/hobby route; production recommendation is route/custom domain. [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

### Material risks

- PartyKit cloud-prem docs may lag current operational reality.
- Need explicit validation of CI/deploy path in this repo before committing a spec-level provider decision.

## 2) Azure Web PubSub + Azure Functions + state store/scheduler

### Architectural fit

### Verified facts

- Web PubSub is managed realtime connection/messaging infrastructure (connections/users/groups/events), not your business state store. [Web PubSub overview](https://learn.microsoft.com/en-us/azure/azure-web-pubsub/overview) [Service internals](https://learn.microsoft.com/en-us/azure/azure-web-pubsub/concept-service-internals)
- In serverless pattern, client connects with negotiated token and events flow to upstream handlers (often Functions) using CloudEvents/webhook style. [Service internals](https://learn.microsoft.com/en-us/azure/azure-web-pubsub/concept-service-internals) [Serverless quickstart](https://learn.microsoft.com/en-us/azure/azure-web-pubsub/quickstart-serverless)
- Azure Functions timer triggers support scheduled execution via NCRONTAB. [Timer trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-timer)
- Cosmos DB TTL can auto-expire items, including per-item overrides; expiry deletion is background and may be delayed by RU constraints. [Cosmos TTL](https://learn.microsoft.com/en-us/azure/cosmos-db/time-to-live)

### Engineering judgment

- This stack can satisfy all Quizatz requirements if authoritative state lives in Cosmos DB (or equivalent), with explicit server-side lease checks and timer-driven expiry notifications/cleanup.
- For strict “non-extendable 24h lease,” rely on `expiresAt` enforcement in command handlers and push expiry events from scheduled logic; use TTL for physical cleanup, not as sole logical authority.

### Room storage/alarm/hooks replacement

- Party room storage -> Cosmos DB (or other store) partitioned by session code.
- Party alarms -> Timer trigger and/or scheduled workflows, plus TTL for garbage collection.
- Party pre-connect hook -> negotiate endpoint + upstream auth and command authorization.

### Entra + anonymous auth fit

- Strong fit in Microsoft ecosystem. Functions/App Service auth and token validation patterns are documented.
- Anonymous participants can be represented as anonymous app identities in your own state model.

### Deployment prerequisites

- Azure subscription, resource group, Web PubSub, Function App, storage account, state store (Cosmos DB), identity/secret management, Actions-based deployment.

### Migration shape / blast radius

- Medium to high.
- `src/lobby.ts` connection path must switch from PartySocket room endpoint to negotiate + Web PubSub connection flow.
- `party/index.ts` room-centric in-memory model must be rewritten as function/event handler + persistent store workflow.

### Operational burden and lock-in

- Higher than Cloudflare option (more services), but still managed PaaS.
- Lock-in to Azure service model and Functions bindings/events.

### Pricing/limits notes (verified)

- Web PubSub and SignalR both publish Free/Standard/Premium tiers and message/connection limits with estimator caveats. [Web PubSub pricing](https://azure.microsoft.com/en-us/pricing/details/web-pubsub/) [SignalR pricing](https://azure.microsoft.com/en-us/pricing/details/signalr-service/)

### Material risks

- Complexity inflation for MVP due multi-service composition.
- Lease-expiry behavior must be designed carefully (TTL alone is insufficient for deterministic user-facing expiry timing).

## 2b) Azure SignalR + Azure Functions + state store/scheduler (variant)

### Verified facts

- SignalR serverless mode with Functions requires negotiate endpoint and trigger/output bindings. [SignalR serverless config](https://learn.microsoft.com/en-us/azure/azure-signalr/signalr-concept-serverless-development-config) [SignalR bindings](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-signalr-service)

### Engineering judgment

- Viable, but less natural than Web PubSub for Quizatz’s current raw WebSocket + custom event protocol model.
- Better if team is strongly invested in SignalR tooling/ecosystem.

## 3) Convex

### Architectural fit

### Verified facts

- Convex provides reactive realtime query subscriptions over its own database model. [Convex Realtime](https://docs.convex.dev/realtime)
- Scheduled functions (`runAt`, `runAfter`) are durable and can be atomic when scheduled from mutations. [Scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions)
- Convex supports custom OIDC and custom JWT auth providers with explicit issuer/audience requirements. [Custom OIDC](https://docs.convex.dev/auth/advanced/custom-auth) [Custom JWT](https://docs.convex.dev/auth/advanced/custom-jwt)
- Convex docs include custom hosting workflows, including GitHub Pages examples. [Custom hosting](https://docs.convex.dev/production/hosting/custom)

### Engineering judgment

- Convex is a complete deployable backend candidate for Quizatz requirements, including authoritative state and scheduling.
- However, adopting Convex requires moving from room-object semantics to Convex data/functions/reactive-query patterns; this is a substantial conceptual migration.

### Room storage/alarm/hooks replacement

- Room storage -> Convex tables/documents.
- Alarm -> scheduled function(s) with lease metadata.
- Pre-connect hook -> auth config + per-mutation authorization checks.

### Entra + anonymous auth fit

- Entra can fit via OIDC/JWT integration.
- Anonymous participants require deliberate token issuance and policy design (not the same as “no token” room join).

### Deployment prerequisites

- Convex project/deployment setup, auth provider integration, Convex CLI in CI/CD.

### Migration shape / blast radius

- High.
- Replace `party/index.ts` and PartySocket protocol assumptions with Convex client/query subscription flow.

### Operational burden and lock-in

- Low ops, high platform lock-in to Convex runtime/data model.

### Pricing/limits notes (verified)

- Convex publishes free/starter/pro and resource limits including concurrent sessions and scheduling limits. [Convex pricing](https://www.convex.dev/pricing) [Convex limits](https://docs.convex.dev/production/state/limits)

### Material risks

- Architecture rewrite risk for MVP schedule.
- Team must adopt Convex-specific backend development model.

## 4) Supabase Realtime + Postgres + Edge Functions/Cron

### Architectural fit

### Verified facts

- Supabase Realtime provides Broadcast/Presence/Postgres Changes channels. [Realtime overview](https://supabase.com/docs/guides/realtime)
- Broadcast/presence are transport/state-sharing features; durable authoritative state remains in Postgres. [Broadcast](https://supabase.com/docs/guides/realtime/broadcast) [Presence](https://supabase.com/docs/guides/realtime/presence)
- Supabase Auth supports anonymous sign-ins and differentiating via `is_anonymous` claims under RLS. [Anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)
- Supabase SSO with SAML supports Entra, but is plan-gated (Pro+). [SAML SSO](https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml)
- Scheduled jobs are available via pg_cron/Supabase Cron. [Cron](https://supabase.com/docs/guides/cron)
- RLS is powerful but dangerous if grants/policies are misconfigured. [RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security)

### Engineering judgment

- Technically complete stack for Quizatz, but policy/security and data modeling complexity is higher than current Party room model.
- Good fit if team already comfortable with SQL/RLS/pg_cron; otherwise likely overkill for this MVP.

### Room storage/alarm/hooks replacement

- Room storage -> Postgres session tables.
- Alarm -> pg_cron jobs and/or function scheduler.
- Pre-connect policy -> Auth + RLS + server-side function checks.

### Entra + anonymous auth fit

- Both supported, but SSO/commercial details must be checked against current plan.

### Deployment prerequisites

- Supabase project, schema/RLS migrations, function deployment pipeline, key management.

### Migration shape / blast radius

- High.
- Replace PartySocket room endpoint assumptions and recast protocol flow around Supabase channels + DB.

### Operational burden and lock-in

- Medium ops (managed, but more policy/data operations).
- Moderate lock-in to Supabase auth/realtime conventions.

### Pricing/limits notes (verified)

- Free projects can pause after inactivity; Realtime/Auth/SSO limits are plan-specific and published. [Supabase pricing](https://supabase.com/pricing)

### Material risks

- RLS misconfiguration risk is nontrivial.
- Anonymous-user cleanup is not automatic in auth docs; requires explicit cleanup jobs. [Anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)

## 5) Ably and Pusher

### Architectural fit

### Verified facts

- Ably and Pusher are realtime pub/sub platforms with channel auth, presence/occupancy capabilities. [Ably channels](https://ably.com/docs/channels) [Ably occupancy](https://ably.com/docs/presence-occupancy/occupancy) [Pusher Channels](https://pusher.com/docs/channels) [Pusher presence](https://pusher.com/docs/channels/using_channels/presence-channels/)
- Both require server-side token/auth endpoints for secure channel access models. [Ably auth](https://ably.com/docs/auth) [Pusher authorization](https://pusher.com/docs/channels/server_api/authorizing-users)

### Engineering judgment

- **Not complete substitutes** for PartyKit room authority.
- They can replace transport/presence, but you still must build authoritative session state, organizer authorization checks, lease enforcement, and cleanup scheduler in separate backend services.

### Room storage/alarm/hooks replacement

- Not provided as first-class room state/alarm runtime in base offerings.
- Requires additional backend (e.g., Functions + DB + scheduler), making total stack more complex than Cloudflare/Convex direct options.

### Migration shape / blast radius

- Medium to high (client and server both change), plus additional components.

### Operational burden and lock-in

- Medium to high once complete stack is assembled.

### Pricing/limits notes (verified)

- Both publish tiered message/connection limits and paid scaling. [Ably pricing](https://ably.com/pricing) [Pusher pricing](https://pusher.com/channels/pricing)

### Material risks

- Scope creep: transport solved, authoritative domain behavior still unsolved unless extra backend is built.

## 6) Stronger additional alternative discovered: Raw Cloudflare Workers + Durable Objects (without PartyKit layer)

### Why this is stronger

### Verified facts

- Durable Objects natively provide the stateful room primitive, strong consistency, WebSocket support patterns, and alarms. [Durable Objects](https://developers.cloudflare.com/durable-objects/) [DO alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- workers.dev supports immediate deploy endpoints without custom domains. [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

### Engineering judgment

- This avoids managed PartyKit platform dependencies entirely while staying in same conceptual runtime family as current code.
- It may be more durable than waiting on PartyKit managed fixes and may be easier to reason about long-term than partial PartyKit cloud-prem docs.

### Migration shape / blast radius

- Medium.
- If endpoint shape is preserved (`/parties/main/:room` + POST create + WS connect), `src/lobby.ts` can remain largely stable while server runtime abstraction changes.

### Material risks

- You own more runtime glue previously supplied by PartyKit tooling.
- Requires careful protocol compatibility testing against existing PartySocket behavior.

## Complete-Stack Ranking For Quizatz MVP

1. **Azure Container Apps Consumption + Azure Table Storage** (selected)
2. **Raw Cloudflare Workers + Durable Objects** (best strict-zero alternative)
3. **Convex** (complete free tier but high conceptual migration and lock-in)
4. **Azure Web PubSub + Functions + durable state** (managed, but Free is capped at 20 connections and Standard exceeds the budget)
5. **PartyServer on Cloudflare** (low source migration, but retains PartyKit-family dependencies that the decision removes)
6. **Supabase Realtime + Postgres + Edge Functions/Cron** (complete but security/policy complexity)
7. **Azure SignalR + Functions + state store** (same base-cost problem as Web PubSub and less natural for the current protocol)
8. **Ably/Pusher as sole provider** (reject as incomplete substitute)

## Best-Of Categories Requested

- **Selected option:** Azure Container Apps Consumption + Azure Table Storage.
- **Best strict-zero alternative:** raw Cloudflare Workers + Durable Objects.
- **Reject for this MVP as primary provider:** Ably-only, Pusher-only.

## Provider-Neutral Seam Recommendation (Only because it earns its keep)

A seam is justified because at least two realistic implementations were
evaluated:

- Selected implementation: Node WebSocket backend on Azure Container Apps with
  Azure Table Storage.
- Credible alternative: raw Cloudflare Workers with Durable Objects.

### Recommended seam boundary

Keep seam at **application protocol/domain command level**, not raw socket API:

- Commands: `CreateLiveSession`, `JoinLiveSession`, `OrganizerAuthenticate`, `SetAccessPolicy`, `ExpireSession`, future `StartQuestion`, `SubmitAnswer`, `RevealResult`.
- Events/Snapshots: `SessionCreated`, `LobbySnapshot`, `SessionExpired`, future `QuestionActivated`, `AnswerAccepted`, `ResultRevealed`.

This preserves domain language from `CONTEXT.md` and allows transport/runtime swap without rewriting frontend state logic repeatedly.

### Not recommended seam

- Generic “WebSocketProvider” abstraction. Too low-level, leaks transport concerns, and does not protect domain invariants.

## Migration Blast Radius vs Current Files

- `party/index.ts`: replace with the Node backend while preserving domain rules and Entra authorization.
- `src/lobby.ts`: replace PartySocket with the native WebSocket client and explicit reconnect/rehydration behavior.
- `.github/workflows/partykit.yml`: replace with container build and Azure Container Apps deployment.
- `.github/workflows/pages.yml`: mostly stable; only environment variables/host URL wiring changes.
- `README.md` + issue/spec docs: must update to reflect chosen provider and deployment assumptions.

## Facts Not Fully Verifiable From Current Primary Sources

1. **An end-to-end migration guide from `partykit/server` to PartyServer** could
   not be found. The official PartyServer package README documents the target
   Worker and Wrangler configuration, but not this specific migration.
2. **Current operational status/ETA** for permanent resolution of issue #985 is not documented with a maintainer roadmap in the fetched issue content.
3. **Exact cost forecast for your expected traffic** cannot be responsibly stated from list pricing pages alone (all providers note estimate/plan-context caveats).

## Decision Follow-Up

Completed on 2026-08-19:

1. Issue #5, the parent specification, and affected downstream tickets now use
  the Azure architecture and constraints.
2. ADR 0001 records the accepted decision; prior research is marked superseded.
3. `README.md` describes the new trust boundaries and marks PartyKit deployment
  instructions obsolete.

Still pending in issue #5:

1. Replace the runtime, client transport, tests, and deployment workflow.
2. Remove PartyKit packages, configuration, scripts, variables, and secrets.

## Primary Sources

### Repository and ticket context

- https://github.com/carl-else/quizatz/issues/5
- Local repository files read: `CONTEXT.md`, `initial.md`, `docs/research/fixed-stack-feasibility.md`, `party/index.ts`, `src/lobby.ts`, `package.json`, `partykit.json`, `.github/workflows/pages.yml`, `.github/workflows/partykit.yml`, `README.md`

### PartyKit / Cloudflare

- https://github.com/partykit/partykit/issues/985
- https://docs.partykit.io/reference/partyserver-api/
- https://github.com/cloudflare/partykit/tree/main/packages/partyserver
- https://docs.partykit.io/how-partykit-works/
- https://docs.partykit.io/guides/deploy-to-cloudflare/
- https://docs.partykit.io/guides/deploying-your-partykit-server/
- https://developers.cloudflare.com/durable-objects/
- https://developers.cloudflare.com/durable-objects/api/alarms/
- https://developers.cloudflare.com/workers/configuration/routing/workers-dev/

### Azure Container Apps / Storage / managed realtime alternatives

- https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview
- https://learn.microsoft.com/en-us/azure/container-apps/billing
- https://learn.microsoft.com/en-us/azure/container-apps/scale-app
- https://azure.microsoft.com/en-us/pricing/details/container-apps/
- https://learn.microsoft.com/en-us/azure/storage/tables/table-storage-overview

- https://learn.microsoft.com/en-us/azure/azure-web-pubsub/overview
- https://learn.microsoft.com/en-us/azure/azure-web-pubsub/concept-service-internals
- https://learn.microsoft.com/en-us/azure/azure-web-pubsub/quickstart-serverless
- https://learn.microsoft.com/en-us/azure/azure-signalr/signalr-overview
- https://learn.microsoft.com/en-us/azure/azure-signalr/signalr-concept-serverless-development-config
- https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-signalr-service
- https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-timer
- https://learn.microsoft.com/en-us/azure/cosmos-db/time-to-live
- https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-time-to-live
- https://learn.microsoft.com/en-us/azure/storage/tables/table-storage-overview
- https://azure.microsoft.com/en-us/pricing/details/web-pubsub/
- https://azure.microsoft.com/en-us/pricing/details/signalr-service/

### Convex

- https://docs.convex.dev/realtime
- https://docs.convex.dev/scheduling/scheduled-functions
- https://docs.convex.dev/auth
- https://docs.convex.dev/auth/advanced/custom-auth
- https://docs.convex.dev/auth/advanced/custom-jwt
- https://docs.convex.dev/production/hosting/custom
- https://docs.convex.dev/testing/ci
- https://docs.convex.dev/production/state/limits
- https://www.convex.dev/pricing

### Supabase

- https://supabase.com/docs/guides/realtime
- https://supabase.com/docs/guides/realtime/broadcast
- https://supabase.com/docs/guides/realtime/presence
- https://supabase.com/docs/guides/functions
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/cron
- https://supabase.com/docs/guides/auth/auth-anonymous
- https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml
- https://supabase.com/pricing

### Ably / Pusher

- https://ably.com/docs
- https://ably.com/docs/auth
- https://ably.com/docs/channels
- https://ably.com/docs/presence-occupancy/occupancy
- https://ably.com/pricing
- https://pusher.com/docs/channels
- https://pusher.com/docs/channels/using_channels/presence-channels/
- https://pusher.com/docs/channels/server_api/authorizing-users
- https://pusher.com/channels/pricing
