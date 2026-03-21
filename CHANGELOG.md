# Changelog

## v0.2.0 — 2026-03-21

**343 passing. 0 failures. 14 packages. 9 migrations. 122 files. 403KB.**

### New: `@forge/daemon` — the autonomous intelligence layer

Five systems, one package, running every 5 minutes alongside the probe runner:

**Daemon engine** (`daemon_state` + `daemon_scan_results`) — self-healing state machine. Every component registers heartbeats. 5 consecutive errors → `waiting_human`. Below threshold → auto-restart. `v_daemon_health` view shows health across all workspaces: `healthy`, `warning`, `critical`. `GET /api/daemon/health` surfaces this to the Command Center.

**Federated intelligence** (`federation_contributions` + `federation_priors`) — privacy-preserving cross-deployment annotation sharing. Laplace noise (ε=0.1) applied before any aggregate signal leaves a workspace — noisy counts and noisy first-pass rates, never raw content. Local trust weight starts at 20% (trust global intelligence at first), converges to 80% at session 100 (trust your own accumulated history). `injectFederatedPriors()` runs before every spec compilation.

**RL feedback guard** (`rl_scoring_log`) — tournament scoring integrity. Three signals: score variance across variants (suspiciously low = gaming pattern found), test-claim alignment (too many tests per claim = probing implementation not behavior), implementation diversity (identical hashes = not actually generating different approaches). Gaming regime blocks selection until human review. Wired into the implementer's tournament loop via `POST /api/daemon/rl-assess`.

**T34 pipeline integrity** (`pipeline_feeds` + `pipeline_integrity_checks`) — external data feed tamper detection before agents act on them. Welford online algorithm: rolling baseline (mean + stddev) over first 30 samples. After baseline locked: z-score > 3 = `anomaly`, z-score > 5 = `tamper_suspected`, agent blocked from acting on that data.

**T35 personal agent surface** (`personal_surface_zones` + `personal_surface_events`) — hard boundary between the software factory and personal data. Hard-block set: read/send/delete email, read/create/delete calendar, read/write contacts, read/modify identity, read financial accounts, initiate payment. Any of these arriving through `spec_compiler → implementer` chain = injection-suspected, blocked with forensic log.

### New migrations (006–009)

- `006_annotations.sql` — domain annotations learning loop: agents record what they learned from resolved gaps so the next implementer starts with context
- `007_signed_audit_retro.sql` — HMAC signatures on `agent_actions` (DoD/NDAA FY2026 compliance ready), `v_cost_per_bu`, `v_weekly_retro`
- `008_company_ops.sql` — attendance with evidence_refs, payroll/credits, inter-agent comms, cross-workspace pairing, rejected-ideas graveyard
- `009_autonomous_engine.sql` — daemon state machine, federated intelligence, RL scoring log, T34 pipeline feeds, T35 surface zones

### Scheduler update

Four parallel background loops now run non-blocking:
- Probe runner (every 60s)
- Company ops (every 5min)
- Company pairing / payroll / graveyard (every 5min)
- Daemon engine (every 5min)

---

## v0.1.1 — 2026-03-20

### New: `@forge/mcp` — 13 MCP tools for Claude Code

`forge_compile_spec`, `forge_get_graph`, `forge_get_annotations`, `forge_run_batch`, `forge_get_production`, `forge_get_retro`, `forge_get_cost`, `forge_record_annotation`, `forge_get_gaps`, `forge_resolve_gap`, `forge_get_portfolio`, `forge_dispatch`, `forge_propagate_annotation`.

Add to Claude Code: `claude mcp add forge "bun run /path/to/forge/packages/mcp/src/index.ts"`

### New: multi-tenant workspaces (`migration 005`)

- `workspaces` table with slug, name, plan (solo / team / enterprise)
- `api_keys` table scoped per workspace (SHA-256 keyed, prefix display)
- `behavioral_units` and `probe_schedules` workspace-scoped
- Default workspace preserves all existing single-tenant data

### New: `forge portfolio` + portfolio API

- `GET /api/cc/portfolio` — all workspaces, BU counts by status, one call
- `POST /api/cc/dispatch` — natural language task → behavioral units in the right workspace
- `POST /api/cc/propagate-annotation` — push a domain annotation across all workspaces

### New: `scripts/seed-will.ts`

Five companies, five workspaces, real behavioral units. Aiglos (DoD compliance), InstantPrequal (8.2s credit decision), Strider Logistics (FedEx ISP roll-up), TPM Sciences (GLP-1RA combination therapy), CofC Grammar School (AI-adaptive instruction).

---

## v0.1.0 — 2026-03-18

Initial public release.

**187 tests across 11 packages, all passing.**

### What's included

**Core infrastructure**
- `@forge/types` — Zod schemas for every domain object
- `@forge/db` — Postgres + pgvector, migration runner, vector similarity search
- `@forge/events` — Shared event broadcaster (no circular deps)

**Intent graph**
- BehavioralUnit CRUD with status machine (proposed → verified → deployed → deprecated)
- DAG with cycle detection, transitive dependency resolution, cascade propagation
- Semantic similarity search via pgvector (1536-dim embeddings)
- Autonomy gap tracker with frequency analysis and velocity trending

**Spec compiler**
- NL → TaskGraph decomposition pipeline
- Quality gating (rejects specs scoring below 40/100)
- Ambiguity detection: missing actors, vague performance claims, scope ambiguity
- Conflict detection via cosine similarity + LLM analysis

**Agents**
- `ImplementerAgent` — tournament loop: 1–3 parallel implementations, winner by behavioral score minus complexity
- `VerifierAgent` — anti-gaming via Claude Haiku audit, consecutive-failure escalation
- `ChiefOfStaffAgent` — 9am/4pm digest, exactly one ask, token cost summary
- `AgentRunner` — bounded concurrency orchestration

**Security**
- Policy graph enforced at action-log level (not prompt level)
- Hard blocks on auth/billing/payment/deploy
- Soft blocks on deletes and external API calls
- Full audit trail in `agent_actions`

**`@forge/probes`**
- Acceptance criteria → HTTP probes (Claude Haiku inference)
- Probe schedules per deployed BU, configurable interval
- Three consecutive failures cascade `needs_reverification` through intent graph
- CoS escalation on probe failure

**API** — Hono REST + Bun WebSocket + SSE, 35+ endpoints

**CLI** — `forge spec / status / digest / gaps / diff / run / probe / watch`
