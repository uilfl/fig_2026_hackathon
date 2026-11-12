/** Row shapes for the in-app demo data (formerly the generated Supabase types). */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type LedgerRow = {
  action: string;
  agent: string;
  created_at: string;
  criteria: Json;
  criterion: string | null;
  decided_at: string | null;
  default_key: string | null;
  default_label: string | null;
  depends_on: number | null;
  filtered_out: Json;
  id: string;
  inputs: Json;
  kind: string;
  options_considered: Json;
  preview: Json | null;
  rationale: string;
  resolution: string | null;
  /** Place in the plan shape (scenarios.ts `Role`); null for the contract step. */
  role: string | null;
  run_id: string;
  /** Demo case the run was planned under (scenarios.ts). */
  scenario: string;
  seq: number;
  source: string;
  status: string;
};

export type ContractDbRow = {
  budget_cap: number;
  goal: string;
  headcount: number;
  rules: Json;
  triggers: Json;
  updated_at: string;
};

export type ContractVersionRow = {
  diff: Json;
  id: string;
  signed_at: string;
  snapshot: Json;
  version: number;
};

export type SharedReceiptRow = {
  created_at: string;
  id: string;
  run_id: string;
  summary: Json;
};
