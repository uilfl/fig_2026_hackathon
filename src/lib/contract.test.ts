import { describe, expect, it } from "vitest";
import { contractDiff, planPreview, signLabel, snapThreshold, isHouseRule, type Snapshot } from "./contract";

const base: Snapshot = { goal: "a two-day team offsite", budget_cap: 6000, headcount: 12, triggers: { ask_at: "never", over_budget: true, actions: {} }, rules: [] };

describe("contract versions", () => {
  it("keeps the version when nothing changed", () => {
    expect(signLabel({ version: 3, snapshot: base, diff: [], signed_at: "" }, base).label).toBe("Run again under v3");
  });
  it("increments the version when something changed", () => {
    expect(signLabel({ version: 3, snapshot: base, diff: [], signed_at: "" }, { ...base, budget_cap: 7000 }).label).toBe("Sign v4 & run agents");
  });
  it("lists an added rule and a threshold change", () => {
    const d = contractDiff({ ...base, triggers: { ...base.triggers, ask_at: "off" } }, { ...base, rules: [{ key: "require_parking", label: "Venues must have parking", kind: "keep" }] });
    expect(d).toContain("+ Rule: Venues must have parking");
    expect(d).toContain("Threshold: never ask → ask before anything that can't be undone");
  });
});

describe("plan preview", () => {
  it("asks for 2 of 4 under can't-be-undone", () => {
    const p = planPreview(base.triggers);
    expect(p.header).toBe("With this contract, 2 of 4 actions will ask you.");
    expect(p.summary).toBe("Agents will pick the budget split, venue and dates and book the caterer on their own. They'll stop for the $1,600 deposit and before emailing 12 people.");
  });
  it("an override flips one action", () => {
    expect(planPreview({ ...base.triggers, actions: { invites: false } }).asking).toBe(1);
  });
  it("snaps the dragged edge to the nearest threshold", () => {
    expect(snapThreshold(2.8)).toBe("never");
    expect(snapThreshold(1.7)).toBe("until_deadline");
    expect(snapThreshold(3.9)).toBe("off");
  });
  it("one-time overrides are not house rules", () => {
    expect(isHouseRule({ key: "earliest_weekend", label: "x", kind: "override", value: "Mar 21–22" })).toBe(false);
    expect(isHouseRule({ key: "require_parking", label: "x", kind: "keep" })).toBe(true);
  });
});

describe("agent settings in versions", () => {
  it("pausing and resuming an agent is a versioned change", () => {
    const paused = { ...base, agents: { invites: { paused: true } } };
    expect(contractDiff(base, paused)).toEqual(["Invites agent: paused"]);
    expect(contractDiff(paused, { ...base, agents: {} })).toEqual(["Invites agent: resumed"]);
    expect(signLabel({ version: 1, snapshot: base, diff: [], signed_at: "" }, paused).changed).toBe(true);
  });
  it("changing an agent's instruction shows the old and new rule", () => {
    const a = { ...base, rules: [{ key: "venue_share_60", label: "Use 50% instead of “Spend 60%”", kind: "override" as const, value: "50%" }] };
    const b = { ...base, rules: [{ key: "venue_share_60", label: "Use 70% instead of “Spend 60%”", kind: "override" as const, value: "70%" }] };
    expect(contractDiff(a, b)).toEqual(["Rule: Use 50% instead of “Spend 60%” → Use 70% instead of “Spend 60%”"]);
  });
  it("a paused agent makes its actions ask in the preview", () => {
    const p = planPreview({ ask_at: "off", over_budget: false }, { agents: { budget: { paused: true } } });
    expect(p.rows.filter((r) => r.asks).map((r) => r.key)).toEqual(["plan", "catering", "deposit"]);
  });
});

describe("cases in versions", () => {
  const snap = (over: Partial<Snapshot>): Snapshot => ({ goal: "Plan a two-day team offsite for 12 people", budget_cap: 6000, headcount: 12, triggers: { ask_at: "never", over_budget: true }, rules: [], scenario: "offsite", ...over });
  it("switching case is one diff line, and the same rule key in another case is a separate rule", () => {
    const prev = snap({ rules: [{ key: "venue_share_60", label: "Use 70%", kind: "override", value: "70%" }] });
    const next = snap({ scenario: "dinner", goal: "Host a client dinner for 8 guests", rules: [...prev.rules, { key: "venue_share_60", label: "Use 50%", kind: "override", value: "50%", scenario: "dinner" }] });
    const d = contractDiff(prev, next);
    expect(d[0]).toBe("Case: Team offsite → Client dinner");
    expect(d).toContain("+ Rule: Use 50%");
    expect(d.some((l) => l.startsWith("Rule: Use 70%"))).toBe(false);
  });
});
