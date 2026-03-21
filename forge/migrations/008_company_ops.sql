-- Forge migration 008: company operations layer
--
-- Five systems built in parallel:
-- 1. Attendance (evidence_refs — fixes silent failure)
-- 2. Payroll/credits (behavioral signal → role config)
-- 3. Inter-agent communication (structured protocol, required acks)
-- 4. Cross-workspace pairing (emergent knowledge sharing)
-- 5. Rejected ideas graveyard (revival conditions)

-- ─── 1. Attendance with evidence_refs ────────────────────────────────────────
-- Agents must prove what they did, not just claim completion.
-- 8 blocks per day forced to sum to 8. evidence_refs must point to real artifacts.

CREATE TABLE IF NOT EXISTS agent_timesheets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id              TEXT NOT NULL,
  agent_role            TEXT NOT NULL,
  workspace_id          UUID REFERENCES workspaces(id) ON DELETE CASCADE
                          DEFAULT '00000000-0000-0000-0000-000000000001',
  date                  DATE NOT NULL DEFAULT CURRENT_DATE,
  -- 8 blocks must sum to 8
  primary_work_blocks   INTEGER NOT NULL DEFAULT 0 CHECK (primary_work_blocks >= 0),
  secondary_work_blocks INTEGER NOT NULL DEFAULT 0 CHECK (secondary_work_blocks >= 0),
  improvement_blocks    INTEGER NOT NULL DEFAULT 0 CHECK (improvement_blocks >= 0),
  break_blocks          INTEGER NOT NULL DEFAULT 0 CHECK (break_blocks >= 0),
  -- Artifact evidence — must not be empty on a claimed success
  evidence_refs         JSONB NOT NULL DEFAULT '[]', -- array of {type, id, description}
  -- Narrative
  summary               TEXT,
  blockers              TEXT,
  -- Review state
  reviewed              BOOLEAN NOT NULL DEFAULT false,
  reviewer_notes        TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, date),
  CONSTRAINT total_blocks_check CHECK (
    primary_work_blocks + secondary_work_blocks +
    improvement_blocks + break_blocks = 8
  )
);

CREATE INDEX IF NOT EXISTS ts_agent_date_idx ON agent_timesheets (agent_id, date DESC);
CREATE INDEX IF NOT EXISTS ts_workspace_date_idx ON agent_timesheets (workspace_id, date DESC);
CREATE INDEX IF NOT EXISTS ts_unreviewed_idx ON agent_timesheets (date DESC) WHERE reviewed = false;

-- Add evidence_refs to agent_actions (the individual action level)
ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS
  evidence_refs JSONB DEFAULT '[]';

-- ─── 2. Payroll / credits ─────────────────────────────────────────────────────
-- Weekly behavioral signal. Not real money — behavioral quality tracking.
-- base_salary + bonus - penalty = total_credits
-- Low credit weeks trigger configuration review.

CREATE TABLE IF NOT EXISTS agent_payroll (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        TEXT NOT NULL,
  agent_role      TEXT NOT NULL,
  workspace_id    UUID REFERENCES workspaces(id) ON DELETE CASCADE
                    DEFAULT '00000000-0000-0000-0000-000000000001',
  week_start      DATE NOT NULL,
  week_end        DATE NOT NULL,
  base_salary     INTEGER NOT NULL DEFAULT 100,  -- credits
  -- Bonuses
  shipped_bu_bonus       INTEGER NOT NULL DEFAULT 0,  -- +10 per verified BU
  closed_gap_bonus       INTEGER NOT NULL DEFAULT 0,  -- +5 per resolved gap
  timely_evidence_bonus  INTEGER NOT NULL DEFAULT 0,  -- +2 per day with evidence_refs
  -- Penalties
  missing_timesheet_penalty  INTEGER NOT NULL DEFAULT 0,  -- -15 per missing day
  open_loop_penalty          INTEGER NOT NULL DEFAULT 0,  -- -5 per stale escalation >48h
  hardban_violation_penalty  INTEGER NOT NULL DEFAULT 0,  -- -20 per violation
  -- Totals
  total_credits   INTEGER GENERATED ALWAYS AS (
    base_salary +
    shipped_bu_bonus + closed_gap_bonus + timely_evidence_bonus -
    missing_timesheet_penalty - open_loop_penalty - hardban_violation_penalty
  ) STORED,
  -- Meta
  consecutive_low_weeks  INTEGER NOT NULL DEFAULT 0,
  notes                  TEXT,
  computed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, week_start)
);

CREATE INDEX IF NOT EXISTS pay_agent_week_idx ON agent_payroll (agent_id, week_start DESC);
CREATE INDEX IF NOT EXISTS pay_low_idx ON agent_payroll (workspace_id, total_credits ASC)
  WHERE total_credits < 80;

-- Role reviews triggered by performance evidence
CREATE TABLE IF NOT EXISTS agent_role_reviews (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         TEXT NOT NULL,
  agent_role       TEXT NOT NULL,
  workspace_id     UUID REFERENCES workspaces(id) ON DELETE CASCADE
                     DEFAULT '00000000-0000-0000-0000-000000000001',
  review_type      TEXT NOT NULL CHECK (review_type IN (
                     'improvement_plan', 'shadow', 'scope_narrowing', 'transfer'
                   )),
  trigger_reason   TEXT NOT NULL,  -- "3 consecutive low-credit weeks", "repeated hardban violations"
  evidence         JSONB NOT NULL DEFAULT '{}',  -- payroll refs, timesheet refs, peer review refs
  -- Configuration changes applied
  config_changes   JSONB NOT NULL DEFAULT '{}',  -- {tournament_size: 1, domain_restrictions: [...]}
  resolved         BOOLEAN NOT NULL DEFAULT false,
  resolved_at      TIMESTAMPTZ,
  resolved_by      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. Inter-agent communication protocol ────────────────────────────────────
-- Structured messages between agents. Required acknowledgment. No silent ignoring.
-- Prevents hallucination amplification and the "I've handled it" → task disappears bug.

CREATE TABLE IF NOT EXISTS agent_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL DEFAULT gen_random_uuid(),
  sender_id        TEXT NOT NULL,
  sender_role      TEXT NOT NULL,
  target_agent_id  TEXT,          -- null = broadcast to all agents in workspace
  workspace_id     UUID REFERENCES workspaces(id) ON DELETE CASCADE
                     DEFAULT '00000000-0000-0000-0000-000000000001',
  -- Structured labels (prevents "I've handled it" ambiguity)
  message_type     TEXT NOT NULL CHECK (message_type IN (
                     'question', 'reply', 'opinion', 'challenge',
                     'agreement', 'handoff', 'insight', 'alert'
                   )),
  sentiment        TEXT NOT NULL DEFAULT 'neutral' CHECK (sentiment IN (
                     'positive', 'negative', 'curious', 'frustrated',
                     'supportive', 'critical', 'neutral'
                   )),
  content          TEXT NOT NULL,
  -- Related work
  bu_id            UUID REFERENCES behavioral_units(id) ON DELETE SET NULL,
  -- Acknowledgment (required — silent ignoring not allowed)
  status           TEXT NOT NULL DEFAULT 'sent' CHECK (status IN (
                     'draft', 'sent', 'acknowledged', 'closed'
                   )),
  acknowledged_at  TIMESTAMPTZ,
  acknowledged_by  TEXT,
  -- Outcome
  produced_insight BOOLEAN NOT NULL DEFAULT false,
  insight_id       UUID,  -- references domain_annotations if insight was recorded
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS msg_conversation_idx ON agent_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS msg_target_status_idx ON agent_messages (target_agent_id, status)
  WHERE status IN ('sent', 'acknowledged');
CREATE INDEX IF NOT EXISTS msg_workspace_idx ON agent_messages (workspace_id, created_at DESC);

-- HardBan violations log
CREATE TABLE IF NOT EXISTS agent_ban_violations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    TEXT NOT NULL,
  agent_role  TEXT NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE
                DEFAULT '00000000-0000-0000-0000-000000000001',
  ban_rule    TEXT NOT NULL,      -- e.g. "no fabricating signal strength"
  action_taken TEXT NOT NULL,     -- what the agent tried to do
  bu_id       UUID REFERENCES behavioral_units(id) ON DELETE SET NULL,
  context     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ban_agent_idx ON agent_ban_violations (agent_id, created_at DESC);

-- ─── 4. Cross-workspace pairing (random coffee) ───────────────────────────────
-- Weekly random pairing of agents from different workspaces.
-- Cross-domain exchange produces emergent insights invisible in sequential execution.

CREATE TABLE IF NOT EXISTS cross_workspace_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_type    TEXT NOT NULL DEFAULT 'random_coffee' CHECK (session_type IN (
                    'random_coffee', 'demo_day', 'incident_review', 'strategy_sync'
                  )),
  agent_a_id      TEXT NOT NULL,
  agent_a_role    TEXT NOT NULL,
  workspace_a     UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_b_id      TEXT NOT NULL,
  agent_b_role    TEXT NOT NULL,
  workspace_b     UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  -- The conversation
  conversation_id UUID,  -- links to agent_messages
  topic           TEXT,  -- inferred or assigned topic
  -- Outcomes
  insights_produced  INTEGER NOT NULL DEFAULT 0,
  shared_insight_ids JSONB DEFAULT '[]',  -- annotation IDs produced
  -- Scheduling
  scheduled_for   TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cws_scheduled_idx ON cross_workspace_sessions (scheduled_for)
  WHERE completed_at IS NULL;

-- Shared insights from cross-workspace sessions (with voting)
CREATE TABLE IF NOT EXISTS shared_insights (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID REFERENCES cross_workspace_sessions(id) ON DELETE CASCADE,
  source_agent  TEXT NOT NULL,
  content       TEXT NOT NULL,
  domain_a      TEXT NOT NULL,   -- originating domain
  domain_b      TEXT NOT NULL,   -- receiving domain
  upvotes       INTEGER NOT NULL DEFAULT 0,
  downvotes     INTEGER NOT NULL DEFAULT 0,
  promoted      BOOLEAN NOT NULL DEFAULT false,  -- true = added to domain_annotations
  annotation_id UUID,  -- if promoted, the annotation it became
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 5. Rejected ideas graveyard ─────────────────────────────────────────────
-- Rejected specs/ideas with revival conditions.
-- When conditions change, dormant ideas surface automatically.
-- "An idea rejected two months ago gets revived when market conditions change."

CREATE TABLE IF NOT EXISTS idea_graveyard (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID REFERENCES workspaces(id) ON DELETE CASCADE
                       DEFAULT '00000000-0000-0000-0000-000000000001',
  -- The original idea
  title              TEXT NOT NULL,
  spec_text          TEXT NOT NULL,
  domain             TEXT NOT NULL,
  -- Rejection context
  rejected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rejected_by        TEXT NOT NULL DEFAULT 'human',  -- agent_id or 'human'
  rejection_reason   TEXT NOT NULL,
  ceo_review         JSONB,  -- the CeoReview object that led to rejection
  quality_score      JSONB,  -- the quality score at time of rejection
  -- Revival
  revival_conditions TEXT NOT NULL,  -- what would need to change
  revival_triggers   JSONB DEFAULT '[]',  -- structured: [{type, signal, threshold}]
  revived            BOOLEAN NOT NULL DEFAULT false,
  revived_at         TIMESTAMPTZ,
  revived_bu_id      UUID REFERENCES behavioral_units(id) ON DELETE SET NULL,
  -- Monitoring
  last_checked_at    TIMESTAMPTZ,
  check_count        INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS grave_workspace_idx ON idea_graveyard (workspace_id, revived)
  WHERE revived = false;
CREATE INDEX IF NOT EXISTS grave_domain_idx ON idea_graveyard (domain, revived)
  WHERE revived = false;

-- ─── Views ────────────────────────────────────────────────────────────────────

-- Weekly company operations summary
CREATE OR REPLACE VIEW v_company_ops AS
  SELECT
    ws.slug                                                      AS workspace,
    ts.date                                                      AS date,
    COUNT(DISTINCT ts.agent_id)                                  AS agents_present,
    COUNT(ts.id) FILTER (WHERE ts.reviewed = false)              AS timesheets_pending_review,
    COUNT(ts.id) FILTER (
      WHERE jsonb_array_length(ts.evidence_refs) = 0
        AND ts.primary_work_blocks > 0
    )                                                            AS missing_evidence,
    COALESCE(SUM(pay.total_credits), 0)                         AS total_credits_this_week,
    COUNT(m.id) FILTER (WHERE m.status = 'sent')                AS unacknowledged_messages,
    COUNT(bv.id)                                                 AS ban_violations_today
  FROM workspaces ws
  LEFT JOIN agent_timesheets ts  ON ts.workspace_id = ws.id AND ts.date >= CURRENT_DATE - 7
  LEFT JOIN agent_payroll pay    ON pay.workspace_id = ws.id
    AND pay.week_start >= DATE_TRUNC('week', NOW())::date
  LEFT JOIN agent_messages m     ON m.workspace_id = ws.id AND m.status = 'sent'
  LEFT JOIN agent_ban_violations bv ON bv.workspace_id = ws.id
    AND bv.created_at >= CURRENT_DATE
  GROUP BY ws.slug, ts.date;

-- Agents needing review (low credits, missing evidence, violations)
CREATE OR REPLACE VIEW v_agents_needing_review AS
  SELECT
    p.agent_id,
    p.agent_role,
    p.workspace_id,
    ws.slug                                     AS workspace,
    p.consecutive_low_weeks,
    p.total_credits                             AS last_week_credits,
    COUNT(bv.id)                                AS total_violations,
    COUNT(ts.id) FILTER (
      WHERE jsonb_array_length(ts.evidence_refs) = 0
    )                                           AS days_missing_evidence
  FROM agent_payroll p
  JOIN workspaces ws ON ws.id = p.workspace_id
  LEFT JOIN agent_ban_violations bv ON bv.agent_id = p.agent_id
  LEFT JOIN agent_timesheets ts ON ts.agent_id = p.agent_id
    AND ts.date >= p.week_start
  WHERE p.week_start >= DATE_TRUNC('week', NOW())::date - 21
  GROUP BY p.agent_id, p.agent_role, p.workspace_id, ws.slug,
           p.consecutive_low_weeks, p.total_credits
  HAVING p.consecutive_low_weeks >= 2
      OR COUNT(bv.id) >= 3
      OR COUNT(ts.id) FILTER (WHERE jsonb_array_length(ts.evidence_refs) = 0) >= 2;
