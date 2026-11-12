import { create } from "zustand";
import type { Contract } from "./engine";
import type { ContractVersionRow, Json, LedgerRow, SharedReceiptRow } from "./model";
import type { NewLedgerRow } from "./plan-rows";
import { buildSeed, materialise, type DemoData } from "./seed";

type Actions = {
  /** Patch every ledger row matching `where`; returns how many changed. */
  updateRows: (where: (r: LedgerRow) => boolean, patch: Partial<LedgerRow>) => number;
  insertRows: (rows: NewLedgerRow[]) => LedgerRow[];
  deleteRows: (ids: string[]) => void;
  setContract: (patch: Partial<Contract>) => void;
  addVersion: (v: { version: number; snapshot: Json; diff: Json }) => void;
  addShared: (run_id: string, summary: Json) => SharedReceiptRow;
  /** Back to the seed, optionally for another demo case. */
  reset: (caseId?: string) => void;
};

/** The whole demo database. In memory only: reload returns to the seed. */
export const useDemoStore = create<DemoData & Actions>((set, get) => ({
  ...buildSeed(),
  updateRows: (where, patch) => {
    let n = 0;
    set((s) => ({ ledger: s.ledger.map((r) => (where(r) ? (n++, { ...r, ...patch }) : r)) }));
    return n;
  },
  insertRows: (rows) => {
    const made = materialise(rows);
    set((s) => ({ ledger: [...s.ledger, ...made] }));
    return made;
  },
  deleteRows: (ids) => set((s) => ({ ledger: s.ledger.filter((r) => !ids.includes(r.id)) })),
  setContract: (patch) => set((s) => ({ contract: { ...s.contract, ...patch, updated_at: new Date().toISOString() } })),
  addVersion: (v) => set((s) => ({ versions: [...s.versions, { id: crypto.randomUUID(), signed_at: new Date().toISOString(), ...v }] })),
  addShared: (run_id, summary) => {
    const row: SharedReceiptRow = { id: crypto.randomUUID(), created_at: new Date().toISOString(), run_id, summary };
    set((s) => ({ shared: [...s.shared, row] }));
    return row;
  },
  reset: (caseId) => set(buildSeed(caseId)),
}));

/** Ledger in the order the old query returned: newest first, steps in sequence. */
export const sortedLedger = (): LedgerRow[] =>
  [...useDemoStore.getState().ledger].sort((a, b) => b.created_at.localeCompare(a.created_at) || a.seq - b.seq);

export const getState = () => useDemoStore.getState();
