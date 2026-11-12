import { normaliseTriggers, runScenario, type Contract } from "./engine";
import type { ContractVersionRow, LedgerRow, SharedReceiptRow } from "./model";
import { rowFromStep } from "./plan-rows";
import { DEFAULT_SCENARIO, scenarioOf } from "./scenarios";
import { DEMO_NAME, DEMO_TEAM } from "./seed.constants";

export type DemoData = {
  contract: Contract & { updated_at: string };
  ledger: LedgerRow[];
  versions: ContractVersionRow[];
  shared: SharedReceiptRow[];
  profile: { display_name: string; team: string };
};

/** Materialise ledger rows for a batch of steps; one timestamp per batch, like a single insert. */
export function materialise(rows: ReturnType<typeof rowFromStep>[], now = new Date().toISOString()): LedgerRow[] {
  return rows.map((r) => ({
    criteria: [], criterion: null, decided_at: null, default_key: null, default_label: null, depends_on: null, filtered_out: [], inputs: [],
    options_considered: [], preview: null, rationale: "", resolution: null, status: "done", role: null, scenario: DEFAULT_SCENARIO,
    ...r, id: crypto.randomUUID(), created_at: now,
  }));
}

/** The demo every visitor starts from: a case's default contract and one run the engine plans from it. */
export function buildSeed(caseId: string = DEFAULT_SCENARIO): DemoData {
  const now = new Date().toISOString();
  const S = scenarioOf(caseId);
  const contract: Contract = { ...S.defaults, triggers: normaliseTriggers({ ask_at: "never", over_budget: true }), rules: [], scenario: S.id };
  const run_id = crypto.randomUUID();
  const ledger = materialise(runScenario(contract).map((s, i) => rowFromStep(s, run_id, i, null, S.id)), now);
  return { contract: { ...contract, updated_at: now }, ledger, versions: [], shared: [], profile: { display_name: DEMO_NAME, team: DEMO_TEAM } };
}
