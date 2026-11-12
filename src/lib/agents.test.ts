import { describe, expect, it } from "vitest";
import {
  AGENT_NAME_MAX,
  AGENT_NOTE_MAX,
  agentNameError,
  agentSettings,
  agentSummary,
  customAgentsFor,
  withAgentSetting,
  withCustomAgent,
  withoutCustomAgent,
  UP_TO_AGENT,
} from "./agents";
import { DATES_KEY, SHARE_KEY, runScenario, type Contract } from "./engine";
import { scenarioOf } from "./scenarios";

const S = scenarioOf("offsite");
const base: Contract = {
  goal: "Plan a two-day team offsite",
  budget_cap: 6000,
  headcount: 12,
  triggers: { ask_at: "never", over_budget: true },
  rules: [],
  scenario: "offsite",
};

describe("agent instructions are contract rules", () => {
  it("nothing set: every instruction is up to the agent", () => {
    const v = agentSettings(base, S, "venue");
    expect(v.instructions.map((i) => [i.key, i.value])).toEqual([
      ["require_parking", UP_TO_AGENT],
      [DATES_KEY, UP_TO_AGENT],
    ]);
  });
  it("the agent's own pick becomes a keep rule, labelled like a kept default", () => {
    const c = withAgentSetting(base, S, "budget", { instruction: SHARE_KEY, value: "Balanced" });
    expect(c.rules).toEqual([
      { key: SHARE_KEY, label: "Keep it balanced", kind: "keep", scenario: "offsite" },
    ]);
    expect(agentSettings(c, S, "budget").instructions[0]!.value).toBe("Balanced");
  });
  it("another pick becomes an override the engine follows", () => {
    const c = withAgentSetting(base, S, "budget", {
      instruction: SHARE_KEY,
      value: "Save for catering",
    });
    expect(c.rules[0]).toMatchObject({
      kind: "override",
      value: "Save for catering",
      label: "Save money for catering & extras (instead of “Keep it balanced”)",
    });
    const split = runScenario(c).find((s) => s.role === "split")!;
    expect(split.action).toBe(
      "Chose “Save money for catering & extras”: up to $3,000 for the venue",
    );
    expect(split.source).toBe("user");
  });
  it("split options are trade-offs with a dollar hint that follows the budget cap, never a percentage", () => {
    const share = agentSettings({ ...base, budget_cap: 5000 }, S, "budget").instructions[0]!;
    expect(share.title).toBe("What matters more?");
    expect(share.options.map((o) => [o.label, o.hint])).toEqual([
      ["Let the agent decide", "It assumes “Keep it balanced”"],
      ["Save money for catering & extras", "Up to $2,500 for the venue"],
      ["Keep it balanced", "Up to $3,000 for the venue"],
      ["Get the best venue for the group", "Up to $3,500 for the venue"],
    ]);
    expect(JSON.stringify(share)).not.toMatch(/\d%/);
  });
  it("requirement: 'Always required' keeps the rule, so the venue is no longer a default", () => {
    const c = withAgentSetting(
      withAgentSetting(base, S, "venue", { instruction: "require_parking", value: "required" }),
      S,
      "venue",
      { instruction: DATES_KEY, value: "Apr 4–5" },
    );
    expect(c.rules.find((r) => r.key === "require_parking")).toMatchObject({
      kind: "keep",
      label: "Venues must have on-site parking",
    });
    expect(runScenario(c).find((s) => s.role === "dates")!.action).toBe("Picked dates Apr 4–5");
  });
  it("'Up to the agent' removes the rule", () => {
    const c = withAgentSetting(base, S, "venue", { instruction: DATES_KEY, value: "Mar 21–22" });
    expect(
      withAgentSetting(c, S, "venue", { instruction: DATES_KEY, value: UP_TO_AGENT }).rules,
    ).toEqual([]);
  });
  it("an earlier one-off venue pick shows as its own option", () => {
    const c = {
      ...base,
      rules: [
        {
          key: "require_parking",
          label: "Use Harbor House instead",
          kind: "override" as const,
          value: "Harbor House",
        },
      ],
    };
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
    expect(
      withAgentSetting(go, S, "budget", { action: "catering", mode: "threshold" }).triggers.actions,
    ).toEqual({ deposit: false });
  });
  it("reports what the threshold alone would do", () => {
    const a = agentSettings(base, S, "budget").actions;
    expect(a.map((x) => [x.key, x.mode, x.thresholdAsks, x.asks, x.overridden])).toEqual([
      ["deposit", "threshold", true, true, false],
      ["catering", "threshold", false, false, false],
    ]);
  });
  it("'Ask me first' switch: going against the threshold sets an override, matching it clears it", () => {
    const on = withAgentSetting(base, S, "budget", { action: "catering", asks: true });
    expect(on.triggers.actions).toEqual({ catering: true });
    expect(agentSettings(on, S, "budget").actions[1]).toMatchObject({
      asks: true,
      overridden: true,
    });
    expect(
      withAgentSetting(on, S, "budget", { action: "catering", asks: false }).triggers.actions,
    ).toEqual({});
    const off = withAgentSetting(base, S, "budget", { action: "deposit", asks: false });
    expect(off.triggers.actions).toEqual({ deposit: false });
    expect(
      withAgentSetting(off, S, "budget", { action: "deposit", asks: true }).triggers.actions,
    ).toEqual({});
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
    const c = withAgentSetting(
      withAgentSetting(base, S, "budget", { instruction: SHARE_KEY, value: "Save for catering" }),
      S,
      "budget",
      { action: "catering", mode: "ask" },
    );
    expect(agentSummary(c, S, "budget")).toBe("Save for catering · asks before booking");
    expect(agentSummary(withAgentSetting(base, S, "budget", { paused: true }), S, "budget")).toBe(
      "Paused — every step waits for you",
    );
  });
});

describe("dinner case", () => {
  const D = scenarioOf("dinner");
  const dinner: Contract = {
    ...D.defaults,
    triggers: { ask_at: "never", over_budget: true },
    rules: [],
    scenario: "dinner",
  };
  it("names the Restaurant agent, its split trade-offs and the private-room requirement", () => {
    const v = agentSettings(dinner, D, "venue");
    expect(v.name).toBe("Restaurant agent");
    expect(v.instructions.map((i) => i.title)).toEqual(["Private room", "Date"]);
    const share = agentSettings(dinner, D, "budget").instructions[0]!;
    expect(share.title).toBe("What matters more?");
    expect(share.options.map((o) => o.label)).toContain("Get the best restaurant for the guests");
  });
  it("writes rules tagged with the case and keeps the other case's rules", () => {
    const offsiteRule = {
      key: SHARE_KEY,
      label: "Get the best venue",
      kind: "override" as const,
      value: "Best venue",
    };
    const c = withAgentSetting({ ...dinner, rules: [offsiteRule] }, D, "budget", {
      instruction: SHARE_KEY,
      value: "Save for wine",
    });
    expect(c.rules).toEqual([
      offsiteRule,
      expect.objectContaining({ key: SHARE_KEY, value: "Save for wine", scenario: "dinner" }),
    ]);
    expect(agentSettings(c, D, "budget").instructions[0]!.value).toBe("Save for wine");
  });
});

describe("agents the user adds", () => {
  const D = scenarioOf("dinner");
  const add = (c: Contract, name: string, id = name, note = "") =>
    withCustomAgent(c, S, { id, name, note });

  it("adds a named agent to the contract's case, trimmed, and removes it by id", () => {
    const c = add(base, "  Catering agent ", "a1", "  Finds a caterer for the group  ");
    expect(customAgentsFor(c)).toEqual([
      {
        id: "a1",
        name: "Catering agent",
        note: "Finds a caterer for the group",
        scenario: "offsite",
      },
    ]);
    expect(customAgentsFor(withoutCustomAgent(c, "a1"))).toEqual([]);
  });
  it("cuts the note to its limit", () => {
    const c = add(base, "Notes agent", "a1", "x".repeat(AGENT_NOTE_MAX + 20));
    expect(customAgentsFor(c)[0]!.note).toHaveLength(AGENT_NOTE_MAX);
  });
  it("belongs to one case: an offsite agent isn't on the dinner's team", () => {
    const c = add(base, "Catering agent");
    expect(customAgentsFor({ ...c, scenario: "dinner" })).toEqual([]);
  });
  it("rejects names that would clash with who decided a step", () => {
    expect(agentNameError(base, S, "   ")).toBe("Give it a name.");
    expect(agentNameError(base, S, "x".repeat(AGENT_NAME_MAX + 1))).toMatch(/under/);
    expect(agentNameError(base, S, "budget AGENT")).toMatch(/already on the team/);
    expect(agentNameError(base, S, "cosign")).toMatch(/already on the team/);
    expect(agentNameError(base, S, "You")).toMatch(/already on the team/);
    expect(agentNameError(base, D, "Restaurant agent")).toMatch(/already on the team/);
    expect(agentNameError(add(base, "Catering agent"), S, " catering agent")).toMatch(
      /already on the team/,
    );
    expect(agentNameError(base, S, "Catering agent")).toBeNull();
  });
  it("an invalid name leaves the contract unchanged", () => {
    expect(add(base, "Venue agent")).toBe(base);
  });
  it("takes no steps: the plan is identical with or without one", () => {
    // Compare as JSON: steps carry fresh `check` closures, which never deep-equal across calls.
    expect(JSON.stringify(runScenario(add(base, "Catering agent")))).toBe(
      JSON.stringify(runScenario(base)),
    );
  });
});
