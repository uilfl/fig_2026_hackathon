import { forRun, runScenario, planReplacements, withRunRules, type OldStep } from "./engine";
import { scenarioOf } from "./scenarios";
import { rowFromStep } from "./plan-rows";
import { getState } from "./store";

/** Create a new run from the current contract. Older runs' pending/blocked steps expire: only the newest run can be approved. */
export async function startRun() {
  const { contract, updateRows, insertRows } = getState();
  const steps = runScenario(contract);
  updateRows((r) => r.status === "pending" || r.status === "blocked", { status: "expired" });
  const run_id = crypto.randomUUID();
  const scenario = scenarioOf(contract.scenario).id;
  insertRows(steps.map((s, i) => rowFromStep(s, run_id, i, null, scenario)));
  return { run_id };
}

/** Re-plan within a run after a default is resolved: supersede changed/downstream steps and write fresh ones. */
export async function replanRun({ data }: { data: { run_id: string } }) {
  const { contract: base, ledger, updateRows, insertRows } = getState();
  const everyRow = ledger.filter((r) => r.run_id === data.run_id);
  // "Just this run" choices live on the run's rows and win over contract rules; the run keeps the case it started with.
  const contract = withRunRules(forRun(base, everyRow), everyRow);
  const scenario = scenarioOf(contract.scenario).id;
  const olds = everyRow.filter((o) => o.status !== "superseded");
  const none = { replaced: 0, inserted: [] as string[], superseded: [] as string[] };
  if (!olds.length || olds.some((o) => o.status === "expired")) return none;
  const fresh = runScenario(contract);
  const seqs = planReplacements(olds as unknown as OldStep[], fresh);
  if (!seqs.length) return none;
  const targets = olds.filter((o) => seqs.includes(o.seq));
  const ids = new Set(targets.map((t) => t.id));
  updateRows((r) => ids.has(r.id), { status: "superseded" });
  const rows = fresh.filter((f) => seqs.includes(f.seq)).map((s) => {
    const prev = targets.find((t) => t.seq === s.seq);
    const carry = prev?.resolution && prev.default_key && prev.default_key === s.default_key ? prev.resolution : null;
    return rowFromStep(s, data.run_id, s.seq, carry, scenario);
  });
  const inserted = insertRows(rows);
  return { replaced: rows.length, inserted: inserted.map((x) => x.id), superseded: targets.map((t) => t.id) };
}
