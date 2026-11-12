import { describe, expect, it } from "vitest";
import { alternativesFor, isCommitStep, runScenario, SHARE_KEY, type Contract, type Rule } from "./engine";
import { planPreview } from "./contract";
import { nodeKeyOf } from "./map";
import { rowFromStep } from "./plan-rows";
import { scenarioOf } from "./scenarios";

const base: Contract = { goal: "Plan a two-day team offsite for 12 people", budget_cap: 6000, headcount: 12, triggers: { ask_at: "never", over_budget: true }, rules: [] };
const rule = (key: string, value: string): Rule => ({ key, label: key, kind: "override", value });

/** Contracts that walk every branch of the offsite plan: conflict open/settled each way, overrides, kept rules, thresholds. */
const CASES: [string, Contract][] = [
  ["seed", base],
  ["sided with budget", { ...base, rules: [rule("venue_conflict", "budget")] }],
  ["sided with venue", { ...base, rules: [rule("venue_conflict", "venue")] }],
  ["picked a venue in the conflict", { ...base, rules: [rule("venue_conflict", "Cedar Hall")] }],
  ["split raised to 70%", { ...base, rules: [rule("venue_share_60", "70%")] }],
  ["dates + parking override", { ...base, rules: [rule("venue_conflict", "budget"), rule("earliest_weekend", "Apr 4–5"), rule("require_parking", "Harbor House")] }],
  ["kept parking rule", { ...base, rules: [rule("venue_conflict", "budget"), { key: "require_parking", label: "Venues must have on-site parking", kind: "keep" }] }],
  ["ask before everything, 20 people", { ...base, headcount: 20, triggers: { ask_at: "free", over_budget: true } }],
  ["never ask, small budget", { ...base, budget_cap: 2000, triggers: { ask_at: "off", over_budget: false } }],
];

/** Everything the UI and ledger read from a step (functions like `check`, and the newer `role`, are left out). */
const shape = (c: Contract) => runScenario(c).map(({ check: _check, role: _role, ...s }) => s);

describe("steps carry their role", () => {
  it("every step except the contract has a distinct role, and the map reads it", () => {
    const steps = runScenario(base);
    expect(steps[0]!.role).toBeUndefined();
    expect(steps.slice(1).map((s) => s.role)).toEqual(["split", "conflict", "venue", "dates", "deposit", "catering", "invites"]);
    for (const s of steps) expect(nodeKeyOf(s)).toBe(s.role ?? null);
  });
  it("ledger rows record the role and the case they were planned under", () => {
    const steps = runScenario(base);
    const row = rowFromStep(steps[3]!, "run-1", 3, null, "offsite");
    expect(row).toMatchObject({ role: "venue", scenario: "offsite", action: "Shortlisted Lakeside Lodge" });
  });
  it("an unknown case id falls back to the offsite", () => {
    expect(scenarioOf("nope").id).toBe("offsite");
    expect(scenarioOf(undefined).id).toBe("offsite");
  });
});

describe("plan preview uses real amounts from the contract", () => {
  it("20 people: catering and invites follow the headcount", () => {
    const p = planPreview({ ask_at: "never", over_budget: true }, { headcount: 20 });
    expect(p.rows.find((r) => r.key === "catering")!.reachLabel).toBe("$1,700 refundable");
    expect(p.rows.find((r) => r.key === "invites")!.reachLabel).toBe("Emails 20 people");
    expect(p.summary).toContain("before emailing 20 people");
  });
  it("siding with the Venue agent raises the deposit shown on the risk map", () => {
    const p = planPreview({ ask_at: "never", over_budget: true }, { rules: [rule("venue_conflict", "venue")] });
    expect(p.rows.find((r) => r.key === "deposit")!.reachLabel).toBe("$2,600 non-refundable");
  });
});

describe("offsite scenario stays identical through the scenario refactor", () => {
  for (const [name, c] of CASES) it(name, () => expect(shape(c)).toMatchSnapshot());
  it("decline alternatives", () => {
    const run = runScenario(CASES[1]![1]).map((s) => ({ ...s, status: s.status as string }));
    expect(alternativesFor(run.find((s) => s.kind === "spend")!.seq, run, CASES[1]![1])).toMatchSnapshot();
  });
});

describe("client dinner case", () => {
  const D = scenarioOf("dinner");
  const dinner: Contract = { ...D.defaults, triggers: { ask_at: "never", over_budget: true }, rules: [], scenario: "dinner" };
  const byRole = (c: Contract) => new Map(runScenario(c).map((s) => [s.role, s]));
  it("seed: the agents disagree over Lumen, $300 over the $1,500 restaurant share", () => {
    const conflict = byRole(dinner).get("conflict")!;
    expect(conflict.status).toBe("pending");
    expect(conflict.action).toContain("Restaurant agent wants Chef's Table at Lumen");
    expect(conflict.action).toContain("over restaurant share by $300");
  });
  it("siding with Budget picks Osteria Nove; deposit and wine go on the commit card, the send reaches 8 guests", () => {
    const steps = byRole({ ...dinner, rules: [{ key: "venue_conflict", label: "", kind: "override", value: "budget", scenario: "dinner" }] });
    expect(steps.get("venue")!.action).toBe("Shortlisted Osteria Nove");
    expect(steps.get("deposit")!.action).toBe("Pay room deposit to Osteria Nove");
    expect(isCommitStep({ ...steps.get("deposit")!, status: "pending" })).toBe(true);
    expect(steps.get("catering")!.action).toBe("Order wine pairing from Vino Select");
    expect(steps.get("invites")!.effect).toMatchObject({ recipients: 8 });
  });
  it("the requirement and the date are defaults nobody chose", () => {
    const steps = byRole({ ...dinner, rules: [{ key: "venue_conflict", label: "", kind: "override", value: "budget", scenario: "dinner" }] });
    expect(steps.get("venue")!.default_key).toBe("require_private_room");
    expect(steps.get("dates")!.default_label).toBe("Book the earliest open evening");
  });
  it("offsite rules never steer the dinner, and untagged rules still steer the offsite", () => {
    const offsiteOnly: Rule = { key: SHARE_KEY, label: "", kind: "override", value: "70%" };
    expect(byRole({ ...dinner, rules: [offsiteOnly] }).get("split")!.action).toContain("60%");
    expect(byRole({ ...base, rules: [offsiteOnly] }).get("split")!.action).toContain("70%");
  });
  it("plan preview speaks dinner", () => {
    const p = planPreview({ ask_at: "never", over_budget: true }, { scenario: "dinner" });
    expect(p.rows.find((r) => r.key === "invites")!.reachLabel).toBe("Emails 8 guests");
    expect(p.summary).toContain("8 guests");
  });
});
