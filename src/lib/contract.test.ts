import { describe, expect, it } from "vitest";
import {
  contractDiff,
  planPreview,
  signLabel,
  snapThreshold,
  isHouseRule,
  type Snapshot,
} from "./contract";

const base: Snapshot = {
  goal: "a two-day team offsite",
  budget_cap: 6000,
  headcount: 12,
  triggers: { ask_at: "never", over_budget: true, actions: {} },
  rules: [],
};

describe("contract versions", () => {
  it("keeps the version when nothing changed", () => {
    expect(signLabel({ version: 3, snapshot: base, diff: [], signed_at: "" }, base).label).toBe(
      "Run again under v3",
    );
  });
  it("increments the version when something changed", () => {
    expect(
      signLabel(
        { version: 3, snapshot: base, diff: [], signed_at: "" },
        { ...base, budget_cap: 7000 },
      ).label,
    ).toBe("Sign v4 & run agents");
  });
  it("lists an added rule and a threshold change", () => {
    const d = contractDiff(
      { ...base, triggers: { ...base.triggers, ask_at: "off" } },
      {
        ...base,
        rules: [{ key: "require_parking", label: "Venues must have parking", kind: "keep" }],
      },
    );
    expect(d).toContain("+ Rule: Venues must have parking");
    expect(d).toContain("Threshold: never ask → ask before anything that can't be undone");
  });
});

describe("plan preview", () => {
  it("asks for 2 of 4 under can't-be-undone", () => {
    const p = planPreview(base.triggers);
    expect(p.header).toBe("With this contract, 2 of 4 actions will ask you.");
    expect(p.summary).toBe(
      "Agents will pick the budget split, venue and dates and book the caterer on their own. They'll stop for the $1,600 deposit and before emailing 12 people.",
    );
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
    expect(
      isHouseRule({ key: "earliest_weekend", label: "x", kind: "override", value: "Mar 21–22" }),
    ).toBe(false);
    expect(isHouseRule({ key: "require_parking", label: "x", kind: "keep" })).toBe(true);
  });
});

describe("agent settings in versions", () => {
  it("pausing and resuming an agent is a versioned change", () => {
    const paused = { ...base, agents: { invites: { paused: true } } };
    expect(contractDiff(base, paused)).toEqual(["Invites agent: paused"]);
    expect(contractDiff(paused, { ...base, agents: {} })).toEqual(["Invites agent: resumed"]);
    expect(signLabel({ version: 1, snapshot: base, diff: [], signed_at: "" }, paused).changed).toBe(
      true,
    );
  });
  it("changing an agent's instruction shows the old and new rule", () => {
    const a = {
      ...base,
      rules: [
        {
          key: "venue_share_60",
          label: "Save money for catering & extras (instead of “Keep it balanced”)",
          kind: "override" as const,
          value: "Save for catering",
        },
      ],
    };
    const b = {
      ...base,
      rules: [
        {
          key: "venue_share_60",
          label: "Get the best venue for the group (instead of “Keep it balanced”)",
          kind: "override" as const,
          value: "Best venue",
        },
      ],
    };
    expect(contractDiff(a, b)).toEqual([
      "Rule: Save money for catering & extras (instead of “Keep it balanced”) → Get the best venue for the group (instead of “Keep it balanced”)",
    ]);
  });
  it("a paused agent makes its actions ask in the preview", () => {
    const p = planPreview(
      { ask_at: "off", over_budget: false },
      { agents: { budget: { paused: true } } },
    );
    expect(p.rows.filter((r) => r.asks).map((r) => r.key)).toEqual(["plan", "catering", "deposit"]);
  });
});

describe("cases in versions", () => {
  const snap = (over: Partial<Snapshot>): Snapshot => ({
    goal: "Plan a two-day team offsite for 12 people",
    budget_cap: 6000,
    headcount: 12,
    triggers: { ask_at: "never", over_budget: true },
    rules: [],
    scenario: "offsite",
    ...over,
  });
  it("switching case is one diff line, and the same rule key in another case is a separate rule", () => {
    const prev = snap({
      rules: [
        {
          key: "venue_share_60",
          label: "Get the best venue",
          kind: "override",
          value: "Best venue",
        },
      ],
    });
    const next = snap({
      scenario: "dinner",
      goal: "Host a client dinner for 8 guests",
      rules: [
        ...prev.rules,
        {
          key: "venue_share_60",
          label: "Save for wine",
          kind: "override",
          value: "Save for wine",
          scenario: "dinner",
        },
      ],
    });
    const d = contractDiff(prev, next);
    expect(d[0]).toBe("Case: Team offsite → Client dinner");
    expect(d).toContain("+ Rule: Save for wine");
    expect(d.some((l) => l.startsWith("Rule: Get the best venue"))).toBe(false);
  });
  it("adding or removing your own agent is a versioned change in its case only", () => {
    const agent = { id: "a1", name: "Catering agent", note: "", scenario: "offsite" };
    const prev = snap({});
    const next = snap({ custom_agents: [agent] });
    expect(contractDiff(prev, next)).toEqual(["+ Agent: Catering agent"]);
    expect(contractDiff(next, prev)).toEqual(["− Agent: Catering agent"]);
    expect(signLabel({ version: 2, snapshot: prev, diff: [], signed_at: "" }, next).label).toBe(
      "Sign v3 & run agents",
    );
    // An offsite agent is neither added nor removed when the next version is the dinner.
    const dinner = snap({
      scenario: "dinner",
      goal: "Host a client dinner for 8 guests",
      custom_agents: [agent],
    });
    expect(contractDiff(next, dinner).some((l) => l.includes("Agent:"))).toBe(false);
  });
});
