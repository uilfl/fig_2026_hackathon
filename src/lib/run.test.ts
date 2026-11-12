import { beforeEach, describe, expect, it } from "vitest";
import { applyChoice, decide, latestRun, resolveDefault } from "./decisions";
import { replanRun, startRun } from "./run";
import { getState, sortedLedger } from "./store";
import { contractQuery } from "./queries";

const reset = () => getState().reset();
const contract = async () =>
  (await contractQuery.queryFn!({} as never)) as Awaited<
    ReturnType<NonNullable<typeof contractQuery.queryFn>>
  >;

describe("demo store", () => {
  beforeEach(reset);

  it("seeds a contract and one planned run", () => {
    const { contract: c, ledger, versions } = getState();
    expect(c.headcount).toBe(12);
    expect(versions).toEqual([]);
    expect(new Set(ledger.map((r) => r.run_id)).size).toBe(1);
    expect(ledger.every((r) => typeof r.id === "string" && r.id.length > 0)).toBe(true);
  });

  it("a signed contract keeps your own agents when read back", async () => {
    const agent = {
      id: "a1",
      name: "Catering agent",
      note: "Finds a caterer",
      scenario: "offsite",
    };
    getState().setContract({ custom_agents: [agent] });
    expect((await contract()).custom_agents).toEqual([agent]);
  });

  it("reset discards changes and returns to a fresh seed", async () => {
    await startRun();
    expect(new Set(getState().ledger.map((r) => r.run_id)).size).toBe(2);
    getState().reset();
    expect(new Set(getState().ledger.map((r) => r.run_id)).size).toBe(1);
  });
});

describe("startRun", () => {
  beforeEach(reset);

  it("expires older runs' pending/blocked steps and makes the new run the latest", async () => {
    const firstRun = latestRun(sortedLedger())[0]!.run_id;
    const { run_id } = await startRun();
    const all = sortedLedger();
    expect(latestRun(all)[0]!.run_id).toBe(run_id);
    const old = all.filter((r) => r.run_id === firstRun);
    expect(old.some((r) => r.status === "pending" || r.status === "blocked")).toBe(false);
  });
});

describe("replanRun / applyChoice", () => {
  beforeEach(reset);

  it("resolving an open default re-plans the run and records the resolution", async () => {
    const run = latestRun(sortedLedger());
    const open = run.find((r) => r.source === "default" && r.default_key && !r.resolution);
    expect(open).toBeDefined();
    await resolveDefault(open!, await contract(), "keep");
    const after = getState().ledger.find((r) => r.id === open!.id);
    expect(after?.resolution).toBe("keep");
  });

  it("applyChoice's undo restores rows and contract rules", async () => {
    const c = await contract();
    const all = sortedLedger();
    const step = latestRun(all).find((r) => r.criterion === "venue_share_60" || r.default_key);
    expect(step).toBeDefined();
    const r = await applyChoice(step!, "Best venue", true, c, all);
    expect(getState().contract.rules.length).toBeGreaterThan(c.rules.length);
    await r.undo();
    expect(getState().contract.rules).toEqual(c.rules);
    const stillThere = getState().ledger.find((x) => x.id === step!.id)!;
    expect(stillThere.resolution).toBe(step!.resolution);
    expect(r.inserted.every((id) => !getState().ledger.some((x) => x.id === id))).toBe(true);
  });

  it("replanRun is a no-op for a run with nothing to change", async () => {
    const run_id = latestRun(sortedLedger())[0]!.run_id;
    const out = await replanRun({ data: { run_id } });
    expect(out.inserted).toEqual([]);
  });
});

describe("decide", () => {
  beforeEach(reset);

  it("approving a pending step marks it done and releases blocked dependents", async () => {
    const all = sortedLedger();
    const pending = latestRun(all).find((r) => r.status === "pending");
    expect(pending).toBeDefined(); // the seed pauses on the Venue/Budget conflict
    await decide(pending!, true, all);
    expect(getState().ledger.find((r) => r.id === pending!.id)?.status).toBe("done");
  });
});
