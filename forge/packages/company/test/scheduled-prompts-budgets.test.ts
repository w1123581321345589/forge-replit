import { test, expect, describe } from "bun:test";
import { isDue, getNextRunTime, parseCronExpression } from "@forge/company";

// ─── 1. Scheduled jobs — cron parsing and due detection ───────────────────────

describe("Cron expression parsing", () => {
  test("parses standard 5-field expression", () => {
    const parsed = parseCronExpression("0 9 * * 1");
    expect(parsed.minute).toBe("0");
    expect(parsed.hour).toBe("9");
    expect(parsed.dow).toBe("1");
  });

  test("throws on invalid field count", () => {
    expect(() => parseCronExpression("0 9 * *")).toThrow();
    expect(() => parseCronExpression("0 9 * * * *")).toThrow();
  });

  test("parses wildcard", () => {
    const parsed = parseCronExpression("* * * * *");
    expect(parsed.minute).toBe("*");
    expect(parsed.hour).toBe("*");
  });
});

describe("Cron isDue detection", () => {
  test("every-minute cron is due on any minute", () => {
    expect(isDue("* * * * *", new Date())).toBe(true);
  });

  test("Monday 9am fires on Monday at 9:00", () => {
    // Find next Monday
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
    expect(isDue("0 9 * * 1", d)).toBe(true);
  });

  test("Monday 9am does NOT fire on Tuesday", () => {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    while (d.getDay() !== 2) d.setDate(d.getDate() + 1); // Tuesday
    expect(isDue("0 9 * * 1", d)).toBe(false);
  });

  test("Wednesday 10am fires on Wednesday at 10:00", () => {
    const d = new Date();
    d.setHours(10, 0, 0, 0);
    while (d.getDay() !== 3) d.setDate(d.getDate() + 1);
    expect(isDue("0 10 * * 3", d)).toBe(true);
  });

  test("Wednesday 10am does NOT fire at 10:01", () => {
    const d = new Date();
    d.setHours(10, 1, 0, 0);
    while (d.getDay() !== 3) d.setDate(d.getDate() + 1);
    expect(isDue("0 10 * * 3", d)).toBe(false);
  });

  test("every-5-minutes cron fires at minute 0, 5, 10, 15", () => {
    const test5 = (min: number) => {
      const d = new Date();
      d.setMinutes(min, 0, 0);
      return isDue("*/5 * * * *", d);
    };
    expect(test5(0)).toBe(true);
    expect(test5(5)).toBe(true);
    expect(test5(15)).toBe(true);
    expect(test5(3)).toBe(false);
    expect(test5(7)).toBe(false);
  });

  test("Sunday 8pm fires on Sunday at 20:00", () => {
    const d = new Date();
    d.setHours(20, 0, 0, 0);
    while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
    expect(isDue("0 20 * * 0", d)).toBe(true);
  });

  test("comma-separated DOW: fires on Mon and Wed", () => {
    const monday = new Date();
    monday.setHours(9, 0, 0, 0);
    while (monday.getDay() !== 1) monday.setDate(monday.getDate() + 1);

    const wednesday = new Date(monday);
    while (wednesday.getDay() !== 3) wednesday.setDate(wednesday.getDate() + 1);

    const tuesday = new Date(monday);
    tuesday.setDate(monday.getDate() + 1); // Tuesday

    expect(isDue("0 9 * * 1,3", monday)).toBe(true);
    expect(isDue("0 9 * * 1,3", wednesday)).toBe(true);
    expect(isDue("0 9 * * 1,3", tuesday)).toBe(false);
  });
});

describe("getNextRunTime", () => {
  test("returns a future date", () => {
    const next = getNextRunTime("0 9 * * 1");
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  test("next run for every-minute cron is within 2 minutes", () => {
    const next = getNextRunTime("* * * * *");
    expect(next.getTime() - Date.now()).toBeLessThan(2 * 60 * 1000);
  });

  test("same cron called twice returns same next minute", () => {
    const d = new Date();
    d.setSeconds(30, 0); // mid-minute
    const next1 = getNextRunTime("*/5 * * * *", d);
    const next2 = getNextRunTime("*/5 * * * *", d);
    expect(next1.getTime()).toBe(next2.getTime());
  });
});

// ─── 2. Prompt template optimization ─────────────────────────────────────────

describe("Prompt template quality tracking", () => {
  function computeFirstPassRate(
    history: Array<{ satisfied: boolean }>,
    currentRate: number | null,
    currentCount: number
  ): number {
    if (history.length === 0) return currentRate ?? 0;
    const newSatisfied = history.filter((h) => h.satisfied).length;
    const prevRate = currentRate ?? 0;
    // Incremental: (prev_rate * prev_count + new_satisfied) / (prev_count + new_count)
    return (prevRate * currentCount + newSatisfied) / (currentCount + history.length);
  }

  test("perfect run increases rate", () => {
    const rate = computeFirstPassRate(
      [{ satisfied: true }, { satisfied: true }, { satisfied: true }],
      0.7, 10
    );
    expect(rate).toBeGreaterThan(0.7);
  });

  test("all failures decreases rate", () => {
    const rate = computeFirstPassRate(
      [{ satisfied: false }, { satisfied: false }],
      0.8, 10
    );
    expect(rate).toBeLessThan(0.8);
  });

  test("first run with no history", () => {
    const rate = computeFirstPassRate([{ satisfied: true }], null, 0);
    expect(rate).toBe(1.0);
  });

  test("50/50 run from perfect base converges toward middle", () => {
    const rate = computeFirstPassRate(
      [{ satisfied: true }, { satisfied: false }],
      1.0, 10
    );
    expect(rate).toBeGreaterThan(0.8);
    expect(rate).toBeLessThan(1.0);
  });
});

describe("Model guidance selection", () => {
  function getModelFamily(modelId: string): string {
    if (modelId.toLowerCase().includes("claude")) return "claude";
    if (modelId.toLowerCase().includes("gpt")) return "gpt";
    if (modelId.toLowerCase().includes("gemini")) return "gemini";
    return "default";
  }

  test("claude models route to claude guidance", () => {
    expect(getModelFamily("claude-sonnet-4-5-20251001")).toBe("claude");
    expect(getModelFamily("claude-haiku-4-5-20251001")).toBe("claude");
  });

  test("gpt models route to gpt guidance", () => {
    expect(getModelFamily("gpt-4o")).toBe("gpt");
    expect(getModelFamily("gpt-5.4")).toBe("gpt");
  });

  test("unknown model gets default guidance", () => {
    expect(getModelFamily("llama-3.1-70b")).toBe("default");
    expect(getModelFamily("mistral-large")).toBe("default");
  });
});

// ─── 3. Context budget enforcement ───────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function applyBudget<T extends { title: string; content: string; confidence: number }>(
  annotations: T[],
  maxTokens: number
): { fitting: T[]; pruned: number; tokensUsed: number } {
  let tokensUsed = 0;
  const fitting: T[] = [];
  let pruned = 0;

  for (const a of annotations) {
    const text = `### ${a.title}\n${a.content}\n\n`;
    const tokens = estimateTokens(text);
    if (tokensUsed + tokens <= maxTokens) {
      fitting.push(a);
      tokensUsed += tokens;
    } else {
      pruned++;
    }
  }

  return { fitting, pruned, tokensUsed };
}

describe("Context budget enforcement", () => {
  const makeAnnotation = (title: string, content: string, confidence = 0.9) => ({
    title, content, confidence,
  });

  test("all annotations fit within generous budget", () => {
    const annotations = [
      makeAnnotation("Tip 1", "Use short-lived JWTs"),
      makeAnnotation("Tip 2", "Always verify webhook signatures"),
    ];
    const result = applyBudget(annotations, 2000);
    expect(result.fitting.length).toBe(2);
    expect(result.pruned).toBe(0);
    expect(result.budgetExceeded).toBe(undefined); // not set in pure version
  });

  test("large annotations get pruned when over budget", () => {
    const bigContent = "x".repeat(2000);
    const annotations = [
      makeAnnotation("Small tip", "Short content"),
      makeAnnotation("Huge tip", bigContent),
      makeAnnotation("Another small", "Also short"),
    ];
    const result = applyBudget(annotations, 500);
    expect(result.pruned).toBeGreaterThan(0);
    expect(result.tokensUsed).toBeLessThanOrEqual(500);
  });

  test("token estimation: 4 chars ≈ 1 token", () => {
    expect(estimateTokens("hello")).toBe(2); // 5 chars → 2 tokens
    expect(estimateTokens("a".repeat(400))).toBe(100);
    expect(estimateTokens("")).toBe(0);
  });

  test("budget 0 produces no annotations", () => {
    const annotations = [makeAnnotation("Tip", "Content")];
    const result = applyBudget(annotations, 0);
    expect(result.fitting.length).toBe(0);
    expect(result.pruned).toBe(1);
  });

  test("sort by confidence descending fills highest-value first", () => {
    const annotations = [
      makeAnnotation("Low confidence", "Content A", 0.3),
      makeAnnotation("High confidence", "Content B", 0.95),
      makeAnnotation("Medium confidence", "Content C", 0.6),
    ].sort((a, b) => b.confidence - a.confidence);

    const result = applyBudget(annotations, 50); // very tight budget
    // Should fit the high-confidence one first
    expect(result.fitting[0]?.confidence).toBe(0.95);
  });

  test("mixed sort blends confidence, usage, and recency", () => {
    // Mixed sort formula: confidence * 0.5 + usage_normalized * 0.3 + recency * 0.2
    function mixedScore(confidence: number, timesUsed: number, maxUsage: number, ageMs: number): number {
      const maxAge = 30 * 86400 * 1000;
      return confidence * 0.5
        + (timesUsed / maxUsage) * 0.3
        + Math.max(0, 1 - ageMs / maxAge) * 0.2;
    }

    const fresh = mixedScore(0.7, 5, 10, 1 * 86400 * 1000);  // 1 day old
    const stale = mixedScore(0.7, 5, 10, 28 * 86400 * 1000); // 28 days old
    expect(fresh).toBeGreaterThan(stale);

    const highUsage = mixedScore(0.6, 10, 10, 5 * 86400 * 1000);
    const lowUsage = mixedScore(0.6, 1, 10, 5 * 86400 * 1000);
    expect(highUsage).toBeGreaterThan(lowUsage);
  });
});

describe("Annotation pruning criteria", () => {
  interface Annotation {
    id: string; confidence: number; timesUsed: number;
    lastUsedAt: Date | null; createdAt: Date;
  }

  function shouldPrune(a: Annotation, now: Date): boolean {
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400 * 1000);

    return (
      a.confidence < 0.5 &&
      (a.lastUsedAt === null || a.lastUsedAt < ninetyDaysAgo) &&
      a.createdAt < thirtyDaysAgo
    );
  }

  const now = new Date();

  test("high-confidence annotation is never pruned", () => {
    const annotation: Annotation = {
      id: "1", confidence: 0.9, timesUsed: 0,
      lastUsedAt: null, createdAt: new Date(now.getTime() - 60 * 86400 * 1000),
    };
    expect(shouldPrune(annotation, now)).toBe(false);
  });

  test("recently used annotation is never pruned", () => {
    const annotation: Annotation = {
      id: "2", confidence: 0.3, timesUsed: 5,
      lastUsedAt: new Date(now.getTime() - 5 * 86400 * 1000), // 5 days ago
      createdAt: new Date(now.getTime() - 60 * 86400 * 1000),
    };
    expect(shouldPrune(annotation, now)).toBe(false);
  });

  test("stale low-confidence unread annotation is pruned", () => {
    const annotation: Annotation = {
      id: "3", confidence: 0.3, timesUsed: 0,
      lastUsedAt: null,
      createdAt: new Date(now.getTime() - 95 * 86400 * 1000),
    };
    expect(shouldPrune(annotation, now)).toBe(true);
  });

  test("new annotation is not pruned even if low confidence", () => {
    const annotation: Annotation = {
      id: "4", confidence: 0.2, timesUsed: 0,
      lastUsedAt: null,
      createdAt: new Date(now.getTime() - 10 * 86400 * 1000), // only 10 days old
    };
    expect(shouldPrune(annotation, now)).toBe(false);
  });
});
