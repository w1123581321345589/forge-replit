/**
 * Will's portfolio seed — 5 companies, 5 workspaces, real behavioral units.
 *
 * This is the demo. One founder, five companies, one intent graph OS.
 * The Command Center dispatches tasks. Forge verifies them. Production
 * probes watch them. Annotations propagate across all five.
 *
 * Companies:
 *   aiglos           — AI agent runtime security (DoD/NDAA FY2026)
 *   instantprequal   — Phone + DOB → credit decision in 8.2s
 *   strider          — FedEx Ground ISP roll-up ($325M target)
 *   tpm-platform     — GLP-1RA + ICI combination therapy platform
 *   cofcgs           — K-8 laboratory school with AI-adaptive instruction
 *
 * Run: bun run scripts/seed-will.ts
 * Requires: DATABASE_URL env var
 */

import { getDb } from "../packages/db/src/index.ts";
import { createBU, recordAnnotation } from "../packages/intent-graph/src/index.ts";

const sql = getDb();

// ─── Create workspaces ────────────────────────────────────────────────────────

const WORKSPACES = [
  { slug: "aiglos",         name: "Aiglos",              plan: "solo" },
  { slug: "instantprequal", name: "InstantPrequal",       plan: "solo" },
  { slug: "strider",        name: "Strider Logistics",    plan: "solo" },
  { slug: "tpm",            name: "TPM Sciences",         plan: "solo" },
  { slug: "cofcgs",         name: "CofC Grammar School",  plan: "solo" },
];

// ─── Behavioral units per company ─────────────────────────────────────────────

const AIGLOS_BUS = [
  {
    claim: "Every MCP tool call is intercepted at the SDK boundary and evaluated against all 36 rule families before execution",
    domain: "security",
    acceptanceCriteria: [
      { given: "An agent attempting to call a tool with a hard-blocked action type", when: "The MCP SDK intercepts the call", then: "The tool call is rejected with a SecurityViolation error before any execution occurs", critical: true },
      { given: "A clean tool call that passes all 36 rule families", when: "The call is evaluated", then: "Execution proceeds normally with no latency overhead exceeding 5ms", critical: true },
    ],
    constraints: [
      { text: "Interception must occur at import time — no agent code changes required", type: "technical" as const, measurable: true },
      { text: "Rule evaluation must complete in < 5ms P99", type: "performance" as const, measurable: true, threshold: "<5ms" },
    ],
  },
  {
    claim: "Aiglos generates a signed cryptographic audit artifact for each agent session that maps to NIST 800-171 controls and is accepted by C3PAO auditors",
    domain: "compliance",
    acceptanceCriteria: [
      { given: "A completed agent session with 50+ tool calls across multiple rule families", when: "The session audit artifact is generated", then: "The artifact includes HMAC-signed action log, NIST 800-171 control mapping, and C3PAO attestation block", critical: true },
      { given: "A C3PAO auditor reviews the artifact", when: "They validate against NDAA FY2026 Section 1513 requirements", then: "The artifact satisfies all documentation requirements without additional human annotation", critical: true },
    ],
    constraints: [
      { text: "Must comply with NDAA FY2026 Section 1513 by June 2026 deadline", type: "compliance" as const, measurable: true },
      { text: "Artifact must be verifiable without trusting the database operator", type: "security" as const, measurable: true },
    ],
  },
  {
    claim: "Defense contractors can integrate Aiglos via npm install with zero configuration changes to existing agent code",
    domain: "developer-experience",
    acceptanceCriteria: [
      { given: "An existing TypeScript agent using MCP SDK without Aiglos", when: "The developer adds 'import @aiglos/sdk' as the first line", then: "All subsequent MCP tool calls are protected without any other code changes", critical: true },
      { given: "A contractor running the integration test suite", when: "Aiglos is installed and initialized", then: "All 335 existing tests continue to pass", critical: true },
    ],
    constraints: [
      { text: "Zero breaking changes to MCP SDK API surface", type: "technical" as const, measurable: true },
      { text: "npm install must not add > 50KB to bundle", type: "technical" as const, measurable: true, threshold: "<50KB" },
    ],
  },
];

const INSTANTPREQUAL_BUS = [
  {
    claim: "Given a borrower's phone number and date of birth, the system delivers a decision-ready pre-qualification result in under 8.2 seconds via a four-endpoint API",
    domain: "core",
    acceptanceCriteria: [
      { given: "A valid US phone number and date of birth", when: "POST /api/prequal is called", then: "Returns a pre-qualification decision with credit tier, estimated rate range, and max loan amount in ≤ 8.2 seconds", critical: true },
      { given: "An invalid phone number format", when: "The request is submitted", then: "Returns 422 with field-level validation errors within 50ms — never times out", critical: true },
    ],
    constraints: [
      { text: "P99 response time must not exceed 8.2 seconds", type: "performance" as const, measurable: true, threshold: "≤8.2s" },
      { text: "Must not require SSN or full credit pull for pre-qualification", type: "compliance" as const, measurable: true },
    ],
  },
  {
    claim: "The system integrates directly with Jack Henry Symitar SymXchange API to bypass MeridianLink entirely for credit union decisioning",
    domain: "integrations",
    acceptanceCriteria: [
      { given: "A credit union running Jack Henry Symitar core", when: "InstantPrequal connects via SymXchange API", then: "Member pre-qualification queries are processed without routing through MeridianLink, reducing latency by ≥40%", critical: true },
    ],
    constraints: [
      { text: "SymXchange credentials must be stored encrypted at rest", type: "security" as const, measurable: true },
      { text: "Must handle Symitar maintenance windows gracefully with fallback mode", type: "technical" as const, measurable: true },
    ],
  },
  {
    claim: "The acquisition pitch dashboard shows MeridianLink leadership real-time metrics proving InstantPrequal accelerates their loan volume",
    domain: "sales",
    acceptanceCriteria: [
      { given: "A prospect demo session with Troy Coggiola (CSO) or Mrinal Mehta (Corporate Dev)", when: "The dashboard is opened", then: "Displays live pre-qualification volume, conversion rate vs baseline, and projected revenue lift at MeridianLink's customer scale", critical: false },
    ],
    constraints: [
      { text: "Dashboard must load in < 2 seconds with real data", type: "performance" as const, measurable: true, threshold: "<2s" },
    ],
  },
];

const STRIDER_BUS = [
  {
    claim: "The roll-up platform tracks ISP route performance, driver retention, and package volume across 2,500+ routes and surfaces at-risk routes before they churn",
    domain: "operations",
    acceptanceCriteria: [
      { given: "An ISP route with on-time delivery rate dropping below 94% for 3 consecutive days", when: "The platform evaluates route health", then: "An alert is surfaced in the operations dashboard with root cause classification and recommended intervention", critical: true },
      { given: "A driver with 3+ consecutive days below minimum delivery standard", when: "Retention risk is evaluated", then: "An intervention workflow is triggered with automated outreach and escalation to route manager", critical: true },
    ],
    constraints: [
      { text: "Platform must handle 2,500+ concurrent route feeds without degradation", type: "technical" as const, measurable: true, threshold: "2,500+ routes" },
      { text: "Alert latency from event to dashboard must not exceed 15 minutes", type: "performance" as const, measurable: true, threshold: "<15min" },
    ],
  },
  {
    claim: "The embedded fintech layer issues fuel cards, processes payroll, and offers earned wage access to drivers, capturing transaction revenue alongside management fee",
    domain: "fintech",
    acceptanceCriteria: [
      { given: "A driver completing their first route under Strider management", when: "Onboarding is complete", then: "They receive a Strider fuel card, are enrolled in payroll processing, and can access earned wages within 24 hours of route completion", critical: true },
      { given: "A fuel card transaction at a Flying J or Pilot location", when: "The transaction is processed", then: "The discount is applied, the transaction is categorized by route, and the driver sees the savings vs pump price", critical: true },
    ],
    constraints: [
      { text: "Earned wage access must fund within 24 hours of route completion", type: "business" as const, measurable: true, threshold: "<24h" },
      { text: "Fuel card must be accepted at 95%+ of Flying J, Pilot, and Love's locations", type: "business" as const, measurable: true, threshold: "≥95%" },
    ],
  },
];

const COFCGS_BUS = [
  {
    claim: "The AI-adaptive instruction system identifies each student's current mastery level per subject and generates a personalized learning path updated daily",
    domain: "instruction",
    acceptanceCriteria: [
      { given: "A student completing a mastery assessment in mathematics", when: "The assessment is scored", then: "The system updates their mastery profile, identifies the next skill gap, and queues 3 targeted exercises before the next school day", critical: true },
      { given: "A teacher reviewing the class dashboard", when: "They open the learning path view", then: "They see each student's current level, progress velocity, and intervention flags without needing to interpret raw scores", critical: true },
    ],
    constraints: [
      { text: "Learning path updates must complete overnight — ready at 7am each school day", type: "technical" as const, measurable: true, threshold: "ready by 7am" },
      { text: "System must comply with FERPA — no student data to third parties without consent", type: "compliance" as const, measurable: true },
    ],
  },
  {
    claim: "Education students in clinical placement receive structured feedback on their teaching within 24 hours of each observed session",
    domain: "teacher-prep",
    acceptanceCriteria: [
      { given: "A clinical supervisor observing an education student's lesson", when: "The observation form is submitted", then: "The student receives structured feedback with specific evidence, a growth focus, and one actionable practice target within 24 hours", critical: true },
    ],
    constraints: [
      { text: "Feedback must reference the actual lesson content — no generic templates", type: "business" as const, measurable: false },
      { text: "Response time from submission to student notification: ≤24 hours", type: "business" as const, measurable: true, threshold: "≤24h" },
    ],
  },
];

// ─── Cross-company shared annotations ─────────────────────────────────────────

const SHARED_ANNOTATIONS = [
  // Billing pattern shared across all companies with payment flows
  {
    domain: "fintech",
    key: "payments/stripe-idempotency",
    title: "Stripe payment intents require idempotency keys",
    content: "All Stripe payment intent creates must include an idempotency key. Without it, network retries create duplicate charges. Key format: `${userId}-${orderId}-${timestamp}`. Store the key alongside the order before calling Stripe — if the Stripe call fails, retry with the same key.",
    contentType: "gotcha" as const,
    confidence: 1.0,
  },
  // Compliance pattern for both Aiglos (DoD) and InstantPrequal (lending)
  {
    domain: "compliance",
    key: "audit/immutable-logs",
    title: "Compliance audit logs must be append-only",
    content: "Any table used for regulatory compliance (agent_actions, prediction_logs, loan_decisions) must be append-only. Do not add soft-delete, updated_at triggers, or edit endpoints. Compliance reviewers verify record integrity by checking that no rows have been modified post-creation. HMAC sign every row at write time.",
    contentType: "constraint" as const,
    confidence: 1.0,
  },
  // API pattern shared across InstantPrequal and Aiglos
  {
    domain: "security",
    key: "api/key-rotation",
    title: "API keys must support rotation without downtime",
    content: "Never use a single API key per integration. Issue keys in pairs: one active, one pending. Rotation process: activate pending key → verify new key works → deactivate old key. Zero-downtime rotation is required for DoD and financial services customers who cannot tolerate auth interruptions.",
    contentType: "pattern" as const,
    confidence: 0.95,
  },
];

// ─── Seed function ─────────────────────────────────────────────────────────────

async function seedWill() {
  console.log("Seeding Will's portfolio...\n");

  // Upsert all workspaces
  for (const ws of WORKSPACES) {
    await sql`
      INSERT INTO workspaces (slug, name, plan)
      VALUES (${ws.slug}, ${ws.name}, ${ws.plan})
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    `;
    console.log(`✓ Workspace: ${ws.slug}`);
  }

  // Helper to get workspace_id by slug
  async function getWorkspaceId(slug: string): Promise<string> {
    const rows = await sql<Array<{ id: string }>>`SELECT id FROM workspaces WHERE slug = ${slug}`;
    if (!rows[0]) throw new Error(`Workspace ${slug} not found`);
    return rows[0].id;
  }

  console.log("\nSeeding Aiglos BUs...");
  const aiglosWs = await getWorkspaceId("aiglos");
  for (const buData of AIGLOS_BUS) {
    const bu = await createBU({
      claim: buData.claim,
      domain: buData.domain,
      constraints: buData.constraints.map((c) => ({ id: crypto.randomUUID(), ...c })),
      acceptanceCriteria: buData.acceptanceCriteria.map((ac) => ({ id: crypto.randomUUID(), ...ac })),
      workspaceId: aiglosWs,
    });
    console.log(`  ✓ [${bu.domain}] ${bu.claim.substring(0, 65)}…`);
  }

  console.log("\nSeeding InstantPrequal BUs...");
  const ipWs = await getWorkspaceId("instantprequal");
  for (const buData of INSTANTPREQUAL_BUS) {
    const bu = await createBU({
      claim: buData.claim,
      domain: buData.domain,
      constraints: buData.constraints.map((c) => ({ id: crypto.randomUUID(), ...c })),
      acceptanceCriteria: buData.acceptanceCriteria.map((ac) => ({ id: crypto.randomUUID(), ...ac })),
      workspaceId: ipWs,
    });
    console.log(`  ✓ [${bu.domain}] ${bu.claim.substring(0, 65)}…`);
  }

  console.log("\nSeeding Strider BUs...");
  const striderWs = await getWorkspaceId("strider");
  for (const buData of STRIDER_BUS) {
    const bu = await createBU({
      claim: buData.claim,
      domain: buData.domain,
      constraints: buData.constraints.map((c) => ({ id: crypto.randomUUID(), ...c })),
      acceptanceCriteria: buData.acceptanceCriteria.map((ac) => ({ id: crypto.randomUUID(), ...ac })),
      workspaceId: striderWs,
    });
    console.log(`  ✓ [${bu.domain}] ${bu.claim.substring(0, 65)}…`);
  }

  console.log("\nSeeding CofC Grammar School BUs...");
  const cofcWs = await getWorkspaceId("cofcgs");
  for (const buData of COFCGS_BUS) {
    const bu = await createBU({
      claim: buData.claim,
      domain: buData.domain,
      constraints: buData.constraints.map((c) => ({ id: crypto.randomUUID(), ...c })),
      acceptanceCriteria: buData.acceptanceCriteria.map((ac) => ({ id: crypto.randomUUID(), ...ac })),
      workspaceId: cofcWs,
    });
    console.log(`  ✓ [${bu.domain}] ${bu.claim.substring(0, 65)}…`);
  }

  console.log("\nSeeding cross-company annotations...");
  for (const a of SHARED_ANNOTATIONS) {
    await recordAnnotation({ ...a, agentRole: "human" });
    console.log(`  ✓ [${a.domain}] ${a.title}`);
  }

  const total = AIGLOS_BUS.length + INSTANTPREQUAL_BUS.length + STRIDER_BUS.length + COFCGS_BUS.length;

  console.log(`
✓ Portfolio seed complete
  ${WORKSPACES.length} workspaces created
  ${total} behavioral units seeded across 5 companies
  ${SHARED_ANNOTATIONS.length} cross-company annotations

Command Center integration:
  forge_get_graph domain=security workspace=aiglos
  forge_get_graph domain=core workspace=instantprequal
  forge_run_batch domain=fintech workspace=strider
  forge_get_retro workspace=aiglos

MCP server (for Claude Code / Command Center):
  bun run packages/mcp/src/index.ts
`);
}

seedWill().catch((e) => { console.error(e); process.exit(1); });
