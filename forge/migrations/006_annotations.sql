-- Forge migration 006: domain annotations
--
-- The learning loop. When agents encounter domain_knowledge gaps, they
-- record what they learned so the next agent doesn't hit the same wall.
-- Annotations flow: gap detected → human resolves → agent records annotation
-- → next implementer reads it before generating variants.
--
-- This is context-hub's chub annotate pattern, but wired directly into
-- the intent graph. The autonomy_gaps table was one-way (up to humans).
-- domain_annotations is two-way (agents learn from resolved gaps).

CREATE TABLE IF NOT EXISTS domain_annotations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Scope: annotations can be domain-wide or BU-specific
  domain        TEXT NOT NULL,              -- e.g. "billing", "auth", "webhooks"
  key           TEXT NOT NULL,              -- e.g. "stripe/webhooks", "jwt/expiry"
  -- Content
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,              -- markdown, injected into agent prompts
  content_type  TEXT NOT NULL DEFAULT 'pattern', -- pattern | gotcha | example | constraint
  -- Provenance
  agent_id      TEXT,                       -- which agent recorded this
  agent_role    TEXT,                       -- implementer | verifier | paranoid_reviewer | human
  bu_id         UUID REFERENCES behavioral_units(id) ON DELETE SET NULL,
  gap_id        UUID REFERENCES autonomy_gaps(id) ON DELETE SET NULL,
  -- Metadata
  confidence    NUMERIC(3,2) DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  times_used    INTEGER NOT NULL DEFAULT 0,
  last_used_at  TIMESTAMPTZ,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by domain when building agent prompts
CREATE INDEX IF NOT EXISTS da_domain_active_idx
  ON domain_annotations (domain, active, confidence DESC)
  WHERE active = true;

-- Fast lookup by key for exact matches
CREATE INDEX IF NOT EXISTS da_key_idx
  ON domain_annotations (key, domain)
  WHERE active = true;

-- Trigger: updated_at
CREATE OR REPLACE TRIGGER domain_annotations_updated_at
  BEFORE UPDATE ON domain_annotations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Seed: bootstrap annotations from known gotchas ──────────────────────────
-- These are the things every agent gets wrong the first time.

INSERT INTO domain_annotations (domain, key, title, content, content_type, agent_role, confidence) VALUES

('auth', 'jwt/expiry',
  'JWT expiry must be validated on every request',
  'Always verify exp claim in JWT middleware. Never trust client-side token freshness checks. Use short-lived access tokens (15min) with refresh tokens. Check both token signature AND expiry before granting access.',
  'gotcha', 'human', 1.0),

('auth', 'password/hashing',
  'Use bcrypt or argon2 — never SHA or MD5',
  'Passwords must be hashed with bcrypt (cost factor ≥ 12) or argon2id. SHA-256/MD5 are NOT acceptable for passwords. Always salt automatically (bcrypt includes salt). Never store plaintext or reversibly-encrypted passwords.',
  'gotcha', 'human', 1.0),

('billing', 'stripe/webhooks',
  'Stripe webhooks require idempotency and signature verification',
  'Always: (1) verify webhook signature using stripe.webhooks.constructEvent(), (2) check event type before processing, (3) use idempotency keys — Stripe retries failed webhooks, so your handler must be idempotent, (4) return 200 immediately and process async. Missing any of these causes duplicate charges or silent failures.',
  'gotcha', 'human', 1.0),

('billing', 'stripe/refunds',
  'Refunds must update both Stripe and your DB atomically',
  'Use database transactions when recording refunds. If DB write fails after Stripe refund succeeds, the customer gets refunded but your records show a charge. Always record the Stripe refund ID before updating order status.',
  'pattern', 'human', 1.0),

('storage', 'file-upload/cleanup',
  'Failed uploads must clean up orphaned files',
  'Multi-step uploads (upload file → save metadata → update record) must clean up on failure at any step. Use try/catch/finally or a saga pattern. Without cleanup, storage fills with orphaned files. Implement a background cleanup job as a secondary defense.',
  'gotcha', 'human', 1.0),

('api', 'pagination/limits',
  'Always enforce LIMIT on user-generated content queries',
  'Never query user-generated content without a LIMIT clause. Without limits, a user with 100k records can bring down the database. Default page size: 20. Maximum: 100. Always return total count separately from results.',
  'constraint', 'human', 1.0),

('api', 'rate-limiting',
  'External API calls need timeouts and retry limits',
  'Set explicit timeouts on all outbound HTTP calls (recommended: 10-15s). Implement exponential backoff for retries (max 3 retries). Never retry on 4xx errors (client errors are not transient). Log all external failures with enough context to debug.',
  'pattern', 'human', 1.0),

('database', 'transactions/multi-step',
  'Multi-step database operations must use transactions',
  'Any operation that modifies more than one table must be wrapped in a transaction. Without transactions, a failure mid-operation leaves the database in an inconsistent state. Use BEGIN/COMMIT/ROLLBACK explicitly — do not rely on ORM auto-commit behavior.',
  'constraint', 'human', 1.0)

ON CONFLICT DO NOTHING;
