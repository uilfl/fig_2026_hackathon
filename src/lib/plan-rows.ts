import type { Attributed, Contract } from "./engine";
import type { Json, LedgerRow } from "./model";
import { DEFAULT_SCENARIO } from "./scenarios";

/** Fields a caller must/may supply when inserting a ledger row; the store fills the rest. */
export type NewLedgerRow = Pick<LedgerRow, "run_id" | "seq" | "agent" | "kind" | "action" | "source"> & Partial<Omit<LedgerRow, "id" | "created_at">>;

/** Static rationale for a step (the demo has no LLM): contract steps echo the brief, others restate the proposal. */
export function rationaleFor(s: Pick<Attributed, "kind" | "agent" | "action">): string {
  return s.kind === "contract" ? "Your instructions for this delegation." : `${s.agent} proposed: ${s.action}.`;
}

/** Map an engine step onto a ledger row. `scenario` is the case the run was planned under. */
export function rowFromStep(s: Attributed, run_id: string, seq: number, resolution: string | null = null, scenario: string = DEFAULT_SCENARIO): NewLedgerRow {
  return {
    run_id, seq, scenario, role: s.role ?? null, agent: s.agent, kind: s.kind, action: s.action, rationale: rationaleFor(s),
    source: s.source, status: s.status, criterion: s.criterion, depends_on: s.depends_on ?? null,
    inputs: (s.inputs ?? []) as unknown as Json, default_key: s.default_key, default_label: s.default_label, resolution,
    options_considered: s.options_considered as unknown as Json, filtered_out: s.filtered_out as unknown as Json,
    preview: s.preview as unknown as Json, criteria: s.criteria_out as unknown as Json,
  };
}

export type ContractInput = Pick<Contract, "goal" | "budget_cap" | "headcount" | "triggers" | "rules">;
