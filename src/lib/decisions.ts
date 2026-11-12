import type { ContractRow } from "./queries";
import type { LedgerRow } from "./model";
import { getState } from "./store";
import {
  putRule,
  resourceForKey,
  unblockedStatus,
  upstreamOf,
  SCOPE_KEY,
  CONFLICT_KEY,
  RECIPIENTS_KEY,
  type Alternative,
  type Criterion,
  type Preview,
  type Rule,
} from "./engine";
import { replanRun } from "./run";
import { scenarioOf, type Resource } from "./scenarios";

export type Entry = LedgerRow;

const store = () => getState();
const setRules = (rules: Rule[]) => store().setContract({ rules });
const patchById = (id: string, patch: Partial<LedgerRow>) =>
  store().updateRows((r) => r.id === id, patch);

/** Approve/decline a paused step, then release or cancel steps that depended on it. */
export async function decide(e: Entry, approve: boolean, all: Entry[]) {
  const now = new Date().toISOString();
  store().updateRows(
    (r) => r.id === e.id && r.status === "pending",
    approve
      ? { source: "approved", status: "done", decided_at: now }
      : { source: "user", status: "declined", decided_at: now },
  );
  // A decline leaves dependents blocked until the user picks an alternative or stops the run.
  if (!approve) return;
  for (const d of all.filter(
    (x) => x.run_id === e.run_id && x.depends_on === e.seq && x.status === "blocked",
  )) {
    const dp = d.preview as Preview | null;
    const next = unblockedStatus(dp?.blocked_by, approve, !!dp?.saved_scope);
    patchById(d.id, next);
  }
}

export type Resolution = "keep" | "once" | "override";

/** Resolve a flagged default: keep as rule, accept just this time, or override with another option. */
export async function resolveDefault(
  e: Entry,
  contract: ContractRow,
  how: Resolution,
  value?: string,
) {
  if (how !== "once") {
    const rule: Rule =
      how === "keep"
        ? { key: e.default_key!, label: e.default_label!, kind: "keep" }
        : {
            key: e.default_key!,
            label: `Use ${value} instead of “${e.default_label}”`,
            kind: "override",
            value: value!,
          };
    setRules(putRule(contract, rule.key, rule, e.scenario));
  }
  patchById(e.id, {
    resolution: how === "override" ? `override:${value}` : how,
    decided_at: new Date().toISOString(),
  });
  // Re-plan the same run so downstream steps reflect the decision.
  return replanRun({ data: { run_id: e.run_id } });
}

export const isOpenConflict = (e: Entry) => e.criterion === CONFLICT_KEY && e.status === "pending";

export const isOpenDefault = (e: Entry) =>
  e.source === "default" &&
  !!e.default_key &&
  !e.resolution &&
  e.status !== "superseded" &&
  e.status !== "expired";

/** Unresolved defaults in steps upstream of `e` (its data dependencies), same run. */
export function unresolvedUpstream(e: Entry, all: Entry[]): Entry[] {
  const run = all.filter((x) => x.run_id === e.run_id && x.status !== "superseded");
  const ups = upstreamOf(
    e.seq,
    run.map((x) => ({ seq: x.seq, inputs: x.inputs, depends_on: x.depends_on })),
  );
  return run.filter((x) => ups.includes(x.seq) && (isOpenDefault(x) || isOpenConflict(x)));
}

export async function flagShouldHaveAsked(e: Entry) {
  patchById(e.id, { resolution: "should_have_asked" });
}

export function latestRun(entries: Entry[]): Entry[] {
  const id = entries[0]?.run_id;
  return entries
    .filter((e) => e.run_id === id)
    .sort((a, b) => a.seq - b.seq || a.created_at.localeCompare(b.created_at));
}

/** One approval for every irreversible step in the run. Unchecked steps are declined; steps depending on a declined one are cancelled. */
export async function commitPlan(
  items: Entry[],
  include: Set<string>,
  all: Entry[],
  scope: { contract: ContractRow; invite: Entry } | null,
) {
  const now = new Date().toISOString();
  const declined = new Set<number>();
  const ids = new Set(items.map((i) => i.id));
  for (const e of [...items].sort((a, b) => a.seq - b.seq)) {
    const off = !include.has(e.id) || (e.depends_on != null && declined.has(e.depends_on));
    if (off) declined.add(e.seq);
    // A step left waiting on a declined one stays blocked: the decline panel decides what happens next.
    if (off && (include.has(e.id) || (e.depends_on != null && declined.has(e.depends_on))))
      continue;
    const patch = off
      ? { source: "user", status: include.has(e.id) ? "cancelled" : "declined", decided_at: now }
      : { source: "approved", status: "done", decided_at: now };
    store().updateRows(
      (r) => r.id === e.id && (r.status === "pending" || r.status === "blocked"),
      patch,
    );
    if (off) continue;
    // Release non-commit steps that waited on this one.
    for (const d of all.filter(
      (x) =>
        x.run_id === e.run_id && x.depends_on === e.seq && x.status === "blocked" && !ids.has(x.id),
    )) {
      const dp = d.preview as Preview | null;
      patchById(d.id, unblockedStatus(dp?.blocked_by, true, !!dp?.saved_scope));
    }
  }
  if (scope && include.has(scope.invite.id) && !declined.has(scope.invite.seq)) {
    const v = (scope.invite.preview as Preview).scope!;
    const rule: Rule = {
      key: SCOPE_KEY("invites"),
      label: `Send invites without asking while recipients (${v.recipients}) and message match`,
      kind: "scope",
      value: v,
    };
    setRules(putRule(scope.contract, rule.key, rule, scope.invite.scenario));
  }
}

/** Save a scoped approval directly from the latest approved invite (Status suggestion). */
export async function saveScopeFrom(invite: Entry, contract: ContractRow) {
  const v = (invite.preview as Preview).scope!;
  const rule: Rule = {
    key: SCOPE_KEY("invites"),
    label: `Send invites without asking while recipients (${v.recipients}) and message match`,
    kind: "scope",
    value: v,
  };
  setRules(putRule(contract, rule.key, rule, invite.scenario));
}

/** Declined steps in a run that still wait for "what should happen instead?". */
export const awaitingAlternative = (e: Entry) => e.status === "declined" && !e.resolution;

/** Pick another option for a declined step: recorded as YOU CHOSE, then the run is re-planned. */
export async function chooseAlternative(
  declined: Entry,
  alt: Alternative,
  contract: ContractRow,
  all: Entry[],
) {
  const step = all.find(
    (x) => x.run_id === declined.run_id && x.criterion === alt.key && x.status !== "superseded",
  );
  const rule: Rule = {
    key: alt.key,
    label: `Use ${alt.value} instead of “${step?.default_label ?? (alt.kind === "venue" ? `the agent's ${scenarioOf(declined.scenario).place} pick` : scenarioOf(declined.scenario).dates.label)}”`,
    kind: "override",
    value: alt.value,
  };
  setRules(putRule(contract, rule.key, rule, declined.scenario));
  if (step)
    patchById(step.id, {
      resolution: `override:${alt.value}`,
      decided_at: new Date().toISOString(),
    });
  // The declined card is replaced by a fresh one built on the new choice.
  patchById(declined.id, { status: "superseded", resolution: `replaced:${alt.value}` });
  return replanRun({ data: { run_id: declined.run_id } });
}

/** The step's own open assumption that only an agent's guess answers: its default, or (on a send) who gets it. */
export function openAssumptionKey(e: Entry): string | null {
  if (isOpenDefault(e)) return e.default_key;
  const cs = Array.isArray(e.criteria) ? (e.criteria as Criterion[]) : [];
  return e.kind === "send" && cs.some((c) => c.key === RECIPIENTS_KEY && c.source === "default")
    ? RECIPIENTS_KEY
    : null;
}

/** A not-yet-connected resource of the run's case that could answer this step's open assumption. */
export function resourceOffer(e: Entry, contract: ContractRow): Resource | null {
  const key = openAssumptionKey(e);
  const r = key ? resourceForKey(scenarioOf(e.scenario), key) : undefined;
  return r && !contract.resources?.includes(r.id) ? r : null;
}

/**
 * "Answer from Team calendar": connect a resource of the run's case and re-plan, so it answers the
 * assumption it covers. Written straight to the contract like "Keep as rule". Returns an undo.
 */
export async function connectResource(e: Entry, resourceId: string, all: Entry[]) {
  // Read the live contract, not a caller's copy: a stale copy would drop resources connected since it was read.
  const before = store().contract.resources ?? [];
  if (!scenarioOf(e.scenario).resources.some((r) => r.id === resourceId))
    throw new Error(`Unknown resource for this case: ${resourceId}`);
  if (!before.includes(resourceId)) store().setContract({ resources: [...before, resourceId] });
  const r = await replanRun({ data: { run_id: e.run_id } });
  const prior = new Map(all.map((x) => [x.id, x]));
  async function undo() {
    if (r.inserted.length) store().deleteRows(r.inserted);
    for (const id of r.superseded) {
      const o = prior.get(id);
      if (o) patchById(id, { status: o.status, resolution: o.resolution });
    }
    store().setContract({ resources: before });
  }
  return { ...r, undo };
}

/** "Stop the run here": the only path that cancels steps depending on the declined one. */
export async function stopRun(declined: Entry, all: Entry[]) {
  const run = all.filter((x) => x.run_id === declined.run_id && x.status !== "superseded");
  const nodes = run.map((x) => ({ seq: x.seq, inputs: x.inputs, depends_on: x.depends_on }));
  const down = run.filter(
    (x) =>
      (x.status === "blocked" || x.status === "pending") &&
      upstreamOf(x.seq, nodes).includes(declined.seq),
  );
  const now = new Date().toISOString();
  if (down.length) {
    const ids = new Set(down.map((d) => d.id));
    store().updateRows((r) => ids.has(r.id), {
      status: "cancelled",
      source: "user",
      decided_at: now,
    });
  }
  patchById(declined.id, { resolution: "stopped" });
}

/**
 * Use another option for a step (budget split, venue, dates, or settling the agent conflict).
 * Just this run: recorded on the step row; as rule: also added to the contract. Returns an undo.
 */
export async function applyChoice(
  step: Entry,
  value: string,
  asRule: boolean,
  contract: ContractRow,
  all: Entry[],
) {
  const key = step.criterion!;
  if (asRule) {
    const rule: Rule = {
      key,
      label: `Use ${value} instead of “${step.default_label ?? key}”`,
      kind: "override",
      value,
    };
    setRules(putRule(contract, key, rule, step.scenario));
  }
  patchById(step.id, { resolution: `override:${value}`, decided_at: new Date().toISOString() });
  const r = await replanRun({ data: { run_id: step.run_id } });
  const before = new Map(all.map((x) => [x.id, x]));
  async function undo() {
    if (r.inserted.length) store().deleteRows(r.inserted);
    for (const id of r.superseded) {
      const o = before.get(id);
      if (o) patchById(id, { status: o.status, resolution: o.resolution });
    }
    patchById(step.id, { resolution: step.resolution, decided_at: step.decided_at });
    if (asRule) setRules(contract.rules);
  }
  return { ...r, undo };
}
