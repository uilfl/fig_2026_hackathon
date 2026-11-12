/** Pure contract helpers: versions, diffs, plain-language previews (no I/O). */
import { ACTION_LEVEL, ASK_LABEL, asksFor, resourcesFor, ruleCase, runScenario, type ActionKey, type AskAt, type Contract, type Effect, type Reversibility, type Rule } from "./engine";
import { scenarioOf, type AgentRole } from "./scenarios";
import { AGENT_ROLES, pausedFor } from "./agents";

export type Snapshot = Pick<Contract, "goal" | "budget_cap" | "headcount" | "triggers" | "rules" | "scenario" | "agents" | "resources">;
export type Version = { version: number; snapshot: Snapshot; diff: string[]; signed_at: string };

/** What the plan preview needs from a (draft) contract; missing fields use the case's defaults. */
export type PlanInput = Partial<Pick<Contract, "goal" | "budget_cap" | "headcount" | "rules" | "scenario" | "agents">>;

/**
 * The four actions on the risk map, with reach labels from a dry run of the contract
 * (real deposit, booking and headcount for the chosen case — never hard-coded).
 */
export function actionsFor(c: PlanInput = {}) {
  const S = scenarioOf(c.scenario);
  const contract: Contract = { goal: c.goal ?? S.defaults.goal, headcount: c.headcount ?? S.defaults.headcount, budget_cap: c.budget_cap ?? S.defaults.budget_cap, rules: c.rules ?? [], scenario: S.id, triggers: { ask_at: "off", over_budget: false } };
  const steps = runScenario(contract);
  const amount = (role: string) => { const e = steps.find((s) => s.role === role)?.effect as Effect | undefined; return e?.type === "spend" ? e.amount : 0; };
  const deposit = amount("deposit"), booking = amount("catering"), people = contract.headcount;
  const usd = (n: number) => `$${n.toLocaleString()}`;
  const rows: { key: ActionKey; level: Reversibility; reach: number; reachLabel: string }[] = [
    { key: "plan", level: ACTION_LEVEL.plan, reach: 0.15, reachLabel: "No money moves" },
    { key: "catering", level: ACTION_LEVEL.catering, reach: 0.5, reachLabel: `${usd(booking)} refundable` },
    { key: "deposit", level: ACTION_LEVEL.deposit, reach: 0.72, reachLabel: `${usd(deposit)} non-refundable` },
    { key: "invites", level: ACTION_LEVEL.invites, reach: 0.92, reachLabel: `Emails ${people} ${people === 1 ? "person" : S.sentence.unit}` },
  ];
  return { rows, deposit, people, scenario: S };
}
/** Thresholds offered on the risk map, loosest-asking last. */
export const THRESHOLDS: AskAt[] = ["free", "until_deadline", "never", "off"];
export const THRESHOLD_EXAMPLE: Record<AskAt, string> = {
  free: "e.g. even picking a venue",
  fee: "e.g. bookings with a cancellation fee",
  until_deadline: "e.g. refundable catering, deposits, sent emails",
  never: "e.g. deposits, sent emails",
  off: "e.g. nothing — agents never stop",
};

const rulesKey = (r: Rule[]) => JSON.stringify(r.map((x) => [ruleCase(x), x.key, x.kind ?? "keep", typeof x.value === "string" ? x.value : x.value ? (x.value as { recipients_hash?: string }).recipients_hash : null, x.label]));
/** Same rule slot: one key within one case. */
const sameRule = (a: Rule, b: Rule) => a.key === b.key && ruleCase(a) === ruleCase(b);
/** Paused agents, in a stable order. */
const pausedOf = (a: Snapshot["agents"]): AgentRole[] => AGENT_ROLES.filter((r) => !!a?.[r]?.paused);
/** Connected resource ids of the snapshot's own case, sorted. */
const connectedOf = (s: Snapshot): string[] => resourcesFor({ ...s, scenario: s.scenario }).map((r) => r.id).sort();
const norm = (s: Snapshot) => JSON.stringify([scenarioOf(s.scenario).id, s.goal.trim(), Number(s.budget_cap), Number(s.headcount), s.triggers.ask_at, !!s.triggers.over_budget, Object.entries(s.triggers.actions ?? {}).filter(([, v]) => v != null).sort(), rulesKey(s.rules), pausedOf(s.agents), connectedOf(s)]);
export const sameContract = (a: Snapshot, b: Snapshot) => norm(a) === norm(b);

/** Human-readable changes from one version to the next, e.g. "+ Rule: venues must have parking". */
export function contractDiff(prev: Snapshot | null, next: Snapshot): string[] {
  if (!prev) return ["First signed version"];
  const out: string[] = [];
  const [from, to] = [scenarioOf(prev.scenario), scenarioOf(next.scenario)];
  if (from.id !== to.id) out.push(`Case: ${from.title} → ${to.title}`);
  const labels = to.actionLabels;
  if (prev.goal.trim() !== next.goal.trim()) out.push(`Goal: ${prev.goal} → ${next.goal}`);
  if (Number(prev.headcount) !== Number(next.headcount)) out.push(`Headcount: ${prev.headcount} → ${next.headcount}`);
  if (Number(prev.budget_cap) !== Number(next.budget_cap)) out.push(`Budget cap: $${Number(prev.budget_cap).toLocaleString()} → $${Number(next.budget_cap).toLocaleString()}`);
  if (!!prev.triggers.over_budget !== !!next.triggers.over_budget) out.push(`Over budget: ${next.triggers.over_budget ? "fine → check with me" : "check with me → fine"}`);
  if (prev.triggers.ask_at !== next.triggers.ask_at) out.push(`Threshold: ${ASK_LABEL[prev.triggers.ask_at].toLowerCase()} → ${ASK_LABEL[next.triggers.ask_at].toLowerCase()}`);
  for (const k of Object.keys(labels) as ActionKey[]) {
    const a = prev.triggers.actions?.[k], b = next.triggers.actions?.[k];
    if (a !== b) out.push(b == null ? `Override removed: ${labels[k]}` : `Override: ${labels[k]} → ${b ? "asks you" : "goes ahead"}`);
  }
  for (const r of next.rules) {
    const p = prev.rules.find((x) => sameRule(x, r));
    if (!p) out.push(`+ Rule: ${r.label}`);
    else if (p.label !== r.label) out.push(`Rule: ${p.label} → ${r.label}`);
  }
  for (const r of prev.rules) if (!next.rules.some((p) => sameRule(p, r))) out.push(`− Rule: ${r.label}`);
  const [was, now] = [pausedOf(prev.agents), pausedOf(next.agents)];
  for (const r of AGENT_ROLES) if (was.includes(r) !== now.includes(r)) out.push(`${to.agents[r]}: ${now.includes(r) ? "paused" : "resumed"}`);
  const [had, has] = [connectedOf(prev), connectedOf(next)];
  for (const r of to.resources) if (had.includes(r.id) !== has.includes(r.id)) out.push(`${has.includes(r.id) ? "+ Connected" : "− Disconnected"}: ${r.name}`);
  return out;
}

/** Button label: the version number only increments when something changed. */
export function signLabel(latest: Version | null, draft: Snapshot): { label: string; next: number; changed: boolean } {
  if (!latest) return { label: "Sign v1 & run agents", next: 1, changed: true };
  const changed = !sameContract(latest.snapshot, draft);
  return changed ? { label: `Sign v${latest.version + 1} & run agents`, next: latest.version + 1, changed } : { label: `Run again under v${latest.version}`, next: latest.version, changed };
}

/** Which actions ask, and a sentence saying what the agents will do. */
export function planPreview(t: Contract["triggers"], c: PlanInput = {}) {
  const plan = actionsFor(c);
  const rows = plan.rows.map((x) => ({ ...x, asks: asksFor(x.key, x.level, t) || pausedFor(x.key, c.agents), overridden: t.actions?.[x.key] != null }));
  const asking = rows.filter((r) => r.asks);
  const phrase = plan.scenario.phrases({ deposit: plan.deposit, people: plan.people });
  const join = (xs: string[]) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
  const own = rows.filter((r) => !r.asks).map((r) => phrase[r.key][0]);
  const stop = asking.map((r) => phrase[r.key][1]);
  const a = own.length ? `Agents will ${join(own)} on their own.` : "Agents won't do anything on their own.";
  const b = stop.length ? ` They'll stop ${join(stop)}.` : " They won't stop to ask you.";
  return { rows, asking: asking.length, header: `With this contract, ${asking.length} of ${rows.length} actions will ask you.`, summary: a + b };
}

/** Index in THRESHOLDS for a threshold (fee is treated as until_deadline's neighbour). */
export const thresholdIndex = (a: AskAt) => { const i = THRESHOLDS.indexOf(a); return i < 0 ? 1 : i; };
/** Column (0..4) where the "Asks you" zone starts: free=0 … off=4 (empty zone). */
export const zoneStart = (a: AskAt) => ({ free: 0, fee: 1, until_deadline: 2, never: 3, off: 4 } as const)[a];
export const COLUMN: Record<Reversibility, number> = { free: 0, fee: 1, until_deadline: 2, never: 3 };
/** Snap a dragged zone edge (in columns, 0..4) to the nearest offered threshold. */
export function snapThreshold(col: number): AskAt {
  let best: AskAt = "never", d = Infinity;
  for (const t of THRESHOLDS) { const dd = Math.abs(zoneStart(t) - col); if (dd < d) { d = dd; best = t; } }
  return best;
}

/** Only rules belong in House rules; one-time picks are not listed. */
export const isHouseRule = (r: Rule) => r.kind !== "override";
