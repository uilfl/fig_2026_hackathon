import { beforeEach, describe, expect, it } from "vitest";
import { DATES_KEY, RECIPIENTS_KEY, planReplacements, putRule, resourcesFor, runScenario, type Contract, type Criterion, type OldStep } from "./engine";
import { connectResource, isOpenDefault, latestRun, resourceOffer } from "./decisions";
import { contractDiff, sameContract, type Snapshot } from "./contract";
import { accountability, diffRuns, receiptNumbers } from "./receipt";
import { getState, sortedLedger } from "./store";
import { chipFor } from "@/components/Chip";

const base: Contract = { goal: "Plan a two-day team offsite for 12 people", budget_cap: 6000, headcount: 12, triggers: { ask_at: "never", over_budget: true }, rules: [], scenario: "offsite" };
const dinner: Contract = { ...base, goal: "Host a client dinner for 8 guests", headcount: 8, budget_cap: 2500, scenario: "dinner" };
const step = (c: Contract, role: string) => runScenario(c).find((s) => s.role === role)!;
const crit = (c: Contract, role: string, key: string) => step(c, role).criteria_out.find((x) => x.key === key)!;
const live = () => latestRun(sortedLedger()).filter((e) => e.status !== "superseded");

describe("connected resources in the engine", () => {
  it("nothing connected: the date, the requirement and the recipients are the agents' assumptions", () => {
    expect(crit(base, "dates", DATES_KEY).source).toBe("default");
    expect(crit(base, "venue", "require_parking").source).toBe("default");
    expect(crit(base, "invites", RECIPIENTS_KEY)).toMatchObject({ source: "default", label: "Agent's guess: the team mailing list" });
  });

  it("the team calendar answers the date and wins over the agent's guess, saying what it would have assumed", () => {
    const c = { ...base, resources: ["offsite.calendar"] };
    const d = step(c, "dates");
    expect(d.action).toBe("Picked dates Mar 21–22");
    expect(d.source).toBe("resource");
    expect(d.default_key).toBeNull();
    expect(d.criteria_out[0]).toMatchObject({ source: "resource", resource: "Team calendar", note: "Agent would have assumed Mar 14–15 — Team calendar: 3 of 12 people are away Mar 14–15" });
    expect(step(c, "invites").effect).toMatchObject({ subject: "Team offsite at Lakeside Lodge, Mar 21–22" });
  });

  it("a rule outranks a resource: your dates override beats the calendar", () => {
    const c = { ...base, resources: ["offsite.calendar"], rules: putRule(base, DATES_KEY, { key: DATES_KEY, label: "Use Apr 4–5", kind: "override", value: "Apr 4–5" }) };
    expect(step(c, "dates").action).toBe("Picked dates Apr 4–5");
    expect(crit(c, "dates", DATES_KEY).source).toBe("you");
  });

  it("the brief answers the requirement; the split stays an open default", () => {
    const c = { ...base, resources: ["offsite.requirements"] };
    expect(crit(c, "venue", "require_parking")).toMatchObject({ source: "resource", resource: "Offsite brief" });
    expect(step(c, "venue").default_key).toBeNull();
    expect(step(c, "split").default_key).toBe("venue_share_60");
  });

  it("the guest list names the recipients, so a scope saved for the guessed list no longer matches", () => {
    const c = { ...base, resources: ["offsite.guests"] };
    const inv = step(c, "invites");
    expect(inv.criteria_out.find((x) => x.key === RECIPIENTS_KEY)).toMatchObject({ source: "resource", label: "Recipients from Team roster" });
    expect(inv.preview!.what).toContain("Email 12 people on Team roster");
    expect(inv.preview!.scope!.recipients).toBe("12 people on Team roster");
    expect(inv.preview!.scope!.recipients_hash).not.toBe(step(base, "invites").preview!.scope!.recipients_hash);
  });

  it("one case's resources never answer another's", () => {
    const c = { ...dinner, resources: ["offsite.calendar", "offsite.requirements"] };
    expect(resourcesFor(c)).toEqual([]);
    expect(step(c, "dates").action).toBe("Picked date Thu Mar 12");
    const d = { ...dinner, resources: ["dinner.calendar"] };
    expect(step(d, "dates").action).toBe("Picked date Fri Mar 13");
  });

  it("re-planning replaces a step a resource now answers, even when the pick is the same", () => {
    const old = runScenario(base).map((s) => ({ ...s, criteria: s.criteria_out }) as unknown as OldStep);
    const seqs = planReplacements(old, runScenario({ ...base, resources: ["offsite.requirements"] }));
    expect(seqs).toContain(step(base, "venue").seq);
  });
});

describe("connecting from the Run screen", () => {
  beforeEach(() => getState().reset("offsite"));

  it("an open date offers the calendar; connecting it re-plans the date and can be undone", async () => {
    const dates = live().find((e) => e.role === "dates")!;
    expect(isOpenDefault(dates)).toBe(true);
    const offer = resourceOffer(dates, getState().contract);
    expect(offer?.name).toBe("Team calendar");
    const before = sortedLedger();
    const r = await connectResource(dates, offer!.id, before);
    expect(getState().contract.resources).toContain("offsite.calendar");
    const now = live().find((e) => e.role === "dates")!;
    expect(now.action).toBe("Picked dates Mar 21–22");
    expect(now.source).toBe("resource");
    // Still blocked behind the open venue conflict; once it runs, the chip names the calendar.
    expect(chipFor({ ...now, status: "done" })).toEqual({ kind: "resource", label: "From Team calendar" });
    expect(resourceOffer(now, getState().contract)).toBeNull();
    await r.undo();
    expect(getState().contract.resources ?? []).not.toContain("offsite.calendar");
    expect(live().find((e) => e.role === "dates")!.action).toBe("Picked dates Mar 14–15");
  });

  it("the commit card's send offers the guest list; the split never offers anything", () => {
    const c = getState().contract;
    expect(resourceOffer(live().find((e) => e.role === "invites")!, c)?.name).toBe("Team roster");
    expect(resourceOffer(live().find((e) => e.role === "split")!, c)).toBeNull();
  });

  it("connecting a second resource keeps the first", async () => {
    await connectResource(live().find((e) => e.role === "dates")!, "offsite.calendar", sortedLedger());
    await connectResource(live().find((e) => e.role === "invites")!, "offsite.guests", sortedLedger());
    expect(getState().contract.resources).toEqual(["offsite.calendar", "offsite.guests"]);
    expect(live().find((e) => e.role === "dates")!.action).toBe("Picked dates Mar 21–22");
  });

  it("refuses another case's resource", async () => {
    const dates = live().find((e) => e.role === "dates")!;
    await expect(connectResource(dates, "dinner.calendar", sortedLedger())).rejects.toThrow("Unknown resource");
  });
});

describe("contract versions and receipts", () => {
  const snap = (over: Partial<Snapshot>): Snapshot => ({ goal: base.goal, budget_cap: 6000, headcount: 12, triggers: base.triggers, rules: [], scenario: "offsite", ...over });

  it("connecting is a contract change, named in the diff; another case's ids don't count", () => {
    expect(contractDiff(snap({}), snap({ resources: ["offsite.calendar"] }))).toEqual(["+ Connected: Team calendar"]);
    expect(contractDiff(snap({ resources: ["offsite.calendar"] }), snap({}))).toEqual(["− Disconnected: Team calendar"]);
    expect(sameContract(snap({}), snap({ resources: ["dinner.calendar"] }))).toBe(true);
    expect(sameContract(snap({ resources: ["offsite.guests", "offsite.calendar"] }), snap({ resources: ["offsite.calendar", "offsite.guests"] }))).toBe(true);
  });

  it("receipts count and name what resources answered, and the diff names the resource", () => {
    const rows = (c: Contract, run: string) => runScenario(c).map((s, i) => ({ ...s, criteria: s.criteria_out as Criterion[], resolution: null, decided_at: null, created_at: `2026-01-0${run}T00:00:0${i}Z`, scenario: "offsite" }));
    const before = rows(base, "1");
    const after = rows({ ...base, resources: ["offsite.calendar", "offsite.requirements"] }, "2");
    expect(receiptNumbers(after).byResource).toBe(2);
    expect(receiptNumbers(before).byResource).toBe(0);
    expect(accountability(after).text).toContain("Team calendar answered the dates.");
    expect(accountability(after).text).toContain("Offsite brief answered the parking requirement.");
    expect(diffRuns(before, after)).toContain("Dates: DEFAULT → FROM TEAM CALENDAR · Mar 14–15 → Mar 21–22");
    expect(diffRuns(before, after)).toContain("Parking: DEFAULT → FROM OFFSITE BRIEF");
    // A date first assumed, then answered by the calendar in the same run, is not an open assumption.
    const superseded = { ...before.find((r) => r.role === "dates")!, status: "superseded" };
    const answered = [superseded, ...after.filter((r) => r.role !== "split" && r.role !== "conflict")];
    expect(receiptNumbers(answered).openAssumptions).toBe(0);
  });
});

describe("contract query", () => {
  beforeEach(() => getState().reset("offsite"));
  it("carries connected resources, so screens never write back a contract without them", async () => {
    getState().setContract({ resources: ["offsite.calendar"] });
    const { contractQuery } = await import("./queries");
    const q = contractQuery.queryFn as unknown as () => Promise<Contract>;
    expect((await q()).resources).toEqual(["offsite.calendar"]);
  });
});
