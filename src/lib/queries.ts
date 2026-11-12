import { queryOptions } from "@tanstack/react-query";
import { normaliseTriggers, type Contract, type Rule } from "./engine";
import type { Snapshot } from "./contract";
import { getState, sortedLedger } from "./store";
import { scenarioOf } from "./scenarios";

export type ContractRow = Contract;

// Every query reads the in-memory demo store; mutations write to it and then invalidate these keys.
export const contractQuery = queryOptions({
  queryKey: ["contract"],
  queryFn: async (): Promise<ContractRow> => {
    const c = getState().contract;
    return { goal: c.goal, headcount: c.headcount, budget_cap: Number(c.budget_cap), triggers: normaliseTriggers(c.triggers), rules: c.rules as Rule[], scenario: scenarioOf(c.scenario).id, agents: c.agents ?? {}, resources: c.resources ?? [] };
  },
});

export const ledgerQuery = queryOptions({
  queryKey: ["ledger"],
  queryFn: async () => sortedLedger(),
});

export const profileQuery = queryOptions({
  queryKey: ["profile"],
  queryFn: async () => getState().profile,
});

export const versionsQuery = queryOptions({
  queryKey: ["contract_versions"],
  queryFn: async () =>
    [...getState().versions].sort((a, b) => b.version - a.version).map((v) => ({ ...v, snapshot: v.snapshot as unknown as Snapshot, diff: (v.diff as string[]) ?? [] })),
});

/** Contract version a run ran under: the latest version signed at or before the run started. */
export function versionAt(versions: { version: number; signed_at: string }[], at: string): number | null {
  return versions.find((v) => v.signed_at <= at)?.version ?? null;
}
