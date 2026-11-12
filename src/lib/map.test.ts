import { describe, expect, it } from "vitest";
import { runScenario, withRunRules, type Contract } from "./engine";
import { deriveOpenItems, impactOf, nodeKeyOf, nodeValue, previewDiff, previewRun } from "./map";

const c: Contract = {
  goal: "Offsite",
  budget_cap: 5999,
  headcount: 12,
  triggers: { ask_at: "never", over_budget: true },
  rules: [{ key: "venue_conflict", label: "s", kind: "override", value: "budget" }],
};
describe("decision map", () => {
  const run = runScenario(c);
  it("the budget split shapes every later decision, with $2,620 committed and 12 people emailed", () => {
    const split = run.find((r) => nodeKeyOf(r) === "split")!;
    const i = impactOf(split.seq, run);
    expect(i.keys).toEqual(["venue", "dates", "deposit", "catering", "invites"]);
    expect(i.money).toBe(2620);
    expect(i.people).toBe(12);
  });
  it("previewing 'Best venue' changes the venue to Ridgeview and adds $1,000, without touching the live run", () => {
    const before = JSON.stringify(run);
    const dry = runScenario(
      withRunRules({ ...c, rules: [] }, [
        { criterion: "venue_share_60", resolution: "override:Best venue" },
      ]),
    );
    const d = previewDiff(run, dry);
    expect(d.changes.get("venue")).toMatchObject({ from: "Lakeside Lodge", to: "Ridgeview Inn" });
    expect(d.moneyDelta).toBe(1000);
    expect(JSON.stringify(run)).toBe(before);
  });
});

describe("open items and preview", () => {
  const base: Contract = {
    goal: "Offsite",
    budget_cap: 5999,
    headcount: 12,
    triggers: { ask_at: "never", over_budget: true },
    rules: [],
  };
  const live = runScenario(base).map((r, i) => ({
    ...r,
    id: `id${i}`,
    resolution: null as string | null,
    created_at: "2026-01-01",
  }));
  it("preview then discard leaves the run rows unchanged (dry run never writes)", () => {
    const before = JSON.stringify(live);
    const split = live.find((r) => nodeKeyOf(r) === "split")!;
    previewRun(live, base, split, "Best venue");
    expect(JSON.stringify(live)).toBe(before);
  });
  it("during the conflict, downstream steps are tentative and the conflict is open", () => {
    const d = deriveOpenItems(live, null);
    expect(d.open.map((i) => i.kind)).toContain("conflict");
    expect(d.tentative.get("deposit")).toBeGreaterThan(0);
    expect(d.tentative.get("invites")).toBeGreaterThan(0);
  });
  it("previewing a 'Best venue' split marks the conflict and the split default resolved in preview", () => {
    const split = live.find((r) => nodeKeyOf(r) === "split")!;
    expect(nodeValue(split)).toBe("Balanced");
    const d = deriveOpenItems(live, previewRun(live, base, split, "Best venue"));
    expect(d.items.find((i) => i.key === "conflict")?.resolvedInPreview).toBe(true);
    expect(d.items.find((i) => i.key === "split")?.resolvedInPreview).toBe(true);
    expect(d.open.length).toBeLessThan(deriveOpenItems(live, null).open.length);
  });
});
