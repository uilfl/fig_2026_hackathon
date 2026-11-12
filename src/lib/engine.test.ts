import { describe, expect, it } from "vitest";
const SETTLED = {
  key: "venue_conflict",
  label: "settled",
  kind: "override" as const,
  value: "budget",
};
import {
  runScenario,
  reversibilityOf,
  needsAsk,
  unblockedStatus,
  normaliseTriggers,
  withRunRules,
  alternativesFor,
  nextAlternative,
  type Contract,
} from "./engine";

const base: Contract = {
  goal: "Offsite",
  budget_cap: 6000,
  headcount: 12,
  triggers: { ask_at: "never", over_budget: true },
  rules: [SETTLED],
};
const find = (c: Contract, p: string) => runScenario(c).find((s) => s.action.startsWith(p))!;

describe("engine", () => {
  it("'can't be undone' threshold pauses the non-refundable deposit", () => {
    expect(find(base, "Pay venue deposit").status).toBe("pending");
  });
  it("with the threshold off, the deposit does not pause", () => {
    expect(
      find({ ...base, triggers: { ask_at: "off", over_budget: true } }, "Pay venue deposit").status,
    ).toBe("done");
  });
  it("emails can't be unsent, so they ask under the 'can't be undone' threshold", () => {
    expect(
      find({ ...base, triggers: { ask_at: "off", over_budget: false } }, "Send").preview
        ?.blocked_by,
    ).toBeUndefined();
    expect(needsAsk("never", "never")).toBe(true);
    expect(needsAsk("until_deadline", "never")).toBe(false);
  });
  it("invites are blocked while the deposit waits", () => {
    expect(find(base, "Send").status).toBe("blocked");
  });
  it("refundable catering runs without asking under 'can't be undone'", () => {
    expect(find(base, "Reserve catering").status).toBe("done");
  });
  it("system flags venue share, parking and earliest weekend as defaults", () => {
    const d = runScenario(base)
      .filter((s) => s.source === "default")
      .map((s) => s.default_key);
    expect(d).toEqual(["venue_share_60", "require_parking", "earliest_weekend"]);
  });
  it("every step records criterion, options and source", () => {
    for (const s of runScenario(base).slice(1)) {
      expect(s.criterion).toBeTruthy();
      expect(s.options_considered.length).toBeGreaterThan(0);
      expect(s.source).toBeTruthy();
    }
  });
  it("Run 2: kept rule shows contract, override shows user and changes the dates", () => {
    const c = {
      ...base,
      rules: [
        { key: "require_parking", label: "p", kind: "keep" as const },
        { key: "earliest_weekend", label: "d", kind: "override" as const, value: "Mar 21–22" },
      ],
    };
    expect(
      find(c, "Shortlisted").criteria_out.find((x) => x.key === "require_parking")!.source,
    ).toBe("rule");
    const d = find(c, "Picked dates");
    expect(d.source).toBe("user");
    expect(d.action).toContain("Mar 21–22");
  });
  it("system marks refundable spend as until_deadline", () => {
    expect(
      reversibilityOf({
        type: "spend",
        amount: 1,
        refundable: true,
        payee: "a",
        memo: "",
        cancel_by: "x",
      }).level,
    ).toBe("until_deadline");
  });
  it("declining the deposit cancels the invites; approving releases them to ask", () => {
    expect(unblockedStatus(["x"], false).status).toBe("cancelled");
    expect(unblockedStatus(["x"], true).status).toBe("pending");
  });
  it("old toggle contracts with spend/send off map to never ask", () => {
    expect(
      normaliseTriggers({
        non_refundable_spend: false,
        irreversible_send: false,
        over_budget: false,
      }).ask_at,
    ).toBe("off");
  });
});

import { runScenario as rs2 } from "./engine";
describe("per-action ask settings", () => {
  const base = { goal: "g", budget_cap: 6000, headcount: 12, rules: [SETTLED] };
  it("deposit goes ahead when switched off even under 'can't be undone'", () => {
    const steps = rs2({
      ...base,
      triggers: { ask_at: "never", over_budget: true, actions: { deposit: false } },
    });
    expect(steps.find((s) => s.action.startsWith("Pay venue deposit"))!.status).toBe("done");
  });
  it("planning steps ask when switched on", () => {
    const steps = rs2({
      ...base,
      triggers: { ask_at: "off", over_budget: true, actions: { plan: true } },
    });
    expect(
      steps
        .filter((s) => s.kind === "select")
        .every((s) => s.status === "pending" || s.status === "blocked"),
    ).toBe(true);
  });
});

import { verifyCriteria, buildCriteria, sourceFromCriteria, venueCheck } from "./engine";
import { scenarioOf } from "./scenarios";
const VENUES = scenarioOf("offsite").options;
describe("multi-criteria attribution", () => {
  const c = {
    goal: "g",
    budget_cap: 6000,
    headcount: 12,
    triggers: { ask_at: "off" as const, over_budget: false },
    rules: [] as Contract["rules"],
  };
  const shortlist = (k: Contract) =>
    runScenario(k).find((s) => s.action.startsWith("Shortlisted"))!;
  it("mixed-source shortlist resolves to DEFAULT with 3 criteria", () => {
    const s = shortlist(c);
    expect(s.source).toBe("default");
    expect(s.criteria_out.map((x) => [x.key, x.source])).toEqual([
      ["headcount", "contract"],
      ["venue_share_60", "default"],
      ["require_parking", "default"],
    ]);
    expect(s.criteria_out.every((x) => x.verified)).toBe(true);
  });
  it("kept parking is credited as a contract rule, shortlist stays DEFAULT until the split is resolved", () => {
    const k1 = { ...c, rules: [{ key: "require_parking", label: "p", kind: "keep" as const }] };
    const s1 = shortlist(k1);
    expect(s1.criteria_out.find((x) => x.key === "require_parking")!.source).toBe("rule");
    expect(s1.source).toBe("default");
    const s2 = shortlist({
      ...c,
      rules: [...k1.rules, { key: "venue_share_60", label: "s", kind: "keep" as const }],
    });
    expect(s2.source).toBe("contract");
  });
  it("agent claiming 'budget cap' for a filter that used the balanced split is an unverified DEFAULT", () => {
    const refs = [
      { key: "headcount", label: "Fits" },
      { key: "budget_cap", label: "Within budget cap" },
      { key: "require_parking", label: "Parking" },
    ];
    const bad = verifyCriteria(
      refs,
      VENUES.map((v) => v.name),
      [
        { option: "Cedar Hall", criterion: "headcount" },
        { option: "The Foundry Loft", criterion: "require_parking" },
        { option: "Harbor House", criterion: "require_parking" },
        { option: "Ridgeview Inn", criterion: "budget_cap" },
      ],
      venueCheck(c, 3600),
    );
    expect([...bad]).toEqual(["budget_cap"]);
    const crit = buildCriteria(refs, c, [], bad);
    expect(crit[1]).toMatchObject({ key: "budget_cap", source: "default", verified: false });
    expect(sourceFromCriteria(crit)).toBe("default");
  });
});

import { planReplacements, upstreamOf } from "./engine";
describe("data dependencies and re-planning", () => {
  const base = {
    goal: "Team offsite",
    budget_cap: 6000,
    headcount: 12,
    triggers: { ask_at: "never" as const, over_budget: true },
    rules: [SETTLED],
  };
  it("deposit depends on the split, shortlist and dates", () => {
    const steps = runScenario(base);
    const dep = steps.find((s) => s.action.startsWith("Pay venue deposit"))!;
    expect(upstreamOf(dep.seq, steps)).toEqual([1, 2, 3, 4]);
  });
  it("overriding the dates regenerates the deposit for Mar 21–22", () => {
    const before = runScenario(base);
    const old = before.map((s) => ({ ...s, criteria: s.criteria_out }));
    const after = runScenario({
      ...base,
      rules: [
        SETTLED,
        { key: "earliest_weekend", label: "x", kind: "override", value: "Mar 21–22" },
      ],
    });
    const seqs = planReplacements(old, after);
    expect(seqs).toEqual([4, 5, 6, 7]);
    expect(after[5]!.preview!.what).toContain("Mar 21–22");
  });
});

import { scopeOf, SCOPE_KEY, countApprovals, scopeSuggestion, isCommitStep } from "./engine";
describe("commit card and saved scope", () => {
  const base = {
    goal: "Team offsite",
    budget_cap: 6000,
    headcount: 12,
    triggers: { ask_at: "never" as const, over_budget: true },
    rules: [SETTLED] as import("./engine").Rule[],
  };
  const invitesOf = (c: typeof base) => runScenario(c).find((s) => s.kind === "send")!;
  it("deposit and invites both go on the commit card", () => {
    const steps = runScenario(base).map((s) => ({ ...s, preview: s.preview as unknown }));
    expect(steps.filter(isCommitStep).map((s) => s.kind)).toEqual(["spend", "send"]);
  });
  it("matching saved scope sends without asking, labeled approved", () => {
    const inv = invitesOf(base);
    const rules = [
      { key: SCOPE_KEY("invites"), label: "s", kind: "scope" as const, value: inv.preview!.scope! },
    ];
    const next = invitesOf({ ...base, rules });
    expect(next.preview!.saved_scope).toBe(true);
    expect(next.source).toBe("approved");
    expect(next.preview!.blocked_by).toBeUndefined();
  });
  it("a changed recipient list pauses and says what changed", () => {
    const inv = invitesOf(base);
    const rules = [
      { key: SCOPE_KEY("invites"), label: "s", kind: "scope" as const, value: inv.preview!.scope! },
    ];
    const next = invitesOf({ ...base, headcount: 14, rules });
    expect(next.preview!.blocked_by![0]).toContain("recipients: 12 people → 14 people");
  });
  it("one commit approving two steps counts as one approval", () => {
    const t = "2026-01-01";
    expect(
      countApprovals([
        { source: "approved", status: "done", decided_at: t, preview: {} },
        { source: "approved", status: "done", decided_at: t, preview: {} },
        { source: "approved", status: "done", decided_at: "x", preview: { saved_scope: true } },
      ]),
    ).toBe(1);
  });
  it("suggests a scope after 2 approved runs, never with a regret flag", () => {
    const run = [{ kind: "send", source: "approved", resolution: null, preview: {} }];
    expect(scopeSuggestion([run, run], base)).toBe("invites");
    expect(
      scopeSuggestion(
        [
          run,
          [
            ...run,
            { kind: "select", source: "default", resolution: "should_have_asked", preview: {} },
          ],
        ],
        base,
      ),
    ).toBeNull();
    expect(
      scopeOf({ type: "send", channel: "email", recipients: 12, subject: "a" }).recipients,
    ).toBe("12 people");
  });
});

describe("alternatives after a decline", () => {
  const c: Contract = {
    goal: "Offsite",
    budget_cap: 6000,
    headcount: 12,
    triggers: { ask_at: "never", over_budget: true },
    rules: [],
  };
  const run = runScenario(c);
  const dep = run.find((s) => s.action.startsWith("Pay venue deposit"))!;
  const alts = alternativesFor(dep.seq, run, c);
  it("declining the Lakeside deposit offers Ridgeview and other dates", () => {
    expect(alts.map((a) => a.value)).toEqual(
      expect.arrayContaining(["Ridgeview Inn", "Mar 21–22", "Apr 4–5"]),
    );
    expect(alts.some((a) => a.value === "Lakeside Lodge" || a.value === "Mar 14–15")).toBe(false);
  });
  it("asking the agent picks the next option that passes the filters", () => {
    // No other venue passes (capacity, balanced venue budget, parking), so the agent moves to the next dates.
    expect(nextAlternative(alts)?.value).toBe("Mar 21–22");
  });
  it("picking Ridgeview re-plans the deposit as YOU CHOSE", () => {
    const r = runScenario({
      ...c,
      rules: [{ key: "require_parking", label: "x", kind: "override", value: "Ridgeview Inn" }],
    });
    expect(
      r
        .find((s) => s.action.startsWith("Shortlisted"))!
        .criteria_out.find((k) => k.key === "require_parking")!.source,
    ).toBe("you");
    expect(r.find((s) => s.action.startsWith("Pay venue deposit"))!.action).toContain(
      "Ridgeview Inn",
    );
  });
});

describe("agent conflict", () => {
  const c: Contract = {
    goal: "Offsite",
    budget_cap: 5999,
    headcount: 12,
    triggers: { ask_at: "never", over_budget: true },
    rules: [],
  };
  it("Venue and Budget agents disagree at the balanced split and the run waits on you", () => {
    const r = runScenario(c);
    const k = r.find((s) => s.criterion === "venue_conflict")!;
    expect(k.status).toBe("pending");
    expect(k.action).toContain("over the venue budget by $1,601");
    expect(r.find((s) => s.action.startsWith("Shortlisted"))!.status).toBe("blocked");
    expect(r.find((s) => s.action.startsWith("Pay venue deposit"))!.status).toBe("blocked");
  });
  it("siding with the Venue agent settles it as YOU and books Ridgeview", () => {
    const r = runScenario(
      withRunRules(c, [{ criterion: "venue_conflict", resolution: "override:venue" }]),
    );
    expect(r.find((s) => s.criterion === "venue_conflict")!.source).toBe("user");
    expect(r.find((s) => s.action.startsWith("Pay venue deposit"))!.preview!.amount).toBe(2600);
  });
  it("a dry run at 'Best venue' previews Ridgeview, +$1,000 on the deposit", () => {
    const base = runScenario(
      withRunRules(c, [{ criterion: "venue_conflict", resolution: "override:budget" }]),
    );
    const dry = runScenario(
      withRunRules(c, [{ criterion: "venue_share_60", resolution: "override:Best venue" }]),
    );
    const dep = (x: typeof base) =>
      x.find((s) => s.action.startsWith("Pay venue deposit"))!.preview!.amount!;
    expect(dry.find((s) => s.action.startsWith("Shortlisted"))!.action).toContain("Ridgeview");
    expect(dep(dry) - dep(base)).toBe(1000);
  });
  it("saving for catering never settles the conflict toward the venue", () => {
    const r = runScenario(
      withRunRules(c, [{ criterion: "venue_share_60", resolution: "override:Save for catering" }]),
    );
    expect(r.find((s) => s.criterion === "venue_conflict")!.status).toBe("pending");
    expect(r.find((s) => s.role === "split")!.action).toBe(
      "Chose “Save money for catering & extras”: up to $3,000 for the venue",
    );
  });
});

describe("paused agents (a contract setting)", () => {
  const c = {
    goal: "Team offsite",
    budget_cap: 6000,
    headcount: 12,
    triggers: { ask_at: "never" as const, over_budget: true },
    rules: [{ key: "venue_conflict", label: "s", kind: "override" as const, value: "budget" }],
  };
  it("a paused Venue agent's picks wait for you, naming the setting; steps after them are blocked", () => {
    const steps = runScenario({ ...c, agents: { venue: { paused: true } } });
    const by = (role: string) => steps.find((s) => s.role === role)!;
    expect(by("venue").status).toBe("pending");
    for (const role of ["venue", "dates"])
      expect(by(role).preview!.blocked_by).toEqual([
        "Your setting: Venue agent is paused — every step it takes waits for you",
      ]);
    expect(by("dates").status).toBe("blocked");
    expect(by("deposit").status).toBe("blocked");
    expect(by("split").status).toBe("done");
  });
  it("a paused Invites agent pauses only the send, with its reason first", () => {
    const steps = runScenario({
      ...c,
      triggers: { ask_at: "off" as const, over_budget: false },
      agents: { invites: { paused: true } },
    });
    expect(steps.filter((s) => s.status !== "done").map((s) => s.role)).toEqual(["invites"]);
    expect(steps.at(-1)!.preview!.blocked_by![0]).toContain("Invites agent is paused");
  });
  it("no paused agents = same plan as without the setting", () => {
    expect(runScenario({ ...c, agents: {} })).toEqual(
      runScenario(c).map((s) =>
        expect.objectContaining({ action: s.action, status: s.status, source: s.source }),
      ),
    );
  });
});
