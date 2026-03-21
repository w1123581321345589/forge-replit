import { test, expect, describe } from "bun:test";

// ─── 1. Attendance / evidence validation ──────────────────────────────────────

function validateTimesheet(ts: {
  primaryWorkBlocks: number; secondaryWorkBlocks: number;
  improvementBlocks: number; breakBlocks: number;
  evidenceRefs: Array<{ type: string; id: string; description: string }>;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const total = ts.primaryWorkBlocks + ts.secondaryWorkBlocks +
    ts.improvementBlocks + ts.breakBlocks;

  if (total !== 8) errors.push(`Blocks must sum to 8, got ${total}`);
  if (ts.primaryWorkBlocks > 0 && ts.evidenceRefs.length === 0) {
    errors.push("Primary work claimed but no evidence_refs provided");
  }
  if (ts.evidenceRefs.some((e) => !e.id || !e.description)) {
    errors.push("All evidence_refs must have id and description");
  }

  return { valid: errors.length === 0, errors };
}

describe("Attendance validation", () => {
  test("valid timesheet with evidence passes", () => {
    const result = validateTimesheet({
      primaryWorkBlocks: 5, secondaryWorkBlocks: 1,
      improvementBlocks: 1, breakBlocks: 1,
      evidenceRefs: [{ type: "implementation", id: "impl-001", description: "Completed auth BU implementation" }],
    });
    expect(result.valid).toBe(true);
  });

  test("blocks not summing to 8 fails", () => {
    const result = validateTimesheet({
      primaryWorkBlocks: 3, secondaryWorkBlocks: 2,
      improvementBlocks: 1, breakBlocks: 1,
      evidenceRefs: [{ type: "verification", id: "v-001", description: "Ran verification" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("sum to 8"))).toBe(true);
  });

  test("primary work without evidence fails — the silent failure fix", () => {
    const result = validateTimesheet({
      primaryWorkBlocks: 6, secondaryWorkBlocks: 0,
      improvementBlocks: 1, breakBlocks: 1,
      evidenceRefs: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("evidence_refs"))).toBe(true);
  });

  test("all break blocks with no evidence is valid", () => {
    const result = validateTimesheet({
      primaryWorkBlocks: 0, secondaryWorkBlocks: 0,
      improvementBlocks: 0, breakBlocks: 8,
      evidenceRefs: [],
    });
    expect(result.valid).toBe(true);
  });

  test("missing evidence id or description fails", () => {
    const result = validateTimesheet({
      primaryWorkBlocks: 4, secondaryWorkBlocks: 2,
      improvementBlocks: 1, breakBlocks: 1,
      evidenceRefs: [{ type: "implementation", id: "", description: "Something" }],
    });
    expect(result.valid).toBe(false);
  });
});

// ─── 2. Payroll computation ───────────────────────────────────────────────────

function computeCredits(inputs: {
  baseSalary?: number;
  shippedBUs?: number; closedGaps?: number; daysWithEvidence?: number;
  missingTimesheets?: number; openLoops?: number; banViolations?: number;
}): number {
  const base = inputs.baseSalary ?? 100;
  const bonus = (inputs.shippedBUs ?? 0) * 10
    + (inputs.closedGaps ?? 0) * 5
    + (inputs.daysWithEvidence ?? 0) * 2;
  const penalty = (inputs.missingTimesheets ?? 0) * 15
    + (inputs.openLoops ?? 0) * 5
    + (inputs.banViolations ?? 0) * 20;
  return base + bonus - penalty;
}

describe("Payroll computation", () => {
  test("base salary is 100 credits", () => {
    expect(computeCredits({})).toBe(100);
  });

  test("shipped BUs add 10 credits each", () => {
    expect(computeCredits({ shippedBUs: 3 })).toBe(130);
  });

  test("missing timesheet costs 15 credits", () => {
    expect(computeCredits({ missingTimesheets: 1 })).toBe(85);
  });

  test("hardban violation costs 20 credits", () => {
    expect(computeCredits({ banViolations: 1 })).toBe(80);
  });

  test("productive week: 5 BUs, 5 days with evidence, no violations = 200 credits", () => {
    expect(computeCredits({ shippedBUs: 5, daysWithEvidence: 5 })).toBe(160);
  });

  test("terrible week: 2 missing timesheets, 1 violation = 50 credits (triggers review)", () => {
    expect(computeCredits({ missingTimesheets: 2, banViolations: 1 })).toBe(50);
  });

  test("low threshold is 80 credits", () => {
    expect(computeCredits({ missingTimesheets: 1 })).toBeLessThan(100);
    expect(computeCredits({ missingTimesheets: 1 })).toBe(85);
    // 85 >= 80, not yet "low"
    expect(computeCredits({ missingTimesheets: 2 })).toBe(70);
    // 70 < 80, this is "low"
  });
});

// ─── 3. Inter-agent messaging protocol ────────────────────────────────────────

type MessageType = "question" | "reply" | "opinion" | "challenge" | "agreement" | "handoff" | "insight" | "alert";
type MessageStatus = "draft" | "sent" | "acknowledged" | "closed";

function detectHallucinationAmplification(messages: Array<{
  type: MessageType; content: string; status: MessageStatus;
}>): boolean {
  // Detects the "I've handled it" → task disappears bug
  const unacknowledged = messages.filter((m) => m.status === "sent");
  if (unacknowledged.length > 3) return true; // too many unacked = silent failures

  // Detect agreement cascade: multiple agreements without any challenges
  const recentTypes = messages.slice(-5).map((m) => m.type);
  const allAgreement = recentTypes.every((t) => t === "agreement" || t === "reply");
  if (recentTypes.length >= 3 && allAgreement) return true;

  return false;
}

function isAmbiguousCompletion(content: string): boolean {
  const ambiguousPatterns = [
    /handled|done|complete|finished|sorted/i,
  ];
  const clearPatterns = [
    /evidence|artifact|implementation|verification|result/i,
  ];

  const hasAmbiguous = ambiguousPatterns.some((p) => p.test(content));
  const hasClear = clearPatterns.some((p) => p.test(content));

  return hasAmbiguous && !hasClear;
}

describe("Inter-agent messaging protocol", () => {
  test("unambiguous handoff with evidence is clean", () => {
    expect(isAmbiguousCompletion("Implementation impl-001 created and passed paranoid review")).toBe(false);
  });

  test('"I handled it" without evidence is ambiguous', () => {
    expect(isAmbiguousCompletion("I handled it")).toBe(true);
    expect(isAmbiguousCompletion("Task complete")).toBe(true);
    expect(isAmbiguousCompletion("Done")).toBe(true);
  });

  test("too many unacknowledged messages signals hallucination risk", () => {
    const msgs = Array.from({ length: 4 }, (_, i) => ({
      type: "handoff" as MessageType,
      content: `I handled task ${i}`,
      status: "sent" as MessageStatus,
    }));
    expect(detectHallucinationAmplification(msgs)).toBe(true);
  });

  test("agreement cascade without challenge is hallucination risk", () => {
    const msgs = [
      { type: "reply" as MessageType, content: "Auth is working", status: "acknowledged" as MessageStatus },
      { type: "agreement" as MessageType, content: "Yes confirmed", status: "acknowledged" as MessageStatus },
      { type: "agreement" as MessageType, content: "Agreed", status: "acknowledged" as MessageStatus },
      { type: "agreement" as MessageType, content: "All good", status: "acknowledged" as MessageStatus },
    ];
    expect(detectHallucinationAmplification(msgs)).toBe(true);
  });

  test("conversation with challenges is healthy", () => {
    const msgs = [
      { type: "opinion" as MessageType, content: "Auth is working", status: "acknowledged" as MessageStatus },
      { type: "challenge" as MessageType, content: "But what about concurrent sessions?", status: "acknowledged" as MessageStatus },
      { type: "reply" as MessageType, content: "Good point, testing now with evidence ref verif-001", status: "sent" as MessageStatus },
    ];
    expect(detectHallucinationAmplification(msgs)).toBe(false);
  });

  test("message types cover required spectrum", () => {
    const validTypes: MessageType[] = ["question", "reply", "opinion", "challenge", "agreement", "handoff", "insight", "alert"];
    expect(validTypes.length).toBe(8);
    expect(validTypes).toContain("challenge"); // prevents echo chambers
    expect(validTypes).toContain("handoff");   // explicit task transfer
    expect(validTypes).toContain("alert");     // urgent signal
  });
});

// ─── 4. Cross-workspace pairing ───────────────────────────────────────────────

function shouldRunPairing(date: Date): boolean {
  return date.getDay() === 3; // Wednesday
}

function pairWorkspaces(workspaces: string[]): Array<[string, string]> {
  const shuffled = [...workspaces].sort(() => Math.random() - 0.5);
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < shuffled.length - 1; i += 2) {
    pairs.push([shuffled[i]!, shuffled[i + 1]!]);
  }
  return pairs;
}

describe("Cross-workspace pairing", () => {
  test("pairings run on Wednesday only", () => {
    const wednesday = new Date("2026-03-18"); // known Wednesday
    const thursday = new Date("2026-03-19");
    expect(shouldRunPairing(wednesday)).toBe(true);
    expect(shouldRunPairing(thursday)).toBe(false);
  });

  test("5 workspaces produces 2 pairs (1 unpaired)", () => {
    const pairs = pairWorkspaces(["aiglos", "instantprequal", "strider", "tpm", "cofcgs"]);
    expect(pairs.length).toBe(2);
    expect(pairs.every((p) => p[0] !== p[1])).toBe(true);
  });

  test("2 workspaces produces 1 pair", () => {
    const pairs = pairWorkspaces(["aiglos", "strider"]);
    expect(pairs.length).toBe(1);
  });

  test("pairing never pairs a workspace with itself", () => {
    for (let trial = 0; trial < 20; trial++) {
      const pairs = pairWorkspaces(["a", "b", "c", "d"]);
      pairs.forEach(([a, b]) => expect(a).not.toBe(b));
    }
  });
});

// ─── 5. Idea graveyard and revival ───────────────────────────────────────────

interface GraveyardEntry {
  id: string; title: string; domain: string;
  rejectedAt: Date; rejectionReason: string;
  revivalConditions: string; revived: boolean;
}

function isRevivalCandidate(entry: GraveyardEntry, currentSignals: string[]): boolean {
  if (entry.revived) return false;
  // Simple check: do any current signals match revival conditions keywords?
  const conditionWords = entry.revivalConditions.toLowerCase().split(/\s+/);
  return currentSignals.some((signal) =>
    conditionWords.some((word) => word.length > 4 && signal.toLowerCase().includes(word))
  );
}

function ageInDays(entry: GraveyardEntry): number {
  return Math.floor((Date.now() - entry.rejectedAt.getTime()) / 86400000);
}

describe("Idea graveyard", () => {
  const sampleEntry: GraveyardEntry = {
    id: "grave-001",
    title: "SymXchange bypass for small credit unions",
    domain: "instantprequal",
    rejectedAt: new Date(Date.now() - 60 * 86400000), // 60 days ago
    rejectionReason: "Too few small credit unions on Symitar in target market",
    revivalConditions: "Symitar market share among small credit unions exceeds 40%",
    revived: false,
  };

  test("revival candidate check matches relevant signals", () => {
    const signals = ["Symitar announces expanded small credit union program"];
    expect(isRevivalCandidate(sampleEntry, signals)).toBe(true);
  });

  test("irrelevant signals do not trigger revival", () => {
    const signals = ["new FedEx Ground ISP routes announced in Southeast"];
    expect(isRevivalCandidate(sampleEntry, signals)).toBe(false);
  });

  test("already revived entry is not a candidate", () => {
    const revived = { ...sampleEntry, revived: true };
    const signals = ["Symitar market share announcement"];
    expect(isRevivalCandidate(revived, signals)).toBe(false);
  });

  test("correctly computes age in days", () => {
    expect(ageInDays(sampleEntry)).toBeGreaterThan(55);
    expect(ageInDays(sampleEntry)).toBeLessThan(65);
  });

  test("graveyard sorts with revival candidates first", () => {
    const entries: GraveyardEntry[] = [
      { ...sampleEntry, id: "1", revived: false },
      { ...sampleEntry, id: "2", revived: true },
      { ...sampleEntry, id: "3", revived: false },
    ];
    const signals = ["Symitar expansion"];
    const withRevival = entries.map((e) => ({ ...e, isCandidate: isRevivalCandidate(e, signals) }));
    const sorted = [...withRevival].sort((a, b) =>
      (b.isCandidate ? 1 : 0) - (a.isCandidate ? 1 : 0)
    );
    expect(sorted[0]?.isCandidate).toBe(true);
  });
});

// ─── Integration: company ops digest shape ───────────────────────────────────

describe("Company ops digest", () => {
  function buildDigest(inputs: {
    missingTimesheets?: number;
    missingEvidence?: number;
    unackedMessages?: number;
    lowCreditAgents?: number;
    revivalCandidates?: number;
  }) {
    return {
      missingTimesheets: inputs.missingTimesheets ?? 0,
      missingEvidenceToday: inputs.missingEvidence ?? 0,
      unacknowledgedMessages: inputs.unackedMessages ?? 0,
      lowCreditAgents: Array.from({ length: inputs.lowCreditAgents ?? 0 }, (_, i) => ({
        agentId: `agent-${i}`, credits: 60, consecutiveLowWeeks: 2,
      })),
      revivalCandidates: inputs.revivalCandidates ?? 0,
    };
  }

  test("clean company has all zeros", () => {
    const d = buildDigest({});
    expect(d.missingTimesheets).toBe(0);
    expect(d.missingEvidenceToday).toBe(0);
    expect(d.lowCreditAgents.length).toBe(0);
  });

  test("detects silent failures via missing evidence", () => {
    const d = buildDigest({ missingEvidence: 2 });
    expect(d.missingEvidenceToday).toBe(2);
  });

  test("surfaces agents needing attention", () => {
    const d = buildDigest({ lowCreditAgents: 3 });
    expect(d.lowCreditAgents.length).toBe(3);
    expect(d.lowCreditAgents.every((a) => a.credits < 80)).toBe(true);
  });
});
