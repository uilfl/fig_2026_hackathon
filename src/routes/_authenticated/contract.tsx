import { createFileRoute, useBlocker, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, FileText, Minus, Plus, Users, X, type LucideIcon } from "lucide-react";
import { contractQuery, ledgerQuery, profileQuery, versionsQuery } from "@/lib/queries";
import {
  answerKey,
  ASK_LABEL,
  ruleCase,
  ruleFor,
  rulesFor,
  scopeSuggestion,
  SHARE_KEY,
  DATES_KEY,
  type ActionKey,
  type AgentSettings,
  type AskAt,
  type Contract,
  type CustomAgent,
  type Rule,
  type Triggers,
} from "@/lib/engine";
import {
  AGENT_ROLES,
  agentSummary,
  customAgentsFor,
  withCustomAgent,
  withoutCustomAgent,
} from "@/lib/agents";
import { AgentPanel } from "@/components/AgentPanel";
import { NewAgentDialog } from "@/components/NewAgentDialog";
import { NEW_AGENT_TEXT } from "@/components/NewAgentDialog.constants";
import { Avatar } from "@/components/AgentChat";
import {
  contractDiff,
  isHouseRule,
  planPreview,
  signLabel,
  THRESHOLDS,
  THRESHOLD_EXAMPLE,
  type Snapshot,
} from "@/lib/contract";
import { startRun } from "@/lib/run";
import { getState } from "@/lib/store";
import type { Json } from "@/lib/model";
import { latestRun, saveScopeFrom, type Entry } from "@/lib/decisions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/PageHeader";
import { RiskMap } from "@/components/RiskMap";
import {
  answersLabel,
  SCENARIO_LIST,
  scenarioOf,
  scenarioOfRows,
  type AgentRole,
  type ResourceKind,
  type Scenario,
} from "@/lib/scenarios";
import { Chip } from "@/components/Chip";

export const Route = createFileRoute("/_authenticated/contract")({
  head: () => ({
    meta: [
      { title: "Delegation Contract — Cosign" },
      {
        name: "description",
        content:
          "Set the goal, budget and stop-and-ask threshold for your agents, and see what they'll do before you sign.",
      },
      { property: "og:title", content: "Delegation Contract — Cosign" },
      {
        property: "og:description",
        content: "Set policy in plain language and see what your agents will do before signing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { agent?: AgentRole | undefined } => ({
    agent: AGENT_ROLES.find((r) => r === s["agent"]),
  }),
  loader: ({ context }) =>
    Promise.all(
      [contractQuery, ledgerQuery, profileQuery, versionsQuery].map((q) =>
        context.queryClient.ensureQueryData(q as typeof contractQuery),
      ),
    ),
  component: ContractPage,
});

/** `resources` = connected resource ids across cases (each case only reads its own); `custom_agents` likewise. */
type Draft = {
  goal: string;
  headcount: number;
  budget_cap: number;
  triggers: Triggers;
  scenario: string;
  agents: AgentSettings;
  resources: string[];
  custom_agents: CustomAgent[];
};
const RESOURCE_ICON: Record<ResourceKind, LucideIcon> = {
  calendar: CalendarDays,
  requirements: FileText,
  guests: Users,
};
const fmt = (d: string) =>
  new Date(d).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
/** The sentence already says "{lead} … for N {unit}", so the goal token holds only the thing. */
const cleanGoal = (g: string, S: Scenario) =>
  g
    .trim()
    .replace(new RegExp(`^${S.sentence.lead}\\s+`, "i"), "")
    .replace(new RegExp(`\\s+for\\s+\\d+\\s+(${S.sentence.unit}|persons)\\.?$`, "i"), "")
    .replace(/\.$/, "");
/** Which agent assumed the default a rule was kept from. */
/** Same rule slot: one key within one case. */
const sameSlot = (a: Rule, b: Rule) => a.key === b.key && ruleCase(a) === ruleCase(b);
const agentOf = (S: Scenario, key: string) =>
  (
    ({
      [S.requirement.key]: S.agents.venue,
      [DATES_KEY]: S.agents.venue,
      [SHARE_KEY]: S.agents.budget,
    }) as Record<string, string>
  )[key];

function ContractPage() {
  const { data: c } = useSuspenseQuery(contractQuery);
  const { data: ledger } = useSuspenseQuery(ledgerQuery);
  const { data: profile } = useSuspenseQuery(profileQuery);
  const { data: versions } = useSuspenseQuery(versionsQuery);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const saved: Draft = {
    goal: c.goal,
    headcount: c.headcount,
    budget_cap: c.budget_cap,
    triggers: c.triggers,
    scenario: scenarioOf(c.scenario).id,
    agents: c.agents ?? {},
    resources: c.resources ?? [],
    custom_agents: c.custom_agents ?? [],
  };
  const [draft, setDraft] = useState<Draft>(saved);
  const [newAgent, setNewAgent] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [phase, setPhase] = useState<0 | 1 | 2 | 3>(0);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const search = Route.useSearch();
  const [agentOpen, setAgentOpen] = useState<AgentRole | null>(search.agent ?? null);
  useEffect(() => {
    if (search.agent) setAgentOpen(search.agent);
  }, [search.agent]);
  const leaving = useRef(false);
  const sig = (d: Draft) =>
    JSON.stringify([
      d.scenario,
      d.goal,
      d.headcount,
      d.budget_cap,
      d.triggers.ask_at,
      d.triggers.over_budget,
      Object.entries(d.triggers.actions ?? {}).sort(),
      AGENT_ROLES.filter((r) => d.agents[r]?.paused),
      [...d.resources].sort(),
      d.custom_agents.map((a) => a.id),
    ]);
  useEffect(() => setDraft(saved), [sig(saved)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = sig(draft) !== sig(saved);
  const S = scenarioOf(draft.scenario);
  const labels = S.actionLabels;
  const planInput = {
    goal: draft.goal,
    headcount: draft.headcount,
    budget_cap: draft.budget_cap,
    rules: c.rules,
    scenario: draft.scenario,
    agents: draft.agents,
  };

  const blocker = useBlocker({
    shouldBlockFn: ({ next }) => dirty && !leaving.current && next.pathname !== "/contract",
    enableBeforeUnload: () => dirty && !leaving.current,
    withResolver: true,
  });

  function edit(field: string, patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setFlash(field + Date.now());
  }
  const setTriggers = (field: string, t: Partial<Triggers>) =>
    edit(field, { triggers: { ...draft.triggers, ...t } });
  const toggleAction = (k: ActionKey) => {
    const cur = planPreview(draft.triggers, planInput).rows.find((r) => r.key === k)!;
    setTriggers("map", { actions: { ...draft.triggers.actions, [k]: !cur.asks } });
  };
  const toggleResource = (id: string) =>
    edit("resources", {
      resources: draft.resources.includes(id)
        ? draft.resources.filter((x) => x !== id)
        : [...draft.resources, id],
    });
  const clearOverride = (k: ActionKey) => {
    const a = { ...draft.triggers.actions };
    delete a[k];
    setTriggers("map", { actions: a });
  };

  async function writeRules(rules: Rule[]) {
    getState().setContract({ rules });
    await qc.invalidateQueries({ queryKey: ["contract"] });
    return true;
  }
  async function removeRule(r: Rule) {
    const before = c.rules;
    if (await writeRules(before.filter((x) => !sameSlot(x, r))))
      toast("Rule removed", {
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => {
            void writeRules(before);
          },
        },
      });
  }
  async function editRule(r: Rule, label: string) {
    const before = c.rules;
    if (await writeRules(before.map((x) => (sameSlot(x, r) ? { ...x, label } : x))))
      toast("Rule updated", {
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => {
            void writeRules(before);
          },
        },
      });
  }

  const snapshot: Snapshot = { ...draft, rules: c.rules };
  /** The agent panel edits the same contract: rules are written like House rules, the rest goes into the draft. */
  const agentContract: Contract = { ...draft, rules: c.rules };
  async function changeAgent(next: Contract) {
    if (next.rules !== c.rules) await writeRules(next.rules);
    if (next.triggers !== draft.triggers || next.agents !== draft.agents)
      edit("agents", { triggers: next.triggers, agents: next.agents ?? {} });
  }
  /** Your own agents are part of the draft: they join the team when you sign. */
  const addAgent = (a: { name: string; note: string }) => {
    edit("agents", {
      custom_agents:
        withCustomAgent(agentContract, S, { id: crypto.randomUUID(), ...a }).custom_agents ?? [],
    });
    toast.success(NEW_AGENT_TEXT.added(a.name.trim()));
  };
  const removeAgent = (id: string) =>
    edit("agents", { custom_agents: withoutCustomAgent(agentContract, id).custom_agents ?? [] });
  const closeAgent = () => {
    setAgentOpen(null);
    if (search.agent) void navigate({ to: "/contract", search: {}, replace: true });
  };
  const latest = versions[0]
    ? {
        version: versions[0].version,
        snapshot: versions[0].snapshot,
        diff: versions[0].diff,
        signed_at: versions[0].signed_at,
      }
    : null;
  const sign = signLabel(latest, snapshot);
  const preview = planPreview(draft.triggers, planInput);
  /** Only the selected case's rules: another case's rules never apply here. */
  const caseRules = rulesFor({ ...c, scenario: draft.scenario });
  const houseRules = caseRules.filter(isHouseRule);
  const carried = caseRules.filter((r) => !isHouseRule(r));
  const pickCase = (id: string) => {
    if (id !== draft.scenario) edit("case", { scenario: id, ...scenarioOf(id).defaults });
  };

  // runs, oldest first, for provenance and suggestions
  const byRun = new Map<string, Entry[]>();
  for (const e of [...ledger].reverse()) byRun.set(e.run_id, [...(byRun.get(e.run_id) ?? []), e]);
  const runs = [...byRun.values()];
  const runNo = (id: string) => runs.findIndex((r) => r[0]!.run_id === id) + 1;
  const regret = [...ledger].find(
    (e) => e.resolution === "should_have_asked" && !dismissed.includes(e.id),
  );
  const regretKey: ActionKey | null = regret
    ? regret.role === "invites"
      ? "invites"
      : regret.role === "catering"
        ? "catering"
        : regret.role === "deposit"
          ? "deposit"
          : "plan"
    : null;
  const scopeKey = scopeSuggestion([...runs].reverse(), c);
  const lastInvite = runs.at(-1)?.find((e) => e.kind === "send" && e.source === "approved");

  async function signAndRun() {
    try {
      setPhase(1);
      getState().setContract(draft);
      if (sign.changed)
        getState().addVersion({
          version: sign.next,
          snapshot: snapshot as unknown as Json,
          diff: contractDiff(latest?.snapshot ?? null, snapshot),
        });
      leaving.current = true;
      setPhase(2);
      await startRun();
      setPhase(3);
      await Promise.all(
        ["contract", "ledger", "contract_versions"].map((k) =>
          qc.invalidateQueries({ queryKey: [k] }),
        ),
      );
      setTimeout(() => navigate({ to: "/run" }), 400);
    } catch (e) {
      leaving.current = false;
      setPhase(0);
      toast.error(e instanceof Error ? e.message : "Run failed");
    }
  }

  const tok = (name: string) => `token-${name}`;
  return (
    <div className="pb-28">
      <PageHeader
        eyebrow={`${profile?.team || "Your team"} · Contract`}
        title="Brief your agents"
        aside={
          <button
            onClick={() => setDrawer(true)}
            className="font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            aria-label="Open version history"
          >
            {latest
              ? `Contract v${latest.version} · last signed ${fmt(latest.signed_at)}`
              : "Draft · not signed yet"}
            {dirty && <span className="ml-2 text-accent">• Unsaved changes</span>}
          </button>
        }
        subtitle="Tap any underlined part to change it. Nothing applies until you sign."
      />

      <section className="mt-8" aria-labelledby="case-h" data-tour="case">
        <h2 id="case-h" className="font-mono text-xs uppercase text-muted-foreground">
          Demo case
        </h2>
        <div role="radiogroup" aria-labelledby="case-h" className="mt-2 grid gap-3 sm:grid-cols-2">
          {SCENARIO_LIST.map((x) => {
            const on = x.id === draft.scenario;
            return (
              <button
                key={x.id}
                role="radio"
                aria-checked={on}
                onClick={() => pickCase(x.id)}
                className={`flex flex-col items-start gap-1 border bg-card p-4 text-left focus-visible:outline-2 focus-visible:outline-ring ${on ? "border-foreground ring-1 ring-foreground" : "border-border hover:border-foreground"}`}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="font-display text-xl">{x.title}</span>
                  {on && <span className="stamp text-muted-foreground">Selected</span>}
                </span>
                <span className="text-sm text-muted-foreground">{x.blurb}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {AGENT_ROLES.map((a) => x.agents[a]).join(" · ")}
                </span>
              </button>
            );
          })}
        </div>
        {draft.scenario !== saved.scenario && (
          <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
            Switched to {S.title}: the brief below uses its defaults. Sign to run it.
          </p>
        )}
      </section>

      <div className="mt-8 grid gap-8 min-[1100px]:grid-cols-[1fr_400px]">
        <div className="min-w-0">
          <p
            data-tour="sentence"
            className="border border-border bg-card p-6 font-display text-2xl leading-[2] sm:text-3xl"
          >
            {S.sentence.lead}{" "}
            <TextToken
              id={tok("goal")}
              flash={flash?.startsWith("goal")}
              label="Goal"
              value={cleanGoal(draft.goal, S)}
              onSave={(goal) => edit("goal", { goal: cleanGoal(goal, S) })}
            />{" "}
            for{" "}
            <Token
              label={`Headcount: ${draft.headcount}`}
              display={String(draft.headcount)}
              flash={flash?.startsWith("headcount")}
            >
              {() => (
                <Stepper
                  value={draft.headcount}
                  onChange={(headcount) => edit("headcount", { headcount })}
                />
              )}
            </Token>{" "}
            {S.sentence.unit}. Spend no more than{" "}
            <MoneyToken
              flash={flash?.startsWith("budget")}
              value={draft.budget_cap}
              onSave={(budget_cap) => edit("budget", { budget_cap })}
            />{" "}
            and{" "}
            <Token
              label={`Over budget: ${draft.triggers.over_budget ? "check with me" : "going over is fine"}`}
              display={
                draft.triggers.over_budget
                  ? "check with me before going over"
                  : "going over is fine"
              }
              flash={flash?.startsWith("over")}
            >
              {(close) => (
                <Options
                  value={String(draft.triggers.over_budget)}
                  options={[
                    ["true", "Check with me before going over", "The run pauses at the cap"],
                    ["false", "Going over is fine", "Agents may exceed the cap"],
                  ]}
                  onPick={(v) => {
                    setTriggers("over", { over_budget: v === "true" });
                    close();
                  }}
                />
              )}
            </Token>
            .{" "}
            <Token
              label={`Ask threshold: ${ASK_LABEL[draft.triggers.ask_at]}`}
              display={ASK_LABEL[draft.triggers.ask_at]}
              flash={flash?.startsWith("ask") || flash?.startsWith("map")}
            >
              {(close) => (
                <Options
                  value={draft.triggers.ask_at}
                  options={THRESHOLDS.map(
                    (t) => [t, ASK_LABEL[t], THRESHOLD_EXAMPLE[t]] as [string, string, string],
                  )}
                  onPick={(v) => {
                    setTriggers("ask", { ask_at: v as AskAt });
                    close();
                  }}
                />
              )}
            </Token>
            .
          </p>

          <section className="mt-12" aria-labelledby="agents-h" data-tour="agents">
            <h2 id="agents-h" className="text-2xl">
              Your agents
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              What each agent decides on its own. Open one to set its instructions, what it may do
              without asking, or pause it. You can also add your own.
            </p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-3">
              {AGENT_ROLES.map((r) => (
                <li key={r}>
                  <button
                    onClick={() => setAgentOpen(r)}
                    className={`flex h-full w-full flex-col items-start gap-2 border bg-card p-4 text-left hover:border-foreground focus-visible:outline-2 focus-visible:outline-ring ${draft.agents[r]?.paused ? "border-src-pending" : "border-border"}`}
                    aria-label={`Configure ${S.agents[r]}`}
                  >
                    <span className="flex items-center gap-2">
                      <Avatar who={S.agents[r]} S={S} />
                      <span className="font-medium">{S.agents[r]}</span>
                    </span>
                    <span className="text-sm text-muted-foreground">{S.jobs[r]}</span>
                    <span className="mt-auto text-xs">{agentSummary(agentContract, S, r)}</span>
                  </button>
                </li>
              ))}
              {customAgentsFor(agentContract).map((a) => (
                <li
                  key={a.id}
                  className="flex h-full flex-col items-start gap-2 border border-border bg-card p-4"
                >
                  <span className="flex items-center gap-2">
                    <Avatar who={a.name} S={S} />
                    <span className="font-medium">{a.name}</span>
                  </span>
                  {a.note && <span className="text-sm text-muted-foreground">{a.note}</span>}
                  <span className="mt-auto flex w-full items-center justify-between gap-2 text-xs text-muted-foreground">
                    {NEW_AGENT_TEXT.noSteps}
                    <button
                      type="button"
                      onClick={() => removeAgent(a.id)}
                      aria-label={NEW_AGENT_TEXT.removeLabel(a.name)}
                      className="underline underline-offset-4 hover:text-foreground"
                    >
                      {NEW_AGENT_TEXT.remove}
                    </button>
                  </span>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => setNewAgent(true)}
                  className="flex h-full min-h-28 w-full flex-col items-center justify-center gap-1 border border-dashed border-border p-4 text-center hover:border-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="font-medium">{NEW_AGENT_TEXT.card}</span>
                  <span className="text-xs text-muted-foreground">{NEW_AGENT_TEXT.cardHint}</span>
                </button>
              </li>
            </ul>
          </section>
          <NewAgentDialog
            open={newAgent}
            onOpenChange={setNewAgent}
            contract={agentContract}
            S={S}
            onCreate={addAgent}
          />

          <section className="mt-12" aria-labelledby="resources-h">
            <h2 id="resources-h" className="text-2xl">
              Connected resources
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Let a calendar, brief or guest list answer what agents would otherwise assume. Your
              rules still come first. Applies when you sign.
            </p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-3">
              {S.resources.map((r) => {
                const on = draft.resources.includes(r.id);
                const Icon = RESOURCE_ICON[r.kind];
                const ruled = ruleFor({ ...c, scenario: draft.scenario }, answerKey(S, r));
                return (
                  <li key={r.id}>
                    <button
                      role="switch"
                      aria-checked={on}
                      onClick={() => toggleResource(r.id)}
                      className={`flex h-full w-full flex-col items-start gap-2 border bg-card p-4 text-left hover:border-foreground focus-visible:outline-2 focus-visible:outline-ring ${on ? "border-src-resource ring-1 ring-src-resource" : "border-dashed border-border"}`}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="flex items-center gap-2 font-medium">
                          <Icon className="h-4 w-4 text-src-resource" aria-hidden />
                          {r.name}
                        </span>
                        {on ? (
                          <Chip kind="resource">Connected</Chip>
                        ) : (
                          <span className="stamp text-muted-foreground">Connect</span>
                        )}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        Answers {answersLabel(S, r.kind)}.
                      </span>
                      <span className="mt-auto text-xs">“{r.evidence}”</span>
                      {on && ruled && (
                        <span className="text-xs text-muted-foreground">
                          Your rule for this comes first: {ruled.label}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="mt-12" aria-labelledby="rules-h">
            <h2 id="rules-h" className="text-2xl">
              House rules
            </h2>
            {houseRules.length === 0 ? (
              <div className="mt-4 flex flex-col items-start gap-4 border border-dashed border-border p-6 text-sm text-muted-foreground sm:flex-row sm:items-center">
                <span className="flex shrink-0 items-center gap-2" aria-hidden>
                  <Chip kind="default">Default</Chip>
                  <span>→</span>
                  <Chip kind="contract">Rule</Chip>
                </span>
                <p>
                  No rules yet. When agents assume something nobody chose, you'll decide here: keep
                  it as a rule, use it once, or override it.
                </p>
              </div>
            ) : (
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {houseRules.map((r) => (
                  <RuleCard
                    key={`${ruleCase(r)}:${r.key}`}
                    r={r}
                    ledger={ledger}
                    runs={runs}
                    runNo={runNo}
                    agent={r.kind === "scope" ? S.agents.invites : (agentOf(S, r.key) ?? "Agents")}
                    onRemove={() => removeRule(r)}
                    onEdit={(l) => editRule(r, l)}
                  />
                ))}
              </ul>
            )}
            {carried.length > 0 && (
              <p className="mt-4 font-mono text-xs text-muted-foreground">
                Carried from your last run:{" "}
                {carried.map((r, i) => (
                  <span key={r.key}>
                    {i ? " · " : ""}
                    {typeof r.value === "string" ? r.value : r.label}{" "}
                    <button
                      aria-label={`Stop carrying ${typeof r.value === "string" ? r.value : r.label}`}
                      className="underline"
                      onClick={() => removeRule(r)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </p>
            )}
          </section>
        </div>

        <aside
          className="min-[1100px]:sticky min-[1100px]:top-6 min-[1100px]:self-start"
          aria-labelledby="wwh"
        >
          <div className="border border-border bg-card p-5" data-tour="risk-map">
            <p id="wwh" className="font-mono text-xs uppercase text-muted-foreground">
              What will happen
            </p>
            <h2 className="mt-1 text-xl" aria-live="polite">
              {preview.header}
            </h2>
            <div className="mt-3">
              <RiskMap
                triggers={draft.triggers}
                plan={planInput}
                onThreshold={(a) => setTriggers("map", { ask_at: a })}
                onToggle={toggleAction}
              />
            </div>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              Drag the edge to move the threshold. Tap a dot to override it.
            </p>
            {(Object.keys(draft.triggers.actions ?? {}) as ActionKey[]).some(
              (k) => draft.triggers.actions?.[k] != null,
            ) || houseRules.some((r) => r.kind === "scope") ? (
              <ul className="mt-3 space-y-1 text-sm" aria-label="Overrides">
                <li className="font-mono text-xs uppercase text-muted-foreground">Overrides</li>
                {(Object.keys(draft.triggers.actions ?? {}) as ActionKey[])
                  .filter((k) => draft.triggers.actions?.[k] != null)
                  .map((k) => (
                    <li key={k} className="flex items-center justify-between gap-2 rise-in">
                      <span>
                        {labels[k]} → {draft.triggers.actions![k] ? "asks you" : "goes ahead"}
                      </span>
                      <button
                        aria-label={`Remove override for ${labels[k]}`}
                        onClick={() => clearOverride(k)}
                        className="p-1 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                {houseRules
                  .filter((r) => r.kind === "scope")
                  .map((r) => (
                    <li key={r.key} className="text-muted-foreground">
                      Invites → goes ahead while recipients and message match (saved scope)
                    </li>
                  ))}
              </ul>
            ) : null}
            <p className="mt-4 border-t border-border pt-3 text-sm" aria-live="polite">
              {preview.summary}
            </p>
            {regret && regretKey && !draft.triggers.actions?.[regretKey] && (
              <div className="mt-4 border-l-2 border-accent bg-secondary p-3 text-sm rise-in">
                <p>
                  In Run {runNo(regret.run_id)} you said “{regret.action}” should have asked you.
                  Tighten?
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setTriggers("map", {
                        actions: { ...draft.triggers.actions, [regretKey]: true },
                      })
                    }
                  >
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDismissed([...dismissed, regret.id])}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            )}
            {scopeKey && lastInvite && (
              <div className="mt-4 border-l-2 border-src-approved bg-secondary p-3 text-sm">
                <p>
                  You approved “{labels[scopeKey]}” in your last 2 runs with no regrets. Save a
                  scoped approval? Anything different still asks.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={async () => {
                    await saveScopeFrom(lastInvite, c);
                    qc.invalidateQueries({ queryKey: ["contract"] });
                  }}
                >
                  Save scoped approval
                </Button>
              </div>
            )}
          </div>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur md:left-[180px]">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3 px-6 py-3">
          <p className="font-mono text-xs text-muted-foreground">
            {preview.asking} action{preview.asking === 1 ? "" : "s"} will ask you ·{" "}
            {houseRules.length} rule{houseRules.length === 1 ? "" : "s"} · $
            {draft.budget_cap.toLocaleString()} cap
          </p>
          {phase === 0 ? (
            <Button variant="stamp" size="lg" onClick={signAndRun} data-tour="sign">
              {sign.label}
            </Button>
          ) : (
            <Progress phase={phase} />
          )}
        </div>
      </div>

      <AgentPanel
        role={agentOpen}
        onClose={closeAgent}
        S={S}
        contract={agentContract}
        run={scenarioOfRows(latestRun(ledger)).id === S.id ? latestRun(ledger) : []}
        onChange={(n) => {
          void changeAgent(n);
        }}
      />
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Contract versions</SheetTitle>
            <SheetDescription>Every signed version and what changed.</SheetDescription>
          </SheetHeader>
          <ol className="mt-6 space-y-5 px-4">
            {dirty || sign.changed ? (
              <li className="border-l-2 border-accent pl-3">
                <p className="font-mono text-xs uppercase text-accent">
                  Unsigned draft → v{sign.next}
                </p>
                <ul className="mt-1 text-sm">
                  {contractDiff(latest?.snapshot ?? null, snapshot).map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </li>
            ) : null}
            {versions.map((v) => (
              <li key={v.id} className="border-l-2 border-border pl-3">
                <p className="font-mono text-xs uppercase text-muted-foreground">
                  v{v.version} · {fmt(v.signed_at)}
                </p>
                <ul className="mt-1 text-sm">
                  {v.diff.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </li>
            ))}
            {!versions.length && !dirty && (
              <li className="text-sm text-muted-foreground">Not signed yet.</li>
            )}
          </ol>
        </SheetContent>
      </Sheet>

      <AlertDialog open={blocker.status === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes to the contract?</AlertDialogTitle>
            <AlertDialogDescription>Your edits haven't been signed yet.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => blocker.proceed?.()}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const STEPS = ["Signing", "Agents planning", "Ready"];
function Progress({ phase }: { phase: number }) {
  return (
    <div
      className="flex w-full max-w-md items-center gap-2 sm:w-auto"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={3}
      aria-valuenow={phase}
      aria-valuetext={STEPS[phase - 1]}
    >
      {STEPS.map((s, i) => (
        <div key={s} className="min-w-0 flex-1 sm:w-32">
          <div className="h-1.5 bg-muted">
            <div
              className={`h-full bg-accent transition-all duration-300 ease-out ${i + 1 < phase ? "w-full" : i + 1 === phase ? "w-2/3 animate-pulse" : "w-0"}`}
            />
          </div>
          <p
            className={`mt-1 font-mono text-[10px] uppercase ${i + 1 <= phase ? "text-foreground" : "text-muted-foreground"}`}
          >
            {s}
          </p>
        </div>
      ))}
    </div>
  );
}

const tokenCls =
  "cursor-pointer rounded-sm border-b-2 border-dashed border-accent px-1 text-accent outline-none transition-colors duration-150 ease-out hover:bg-accent/10 focus-visible:bg-accent/10 focus-visible:outline-2 focus-visible:outline-ring";
function Token({
  label,
  display,
  flash,
  children,
}: {
  label: string;
  display: string;
  flash?: boolean | undefined;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label} — edit`}
          className={`${tokenCls} ${flash ? "token-flash" : ""}`}
        >
          {display}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 font-sans text-base">
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}
function TextToken({
  id,
  label,
  value,
  onSave,
  flash,
}: {
  id: string;
  label: string;
  value: string;
  onSave: (v: string) => void;
  flash?: boolean | undefined;
}) {
  const [v, setV] = useState(value);
  return (
    <Token label={`${label}: ${value}`} display={value} flash={flash}>
      {(close) => (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (v.trim()) {
              onSave(v.trim());
              close();
            }
          }}
          onReset={() => {
            setV(value);
            close();
          }}
        >
          <label htmlFor={id} className="font-mono text-xs uppercase text-muted-foreground">
            {label}
          </label>
          <Input
            id={id}
            autoFocus
            maxLength={80}
            value={v}
            onChange={(e) => setV(e.target.value)}
            onFocus={() => setV(value)}
            className="mt-1"
          />
          <p className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>Enter to save · Esc to cancel</span>
            <span>{v.length}/80</span>
          </p>
        </form>
      )}
    </Token>
  );
}
function MoneyToken({
  value,
  onSave,
  flash,
}: {
  value: number;
  onSave: (v: number) => void;
  flash?: boolean | undefined;
}) {
  const [v, setV] = useState(value.toLocaleString());
  return (
    <Token
      label={`Budget cap: $${value.toLocaleString()}`}
      display={`$${value.toLocaleString()}`}
      flash={flash}
    >
      {(close) => (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(v.replace(/[^\d]/g, ""));
            if (n > 0) {
              onSave(n);
              close();
            }
          }}
        >
          <label htmlFor="budget-in" className="font-mono text-xs uppercase text-muted-foreground">
            Budget cap
          </label>
          <div className="mt-1 flex items-center gap-1">
            <span>$</span>
            <Input
              id="budget-in"
              autoFocus
              inputMode="numeric"
              value={v}
              onFocus={() => setV(value.toLocaleString())}
              onChange={(e) => {
                const n = e.target.value.replace(/[^\d]/g, "");
                setV(n ? Number(n).toLocaleString() : "");
              }}
            />
          </div>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            Enter to save · Esc to cancel
          </p>
        </form>
      )}
    </Token>
  );
}
function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const set = (n: number) => onChange(Math.min(200, Math.max(1, n)));
  return (
    <div>
      <p className="font-mono text-xs uppercase text-muted-foreground">People</p>
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="icon"
          variant="outline"
          aria-label="Fewer people"
          onClick={() => set(value - 1)}
          disabled={value <= 1}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Input
          aria-label="Headcount"
          type="number"
          min={1}
          max={200}
          className="w-20 text-center"
          value={value}
          onChange={(e) => set(Number(e.target.value) || 1)}
        />
        <Button
          size="icon"
          variant="outline"
          aria-label="More people"
          onClick={() => set(value + 1)}
          disabled={value >= 200}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <p className="mt-1 font-mono text-[10px] text-muted-foreground">1–200</p>
    </div>
  );
}
function Options({
  value,
  options,
  onPick,
}: {
  value: string;
  options: [string, string, string][];
  onPick: (v: string) => void;
}) {
  return (
    <div role="radiogroup" className="space-y-1">
      {options.map(([v, l, ex]) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          onClick={() => onPick(v)}
          className={`flex w-full items-start gap-2 px-2 py-1.5 text-left text-sm ${value === v ? "bg-secondary" : "hover:bg-muted"}`}
        >
          <span
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${value === v ? "bg-accent" : "bg-border"}`}
          />
          <span>
            <span className="block">{l}</span>
            <span className="block font-mono text-[10px] text-muted-foreground">{ex}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function RuleCard({
  r,
  ledger,
  runs,
  runNo,
  agent,
  onRemove,
  onEdit,
}: {
  r: Rule;
  ledger: Entry[];
  runs: Entry[][];
  runNo: (id: string) => number;
  agent: string;
  onRemove: () => void;
  onEdit: (label: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(r.label);
  const [gone, setGone] = useState(false);
  const scope = r.kind === "scope";
  const origin = scope
    ? [...ledger].reverse().find((e) => e.kind === "send" && e.source === "approved")
    : [...ledger].reverse().find((e) => e.default_key === r.key && e.resolution === "keep");
  const from = origin
    ? `From Run ${runNo(origin.run_id)} · ${scope ? "you approved the invites · saved as a scope" : `${origin.agent} assumed it · you kept it`}`
    : "Added by you";
  const applied = runs.filter((rows) =>
    rows.some((e) =>
      scope
        ? (e.preview as { saved_scope?: boolean } | null)?.saved_scope
        : ((e.criteria as { key: string; source: string }[] | null) ?? []).some(
            (x) => x.key === r.key && x.source === "rule",
          ),
    ),
  ).length;
  return (
    <li
      className={`border-l-4 border-src-contract bg-card p-4 shadow-sm transition-all duration-200 ease-out ${gone ? "scale-95 opacity-0" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Chip kind="contract">{scope ? "Saved scope" : "Rule"}</Chip>
        <span className="stamp text-muted-foreground">{agent}</span>
      </div>
      {editing ? (
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (v.trim()) {
              onEdit(v.trim());
              setEditing(false);
            }
          }}
        >
          <Input
            autoFocus
            aria-label="Rule text"
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setV(r.label);
                setEditing(false);
              }
            }}
          />
        </form>
      ) : (
        <p className="mt-2 font-display text-xl">{r.label}</p>
      )}
      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
        {from} · Applied in {applied} run{applied === 1 ? "" : "s"}
      </p>
      <div className="mt-2 flex gap-3">
        {!scope && (
          <Button variant="ghost" size="sm" className="px-0" onClick={() => setEditing(!editing)}>
            {editing ? "Cancel" : "Edit"}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="px-0"
          onClick={() => {
            setGone(true);
            setTimeout(onRemove, 200);
          }}
        >
          Remove
        </Button>
      </div>
    </li>
  );
}
