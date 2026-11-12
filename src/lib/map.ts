/** Pure helpers for the Run screen's decision map (no I/O). */
import {
  forRun,
  runScenario,
  upstreamOf,
  withRunRules,
  type Attributed,
  type Preview,
} from "./engine";
import { ROLES, SCENARIOS, isRole, scenarioOfRows, type Role } from "./scenarios";

export type NodeKey = Role;
export const NODE_ORDER: NodeKey[] = ROLES;

type RowLike = {
  seq: number;
  kind: string;
  action: string;
  criterion: string | null;
  preview: unknown;
  inputs?: unknown;
  depends_on?: number | null;
  role?: string | null | undefined;
  scenario?: string | null | undefined;
};

/** The map node a step belongs to: the role the engine gave it (the contract step has none). */
export function nodeKeyOf(r: { role?: string | null | undefined }): NodeKey | null {
  return isRole(r.role) ? r.role : null;
}

/** Node titles for a run's case ("Venue", "Database tier", …). */
export const nodeTitles = (rows: { scenario?: string | null | undefined }[]) =>
  scenarioOfRows(rows).titles;

const amountOf = (r: { preview: unknown }) => (r.preview as Preview | null)?.amount;
export const peopleOf = (r: { preview: unknown }) =>
  Number((r.preview as Preview | null)?.what?.match(/Email (\d+)/)?.[1] ?? 0);

/** Short name of the agent's contested pick in an open conflict ("Ridgeview"), found from the case whose pick the action names. */
const contestedShort = (action: string) =>
  Object.values(SCENARIOS).find((s) => action.includes(s.preference))?.preferenceShort ??
  "Agent's pick";

export function nodeValue(r: {
  kind: string;
  action: string;
  criterion: string | null;
  preview: unknown;
  role?: string | null | undefined;
  scenario?: string | null | undefined;
}): string {
  const k = nodeKeyOf(r);
  if (k === "split")
    return (
      scenarioOfRows([r]).shareTiers.find((t) => r.action.includes(`“${t.label}”`))?.value ?? ""
    );
  if (k === "venue") return r.action.replace("Shortlisted ", "");
  if (k === "dates") return r.action.replace(/^Picked \S+ /, "");
  if (k === "conflict")
    return r.action.includes("→")
      ? r.action.split("→")[1]!.trim()
      : `${contestedShort(r.action)} vs budget`;
  if (k === "invites") return `${peopleOf(r)} ${scenarioOfRows([r]).sentence.unit}`;
  const a = amountOf(r);
  return a != null ? `$${a.toLocaleString()}` : "";
}

const nodes = (rows: RowLike[]) =>
  rows.map((r) => ({ seq: r.seq, inputs: r.inputs, depends_on: r.depends_on ?? null }));

/** Steps whose inputs (transitively) include `seq`. */
export function downstreamOf(seq: number, rows: RowLike[]): RowLike[] {
  const n = nodes(rows);
  return rows.filter((r) => r.seq !== seq && upstreamOf(r.seq, n).includes(seq));
}

/** "This Balanced split shapes N decisions · $X committed · M people emailed" (excludes Cosign's own conflict node). */
export function impactOf(seq: number, rows: RowLike[]) {
  const down = downstreamOf(seq, rows).filter((r) => nodeKeyOf(r) && nodeKeyOf(r) !== "conflict");
  return {
    keys: down.map((r) => nodeKeyOf(r)!),
    count: down.length,
    money: down.filter((r) => r.kind === "spend").reduce((t, r) => t + (amountOf(r) ?? 0), 0),
    people: down.filter((r) => r.kind === "send").reduce((t, r) => t + peopleOf(r), 0),
  };
}

export type NodeChange = { from: string; to: string; fromWho: string; toWho: string };
/** Compare a dry run with the live run node by node. */
export function previewDiff(live: (RowLike & { source: string })[], fresh: Attributed[]) {
  const changes = new Map<NodeKey, NodeChange>();
  let delta = 0;
  for (const f of fresh) {
    const k = nodeKeyOf(f);
    if (!k) continue;
    const o = live.find((x) => nodeKeyOf(x) === k);
    if (f.kind === "spend") delta += (amountOf(f) ?? 0) - (o ? (amountOf(o) ?? 0) : 0);
    const from = o ? nodeValue(o) : "—",
      to = nodeValue(f);
    if (!o || from !== to || o.source !== f.source)
      changes.set(k, { from, to, fromWho: o?.source ?? "", toWho: f.source });
  }
  const venue = fresh.find((f) => nodeKeyOf(f) === "venue");
  return { changes, count: changes.size, moneyDelta: delta, venue: venue ? nodeValue(venue) : "" };
}

// ── Open items: the single source the map, impact bar, Needs-you panel and commit card read from ──

type LiveRow = RowLike & {
  id: string;
  source: string;
  status: string;
  default_key?: string | null;
  default_label?: string | null;
  resolution?: string | null;
  created_at?: string;
};
const CONFLICT = "venue_conflict";
export const isOpenConflictRow = (e: { criterion: string | null; status: string }) =>
  e.criterion === CONFLICT && e.status === "pending";
export const isOpenDefaultRow = (e: {
  source: string;
  default_key?: string | null;
  resolution?: string | null;
  status: string;
}) =>
  e.source === "default" &&
  !!e.default_key &&
  !e.resolution &&
  e.status !== "superseded" &&
  e.status !== "expired";

export type OpenItem = {
  id: string;
  seq: number;
  key: NodeKey;
  kind: "conflict" | "default";
  label: string;
  resolvedInPreview: boolean;
};

/** Is `item` settled in the dry run `fresh`? A conflict is settled when it no longer pauses; a default when its node is no longer a default. */
function settledIn(item: { key: NodeKey; kind: OpenItem["kind"] }, fresh: Attributed[]): boolean {
  const f = fresh.find((x) => nodeKeyOf(x) === item.key);
  if (!f) return item.kind === "conflict"; // conflict disappeared entirely = settled
  return item.kind === "conflict" ? f.status !== "pending" : f.source !== "default";
}

export function deriveOpenItems(live: LiveRow[], preview: Attributed[] | null) {
  const items: OpenItem[] = [];
  const titles = nodeTitles(live);
  for (const e of live) {
    const k = nodeKeyOf(e);
    if (!k) continue;
    if (isOpenConflictRow(e))
      items.push({
        id: e.id,
        seq: e.seq,
        key: k,
        kind: "conflict",
        label: `Agents disagree on the ${scenarioOfRows(live).place}`,
        resolvedInPreview: false,
      });
    else if (isOpenDefaultRow(e))
      items.push({
        id: e.id,
        seq: e.seq,
        key: k,
        kind: "default",
        label: `${titles[k]} default`,
        resolvedInPreview: false,
      });
  }
  if (preview) for (const i of items) i.resolvedInPreview = settledIn(i, preview);
  const open = items.filter((i) => !i.resolvedInPreview);
  const n = nodes(live);
  /** Open items upstream of a step (what makes its value tentative / locks its approval). */
  const openUpstream = (seq: number) => {
    const ups = upstreamOf(seq, n);
    return open.filter((i) => ups.includes(i.seq));
  };
  const tentative = new Map<NodeKey, number>();
  for (const e of live) {
    const k = nodeKeyOf(e);
    if (!k || items.some((i) => i.seq === e.seq)) continue;
    const c = openUpstream(e.seq).length;
    if (c) tentative.set(k, c);
  }
  return { items, open, openUpstream, tentative };
}

/** Which other open items would choosing `value` for `step` also settle? (dry run, no writes) */
export function alsoSettles<C extends Parameters<typeof runScenario>[0]>(
  live: LiveRow[],
  contract: C,
  step: { seq: number; criterion: string | null },
  value: string,
) {
  const fresh = previewRun(live, contract, step, value);
  return deriveOpenItems(live, fresh).items.filter(
    (i) => i.seq !== step.seq && i.resolvedInPreview,
  );
}

/** Dry run of the engine with one extra "just this run" choice. Pure: never writes, never mutates `live`. */
export function previewRun<C extends Parameters<typeof runScenario>[0]>(
  live: LiveRow[],
  contract: C,
  step: { criterion: string | null },
  value: string,
): Attributed[] {
  const rows = live.map((r) => ({
    criterion: r.criterion,
    resolution: r.resolution ?? null,
    created_at: r.created_at ?? "",
  }));
  return runScenario(
    withRunRules(forRun(contract, live), [
      ...rows,
      { criterion: step.criterion, resolution: `override:${value}`, created_at: "9999" },
    ]),
  );
}
