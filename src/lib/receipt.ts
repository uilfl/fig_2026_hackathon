/** Pure receipt summaries and run-to-run diffs (no I/O). */
import { countApprovals, resourceForKey, type Criterion, type Preview } from "./engine";

export type ReceiptRow = {
  seq: number; kind: string; action: string; source: string; status: string; criterion: string | null;
  default_key: string | null; default_label: string | null; resolution: string | null;
  criteria?: unknown; preview: unknown; created_at: string; decided_at: string | null;
  role?: string | null | undefined; scenario?: string | null | undefined;
};

const STEP_WHO: Record<string, string> = { user: "YOU CHOSE", approved: "APPROVED", contract: "CONTRACT RULE", resource: "FROM RESOURCE", default: "DEFAULT", pending: "AWAITING YOU" };
const CRIT_WHO: Record<Criterion["source"], string> = { you: "YOU CHOSE", contract: "CONTRACT", rule: "CONTRACT RULE", resource: "FROM RESOURCE", default: "DEFAULT" };

const criteriaOf = (r: { criteria?: unknown }) => (Array.isArray(r.criteria) ? (r.criteria as Criterion[]) : []);
/** Criteria a connected resource answered on a row. */
export const resourceAnswers = (r: { criteria?: unknown }) => criteriaOf(r).filter((c) => c.source === "resource");
/** "FROM TEAM CALENDAR" — names the resource, not just the kind. */
const fromWho = (c: Criterion | undefined) => (c?.resource ? `FROM ${c.resource.toUpperCase()}` : CRIT_WHO.resource);

type Item = { item: string; find: (r: ReceiptRow) => boolean; criterion?: string; value?: (r: ReceiptRow) => string };
/** The key things a receipt compares, named in the run's case ("Venue" / "Database tier", "Parking" / "Private room"). */
function itemsFor(rows: ReceiptRow[]): Item[] {
  const S = scenarioOfRows(rows);
  const is = (k: NodeKey) => (r: ReceiptRow) => nodeKeyOf(r) === k;
  return [
    { item: S.titles.split, find: is("split"), value: (r) => r.action.match(/\d+%/)?.[0] ?? "" },
    { item: S.titles.venue, find: is("venue"), value: (r) => r.action.replace("Shortlisted ", "") },
    { item: S.requirement.short, find: is("venue"), criterion: S.requirement.key },
    { item: S.titles.dates, find: is("dates"), value: (r) => r.action.replace(/^Picked \S+ /, "") },
    { item: S.titles.deposit, find: is("deposit") },
    { item: S.titles.catering, find: is("catering") },
    { item: S.titles.invites, find: is("invites") },
  ];
}

const order = (rows: ReceiptRow[]) => [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.seq - b.seq);
const whoOf = (r: ReceiptRow, criterion?: string, raw = false) => {
  if (criterion) {
    const c = ((r.criteria as Criterion[] | null) ?? []).find((x) => x.key === criterion);
    return c ? (c.source === "resource" ? fromWho(c) : CRIT_WHO[c.source]) : "—";
  }
  if (r.source === "resource") return fromWho(resourceAnswers(r)[0]);
  if (raw) return STEP_WHO[r.source] ?? r.source.toUpperCase();
  if (r.status === "declined") return "YOU DECLINED";
  if (r.status === "cancelled") return "CANCELLED";
  if (r.status === "expired") return "EXPIRED";
  if (r.source === "approved" && (r.preview as Preview | null)?.saved_scope) return "APPROVED (SAVED SCOPE)";
  if (r.source === "default" && r.resolution) return resolutionLabel(r.resolution).toUpperCase();
  return STEP_WHO[r.source] ?? r.source.toUpperCase();
};

export function resolutionLabel(r: string | null): string {
  if (!r) return "Not resolved";
  if (r === "keep") return "Kept as rule";
  if (r === "once") return "Accepted just this time";
  if (r.startsWith("override:")) return `You overrode → ${r.slice(9)}`;
  if (r === "should_have_asked") return "Flagged: should have asked";
  return r;
}

/** How the agents started the run: the first row written for each key thing (before any re-plan). */
function startOf(rows: ReceiptRow[]) {
  const o = order(rows);
  return itemsFor(rows).map((it) => { const r = o.find(it.find); return r ? { item: it.item, who: whoOf(r, it.criterion, true), value: it.value?.(r) ?? "" } : null; }).filter((x) => x !== null);
}

export type RunStats = { money: number; approvals: number; defaults: number };
export function runStats(rows: ReceiptRow[]): RunStats {
  const live = rows.filter((r) => r.status !== "superseded" && r.kind !== "contract");
  const money = live.filter((r) => r.status === "done" && r.kind === "spend").reduce((t, r) => t + ((r.preview as Preview | null)?.amount ?? 0), 0);
  const defaults = new Set(rows.filter((r) => r.default_key).map((r) => r.default_key)).size;
  return { money, approvals: countApprovals(live), defaults };
}

/** Every difference between two runs, e.g. "Dates: DEFAULT → YOU CHOSE". Approvals and money are always listed. */
export function diffRuns(prev: ReceiptRow[], cur: ReceiptRow[]): string[] {
  const a = startOf(prev), b = startOf(cur);
  const out: string[] = [];
  for (const x of b) {
    const y = a.find((p) => p.item === x.item);
    if (!y) { out.push(`${x.item}: new → ${x.who}`); continue; }
    const parts: string[] = [];
    if (y.who !== x.who) parts.push(`${y.who} → ${x.who}`);
    if (y.value !== x.value) parts.push(`${y.value} → ${x.value}`);
    if (parts.length) out.push(`${x.item}: ${parts.join(" · ")}`);
  }
  const sa = runStats(prev), sb = runStats(cur);
  out.push(`Approvals: ${sa.approvals} → ${sb.approvals}`);
  out.push(`Money committed: $${sa.money.toLocaleString()} → $${sb.money.toLocaleString()}`);
  if (sa.defaults !== sb.defaults) out.push(`Defaults flagged: ${sa.defaults} → ${sb.defaults}`);
  return out;
}

export type ReceiptSummary = {
  /** Case title, e.g. "Client dinner" (missing on receipts shared before cases existed). */
  case?: string | undefined;
  run_date: string; money: number; approvals: number;
  decisions: { item: string; value: string; who: string }[];
  assumptions: { label: string; resolution: string }[];
};

/** Read-only summary for sharing: final state only, never the full trace. */
export function receiptSummary(rows: ReceiptRow[]): ReceiptSummary {
  const live = order(rows).filter((r) => r.status !== "superseded");
  const decisions = itemsFor(rows).map((it) => { const r = [...live].reverse().find(it.find); return r ? { item: it.item, value: it.value?.(r) ?? ((r.preview as Preview | null)?.amount != null ? `$${(r.preview as Preview).amount!.toLocaleString()}` : ""), who: whoOf(r, it.criterion) } : null; }).filter((x) => x !== null);
  const seen = new Map<string, { label: string; resolution: string }>();
  for (const r of order(rows)) if (r.default_key) {
    const prev = seen.get(r.default_key);
    if (!prev || r.resolution) seen.set(r.default_key, { label: r.default_label ?? r.default_key, resolution: resolutionLabel(r.resolution) });
  }
  const s = runStats(rows);
  return { case: scenarioOfRows(rows).title, run_date: rows[0]?.created_at ?? "", money: s.money, approvals: s.approvals, decisions, assumptions: [...seen.values()] };
}

/* ── Receipt page (v2): numbers, accountability sentence, grouped decisions, pairs ── */
import { nodeKeyOf, nodeTitles, type NodeKey } from "./map";
import { answersLabel, scenarioOfRows } from "./scenarios";

const liveRows = (rows: ReceiptRow[]) => rows.filter((r) => r.status !== "superseded" && r.kind !== "contract");
const isYou = (r: ReceiptRow) => r.source === "user" || r.source === "approved" || (r.source === "default" && !!r.resolution && r.resolution !== "should_have_asked") || r.status === "declined";
const isOpenAssumption = (r: ReceiptRow) => r.source === "default" && !!r.default_key && !r.resolution && r.status !== "expired";

export type RunState = "In progress" | "Waiting on you" | "Complete" | "Stopped";
export function runState(rows: ReceiptRow[]): RunState {
  const live = liveRows(rows);
  if (live.some((r) => r.status === "cancelled")) return "Stopped";
  if (live.some((r) => r.status === "pending" || isOpenAssumption(r))) return "Waiting on you";
  if (live.some((r) => r.status === "blocked")) return "In progress";
  return "Complete";
}

/** `byResource` = criteria a connected resource answered (a step can carry several). */
export type ReceiptNumbers = { committed: number; refundable: number; byYou: number; byContract: number; byResource: number; openAssumptions: number; resolvedAssumptions: number };
export function receiptNumbers(rows: ReceiptRow[]): ReceiptNumbers {
  const live = liveRows(rows);
  const done = live.filter((r) => r.status === "done" && r.kind === "spend");
  const amt = (r: ReceiptRow) => (r.preview as Preview | null)?.amount ?? 0;
  const committed = done.filter((r) => (r.preview as Preview | null)?.reversibility === "never").reduce((t, r) => t + amt(r), 0);
  const refundable = done.filter((r) => (r.preview as Preview | null)?.reversibility !== "never").reduce((t, r) => t + amt(r), 0);
  const keys = new Map<string, boolean>();
  for (const r of rows) if (r.default_key && r.status !== "expired") keys.set(r.default_key, (keys.get(r.default_key) ?? false) || !!r.resolution);
  return {
    committed, refundable,
    byYou: live.filter(isYou).length,
    byContract: live.filter((r) => r.source === "contract").length,
    byResource: live.reduce((t, r) => t + resourceAnswers(r).length, 0),
    // Still open only if a live step still rests on it (a key a resource now answers is no longer an assumption).
    openAssumptions: [...keys].filter(([k, v]) => !v && live.some((r) => r.default_key === k)).length,
    resolvedAssumptions: [...keys.values()].filter(Boolean).length,
  };
}

/** What each connected resource answered in a run, in the case's words: Team calendar → ["the dates"]. */
export function answeredBy(rows: ReceiptRow[]): Map<string, string[]> {
  const S = scenarioOfRows(rows);
  const what = (key: string) => { const r = resourceForKey(S, key); return r ? answersLabel(S, r.kind) : key; };
  const out = new Map<string, string[]>();
  for (const r of liveRows(rows)) for (const c of resourceAnswers(r)) if (c.resource) out.set(c.resource, [...(out.get(c.resource) ?? []), what(c.key)]);
  return out;
}

const list = (xs: string[]) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
/** One plain sentence: who decided what. `open` is the count still needing the user. */
export function accountability(rows: ReceiptRow[]): { text: string; open: number } {
  const titles = nodeTitles(rows);
  const lower = (k: NodeKey) => titles[k].toLowerCase();
  const live = liveRows(rows);
  const keyed = live.map((r) => ({ r, k: nodeKeyOf(r) })).filter((x): x is { r: ReceiptRow; k: NodeKey } => !!x.k);
  const chose = keyed.filter(({ r }) => r.source === "user" || (r.source === "default" && !!r.resolution && r.resolution !== "should_have_asked")).map(({ k }) => k === "conflict" ? `settled the ${scenarioOfRows(rows).place} conflict` : `the ${lower(k)}`);
  const chosen = chose.filter((x) => x.startsWith("the "));
  const settled = chose.filter((x) => !x.startsWith("the "));
  const contract = keyed.filter(({ r }) => r.source === "contract").map(({ k }) => lower(k));
  const approved = keyed.filter(({ r }) => r.source === "approved" && r.status === "done").map(({ r, k }) => { const a = (r.preview as Preview | null)?.amount; return a ? `the $${a.toLocaleString()} ${lower(k)}` : `the ${lower(k)}`; });
  const parts: string[] = [];
  const you = [chosen.length ? `chose ${list(chosen)}` : "", ...settled].filter(Boolean);
  if (you.length) parts.push(`You ${list(you)}.`);
  if (contract.length) parts.push(`The contract covered ${list(contract)}.`);
  if (approved.length) parts.push(`You approved ${list(approved)}.`);
  for (const [name, what] of answeredBy(rows)) parts.push(`${name} answered ${list(what)}.`);
  const unchosen = live.filter((r) => r.source === "default" && !r.resolution).length;
  parts.push(unchosen ? `${unchosen} step${unchosen === 1 ? "" : "s"} still rest${unchosen === 1 ? "s" : ""} on an unchosen default.` : "Nothing was left to an unchosen default.");
  const open = live.filter((r) => r.status === "pending" || isOpenAssumption(r)).length;
  return { text: parts.join(" "), open };
}

export type DecisionGroup<R extends ReceiptRow> = { key: NodeKey; title: string; row: R; earlier: { row: R; why: string }[] };
const GROUP_ORDER: NodeKey[] = ["split", "conflict", "venue", "dates", "deposit", "catering", "invites"];
/** Group steps by decision; superseded rows become earlier versions of their group, never their own row. */
export function decisionGroups<R extends ReceiptRow>(rows: R[]): DecisionGroup<R>[] {
  const o = order(rows) as R[];
  const titles = nodeTitles(rows);
  const out: DecisionGroup<R>[] = [];
  for (const key of GROUP_ORDER) {
    const all = o.filter((r) => nodeKeyOf(r) === key);
    if (!all.length) continue;
    const current = [...all].reverse().find((r) => r.status !== "superseded") ?? all.at(-1)!;
    const earlier = all.filter((r) => r !== current && r.status === "superseded").map((r) => {
      const why = current.resolution?.startsWith("override:") ? `You picked ${current.resolution.slice(9)} instead`
        : current.source === "user" ? "You chose a different option" : "Re-planned after an earlier decision changed";
      return { row: r, why };
    });
    out.push({ key, title: titles[key], row: current, earlier });
  }
  return out;
}

export type Pair = { label: string; from: string; to: string; changed: boolean; ownerChanged: boolean };
/** Before/after pairs between two runs; `changed` false means identical. */
export function changePairs(prev: ReceiptRow[], cur: ReceiptRow[]): Pair[] {
  const a = startOf(prev), b = startOf(cur);
  const out: Pair[] = [];
  for (const x of b) {
    const y = a.find((p) => p.item === x.item);
    const ownerChanged = !y || y.who !== x.who;
    const from = y ? y.who + (y.value && y.value !== x.value ? ` · ${y.value}` : "") : "new";
    const to = x.who + (y && y.value !== x.value && x.value ? ` · ${x.value}` : "");
    out.push({ label: x.item, from, to, changed: ownerChanged || y?.value !== x.value, ownerChanged });
  }
  const sa = runStats(prev), sb = runStats(cur);
  out.push({ label: "Approvals", from: String(sa.approvals), to: String(sb.approvals), changed: sa.approvals !== sb.approvals, ownerChanged: false });
  out.push({ label: "Committed", from: `$${sa.money.toLocaleString()}`, to: `$${sb.money.toLocaleString()}`, changed: sa.money !== sb.money, ownerChanged: false });
  return out;
}

/** Do two runs belong to the same case? Receipts only compare runs of one case. */
export const sameCase = (a: ReceiptRow[], b: ReceiptRow[]) => scenarioOfRows(a).id === scenarioOfRows(b).id;
/** The latest run before index `i` (runs oldest first) of the same case, if any. */
export function previousOfCase<R extends ReceiptRow>(runs: R[][], i: number): R[] | undefined {
  for (let j = i - 1; j >= 0; j--) if (sameCase(runs[j]!, runs[i]!)) return runs[j];
  return undefined;
}
