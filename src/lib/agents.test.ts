import { describe, expect, it } from "vitest";
import { agentSettings, agentSummary, withAgentSetting, UP_TO_AGENT } from "./agents";
import { DATES_KEY, SHARE_KEY, runScenario, type Contract } from "./engine";
import { scenarioOf } from "./scenarios";

const S = scenarioOf("offsite");
const base: Contract = { goal: "Plan a two-day team offsite", budget_cap: 6000, headcount: 12, triggers: { ask_at: "never", over_budget: true }, rules: [], scenario: "offsite" };

describe("agent instructions are contract rules", () => {
  it("nothing set: every instruction is up to the agent", () => {
    const v = agentSettings(base, S, "venue");
    expect(v.instructions.map((i) => [i.key, i.value])).toEqual([["require_parking", UP_TO_AGENT], [DATES_KEY, UP_TO_AGENT]]);
  });
  it("the agent's own pick becomes a keep rule, labelled like a kept default", () => {
    const c = withAgentSetting(base, S, "budget", { instruction: SHARE_KEY, value: "60%" });
    expect(c.rules).toEqual([{ key: SHARE_KEY, label: "Spend 60% of the budget on the venue", kind: "keep", scenario: "offsite" }]);
    expect(agentSettings(c, S, "budget").instructions[0]!.value).toBe("60%");
  });
  it("another pick becomes an override the engine follows", () => {
    const c = withAgentSetting(base, S, "budget", { instruction: SHARE_KEY, value: "50%" });
    expect(c.rules[0]).toMatchObject({ kind: "override", value: "50%" });
    const split = runScenario(c).find((s) => s.role === "split")!;
    expect(split.action).toContain("50%");
    expect(split.source).toBe("user");
  });
  it("requirement: 'Always required' keeps the rule, so the venue is no longer a default", () => {
    const c = withAgentSetting(withAgentSetting(base, S, "venue", { instruction: "require_parking", value: "required" }), S, "venue", { instruction: DATES_KEY, value: "Apr 4–5" });
    expect(c.rules.find((r) => r.key === "require_parking")).toMatchObject({ kind: "keep", label: "Venues must have on-site parking" });
    expect(runScenario(c).find((s) => s.role === "dates")!.action).toBe("Picked dates Apr 4–5");
  });
  it("'Up to the agent' removes the rule", () => {
    const c = withAgentSetting(base, S, "venue", { instruction: DATES_KEY, value: "Mar 21–22" });
    expect(withAgentSetting(c, S, "venue", { instruction: DATES_KEY, value: UP_TO_AGENT }).rules).toEqual([]);
  });
  it("an earlier one-off venue pick shows as its own option", () => {
    const c = { ...base, rules: [{ key: "require_parking", label: "Use Harbor House instead", kind: "override" as const, value: "Harbor House" }] };
    const req = agentSettings(c, S, "venue").instructions[0]!;
    expect(req.value).toBe("Harbor House");
    expect(req.options.at(-1)!.label).toContain("Harbor House");
  });
});

describe("what an agent may do without asking", () => {
  it("maps ask / threshold / go to per-action overrides", () => {
    const ask = withAgentSetting(base, S, "budget", { action: "catering", mode: "ask" });
    expect(ask.triggers.actions).toEqual({ catering: true });
    const go = withAgentSetting(ask, S, "budget", { action: "deposit", mode: "go" });
    expect(go.triggers.actions).toEqual({ catering: true, deposit: false });
    expect(withAgentSetting(go, S, "budget", { action: "catering", mode: "threshold" }).triggers.actions).toEqual({ deposit: false });
  });
  it("reports what the threshold alone would do", () => {
    const a = agentSettings(base, S, "budget").actions;
    expect(a.map((x) => [x.key, x.mode, x.thresholdAsks])).toEqual([["deposit", "threshold", true], ["catering", "threshold", false]]);
  });
});

describe("pausing and summaries", () => {
  it("pause toggles contract.agents", () => {
    const p = withAgentSetting(base, S, "invites", { paused: true });
    expect(p.agents).toEqual({ invites: { paused: true } });
    expect(withAgentSetting(p, S, "invites", { paused: false }).agents).toEqual({});
  });
  it("summary lines", () => {
    expect(agentSummary(base, S, "venue")).toBe("Assumes 2 things you haven't set");
    expect(agentSummary(base, S, "invites")).toBe("Follows your contract");
    const c = withAgentSetting(withAgentSetting(base, S, "budget", { instruction: SHARE_KEY, value: "50%" }), S, "budget", { action: "catering", mode: "ask" });
    expect(agentSummary(c, S, "budget")).toBe("Venue share: 50% · asks before booking");
    expect(agentSummary(withAgentSetting(base, S, "budget", { paused: true }), S, "budget")).toBe("Paused — every step waits for you");
  });
});

describe("dinner case", () => {
  const D = scenarioOf("dinner");
  const dinner: Contract = { ...D.defaults, triggers: { ask_at: "never", over_budget: true }, rules: [], scenario: "dinner" };
  it("names the Restaurant agent, its share and the private-room requirement", () => {
    const v = agentSettings(dinner, D, "venue");
    expect(v.name).toBe("Restaurant agent");
    expect(v.instructions.map((i) => i.title)).toEqual(["Private room", "Date"]);
    expect(agentSettings(dinner, D, "budget").instructions[0]!.title).toBe("Restaurant share");
  });
  it("writes rules tagged with the case and keeps the other case's rules", () => {
    const offsiteRule = { key: SHARE_KEY, label: "Spend 70%", kind: "override" as const, value: "70%" };
    const c = withAgentSetting({ ...dinner, rules: [offsiteRule] }, D, "budget", { instruction: SHARE_KEY, value: "50%" });
    expect(c.rules).toEqual([offsiteRule, expect.objectContaining({ key: SHARE_KEY, value: "50%", scenario: "dinner" })]);
    expect(agentSettings(c, D, "budget").instructions[0]!.value).toBe("50%");
  });
});
