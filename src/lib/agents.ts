/**
 * Agent settings: a per-agent view of the contract. Nothing here is stored separately — an agent's
 * instructions are contract rules, its "may do without asking" is `triggers.actions`, and pausing it is
 * `contract.agents`. Editing an agent edits the contract draft, so it's signed and versioned like the rest.
 */
import {
  ACTION_LEVEL,
  DATES_KEY,
  SHARE_KEY,
  asksFor,
  putRule,
  ruleFor,
  type ActionKey,
  type Contract,
  type CustomAgent,
  type Rule,
  type Triggers,
} from "./engine";
import { scenarioOf, tierOf, type AgentRole, type Role, type Scenario } from "./scenarios";

export const AGENT_ROLES: AgentRole[] = ["budget", "venue", "invites"];

type InstructionKind = "share" | "requirement" | "dates";
/** What each agent decides (map roles), which side effects it takes, and which of its assumptions you can set. */
export const AGENT_JOBS: Record<
  AgentRole,
  { roles: Role[]; actions: ActionKey[]; instructions: InstructionKind[] }
> = {
  budget: {
    roles: ["split", "deposit", "catering"],
    actions: ["deposit", "catering"],
    instructions: ["share"],
  },
  venue: { roles: ["venue", "dates"], actions: [], instructions: ["requirement", "dates"] },
  invites: { roles: ["invites"], actions: ["invites"], instructions: [] },
};

/** "agent" = no rule: the agent assumes its own pick (shows up as a default nobody chose). */
export const UP_TO_AGENT = "agent";
const REQUIRED = "required";

/** Title of the Budget agent's split setting (a trade-off, never a percentage). */
export const SHARE_TITLE = "What matters more?";

/** `hint` = a muted second line, e.g. the dollars a split tier leaves for the venue. */
export type InstructionOption = { value: string; label: string; hint?: string };
export type InstructionView = {
  kind: InstructionKind;
  key: string;
  title: string;
  /** The agent's assumption, as a rule label. */ label: string;
  value: string;
  options: InstructionOption[];
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function instructionDef(S: Scenario, kind: InstructionKind) {
  if (kind === "share")
    return {
      key: SHARE_KEY,
      title: SHARE_TITLE,
      label: tierOf(S, S.sharePick).label,
      agentPick: S.sharePick,
      picks: S.shares,
      assumes: `assumes “${tierOf(S, S.sharePick).label}”`,
    };
  if (kind === "dates")
    return {
      key: DATES_KEY,
      title: cap(S.dates.noun),
      label: S.dates.label,
      agentPick: S.dates.options[0]!,
      picks: S.dates.options,
      assumes: `assumes the earliest, ${S.dates.options[0]}`,
    };
  return {
    key: S.requirement.key,
    title: S.requirement.short,
    label: S.requirement.label,
    agentPick: REQUIRED,
    picks: [REQUIRED],
    assumes: "assumes it's required",
  };
}

/** Current value of one instruction, read from the contract's rules. */
function instructionValue(contract: Contract, key: string, agentPick: string): string {
  const r = ruleFor(contract, key);
  if (!r) return UP_TO_AGENT;
  if (r.kind === "override" && typeof r.value === "string") return r.value;
  return r.kind === "scope" ? UP_TO_AGENT : agentPick;
}

export type ActionMode = "ask" | "threshold" | "go";
export type ActionView = {
  key: ActionKey;
  label: string;
  mode: ActionMode;
  /** Would it ask under the threshold alone? */ thresholdAsks: boolean;
  /** Does it ask, all things considered (the "Ask me first" switch)? */ asks: boolean;
  /** Set on this agent rather than following the contract threshold. */ overridden: boolean;
};

export type AgentView = {
  role: AgentRole;
  name: string;
  job: string;
  paused: boolean;
  instructions: InstructionView[];
  actions: ActionView[];
};

export function agentSettings(contract: Contract, S: Scenario, role: AgentRole): AgentView {
  const job = AGENT_JOBS[role];
  const instructions = job.instructions.map((kind): InstructionView => {
    const d = instructionDef(S, kind);
    const value = instructionValue(contract, d.key, d.agentPick);
    const options: InstructionOption[] = [
      { value: UP_TO_AGENT, label: "Let the agent decide", hint: `It ${d.assumes}` },
      ...d.picks.map((p): InstructionOption => {
        if (kind === "share") {
          const tier = tierOf(S, p);
          return {
            value: p,
            label: tier.label,
            hint: `Up to $${Math.round(contract.budget_cap * tier.fraction).toLocaleString()} for the ${S.place}`,
          };
        }
        return { value: p, label: p === REQUIRED ? "Always required" : p };
      }),
    ];
    // An earlier one-off pick (e.g. a venue chosen despite the requirement) stays visible as its own option.
    if (!options.some((o) => o.value === value))
      options.push({ value, label: `Use ${value} (your earlier pick)` });
    return { kind, key: d.key, title: d.title, label: d.label, value, options };
  });
  const t = contract.triggers;
  const actions = job.actions.map((key): ActionView => {
    const o = t.actions?.[key];
    const thresholdAsks = asksFor(key, ACTION_LEVEL[key], { ...t, actions: {} });
    return {
      key,
      label: S.actionLabels[key],
      mode: o == null ? "threshold" : o ? "ask" : "go",
      thresholdAsks,
      asks: o ?? thresholdAsks,
      overridden: o != null,
    };
  });
  return {
    role,
    name: S.agents[role],
    job: S.jobs[role],
    paused: !!contract.agents?.[role]?.paused,
    instructions,
    actions,
  };
}

/** `{ action, asks }` = the "Ask me first" switch: matching the contract threshold clears the override. */
export type AgentChange =
  | { instruction: string; value: string }
  | { action: ActionKey; mode: ActionMode }
  | { action: ActionKey; asks: boolean }
  | { paused: boolean };

/** Apply one agent setting to a contract (returns a new contract; same rule/trigger shapes as the rest of the app). */
export function withAgentSetting<C extends Contract>(
  contract: C,
  S: Scenario,
  role: AgentRole,
  change: AgentChange,
): C {
  if ("paused" in change) {
    const agents = { ...contract.agents };
    if (change.paused) agents[role] = { paused: true };
    else delete agents[role];
    return { ...contract, agents };
  }
  if ("asks" in change) {
    const thresholdAsks = asksFor(change.action, ACTION_LEVEL[change.action], {
      ...contract.triggers,
      actions: {},
    });
    return withAgentSetting(contract, S, role, {
      action: change.action,
      mode: change.asks === thresholdAsks ? "threshold" : change.asks ? "ask" : "go",
    });
  }
  if ("action" in change) {
    const actions: Triggers["actions"] = { ...contract.triggers.actions };
    if (change.mode === "threshold") delete actions[change.action];
    else actions[change.action] = change.mode === "ask";
    return { ...contract, triggers: { ...contract.triggers, actions } };
  }
  const kind = AGENT_JOBS[role].instructions.find(
    (k) => instructionDef(S, k).key === change.instruction,
  );
  if (!kind) return contract;
  const d = instructionDef(S, kind);
  const rule: Rule | null =
    change.value === UP_TO_AGENT
      ? null
      : change.value === d.agentPick
        ? { key: d.key, label: d.label, kind: "keep" }
        : {
            key: d.key,
            label:
              kind === "share"
                ? `${tierOf(S, change.value).label} (instead of “${d.label}”)`
                : `Use ${change.value} instead of “${d.label}”`,
            kind: "override",
            value: change.value,
          };
  return { ...contract, rules: putRule(contract, d.key, rule, S.id) };
}

const ACTION_VERB: Record<ActionKey, string> = {
  plan: "planning",
  catering: "booking",
  deposit: "paying the deposit",
  invites: "sending",
};

/** One line for agent cards, e.g. "Best venue · asks before paying the deposit". */
export function agentSummary(contract: Contract, S: Scenario, role: AgentRole): string {
  const v = agentSettings(contract, S, role);
  if (v.paused) return "Paused — every step waits for you";
  const parts: string[] = [];
  for (const i of v.instructions)
    if (i.value !== UP_TO_AGENT)
      parts.push(
        i.kind === "share" ? i.value : `${i.title}: ${i.value === REQUIRED ? "required" : i.value}`,
      );
  const open = v.instructions.filter((i) => i.value === UP_TO_AGENT).length;
  if (open) parts.push(`assumes ${open} thing${open === 1 ? "" : "s"} you haven't set`);
  for (const a of v.actions)
    if (a.mode !== "threshold")
      parts.push(`${a.mode === "ask" ? "asks before" : "goes ahead"} ${ACTION_VERB[a.key]}`);
  return parts.length ? cap(parts.join(" · ")) : "Follows your contract";
}

/** Agents that take part in an action (planning is shared by the Budget and Venue agents). */
export const actionOwners = (key: ActionKey): AgentRole[] =>
  key === "plan"
    ? ["budget", "venue"]
    : AGENT_ROLES.filter((r) => AGENT_JOBS[r].actions.includes(key));
/** Does pausing agents make this action ask? */
export const pausedFor = (key: ActionKey, agents: Contract["agents"]) =>
  actionOwners(key).some((r) => !!agents?.[r]?.paused);

/** Steps an agent took in a run. */
export const agentSteps = <T extends { agent: string }>(run: T[], S: Scenario, role: AgentRole) =>
  run.filter((e) => e.agent === S.agents[role]);

/* ── Agents the user adds (name + note; they take no steps) ───────────────── */

export const AGENT_NAME_MAX = 40;
export const AGENT_NOTE_MAX = 140;
/** Speakers that aren't agents but share the name space ("Cosign" referees, "You" decide). */
const RESERVED_NAMES = ["Cosign", "You"];

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The contract's user-added agents for its own case (another case's never show). */
export const customAgentsFor = (
  contract: Pick<Contract, "scenario" | "custom_agents">,
): CustomAgent[] => {
  const id = scenarioOf(contract.scenario).id;
  return (contract.custom_agents ?? []).filter((a) => a.scenario === id);
};

/** Why a name can't be used, or null. A clash would make steps attributable to the wrong agent. */
export function agentNameError(contract: Contract, S: Scenario, name: string): string | null {
  const n = name.trim();
  if (!n) return "Give it a name.";
  if (n.length > AGENT_NAME_MAX) return `Keep the name under ${AGENT_NAME_MAX} characters.`;
  const taken = [
    ...Object.values(S.agents),
    ...RESERVED_NAMES,
    ...customAgentsFor({ ...contract, scenario: S.id }).map((a) => a.name),
  ];
  return taken.some((t) => sameName(t, n)) ? `“${n}” is already on the team.` : null;
}

/** Add an agent to the contract's case. Invalid names leave the contract unchanged. `id` comes from the caller. */
export function withCustomAgent<C extends Contract>(
  contract: C,
  S: Scenario,
  a: { id: string; name: string; note: string },
): C {
  if (agentNameError(contract, S, a.name)) return contract;
  const agent: CustomAgent = {
    id: a.id,
    name: a.name.trim(),
    note: a.note.trim().slice(0, AGENT_NOTE_MAX),
    scenario: S.id,
  };
  return { ...contract, custom_agents: [...(contract.custom_agents ?? []), agent] };
}

export const withoutCustomAgent = <C extends Contract>(contract: C, id: string): C => ({
  ...contract,
  custom_agents: (contract.custom_agents ?? []).filter((a) => a.id !== id),
});
