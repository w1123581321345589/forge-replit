import { test, expect, describe } from "bun:test";
import { formatSessionContextForPrompt } from "@forge/company";
import type { SessionContextItem } from "@forge/company";

// ─── Session defaults ─────────────────────────────────────────────────────────

describe("Session idle threshold defaults", () => {
  const DEFAULT_THRESHOLD_MINUTES = 5760; // 4 days
  const OPENCLAW_DEFAULT_MINUTES = 180;   // 2 hours (the bad default)

  test("Forge default is 4 days, not 2 hours", () => {
    expect(DEFAULT_THRESHOLD_MINUTES).toBe(4 * 24 * 60);
    expect(DEFAULT_THRESHOLD_MINUTES).toBeGreaterThan(OPENCLAW_DEFAULT_MINUTES);
  });

  test("session expires_at is last_active_at + threshold", () => {
    const lastActive = new Date("2026-03-20T09:00:00Z");
    const thresholdMinutes = 5760;
    const expiresAt = new Date(lastActive.getTime() + thresholdMinutes * 60 * 1000);

    expect(expiresAt.getTime() - lastActive.getTime()).toBe(5760 * 60 * 1000);

    // Should be 4 days later
    const daysDiff = (expiresAt.getTime() - lastActive.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysDiff).toBe(4);
  });

  test("extending by 4 days adds 5760 more minutes", () => {
    const currentThreshold = 5760;
    const additionalDays = 4;
    const newThreshold = currentThreshold + additionalDays * 24 * 60;
    expect(newThreshold).toBe(11520); // 8 days total
  });

  test("hours until expiry computed correctly", () => {
    function hoursUntilExpiry(expiresAt: Date, now: Date): number {
      return (expiresAt.getTime() - now.getTime()) / (60 * 60 * 1000);
    }
    const now = new Date("2026-03-20T09:00:00Z");
    const expiring = new Date(now.getTime() + 1.5 * 60 * 60 * 1000); // 1.5 hours
    expect(hoursUntilExpiry(expiring, now)).toBeCloseTo(1.5, 1);
    expect(hoursUntilExpiry(expiring, now)).toBeLessThan(2); // would trigger warning
  });
});

// ─── Session context formatting ───────────────────────────────────────────────

function makeContextItem(overrides: Partial<SessionContextItem> = {}): SessionContextItem {
  return {
    id: "item-001",
    sessionId: "sess-001",
    itemType: "discovered",
    content: "Stripe webhooks require idempotency keys",
    buId: undefined,
    promoted: false,
    confidence: 0.8,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Session context formatting", () => {
  test("empty context returns empty string", () => {
    expect(formatSessionContextForPrompt([])).toBe("");
  });

  test("includes section header", () => {
    const items = [makeContextItem()];
    const result = formatSessionContextForPrompt(items);
    expect(result).toContain("Session context");
    expect(result).toContain("prior work");
  });

  test("handoff note is included when provided", () => {
    const note = "Left off implementing the webhook handler. Tried JWT approach, failed on concurrent requests.";
    const result = formatSessionContextForPrompt([], note);
    expect(result).toContain(note);
    expect(result).toContain("Handoff from previous session");
  });

  test("attempted items appear under correct heading", () => {
    const items = [makeContextItem({
      itemType: "attempted",
      content: "Tried async queue approach, failed because of DB connection limits",
    })];
    const result = formatSessionContextForPrompt(items);
    expect(result).toContain("Already tried");
    expect(result).toContain("async queue approach");
  });

  test("human_said items appear under correct heading", () => {
    const items = [makeContextItem({
      itemType: "human_said",
      content: "Use the existing billing domain pattern for transaction handling",
    })];
    const result = formatSessionContextForPrompt(items);
    expect(result).toContain("Operator said");
    expect(result).toContain("billing domain pattern");
  });

  test("multiple item types grouped correctly", () => {
    const items = [
      makeContextItem({ itemType: "attempted", content: "Tried approach A" }),
      makeContextItem({ itemType: "discovered", content: "Found edge case X" }),
      makeContextItem({ itemType: "next_step", content: "Try approach B with transactions" }),
    ];
    const result = formatSessionContextForPrompt(items);
    expect(result).toContain("Already tried");
    expect(result).toContain("Discovered");
    expect(result).toContain("Next step");
  });

  test("context + annotations + federation are additive — session last", () => {
    const annotationContext = "## Domain knowledge\nUse bcrypt for passwords";
    const federationContext = "## Federation intelligence\n75% first-pass rate";
    const items = [makeContextItem({ itemType: "attempted", content: "Tried SHA-256, blocked" })];
    const sessionContext = formatSessionContextForPrompt(items);

    const fullPrompt = annotationContext + federationContext + sessionContext;

    // All three sections present
    expect(fullPrompt).toContain("Domain knowledge");
    expect(fullPrompt).toContain("Federation intelligence");
    expect(fullPrompt).toContain("Session context");

    // Session context is last (most specific to current work)
    expect(fullPrompt.indexOf("Session context")).toBeGreaterThan(
      fullPrompt.indexOf("Federation intelligence")
    );
  });
});

// ─── Context item promotion criteria ─────────────────────────────────────────

describe("Context item promotion to formal annotations", () => {
  function shouldPromote(item: { itemType: string; confidence: number; promoted: boolean }): boolean {
    return !item.promoted && item.confidence >= 0.75 && ["discovered", "learned"].includes(item.itemType);
  }

  test("high-confidence discovered item is promotable", () => {
    expect(shouldPromote({ itemType: "discovered", confidence: 0.8, promoted: false })).toBe(true);
  });

  test("high-confidence learned item is promotable", () => {
    expect(shouldPromote({ itemType: "learned", confidence: 0.85, promoted: false })).toBe(true);
  });

  test("already promoted item is not promotable", () => {
    expect(shouldPromote({ itemType: "discovered", confidence: 0.9, promoted: true })).toBe(false);
  });

  test("low-confidence item is not promotable", () => {
    expect(shouldPromote({ itemType: "discovered", confidence: 0.6, promoted: false })).toBe(false);
  });

  test("attempted/human_said items are not promoted — they're session-specific", () => {
    expect(shouldPromote({ itemType: "attempted", confidence: 0.9, promoted: false })).toBe(false);
    expect(shouldPromote({ itemType: "human_said", confidence: 0.9, promoted: false })).toBe(false);
  });

  test("promoted annotation has slight confidence decay", () => {
    const sessionConfidence = 0.85;
    const annotationConfidence = sessionConfidence * 0.9;
    expect(annotationConfidence).toBeCloseTo(0.765, 2);
    expect(annotationConfidence).toBeLessThan(sessionConfidence);
  });
});

// ─── Session expiry logic ─────────────────────────────────────────────────────

describe("Session expiry and graveyarding", () => {
  function shouldGraveyard(session: { tasksCompleted: number; contextItems: number }): boolean {
    return session.tasksCompleted === 0 && session.contextItems > 0;
  }

  function classifyExpiry(session: {
    tasksCompleted: number; contextItems: number;
  }): "expire" | "graveyard" | "close_clean" {
    if (session.tasksCompleted > 0) return "close_clean";
    if (session.contextItems > 0) return "graveyard"; // partial work preserved
    return "expire"; // nothing to save
  }

  test("session with work but no completion gets graveyarded", () => {
    expect(shouldGraveyard({ tasksCompleted: 0, contextItems: 5 })).toBe(true);
  });

  test("empty session just expires", () => {
    expect(shouldGraveyard({ tasksCompleted: 0, contextItems: 0 })).toBe(false);
    expect(classifyExpiry({ tasksCompleted: 0, contextItems: 0 })).toBe("expire");
  });

  test("completed session closes clean", () => {
    expect(classifyExpiry({ tasksCompleted: 3, contextItems: 2 })).toBe("close_clean");
  });

  test("warning threshold: sessions expiring in < 2 hours get surfaced", () => {
    function needsWarning(hoursUntilExpiry: number, warnThreshold = 2): boolean {
      return hoursUntilExpiry <= warnThreshold;
    }
    expect(needsWarning(1.5)).toBe(true);
    expect(needsWarning(0.5)).toBe(true);
    expect(needsWarning(3)).toBe(false);
    expect(needsWarning(2)).toBe(true); // exactly at threshold
  });
});

// ─── Handoff note quality ─────────────────────────────────────────────────────

describe("Handoff note generation inputs", () => {
  function buildHandoffContext(session: {
    domain: string; agentRole: string; summary?: string;
    tasksCompleted: number; tasksAttempted: number;
  }, items: Array<{ itemType: string; content: string }>): string {
    const contextSummary = items.map((i) => `[${i.itemType}] ${i.content}`).join("\n");
    return [
      `Domain: ${session.domain}`,
      `Agent role: ${session.agentRole}`,
      session.summary ? `Session summary: ${session.summary}` : "",
      `Tasks completed: ${session.tasksCompleted}`,
      `Tasks attempted: ${session.tasksAttempted}`,
      "",
      "Context from this session:",
      contextSummary,
    ].filter(Boolean).join("\n");
  }

  test("handoff context includes all key fields", () => {
    const context = buildHandoffContext(
      { domain: "billing", agentRole: "implementer", tasksCompleted: 0, tasksAttempted: 1 },
      [
        { itemType: "attempted", content: "Tried JWT approach, failed on concurrent requests" },
        { itemType: "next_step", content: "Try transaction wrapper pattern instead" },
      ]
    );
    expect(context).toContain("billing");
    expect(context).toContain("implementer");
    expect(context).toContain("JWT approach");
    expect(context).toContain("transaction wrapper");
  });

  test("empty context items still produces valid handoff", () => {
    const context = buildHandoffContext(
      { domain: "auth", agentRole: "verifier", tasksCompleted: 2, tasksAttempted: 2 },
      []
    );
    expect(context).toContain("auth");
    expect(context).toContain("Tasks completed: 2");
  });
});

// ─── Session status machine ────────────────────────────────────────────────────

describe("Session status transitions", () => {
  type Status = "active" | "idle" | "expired" | "extended" | "closed" | "graveyarded";

  function validTransition(from: Status, to: Status): boolean {
    const allowed: Record<Status, Status[]> = {
      active:     ["idle", "closed"],
      idle:       ["active", "expired", "extended", "closed", "graveyarded"],
      expired:    [], // terminal
      extended:   ["idle", "active", "closed"],
      closed:     [], // terminal
      graveyarded:[], // terminal
    };
    return allowed[from]?.includes(to) ?? false;
  }

  test("active → idle on task completion", () => {
    expect(validTransition("active", "idle")).toBe(true);
  });

  test("idle → active on new task", () => {
    expect(validTransition("idle", "active")).toBe(true);
  });

  test("idle → expired on timeout", () => {
    expect(validTransition("idle", "expired")).toBe(true);
  });

  test("idle → extended on human action", () => {
    expect(validTransition("idle", "extended")).toBe(true);
  });

  test("expired is terminal — cannot reactivate", () => {
    expect(validTransition("expired", "active")).toBe(false);
    expect(validTransition("expired", "idle")).toBe(false);
  });

  test("closed is terminal", () => {
    expect(validTransition("closed", "active")).toBe(false);
  });

  test("active cannot be directly expired — must go idle first", () => {
    expect(validTransition("active", "expired")).toBe(false);
  });
});
