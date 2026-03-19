# Changelog

## v0.1.0 — 2026-03-18

Initial public release.

### What's included

**Core infrastructure**
- `@forge/types` — Zod schemas for every domain object: BehavioralUnit, TaskGraph, AutonomyGap, AgentAction, VerificationResult, Digest, and more
- `@forge/db` — Postgres + pgvector client, migration runner, vector similarity search
- `@forge/events` — Shared event broadcaster; decouples agents from API layer (no circular deps)

**Intent graph**
- BehavioralUnit CRUD with full status machine (proposed → verified → deployed → deprecated)
- DAG with cycle detection, transitive dependency resolution, cascade propagation
- Semantic similarity search via pgvector (1536-dim embeddings)
- Autonomy gap tracker with frequency analysis and velocity trending

**Spec compiler**
- Natural language → TaskGraph decomposition pipeline
- Quality gating (rejects specs scoring below 40/100)
- Ambiguity detection: missing actors, vague performance claims, scope ambiguity
- Conflict detection against existing intent graph via cosine similarity + LLM analysis

**Agents**
- `ImplementerAgent` — tournament loop: 1–3 parallel implementations, behavioral verification scoring, winner selection by score minus complexity penalty
- `VerifierAgent` — anti-gaming detection via Claude Haiku audit, behavioral claim verification, regression detection, consecutive-failure escalation
- `ChiefOfStaffAgent` — 9am/4pm digest with exactly one ask, gap analysis, token cost summary
- `AgentRunner` — bounded concurrency pipeline orchestrating implement → verify → status update
- Digest scheduler with Slack webhook + Resend/SMTP email delivery

**Security**
- Policy graph enforced at action-log level (not just prompt level)
- Hard blocks on auth/billing/payment/deploy without human approval
- Soft blocks on deletes and external API calls
- Full audit trail in `agent_actions` table

**API**
- Hono REST server + Bun WebSocket + SSE fallback for real-time events
- 30+ endpoints covering the full intent graph lifecycle
- `/api/run` — queues BUs for agent implementation, returns job handle
- `/api/digest` — generates chief-of-staff digest on demand
- Static UI serving in production (detects `apps/ui/dist` at startup)

**Web UI**
- Intent map: force-directed graph, physics simulation, BU detail panel
- Chief-of-staff inbox: digest view, inline escalation resolution
- Autonomy gap tracker: velocity trend, type breakdown, BU heatmap
- Behavioral diff view: added/removed/changed claims between deployments
- Agent activity feed: SSE real-time stream, polling fallback

**CLI**
- `forge init` — initialize in any repo, optional import of existing code
- `forge spec` — compile spec, preview TaskGraph, interactive approval
- `forge status` — intent graph by domain
- `forge digest` — CoS digest with inline resolution
- `forge gaps` — gap analysis with bar chart
- `forge diff` — behavioral diff between deployments
- `forge verify` — run behavioral verification on a BU
- `forge run` — queue pending BUs for agent implementation
- `forge tokens` — token cost breakdown by role and model
- `forge watch` — real-time agent activity stream via WebSocket

**Developer experience**
- `make setup` — one command: installs deps, starts Postgres, runs migrations
- `make seed` — 10 realistic BUs across auth/users/billing with dependency edges
- `make test` — 16 test files, all unit tests run without network or DB
- `make healthcheck` — validates full stack before going live
- `replit-start.sh` — zero-config Replit startup

### Known limitations

- Single-tenant only (no multi-user isolation)
- No GitHub PR integration (git bridge exports to files only)
- No on-premise packaging beyond Docker Compose
- LLM calls hardcoded to Anthropic Claude Sonnet; model adapter exists but not wired through all agents
