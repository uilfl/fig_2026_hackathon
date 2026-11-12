import { beforeEach, describe, expect, it } from "vitest";
import { applyChoice, commitPlan, latestRun, resolveDefault } from "./decisions";
import { isCommitStep } from "./engine";
import { getState, sortedLedger } from "./store";
import { scenarioOf } from "./scenarios";
import { LAST_STEP, nextStep, prevStep, settle, TOUR } from "./tour";
import { useTour } from "./tour-store";

const idx = (id: string) => TOUR.findIndex((s) => s.id === id);
const live = () => latestRun(sortedLedger()).filter((e) => e.status !== "superseded");
const contract = () => getState().contract;

/** Resolve every open default in the latest run by keeping it (each resolution re-plans the run). */
async function keepAllDefaults() {
  for (let guard = 0; guard < 5; guard++) {
    const open = live().find((e) => e.source === "default" && !!e.default_key && !e.resolution);
    if (!open) return;
    await resolveDefault(open, contract(), "keep");
  }
}

describe.each(["offsite", "dinner"])("tour on the %s case", (caseId) => {
  beforeEach(() => getState().reset(caseId));

  it("Contract and Run intro steps wait for Next; the conflict step waits for the user", () => {
    const ledger = sortedLedger();
    let i = nextStep(0, ledger);
    const seen: string[] = [];
    while (!TOUR[i]!.done) {
      seen.push(TOUR[i]!.id);
      i = nextStep(i, ledger);
    }
    expect(seen).toEqual(["case", "sentence", "risk-map", "agents", "waiting"]);
    expect(TOUR[i]!.id).toBe("conflict");
    expect(settle(i, ledger)).toBe(i);
  });

  it("settling the conflict, the defaults and the commit each move the tour on, ending on the receipt", async () => {
    const conflict = live().find((e) => e.role === "conflict")!;
    await applyChoice(conflict, "budget", false, contract(), sortedLedger());
    expect(settle(idx("conflict"), sortedLedger())).toBe(idx("default"));

    await keepAllDefaults();
    expect(settle(idx("default"), sortedLedger())).toBe(idx("commit"));

    const items = live().filter((e) => isCommitStep(e));
    expect(items.length).toBeGreaterThan(0);
    await commitPlan(items, new Set(items.map((e) => e.id)), sortedLedger(), null);
    expect(settle(idx("commit"), sortedLedger())).toBe(LAST_STEP);
  });

  it("steps already done are skipped", async () => {
    const conflict = live().find((e) => e.role === "conflict")!;
    await applyChoice(conflict, "budget", false, contract(), sortedLedger());
    expect(nextStep(idx("waiting"), sortedLedger())).toBe(idx("default"));
    expect(prevStep(idx("default"), sortedLedger())).toBe(idx("waiting"));
  });
});

describe("tour copy", () => {
  it("is worded for the chosen case", () => {
    const D = scenarioOf("dinner");
    const conflict = TOUR[idx("conflict")]!.body(D);
    expect(conflict).toContain("Restaurant agent wants Chef's Table at Lumen");
    expect(TOUR[idx("sentence")]!.body(D)).toContain("guests");
  });
});

describe("tour progress", () => {
  beforeEach(() => useTour.setState({ active: true, step: 0, seen: false }));
  it("starting sets the case; skipping or finishing marks it seen", () => {
    useTour.getState().start("dinner", 1);
    expect(useTour.getState()).toMatchObject({ active: true, step: 1, caseId: "dinner" });
    useTour.getState().close();
    expect(useTour.getState()).toMatchObject({ active: false, seen: true });
    useTour.getState().open();
    expect(useTour.getState()).toMatchObject({ active: true, step: 0 });
  });
});
