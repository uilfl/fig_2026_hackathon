// Pure Cosign engine: simulated demo cases (see scenarios.ts) + system-side attribution.
// The agent reports a structured criterion; the system decides whose decision it was.
import {
  scenarioOf,
  tierOf,
  tierRank,
  agentShort,
  agentRole,
  type AgentRole,
  type Resource,
  type Role,
  type Scenario,
} from "./scenarios";

export type Reversibility = "free" | "fee" | "until_deadline" | "never";
export const REV_ORDER: Reversibility[] = ["free", "fee", "until_deadline", "never"];
/** Ask threshold: pause any side effect at least this hard to undo. "off" = never ask. */
export type AskAt = Reversibility | "off";
export type ActionKey = "plan" | "catering" | "deposit" | "invites";
/** How hard each action is to undo (the system's classification; same for every case). */
export const ACTION_LEVEL: Record<ActionKey, Reversibility> = {
  plan: "free",
  catering: "until_deadline",
  deposit: "never",
  invites: "never",
};
/** Per-action overrides of the threshold: true = always ask, false = never ask. */
export type Triggers = {
  ask_at: AskAt;
  over_budget: boolean;
  actions?: Partial<Record<ActionKey, boolean>>;
};
/** Action names for a contract's case (risk map, overrides, pause reasons). */
export const actionLabels = (
  c: { scenario?: string | undefined } | null | undefined,
): Record<ActionKey, string> => scenarioOf(c?.scenario).actionLabels;

export function actionKeyOf(step: { kind: string; effect?: Effect | undefined }): ActionKey {
  if (step.kind === "send") return "invites";
  if (step.kind === "spend")
    return step.effect?.type === "spend" && !step.effect.refundable ? "deposit" : "catering";
  return "plan";
}

/** Does this action ask? Per-action override wins; otherwise the reversibility threshold. */
export function asksFor(key: ActionKey, level: Reversibility, t: Triggers): boolean {
  const o = t.actions?.[key];
  return o ?? needsAsk(level, t.ask_at);
}

function askReason(
  key: ActionKey,
  level: Reversibility,
  t: Triggers,
  labels: Record<ActionKey, string>,
): string {
  if (t.actions?.[key] === true) return `Your setting: “${labels[key]}” — always ask`;
  return `${REV_LABEL[level]} — your setting: “${ASK_LABEL[t.ask_at]}”`;
}
/** keep = the agent's criterion becomes a contract rule; override = the user picked a specific option. */
/** scope = a saved approval: the action runs without asking while its recipients and message hash the same. */
export type ScopeValue = {
  recipients_hash: string;
  template_hash: string;
  recipients?: string;
  template?: string;
};
/** `scenario` = the demo case the rule belongs to; untagged rules belong to the default case (the offsite). */
export type Rule = {
  key: string;
  label: string;
  kind?: "keep" | "override" | "scope";
  value?: string | ScopeValue;
  scenario?: string | undefined;
};
export const SCOPE_KEY = (k: ActionKey) => `scope:${k}`;
export function hashOf(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
export function scopeOf(effect: Extract<Effect, { type: "send" }>): Required<ScopeValue> {
  const recipients = effect.to
    ? `${effect.recipients} people on ${effect.to}`
    : `${effect.recipients} people`;
  return {
    recipients,
    template: effect.subject,
    recipients_hash: hashOf(recipients),
    template_hash: hashOf(effect.subject),
  };
}
/** Compare a send against a saved scope. Returns null if it matches, else what changed. */
export function scopeDiff(saved: ScopeValue, now: Required<ScopeValue>): string[] | null {
  const d: string[] = [];
  if (saved.recipients_hash !== now.recipients_hash)
    d.push(`recipients: ${saved.recipients ?? "saved list"} → ${now.recipients}`);
  if (saved.template_hash !== now.template_hash)
    d.push(`message: “${saved.template ?? "saved message"}” → “${now.template}”`);
  return d.length ? d : null;
}
/** Per-agent settings that aren't rules: a paused agent's every step waits for you. */
export type AgentSettings = Partial<Record<AgentRole, { paused?: boolean | undefined }>>;
/**
 * `scenario` = demo case id (scenarios.ts); missing means the offsite.
 * `resources` = ids of connected resources (scenarios.ts `Resource`); only the contract's own case's count.
 */
export type Contract = {
  goal: string;
  budget_cap: number;
  headcount: number;
  triggers: Triggers;
  rules: Rule[];
  scenario?: string | undefined;
  agents?: AgentSettings | undefined;
  resources?: string[] | undefined;
};

/** The pause reason if the contract pauses the agent taking this step, else null. */
export function pausedReason(contract: Contract, agent: string): string | null {
  const role = agentRole(scenarioOf(contract.scenario), agent);
  return role && contract.agents?.[role]?.paused
    ? `Your setting: ${agent} is paused — every step it takes waits for you`
    : null;
}
export type Source = "user" | "approved" | "contract" | "resource" | "default" | "pending";
export type Status = "done" | "pending" | "blocked";
export type Kind = "contract" | "select" | "spend" | "send";

export type Effect =
  | { type: "spend"; amount: number; refundable: false; payee: string; memo: string }
  | {
      type: "spend";
      amount: number;
      refundable: true;
      payee: string;
      memo: string;
      cancel_by: string;
    }
  | {
      type: "send";
      channel: "email";
      recipients: number;
      subject: string;
      /** Named list the recipients come from (a connected guest list). */ to?: string | undefined;
    };

export type Preview = {
  what: string;
  reversibility: Reversibility;
  reversibility_note: string;
  amount?: number | undefined;
  total_after?: number | undefined;
  blocked_by?: string[] | undefined;
  scope?: Required<ScopeValue> | undefined;
  saved_scope?: boolean | undefined;
};

export type Step = {
  /** Place in the plan shape; the map and receipts key on it (the contract step has none). */
  role?: Role;
  agent: string;
  kind: Kind;
  action: string;
  criterion: string; // structured key logged by the agent
  criterion_label: string;
  options_considered: string[];
  filtered_out: { option: string; reason: string }[];
  effect?: Effect;
  depends_on?: number; // seq of a step that must complete first
  inputs?: number[]; // seqs whose outputs this step uses (data dependencies)
  /** All criteria the agent logged; defaults to the single `criterion`. */
  criteria?: CriterionRef[];
  /** Agent-reported filtered_out may tag which criterion removed each option. */
  filtered_out_by?: { option: string; criterion: string }[];
  /** System-side re-check of a criterion against an option: true pass, false fail, undefined = judgement call. */
  check?: (key: string, option: string) => boolean | undefined;
  /** Options exempt from re-check (e.g. a user-forced pick). */
  exempt?: string[];
};

/** `note` = what a connected resource said (set by the engine when a resource answers the criterion). */
export type CriterionRef = { key: string; label: string; note?: string | undefined };
export type CriterionSource = "you" | "contract" | "rule" | "resource" | "default";
/** `resource` = name of the connected resource that answered it. */
export type Criterion = CriterionRef & {
  source: CriterionSource;
  verified: boolean;
  resource?: string | undefined;
};

export type Attributed = Step & {
  seq: number;
  source: Source;
  criteria_out: Criterion[];
  status: Status;
  default_key: string | null;
  default_label: string | null;
  preview: Preview | null;
};

/** Criteria grounded in the contract's own fields. */
const CONTRACT_CRITERIA = new Set(["user_contract", "headcount", "budget_cap", "ask_threshold"]);

export const ASK_LABEL: Record<AskAt, string> = {
  never: "Ask before anything that can't be undone",
  until_deadline: "Ask before anything with a refund deadline or worse",
  fee: "Ask before anything that costs a fee to undo",
  free: "Ask before every side effect",
  off: "Never ask",
};
export const REV_LABEL: Record<Reversibility, string> = {
  free: "Free to undo",
  fee: "Undo with a fee",
  until_deadline: "Undo until deadline",
  never: "Cannot be undone",
};

export function needsAsk(level: Reversibility, askAt: AskAt): boolean {
  return askAt !== "off" && REV_ORDER.indexOf(level) >= REV_ORDER.indexOf(askAt);
}

/** The system — never the agent — assigns reversibility from the concrete effect. */
export function reversibilityOf(effect: Effect | undefined): {
  level: Reversibility;
  note: string;
} {
  if (!effect) return { level: "free", note: "Nothing leaves Cosign; can be changed any time." };
  if (effect.type === "spend") {
    if (!effect.refundable)
      return { level: "never", note: "Non-refundable. Money cannot be recovered." };
    return { level: "until_deadline", note: `Fully refundable until ${effect.cancel_by}.` };
  }
  return { level: "never", note: "Sent emails cannot be unsent." };
}

/** The case a rule belongs to. */
export const ruleCase = (r: Rule) => scenarioOf(r.scenario).id;
/** Rules that apply to a contract: only its own case's (an offsite override must never steer the dinner). */
export const rulesFor = (contract: Contract) => {
  const id = scenarioOf(contract.scenario).id;
  return contract.rules.filter((r) => ruleCase(r) === id);
};
/**
 * Set (or with `rule` null, remove) one case's rule for a key; other cases' rules are kept.
 * `scenario` = the case it belongs to (defaults to the contract's).
 */
export function putRule(
  contract: Contract,
  key: string,
  rule: Rule | null,
  scenario?: string | null,
): Rule[] {
  const id = scenarioOf(scenario ?? contract.scenario).id;
  const rest = contract.rules.filter((r) => !(r.key === key && ruleCase(r) === id));
  return rule ? [...rest, { ...rule, scenario: id }] : rest;
}

export function ruleFor(contract: Contract, key: string) {
  return rulesFor(contract).find((r) => r.key === key);
}

/** Criterion key for who the invites go to (answered by a guest list). */
export const RECIPIENTS_KEY = "recipients";
/** The criterion a resource answers in its case. */
export function answerKey(S: Scenario, r: Resource): string {
  if (r.kind === "calendar") return DATES_KEY;
  if (r.kind === "requirements") return S.requirement.key;
  return RECIPIENTS_KEY;
}
/** Connected resources of the contract's own case (another case's ids are ignored). */
export const resourcesFor = (contract: Contract): Resource[] =>
  scenarioOf(contract.scenario).resources.filter((r) => contract.resources?.includes(r.id));
/** The case's resource that could answer a criterion, connected or not. */
export const resourceForKey = (S: Scenario, key: string): Resource | undefined =>
  S.resources.find((r) => answerKey(S, r) === key);
/** The connected resource that answers a criterion — only when nobody decided it (any rule for the key wins). */
export function resourceAnswering(contract: Contract, key: string): Resource | undefined {
  if (ruleFor(contract, key)) return undefined;
  const S = scenarioOf(contract.scenario);
  return resourcesFor(contract).find((r) => answerKey(S, r) === key);
}

/** Pick an option for a judgement call: user override > agent's pick. */
function choose<T>(
  contract: Contract,
  key: string,
  options: T[],
  name: (t: T) => string,
  agentPick: T,
): { pick: T; overridden: boolean } {
  const r = ruleFor(contract, key);
  if (r?.kind === "override" && typeof r.value === "string") {
    const o = options.find((x) => name(x) === r.value);
    if (o) return { pick: o, overridden: true };
  }
  return { pick: agentPick, overridden: false };
}

/** Strongest → weakest. A step's source is its weakest criterion. */
export const SOURCE_RANK: Source[] = ["user", "approved", "contract", "resource", "default"];
const CRIT_TO_SOURCE: Record<CriterionSource, Source> = {
  you: "user",
  contract: "contract",
  rule: "contract",
  resource: "resource",
  default: "default",
};
export function sourceFromCriteria(cs: Criterion[]): Source {
  let worst = 0;
  for (const c of cs) worst = Math.max(worst, SOURCE_RANK.indexOf(CRIT_TO_SOURCE[c.source]));
  return SOURCE_RANK[worst]!;
}

/**
 * Re-apply logged criteria to the options (in order; first failing criterion removes an option)
 * and compare with what the agent reported. Returns the keys of criteria whose claims don't hold.
 */
export function verifyCriteria(
  refs: CriterionRef[],
  options: string[],
  reported: { option: string; criterion: string }[],
  check: (key: string, option: string) => boolean | undefined,
  exempt: string[] = [],
): Set<string> {
  const bad = new Set<string>();
  const claimed = new Map(reported.map((r) => [r.option, r.criterion]));
  for (const o of options) {
    if (exempt.includes(o)) continue;
    const actual = refs.find((r) => check(r.key, o) === false)?.key;
    const claim = claimed.get(o);
    if (claim === actual) continue;
    if (claim) bad.add(claim);
    else if (actual) bad.add(actual);
  }
  return bad;
}

/** The system — never the agent — assigns each criterion's source. */
export function buildCriteria(
  refs: CriterionRef[],
  contract: Contract,
  overriddenKeys: string[] = [],
  unverified: Set<string> = new Set(),
): Criterion[] {
  return refs.map((r) => {
    if (unverified.has(r.key)) return { ...r, source: "default", verified: false };
    const rule = ruleFor(contract, r.key);
    const source: CriterionSource =
      overriddenKeys.includes(r.key) || rule?.kind === "override"
        ? "you"
        : CONTRACT_CRITERIA.has(r.key)
          ? "contract"
          : rule
            ? "rule"
            : "default";
    // A connected resource answers only what nobody decided; it ranks below the contract.
    const res = source === "default" ? resourceAnswering(contract, r.key) : undefined;
    if (res)
      return {
        ...r,
        source: "resource",
        verified: true,
        resource: res.name,
        note: r.note ?? `${res.name}: ${res.evidence}`,
      };
    return { ...r, source, verified: true };
  });
}

export function attribute(
  step: Step,
  seq: number,
  contract: Contract,
  spentSoFar: number,
  overridden = false,
): Attributed {
  const refs = step.criteria ?? [{ key: step.criterion, label: step.criterion_label }];
  const unverified =
    step.kind === "select" && step.check && step.filtered_out_by
      ? verifyCriteria(refs, step.options_considered, step.filtered_out_by, step.check, step.exempt)
      : new Set<string>();
  const criteria_out = buildCriteria(
    refs,
    contract,
    overridden ? [step.criterion] : [],
    unverified,
  );
  const firstDefault =
    criteria_out.find((c) => c.source === "default" && (c.key === step.criterion || !c.verified)) ??
    null;
  const base = {
    ...step,
    seq,
    criteria_out,
    default_key: null as string | null,
    default_label: null as string | null,
    preview: null as Preview | null,
  };
  if (step.kind === "contract") return { ...base, source: "user", status: "done" };
  const labels = actionLabels(contract);

  const paused = pausedReason(contract, step.agent);

  if (step.kind === "select") {
    if (paused || asksFor("plan", "free", contract.triggers)) {
      const preview: Preview = {
        what: step.action,
        reversibility: "free",
        reversibility_note: "Nothing leaves Cosign; can be changed any time.",
        blocked_by: [paused ?? askReason("plan", "free", contract.triggers, labels)],
      };
      return { ...base, preview, source: "pending", status: "pending" };
    }
    const source = sourceFromCriteria(criteria_out);
    // Only the step's own default is resolvable here; inherited defaults are resolved on their own step.
    return {
      ...base,
      source,
      status: "done",
      default_key: firstDefault?.key ?? null,
      default_label: firstDefault?.label ?? null,
    };
  }

  const effect = step.effect!;
  const rev = reversibilityOf(effect);
  const blocked: string[] = [];
  let amount: number | undefined;
  let total: number | undefined;
  let what = "";
  if (effect.type === "spend") {
    amount = effect.amount;
    total = spentSoFar + effect.amount;
    what = `Pay $${effect.amount.toLocaleString()} to ${effect.payee} — ${effect.memo}`;
    if (contract.triggers.over_budget && total > contract.budget_cap)
      blocked.push(
        `Would exceed budget cap of $${contract.budget_cap.toLocaleString()} (your setting: ask before going over budget)`,
      );
  }
  const key = actionKeyOf(step);
  let scope: Required<ScopeValue> | undefined;
  let savedScope = false;
  if (effect.type === "send") {
    what = `Email ${effect.recipients} people${effect.to ? ` on ${effect.to}` : ""}: “${effect.subject}”`;
    scope = scopeOf(effect);
  }
  if (asksFor(key, rev.level, contract.triggers)) {
    const saved = scope
      ? rulesFor(contract).find((r) => r.key === SCOPE_KEY(key) && r.kind === "scope")
      : undefined;
    const diff =
      saved && typeof saved.value === "object" ? scopeDiff(saved.value, scope!) : undefined;
    if (saved && diff === null) savedScope = true;
    else
      blocked.unshift(
        diff
          ? `Saved scope doesn't match — ${diff.join("; ")}`
          : askReason(key, rev.level, contract.triggers, labels),
      );
  }
  if (paused) blocked.unshift(paused);
  const preview: Preview = {
    what,
    reversibility: rev.level,
    reversibility_note: rev.note,
    amount,
    total_after: total,
    blocked_by: blocked.length ? blocked : undefined,
    scope,
    saved_scope: (savedScope && !paused) || undefined,
  };
  return blocked.length
    ? { ...base, preview, source: "pending", status: "pending" }
    : { ...base, preview, source: savedScope ? "approved" : "contract", status: "done" };
}

/** Criterion keys shared by every case (the requirement key is per case). */
export const CONFLICT_KEY = "venue_conflict";
export const SHARE_KEY = "venue_share_60";
export const DATES_KEY = "earliest_weekend";

/** The venue budget in dollars for a contract's chosen split tier. */
const venueBudgetOf = (contract: Contract, share: string) =>
  Math.round(contract.budget_cap * tierOf(scenarioOf(contract.scenario), share).fraction);

/** The contract's split tier and the dollars it leaves for the venue. */
export function venueBudgetFor(contract: Contract) {
  const S = scenarioOf(contract.scenario);
  const pick = choose(contract, SHARE_KEY, S.shares, (x) => x, S.sharePick).pick;
  return { tier: tierOf(S, pick), amount: venueBudgetOf(contract, pick) };
}

/** Run-scoped choices ("just this run") recorded as `override:<value>` on a step row, keyed by its criterion. They win over contract rules. */
export function withRunRules<C extends Contract>(
  contract: C,
  rows: { criterion: string | null; resolution: string | null; created_at?: string }[],
): C {
  const picks = new Map<string, string>();
  for (const r of [...rows].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "")))
    if (r.criterion && r.resolution?.startsWith("override:"))
      picks.set(r.criterion, r.resolution.slice(9));
  if (!picks.size) return contract;
  let rules = contract.rules;
  for (const [key, value] of picks)
    rules = putRule({ ...contract, rules }, key, {
      key,
      label: `This run: ${value}`,
      kind: "override",
      value,
    });
  return { ...contract, rules };
}

/** System-side re-check of a venue criterion. `requirementOff` = the user overrode the requirement, so it's a judgement call. */
export function venueCheck(contract: Contract, venueBudget: number, requirementOff = false) {
  const S = scenarioOf(contract.scenario);
  return (key: string, name: string): boolean | undefined => {
    const v = S.options.find((x) => x.name === name);
    if (!v) return undefined;
    if (key === "headcount") return v.cap >= contract.headcount;
    if (key === SHARE_KEY) return v.price <= venueBudget;
    if (key === "budget_cap") return v.price <= contract.budget_cap;
    if (key === S.requirement.key) return requirementOff ? undefined : v.meets;
    return undefined;
  };
}

export function runScenario(contract: Contract): Attributed[] {
  const out: Attributed[] = [];
  let spent = 0;
  const push = (s: Step, overridden = false) => {
    const a = attribute(s, out.length, contract, spent, overridden);
    if (a.effect?.type === "spend") spent += a.effect.amount;
    // A step that waits on a paused/blocked step is blocked, whatever its own status.
    if (s.depends_on != null && out[s.depends_on] && out[s.depends_on]!.status !== "done")
      a.status = "blocked";
    out.push(a);
    return a;
  };

  const S = scenarioOf(contract.scenario);
  const req = S.requirement;
  const usd = (n: number) => `$${n.toLocaleString()}`;
  push({
    agent: "You",
    kind: "contract",
    action: `Set goal “${contract.goal}”, ${contract.headcount} ${S.sentence.unit}, ${usd(contract.budget_cap)} cap`,
    criterion: "user_contract",
    criterion_label: "Your delegation contract",
    options_considered: [],
    filtered_out: [],
  });

  const shareSeq = out.length;
  const share = choose(contract, SHARE_KEY, S.shares, (x) => x, S.sharePick);
  const venueBudget = venueBudgetOf(contract, share.pick);
  push(
    {
      role: "split",
      agent: S.agents.budget,
      kind: "select",
      action: `Chose “${tierOf(S, share.pick).label}”: up to ${usd(venueBudget)} for the ${S.place}`,
      criterion: SHARE_KEY,
      criterion_label: tierOf(S, S.sharePick).label,
      options_considered: S.shares,
      filtered_out: S.shares
        .filter((x) => x !== share.pick)
        .map((x) => ({
          option: x,
          reason: share.overridden ? "You chose otherwise" : `Agent's usual is ${S.sharePick}`,
        })),
    },
    share.overridden,
  );

  const filtered: { option: string; reason: string; criterion: string }[] = [];
  const reqRule = ruleFor(contract, req.key);
  const ok: typeof S.options = [];
  for (const v of S.options) {
    if (v.cap < contract.headcount)
      filtered.push({
        option: v.name,
        reason: S.capReason(v.cap, contract.headcount),
        criterion: "headcount",
      });
    else if (v.price > venueBudget)
      filtered.push({
        option: v.name,
        reason: `${usd(v.price)} over the ${S.place} budget ${usd(venueBudget)}`,
        criterion: SHARE_KEY,
      });
    else if (!v.meets && reqRule?.kind !== "override")
      filtered.push({ option: v.name, reason: req.missing, criterion: req.key });
    else ok.push(v);
  }

  // Agent conflict: the Venue agent prefers the best option for the group; the Budget agent rejects it when it's over the share.
  const pref = S.options.find((v) => v.name === S.preference)!;
  const venueOverride = choose(contract, req.key, S.options, (v) => v.name, ok[0] ?? S.options[0]!);
  const conflict = pref.cap >= contract.headcount && pref.meets && pref.price > venueBudget;
  let settled: (typeof S.options)[number] | null = null;
  let sideBudget = false;
  if (conflict) {
    const r = ruleFor(contract, CONFLICT_KEY);
    const rv = typeof r?.value === "string" ? r.value : null;
    sideBudget = rv === "budget";
    if (rv === "venue") settled = pref;
    else if (rv === "budget") settled = ok[0] ?? S.options[0]!;
    else if (rv && S.options.some((v) => v.name === rv))
      settled = S.options.find((v) => v.name === rv)!;
    else if (venueOverride.overridden) settled = venueOverride.pick;
    else if (share.overridden && tierRank(S, share.pick) > tierRank(S, S.sharePick)) settled = pref; // spending more on the place sides with the Venue agent
  }
  let conflictSeq: number | undefined;
  if (conflict) {
    conflictSeq = out.length;
    const over = pref.price - venueBudget;
    const [va, ba] = [S.agents.venue, S.agents.budget];
    const a = push(
      {
        role: "conflict",
        agent: "Cosign",
        kind: "select",
        criterion: CONFLICT_KEY,
        criterion_label: `Agents disagree on the ${S.place}`,
        action: settled
          ? `You settled a disagreement between ${agentShort(va)} and ${agentShort(ba)} agents → ${settled.name}`
          : `Agents disagree: ${va} wants ${pref.name} (${S.fits(pref.cap)}, ${req.tag}); ${ba} says over the ${S.place} budget by ${usd(over)}`,
        options_considered: ["venue", "budget"],
        filtered_out: [],
        inputs: [shareSeq],
      },
      !!settled,
    );
    if (!settled) {
      a.status = "pending";
      a.source = "pending";
      a.preview = {
        what: `${va} wants ${pref.name} — ${S.fits(pref.cap)}, ${req.tag}. ${ba} says: over the ${S.place} budget by ${usd(over)}.`,
        reversibility: "free",
        reversibility_note: "Nothing is booked yet.",
        blocked_by: ["Agents disagree — Cosign never picks a side for you"],
      };
    }
  }
  const shortlistSeq = out.length;
  const venue = settled ? { pick: settled, overridden: !sideBudget } : venueOverride;
  push(
    {
      role: "venue",
      agent: S.agents.venue,
      kind: "select",
      action: `Shortlisted ${venue.pick.name}`,
      criterion: req.key,
      criterion_label: req.label,
      options_considered: S.options.map((v) => v.name),
      filtered_out: filtered
        .filter((f) => f.option !== venue.pick.name)
        .map(({ option, reason }) => ({ option, reason })),
      criteria: [
        { key: "headcount", label: `Fits all ${contract.headcount} ${S.sentence.unit}` },
        {
          key: SHARE_KEY,
          label: `Within the ${S.place} budget (${usd(venueBudget)}, ${share.pick})`,
        },
        { key: req.key, label: req.label },
      ],
      filtered_out_by: filtered
        .filter((f) => f.option !== venue.pick.name)
        .map((f) => ({ option: f.option, criterion: f.criterion })),
      check: venueCheck(contract, venueBudget, reqRule?.kind === "override"),
      exempt: venue.overridden ? [venue.pick.name] : [],
      inputs: conflictSeq != null ? [shareSeq, conflictSeq] : [shareSeq],
      ...(conflictSeq != null ? { depends_on: conflictSeq } : {}),
    },
    venue.overridden,
  );

  const datesSeq = out.length;
  const D = S.dates.options;
  const chosenDate = choose(contract, DATES_KEY, D, (x) => x, D[0]!);
  // A connected calendar answers the date when nobody chose it; the agent's own guess is the earliest option.
  const cal = resourceAnswering(contract, DATES_KEY);
  const calPick = cal?.value && D.includes(cal.value) ? cal.value : null;
  const date =
    !chosenDate.overridden && calPick ? { pick: calPick, overridden: false } : chosenDate;
  const fromCal = !chosenDate.overridden && !!calPick;
  const dateReason = (d: string) =>
    date.overridden
      ? "You chose otherwise"
      : fromCal && D.indexOf(d) < D.indexOf(date.pick)
        ? `${cal!.name}: ${cal!.evidence}`
        : "Later than earliest";
  const dateLabel = fromCal ? `Earliest ${S.dates.noun} open on ${cal!.name}` : S.dates.label;
  const dateNote =
    fromCal && date.pick !== D[0]
      ? `Agent would have assumed ${D[0]} — ${cal!.name}: ${cal!.evidence}`
      : undefined;
  push(
    {
      role: "dates",
      agent: S.agents.venue,
      kind: "select",
      action: `Picked ${S.dates.noun} ${date.pick}`,
      criterion: DATES_KEY,
      criterion_label: dateLabel,
      ...(dateNote ? { criteria: [{ key: DATES_KEY, label: dateLabel, note: dateNote }] } : {}),
      options_considered: D,
      filtered_out: D.filter((d) => d !== date.pick).map((d) => ({
        option: d,
        reason: dateReason(d),
      })),
      inputs: [shortlistSeq],
      depends_on: shortlistSeq,
    },
    date.overridden,
  );

  const deposit = Math.round(venue.pick.price * 0.5);
  const depositSeq = out.length;
  push({
    role: "deposit",
    agent: S.agents.budget,
    kind: "spend",
    action: S.deposit.action(venue.pick.name),
    criterion: "budget_cap",
    criterion_label: "Within your budget cap",
    options_considered: [venue.pick.name],
    filtered_out: [],
    inputs: [shareSeq, shortlistSeq, datesSeq],
    depends_on: datesSeq,
    effect: {
      type: "spend",
      amount: deposit,
      refundable: false,
      payee: venue.pick.name,
      memo: S.deposit.memo(date.pick),
    },
  });

  const B = S.booking;
  push({
    role: "catering",
    agent: S.agents.budget,
    kind: "spend",
    action: B.action,
    criterion: "budget_cap",
    criterion_label: "Within your budget cap",
    options_considered: [...B.options],
    filtered_out: [{ option: B.options[1], reason: B.rejected }],
    inputs: [datesSeq],
    depends_on: datesSeq,
    effect: {
      type: "spend",
      amount: B.amount(contract.headcount),
      refundable: true,
      payee: B.payee,
      memo: B.memo(contract.headcount),
      cancel_by: B.cancelBy,
    },
  });

  // Who gets the email: a connected guest list names them; otherwise it's the Invites agent's guess.
  const guests = resourceAnswering(contract, RECIPIENTS_KEY);
  const recipientsLabel = guests
    ? `Recipients from ${guests.name}`
    : `Agent's guess: ${S.guessedRecipients}`;
  push({
    role: "invites",
    agent: S.agents.invites,
    kind: "send",
    action: S.send.action,
    criterion: "headcount",
    criterion_label: S.send.label(contract.headcount),
    options_considered: [S.send.option(contract.headcount)],
    filtered_out: [],
    depends_on: depositSeq,
    inputs: [datesSeq, depositSeq],
    criteria: [
      { key: "headcount", label: S.send.label(contract.headcount) },
      { key: RECIPIENTS_KEY, label: recipientsLabel },
    ],
    effect: {
      type: "send",
      channel: "email",
      recipients: contract.headcount,
      subject: S.send.subject(venue.pick.name, date.pick),
      ...(guests ? { to: guests.name } : {}),
    },
  });
  return out;
}

/** The contract a run was planned under: same contract, but the run's own case. */
export function forRun<C extends Contract>(
  contract: C,
  rows: { scenario?: string | null | undefined }[],
): C {
  const scenario = rows.find((r) => r.scenario)?.scenario;
  return scenario && scenario !== contract.scenario ? { ...contract, scenario } : contract;
}

/** Status of a step that was blocked, once the step it depends on is decided. */
export function unblockedStatus(
  ownBlockedBy: string[] | undefined,
  approved: boolean,
  savedScope = false,
): { status: string; source: Source } {
  if (!approved) return { status: "cancelled", source: "user" };
  return ownBlockedBy?.length
    ? { status: "pending", source: "pending" }
    : { status: "done", source: savedScope ? "approved" : "contract" };
}

/** Normalise contracts saved before the reversibility threshold existed. */
export function normaliseTriggers(t: unknown): Triggers {
  const o = (t ?? {}) as Record<string, unknown>;
  if (typeof o["ask_at"] === "string")
    return {
      ask_at: o["ask_at"] as AskAt,
      over_budget: o["over_budget"] !== false,
      actions: (o["actions"] as Triggers["actions"]) ?? {},
    };
  return {
    ask_at: o["non_refundable_spend"] || o["irreversible_send"] ? "never" : "off",
    over_budget: o["over_budget"] !== false,
  };
}

// ---------- Data dependencies & re-planning ----------

export type DepNode = { seq: number; inputs?: unknown; depends_on?: number | null };

/** Every step upstream of `seq` (transitive via inputs and depends_on). */
export function upstreamOf(seq: number, steps: DepNode[]): number[] {
  const bySeq = new Map(steps.map((s) => [s.seq, s]));
  const seen = new Set<number>();
  const visit = (q: number) => {
    const n = bySeq.get(q);
    if (!n) return;
    const ups = [
      ...((Array.isArray(n.inputs) ? n.inputs : []) as number[]),
      ...(n.depends_on != null ? [n.depends_on] : []),
    ];
    for (const u of ups)
      if (!seen.has(u)) {
        seen.add(u);
        visit(u);
      }
  };
  visit(seq);
  return [...seen].sort((a, b) => a - b);
}

export type OldStep = DepNode & {
  action: string;
  preview: unknown;
  source: string;
  status: string;
  criteria?: unknown;
};

/** Seqs to supersede: steps whose recomputed output differs, plus everything downstream of them. Decided steps stay. */
export function planReplacements(old: OldStep[], fresh: Attributed[]): number[] {
  // Compare outcomes (action + preview), with sorted keys since stored JSON may reorder them.
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canon(x)]),
          )
        : v;
  // A resource now answering the same pick is a different decision (other provenance changes are tracked by `resolution`).
  const who = (cs: unknown) =>
    Array.isArray(cs)
      ? (cs as { key?: string; source?: string }[])
          .filter((c) => c.source === "resource")
          .map((c) => c.key)
      : [];
  const sig = (x: { action: string; preview: unknown; criteria?: unknown }) =>
    JSON.stringify(canon([x.action, x.preview ?? null, who(x.criteria)]));
  const changed = new Set<number>();
  for (const f of fresh) {
    const o = old.find((x) => x.seq === f.seq);
    if (!o || sig(o) !== sig({ action: f.action, preview: f.preview, criteria: f.criteria_out }))
      changed.add(f.seq);
  }
  const out = new Set(changed);
  for (const f of fresh) if (upstreamOf(f.seq, fresh).some((u) => changed.has(u))) out.add(f.seq);
  const locked = (o: OldStep | undefined) =>
    !!o &&
    ((o.source === "approved" && o.status === "done") ||
      o.status === "declined" ||
      o.status === "expired");
  return [...out]
    .filter((q) => q !== 0 && !locked(old.find((x) => x.seq === q)))
    .sort((a, b) => a - b);
}

/** Irreversible spends/sends go on the single commit card instead of separate decision cards. */
export function isCommitStep(e: { kind: string; status: string; preview: unknown }): boolean {
  const p = e.preview as Preview | null;
  return (
    (e.kind === "spend" || e.kind === "send") &&
    p?.reversibility === "never" &&
    (e.status === "pending" || e.status === "blocked")
  );
}

/** Approvals = distinct user decisions (a commit approves several steps at once); saved-scope runs aren't approvals. */
export function countApprovals(
  rows: { source: string; status: string; decided_at: string | null; preview: unknown }[],
): number {
  return new Set(
    rows
      .filter(
        (r) =>
          r.source === "approved" &&
          r.status !== "superseded" &&
          !(r.preview as Preview | null)?.saved_scope,
      )
      .map((r) => r.decided_at),
  ).size;
}

/** Suggest a saved scope when an action was approved in the last 2 runs with no "should have asked" flags. Never suggests "Goes ahead". */
export function scopeSuggestion(
  runs: { kind: string; source: string; resolution: string | null; preview: unknown }[][],
  contract: Contract,
): ActionKey | null {
  const last = runs.slice(0, 2);
  if (last.length < 2 || rulesFor(contract).some((r) => r.key === SCOPE_KEY("invites")))
    return null;
  const ok = last.every(
    (run) =>
      !run.some((e) => e.resolution === "should_have_asked") &&
      run.some(
        (e) =>
          e.kind === "send" &&
          e.source === "approved" &&
          !(e.preview as Preview | null)?.saved_scope,
      ),
  );
  return ok ? "invites" : null;
}

// ---------- Alternatives after a decline ----------

/** Judgement calls a declined step can be re-planned around (others stay as they are): the case's requirement and the dates. */
export type Alternative = {
  key: string;
  value: string;
  kind: "venue" | "dates";
  preview: string;
  passes: boolean;
  note?: string | undefined;
};
type AltStep = DepNode & {
  kind: string;
  criterion: string | null;
  action: string;
  status: string;
  options_considered?: unknown;
};

/** Other options the agent already considered, upstream of the declined step, each with a preview. */
export function alternativesFor(
  declinedSeq: number,
  run: AltStep[],
  contract: Contract,
): Alternative[] {
  const live = run.filter((s) => s.status !== "superseded");
  const ups = upstreamOf(declinedSeq, live);
  const S = scenarioOf(contract.scenario);
  const req = S.requirement;
  const share = choose(contract, SHARE_KEY, S.shares, (x) => x, S.sharePick).pick;
  const venueBudget = venueBudgetOf(contract, share);
  const reqOff = ruleFor(contract, req.key)?.kind === "override";
  const venueStep = live.find((s) => ups.includes(s.seq) && s.criterion === req.key);
  const dateStep = live.find((s) => ups.includes(s.seq) && s.criterion === DATES_KEY);
  const curVenue = S.options.find((v) => venueStep?.action.includes(v.name)) ?? S.options[0]!;
  const curDate = S.dates.options.find((d) => dateStep?.action.includes(d));
  const out: Alternative[] = [];
  if (venueStep)
    for (const v of S.options) {
      if (v.name === curVenue.name) continue;
      const why =
        v.cap < contract.headcount
          ? S.capReason(v.cap, contract.headcount)
          : v.price > venueBudget
            ? `Over the ${share} ${S.place} budget ($${venueBudget.toLocaleString()})`
            : !v.meets && !reqOff
              ? req.missing
              : undefined;
      out.push({
        key: req.key,
        value: v.name,
        kind: "venue",
        passes: !why,
        note: why,
        preview: `Deposit $${Math.round(v.price * 0.5).toLocaleString()} to ${v.name} · ${S.fits(v.cap)} · ${v.meets ? req.tag : `no ${req.tag}`}${curDate ? ` · ${curDate}` : ""}`,
      });
    }
  if (dateStep)
    for (const d of S.dates.options) {
      if (d === curDate) continue;
      out.push({
        key: DATES_KEY,
        value: d,
        kind: "dates",
        passes: true,
        preview: `Deposit $${Math.round(curVenue.price * 0.5).toLocaleString()} to ${curVenue.name} for ${d}`,
      });
    }
  return out;
}

/** "Ask the agent for another option": next venue that passes every filter, else the next dates. */
export function nextAlternative(alts: Alternative[]): Alternative | undefined {
  return alts.find((a) => a.kind === "venue" && a.passes) ?? alts.find((a) => a.kind === "dates");
}
