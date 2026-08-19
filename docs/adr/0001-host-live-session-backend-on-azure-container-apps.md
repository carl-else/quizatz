---
status: accepted
---

# Host the live-session backend on Azure Container Apps

Quizatz will host its authoritative Node WebSocket backend on Azure Container
Apps Consumption and persist live-session state in Azure Table Storage. This
replaces PartyKit because managed PartyKit deployment is blocked and the Azure
composition can use the existing Visual Studio credit while remaining near the
original zero-cost goal for intermittent use.

The MVP runs with `minReplicas: 0` and `maxReplicas: 1`. The process is a
connection hub and cache, while Table Storage is the durable authority and uses
ETag-based optimistic concurrency. Clients must reconnect and rehydrate after
cold starts, deployments, or restarts. Supporting multiple replicas requires a
backplane or another coordination design and is a later architecture decision.
