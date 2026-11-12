import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { contractQuery, ledgerQuery, type ContractRow } from "@/lib/queries";
import {
  latestRun,
  isOpenDefault,
  isOpenConflict,
  awaitingAlternative,
  applyChoice,
  type Entry,
} from "@/lib/decisions";
import {
  CommitCard,
  DecisionCard,
  DeclinePanel,
  DefaultResolver,
  useRefresh,
} from "@/components/Ledger";
import { DecisionMap, HoverCard, NODE_ORDER_PRESENT } from "@/components/DecisionMap";
import { UNDO_TOAST_MS } from "@/lib/run.constants";
import { forRun, isCommitStep, venueBudgetFor } from "@/lib/engine";
import {
  agentRole,
  agentShort,
  scenarioOfRows,
  type AgentRole,
  type Scenario,
} from "@/lib/scenarios";
import { AgentPanel } from "@/components/AgentPanel";
import {
  alsoSettles,
  deriveOpenItems,
  impactOf,
  nodeKeyOf,
  nodeValue,
  previewDiff,
  previewRun,
  type NodeKey,
} from "@/lib/map";
import { startRun } from "@/lib/run";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { AgentChat } from "@/components/AgentChat";
import { useAgentActivity } from "@/lib/settings";

export const Route = createFileRoute("/_authenticated/run")({
  head: () => ({
    meta: [
      { title: "Run — Cosign" },
      {
        name: "description",
        content:
          "A map of the latest run's decisions: who decided each one, what it affects, and what's waiting on you.",
      },
      { property: "og:title", content: "Run — Cosign" },
      {
        property: "og:description",
        content:
          "A map of the latest run's decisions: who decided each one, what it affects, and what's waiting on you.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { node?: string } =>
    typeof s["node"] === "string" ? { node: s["node"] } : {},
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(ledgerQuery),
      context.queryClient.ensureQueryData(contractQuery),
    ]),
  component: RunPage,
});

type Try = { step: Entry; value: string };
const TRYABLE: NodeKey[] = ["split", "venue", "dates"];

function RunPage() {
  const { data: all } = useSuspenseQuery(ledgerQuery);
  const { data: contract } = useSuspenseQuery(contractQuery);
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/run" });
  const refresh = useRefresh();
  const qc = useQueryClient();
  const [activity] = useAgentActivity();
  const [hoverKey, setHoverKey] = useState<NodeKey | null>(null);
  const [trying, setTrying] = useState<Try | null>(null);
  const [tryOpen, setTryOpen] = useState(false);
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(0);
  const [choiceHover, setChoiceHover] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<(() => void) | null>(null);
  const [cardFlash, setCardFlash] = useState<NodeKey | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [agentOpen, setAgentOpen] = useState<AgentRole | null>(null);

  const run = latestRun(all);
  const S = scenarioOfRows(run);
  const titles = S.titles;
  /** Open the (read-only) settings of an agent by display name; "You" and "Cosign" aren't agents. */
  const onAgent = (name: string) => {
    const r = agentRole(S, name);
    if (r) setAgentOpen(r);
  };
  const live = useMemo(() => run.filter((e) => e.status !== "superseded"), [run]);
  const nodes = useMemo(() => {
    const m = new Map<NodeKey, Entry>();
    for (const e of live) {
      const k = nodeKeyOf(e);
      if (k) m.set(k, e);
    }
    return m;
  }, [live]);
  const order = NODE_ORDER_PRESENT(nodes);
  const selected = order.includes(search.node as NodeKey) ? (search.node as NodeKey) : undefined;
  const sel = selected ? nodes.get(selected) : undefined;
  const impact = sel ? impactOf(sel.seq, live) : null;
  const lit =
    sel && impact
      ? new Set<NodeKey>([
          selected!,
          ...impact.keys,
          ...(selected === "split" && nodes.has("conflict") ? ["conflict" as NodeKey] : []),
        ])
      : null;

  // Preview is a pure in-memory dry run: nothing is written until "Use this" or "Make it a rule".
  const fresh = useMemo(
    () => (trying ? previewRun(live, contract, trying.step, trying.value) : null),
    [trying, contract, live],
  );
  const dry = useMemo(() => (fresh ? previewDiff(live, fresh) : null), [fresh, live]);
  const openState = useMemo(() => deriveOpenItems(live, fresh), [live, fresh]);
  const resolvedPv = new Set(openState.items.filter((i) => i.resolvedInPreview).map((i) => i.id));
  const resolvedPvKeys = new Set(
    openState.items.filter((i) => i.resolvedInPreview).map((i) => i.key),
  );
  const openKeys = new Set(openState.items.map((i) => i.key));

  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => !!trying && current.pathname !== next.pathname,
    enableBeforeUnload: () => !!trying,
    withResolver: true,
  });
  const guard = (fn: () => void) => (trying ? setConfirm(() => fn) : fn());

  const doSelect = (k: NodeKey | undefined) => {
    setTrying(null);
    setTryOpen(false);
    setFlash((f) => f + 1);
    navigate({ search: k ? { node: k } : {}, replace: true });
    if (k) {
      setCardFlash(k);
      requestAnimationFrame(() =>
        panelRef.current
          ?.querySelector(`[data-card="${k}"]`)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      );
      setTimeout(() => setCardFlash((c) => (c === k ? null : c)), 1000);
    }
  };
  const select = (k: NodeKey | undefined) =>
    trying && k !== selected ? guard(() => doSelect(k)) : doSelect(k);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if ((ev.target as HTMLElement)?.closest("input, textarea, [role=dialog], [role=alertdialog]"))
        return;
      if (ev.key === "Escape") {
        if (trying) setTrying(null);
        else doSelect(undefined);
      } else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
        const i = selected ? order.indexOf(selected) : -1;
        const n = ev.key === "ArrowRight" ? Math.min(order.length - 1, i + 1) : Math.max(0, i - 1);
        select(order[n]);
        ev.preventDefault();
        requestAnimationFrame(() =>
          (document.querySelector(`[data-node="${order[n]}"]`) as HTMLElement | null)?.focus(),
        );
      } else if (
        ev.key === "Enter" &&
        sel &&
        TRYABLE.includes(selected!) &&
        (sel.source === "default" || sel.source === "user") &&
        !(ev.target as HTMLElement)?.closest("button:not([data-node])")
      ) {
        setTryOpen(true);
        ev.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function newRun() {
    setBusy(true);
    try {
      await startRun();
      await qc.invalidateQueries({ queryKey: ["ledger"] });
      navigate({ search: {}, replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Run failed");
    } finally {
      setBusy(false);
    }
  }

  if (!run.length)
    return (
      <div className="py-24 text-center">
        <h1 className="text-5xl">No run yet.</h1>
        <Link to="/contract">
          <Button className="mt-8">Set the contract</Button>
        </Link>
      </div>
    );

  async function apply(t: Try, asRule: boolean) {
    setBusy(true);
    try {
      const settles = 1 + alsoSettles(live, contract, t.step, t.value).length;
      const r = await applyChoice(t.step, t.value, asRule, contract, all);
      setTrying(null);
      setTryOpen(false);
      refresh();
      const msg = `Settled ${settles} item${settles === 1 ? "" : "s"}${asRule ? " · added as a house rule" : ` · ${r.replaced} step${r.replaced === 1 ? "" : "s"} re-planned`}`;
      toast.success(msg, {
        duration: UNDO_TOAST_MS,
        action: {
          label: "Undo",
          onClick: async () => {
            await r.undo();
            refresh();
            toast("Undone");
          },
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const conflicts = live.filter(isOpenConflict);
  const defaults = live.filter(isOpenDefault);
  const declined = live.filter(awaitingAlternative);
  const waitingOnDecline = (e: Entry) =>
    e.depends_on != null && declined.some((d) => d.seq === e.depends_on);
  const commit = live.filter((e) => isCommitStep(e) && !waitingOnDecline(e));
  const otherPending = live.filter(
    (e) => e.status === "pending" && !isCommitStep(e) && !isOpenConflict(e),
  );
  // While the agents disagree the venue is undecided, so its default card waits behind the conflict.
  const shownDefaults = defaults.filter((e) => !(conflicts.length && nodeKeyOf(e) === "venue"));
  const needCount =
    [...conflicts, ...shownDefaults].filter((e) => !resolvedPv.has(e.id)).length +
    declined.length +
    otherPending.length +
    (commit.length ? 1 : 0);
  const noLive = live.length === 0;
  const jump = (e: Entry) => {
    const k = nodeKeyOf(e);
    if (k) select(k === "venue" && conflicts.length ? "conflict" : k);
  };
  const cardProps = (e: Entry) => {
    const k = nodeKeyOf(e);
    return {
      "data-card": k ?? undefined,
      onMouseEnter: () => setHoverKey(k),
      onMouseLeave: () => setHoverKey(null),
      onClick: (ev: React.MouseEvent) => {
        if (!(ev.target as HTMLElement).closest("button, a, [role=checkbox], label")) jump(e);
      },
      className: `transition-[box-shadow] duration-300 ease-out ${cardFlash && k === cardFlash ? "ring-2 ring-accent ring-offset-2 ring-offset-background" : ""}`,
    };
  };
  const settlesText = (e: Entry, v: string) => {
    const s = alsoSettles(live, contract, e, v);
    return s.length ? `Also settles: ${s.map((x) => x.label).join(", ")}` : null;
  };
  const venueShare = `$${venueBudgetFor(forRun(contract, run)).amount.toLocaleString()}`;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-4xl">Run</h1>
        <Link
          to="/ledger"
          className="font-mono text-xs uppercase text-muted-foreground underline underline-offset-4"
        >
          Receipt
        </Link>
      </div>
      <div className="mt-6 grid gap-8 min-[1100px]:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Decision map" className="min-w-0">
          {noLive ? (
            <div className="border border-dashed border-border p-10 text-center">
              <p className="text-2xl font-display">This run has no active steps.</p>
              <Button className="mt-6" disabled={busy} onClick={newRun}>
                {busy ? "Agents are talking…" : "Start a new run"}
              </Button>
            </div>
          ) : (
            <>
              <div
                aria-live="polite"
                className={`z-20 min-h-12 border-y border-border bg-background py-2 text-sm ${trying || tryOpen ? "sticky top-0" : ""}`}
              >
                {dry && trying ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <strong>Preview — nothing saved yet:</strong> {dry.count} decision
                      {dry.count === 1 ? "" : "s"} change · {dry.moneyDelta >= 0 ? "+" : "−"}$
                      {Math.abs(dry.moneyDelta).toLocaleString()} · {dry.venue} chosen
                      {resolvedPv.size
                        ? ` · resolves ${resolvedPv.size} open item${resolvedPv.size === 1 ? "" : "s"}`
                        : ""}
                    </span>
                    <span className="flex gap-2">
                      <Button size="sm" disabled={busy} onClick={() => apply(trying, false)}>
                        Use this, just this run
                      </Button>
                      {trying.step.criterion !== "venue_conflict" && (
                        <Button
                          size="sm"
                          variant="stamp"
                          disabled={busy}
                          onClick={() => apply(trying, true)}
                        >
                          Make it a rule
                        </Button>
                      )}
                      <Button size="sm" variant="link" onClick={() => setTrying(null)}>
                        Discard
                      </Button>
                    </span>
                  </div>
                ) : sel && impact ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      This{" "}
                      {selected === "split"
                        ? `“${nodeValue(sel)}” split`
                        : `${titles[selected!].toLowerCase()} choice`}{" "}
                      shapes {impact.count} decision{impact.count === 1 ? "" : "s"} · $
                      {impact.money.toLocaleString()} committed
                      {impact.people ? ` · ${impact.people} people emailed` : ""}
                    </span>
                    {TRYABLE.includes(selected!) &&
                      (sel.source === "default" || sel.source === "user") && (
                        <Button size="sm" variant="outline" onClick={() => setTryOpen(!tryOpen)}>
                          Try another option
                        </Button>
                      )}
                  </div>
                ) : (
                  <span className="text-muted-foreground">
                    Select a decision to see who made it and what it affects.
                  </span>
                )}
                {tryOpen && sel && (
                  <TryOptions
                    S={S}
                    headcount={contract.headcount}
                    e={sel}
                    k={selected!}
                    current={trying?.value}
                    onPick={(v) => setTrying({ step: sel, value: v })}
                  />
                )}
                {sel && !trying && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer font-mono uppercase text-muted-foreground">
                      Who decided this?
                    </summary>
                    <div className="mt-2 max-w-md border border-border bg-card p-3">
                      <HoverCard e={sel} />
                    </div>
                  </details>
                )}
              </div>
              <div className="mt-4">
                <DecisionMap
                  nodes={nodes}
                  ghosts={history ? run.filter((e) => e.status === "superseded") : []}
                  selected={selected}
                  onSelect={(k) => select(k === selected ? undefined : k)}
                  highlight={hoverKey}
                  lit={lit}
                  changes={dry?.changes ?? null}
                  onClear={() => {
                    setTrying(null);
                    doSelect(undefined);
                  }}
                  flash={flash}
                  tentative={openState.tentative}
                  openKeys={openKeys}
                  resolvedInPreview={resolvedPvKeys}
                  choiceHover={choiceHover}
                  setChoiceHover={setChoiceHover}
                  settledConflict={nodes.get("conflict")?.status === "done"}
                  venueShare={venueShare}
                />
              </div>
              <Timeline
                S={S}
                onAgent={onAgent}
                run={run}
                onPick={(k) => select(k)}
                onHover={setHoverKey}
                history={history}
                setHistory={setHistory}
              />
            </>
          )}
          {activity && !noLive && (
            <div className="mt-8 border border-border bg-background p-5">
              <p className="mb-4 font-mono text-xs uppercase text-muted-foreground">
                Agent channel · #{S.id}
              </p>
              <AgentChat
                key={run[0]!.run_id}
                run={live}
                animate={Date.now() - new Date(run[0]!.created_at).getTime() < 30000}
              />
            </div>
          )}
        </section>
        <aside
          ref={panelRef}
          aria-label="Waiting on you"
          data-tour="waiting"
          className="space-y-4 min-[1100px]:sticky min-[1100px]:top-6 min-[1100px]:max-h-[calc(100vh-48px)] min-[1100px]:self-start min-[1100px]:overflow-y-auto min-[1100px]:pr-1"
        >
          <h2 className="text-2xl">Waiting on you · {needCount}</h2>
          {noLive && <p className="text-muted-foreground">This run has no active steps.</p>}
          {!noLive && needCount === 0 && (
            <p className="text-muted-foreground">
              All set. Agents are finishing up.{" "}
              <Link to="/ledger" className="underline underline-offset-4">
                See the receipt
              </Link>
            </p>
          )}
          {conflicts.map((e, i) => (
            <section
              key={e.id}
              data-tour={i === 0 ? "conflict" : undefined}
              role="region"
              aria-labelledby={`h-${e.id}`}
              {...cardProps(e)}
            >
              <ConflictCard
                S={S}
                onAgent={onAgent}
                e={e}
                busy={busy}
                resolved={resolvedPv.has(e.id)}
                hover={choiceHover}
                setHover={setChoiceHover}
                also={settlesText(e, "venue")}
                onPick={(v) => guard(() => apply({ step: e, value: v }, false))}
              />
            </section>
          ))}
          {shownDefaults.map((e, i) => {
            const k = nodeKeyOf(e) ?? "venue";
            const done = resolvedPv.has(e.id);
            const alt =
              k === "split"
                ? S.shares.at(-1)
                : ((e.options_considered as string[]) ?? []).find((o) => o !== nodeValue(e));
            const also = alt ? settlesText(e, alt) : null;
            const { className, ...rest } = cardProps(e);
            return (
              <section
                key={e.id}
                id={`resolve-${e.id}`}
                data-tour={i === 0 ? "default" : undefined}
                role="region"
                aria-labelledby={`h-${e.id}`}
                {...rest}
                className={`${className} cursor-pointer border border-dashed border-src-default bg-card p-4`}
              >
                <p className="font-mono text-xs uppercase text-src-default-text">
                  Default · <AgentName name={e.agent} onAgent={onAgent} />
                </p>
                <h3
                  id={`h-${e.id}`}
                  className={`mt-1 flex items-center gap-2 text-lg ${done ? "line-through text-muted-foreground" : ""}`}
                >
                  {done && (
                    <Check className="h-4 w-4 text-src-approved" aria-label="Resolved in preview" />
                  )}
                  {titles[k]}: {nodeValue(e)}
                </h3>
                {done && (
                  <p className="font-mono text-xs uppercase text-src-approved">
                    Resolved in preview
                  </p>
                )}
                {also && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {also} (if you pick {alt})
                  </p>
                )}
                <div className="mt-3 text-sm">
                  <DefaultResolver e={e} contract={contract} />
                </div>
              </section>
            );
          })}
          {declined.map((e) => (
            <DeclinePanel key={e.id} e={e} all={all} contract={contract} />
          ))}
          {otherPending.map((e) => (
            <section key={e.id} role="region" aria-label={e.action} {...cardProps(e)}>
              <DecisionCard e={e} all={all} />
            </section>
          ))}
          {commit.length > 0 && (
            <section
              role="region"
              aria-label="Commit plan"
              data-tour="commit"
              {...cardProps(commit[0]!)}
            >
              <CommitCard
                key={commit.map((c) => c.id).join()}
                items={commit}
                all={all}
                contract={contract as ContractRow}
                onJump={jump}
                skip={resolvedPv}
              />
            </section>
          )}
        </aside>
      </div>
      <AgentPanel
        role={agentOpen}
        onClose={() => setAgentOpen(null)}
        S={S}
        contract={forRun(contract, run)}
        run={live}
      />
      <AlertDialog
        open={!!confirm || blocker.status === "blocked"}
        onOpenChange={(o) => {
          if (!o) {
            setConfirm(null);
            if (blocker.status === "blocked") blocker.reset();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard preview?</AlertDialogTitle>
            <AlertDialogDescription>
              Nothing from the preview has been saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep previewing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setTrying(null);
                const f = confirm;
                setConfirm(null);
                if (blocker.status === "blocked") blocker.proceed();
                else f?.();
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TryOptions({
  S,
  headcount,
  e,
  k,
  current,
  onPick,
}: {
  S: Scenario;
  headcount: number;
  e: Entry;
  k: NodeKey;
  current?: string | undefined;
  onPick: (v: string) => void;
}) {
  const opts = k === "split" ? S.shares : ((e.options_considered as string[]) ?? []);
  const reasons = new Map(
    ((e.filtered_out as { option: string; reason: string }[]) ?? []).map((f) => [
      f.option,
      f.reason,
    ]),
  );
  const now = nodeValue(e);
  // Options that can't hold everyone are never offered.
  const hard = (o: string) =>
    k === "venue" && (S.options.find((v) => v.name === o)?.cap ?? Infinity) < headcount;
  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-1.5"
      role={k === "split" ? "radiogroup" : undefined}
      aria-label="Try another option"
    >
      <span className="font-mono text-[10px] uppercase text-muted-foreground">Try:</span>
      {opts.map((o) => {
        const on = (current ?? now) === o;
        return (
          <button
            key={o}
            type="button"
            role={k === "split" ? "radio" : undefined}
            aria-checked={k === "split" ? on : undefined}
            title={reasons.get(o)}
            disabled={(o === now && !current) || hard(o)}
            onClick={() => onPick(o)}
            className={`border px-2.5 py-1 font-mono text-xs transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-foreground bg-foreground text-background" : "border-border"}`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

/** An agent's name that opens its settings (inside clickable cards, so it doesn't select the card). */
function AgentName({ name, onAgent }: { name: string; onAgent: (name: string) => void }) {
  return (
    <button
      type="button"
      className="underline decoration-dotted underline-offset-4 hover:text-foreground"
      aria-label={`${name} settings`}
      onClick={(ev) => {
        ev.stopPropagation();
        onAgent(name);
      }}
    >
      {name}
    </button>
  );
}

function ConflictCard({
  S,
  onAgent,
  e,
  busy,
  resolved,
  hover,
  setHover,
  also,
  onPick,
}: {
  S: Scenario;
  onAgent: (name: string) => void;
  e: Entry;
  busy: boolean;
  resolved: boolean;
  hover: string | null;
  setHover: (v: string | null) => void;
  also: string | null;
  onPick: (v: string) => void;
}) {
  const [mine, setMine] = useState(false);
  const pref = S.options.find((v) => v.name === S.preference)!;
  const [va, ba] = [agentShort(S.agents.venue), agentShort(S.agents.budget)];
  const budget = e.action.match(/\$[\d,]+/)?.[0];
  const hv = (v: string) => ({
    onMouseEnter: () => setHover(v),
    onMouseLeave: () => setHover(null),
    onFocus: () => setHover(v),
    onBlur: () => setHover(null),
  });
  return (
    <div className="cursor-pointer border-2 border-src-pending bg-src-pending/10 p-4">
      <p className="font-mono text-xs uppercase text-accent">⚡ Agents disagree · run paused</p>
      <h3
        id={`h-${e.id}`}
        className={`mt-1 flex items-center gap-2 text-lg ${resolved ? "line-through text-muted-foreground" : ""}`}
      >
        {resolved && (
          <Check className="h-4 w-4 text-src-approved" aria-label="Resolved in preview" />
        )}
        {va} vs {ba}
      </h3>
      {resolved && (
        <p className="font-mono text-xs uppercase text-src-approved">Resolved in preview</p>
      )}
      <p className="mt-1 text-sm">
        <AgentName name={S.agents.venue} onAgent={onAgent} /> wants {pref.name} — {S.fits(pref.cap)}
        , {S.requirement.tag}. <AgentName name={S.agents.budget} onAgent={onAgent} /> says it’s over
        the {S.place} budget by {budget}.
      </p>
      {also && (
        <p className="mt-1 text-xs text-muted-foreground">
          {also} (if you side with {va})
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2">
        <Button
          size="sm"
          disabled={busy}
          {...hv("venue")}
          className={hover === "venue" ? "ring-2 ring-src-pending" : ""}
          onClick={() => onPick("venue")}
        >
          Side with {S.agents.venue} — {S.preferenceShort}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          {...hv("budget")}
          className={hover === "budget" ? "ring-2 ring-src-pending" : ""}
          onClick={() => onPick("budget")}
        >
          Side with {S.agents.budget} — stay within the {S.place} budget
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMine(!mine)}>
          Pick myself…
        </Button>
      </div>
      {mine && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {S.options.map((v) => (
            <button
              key={v.name}
              type="button"
              disabled={busy}
              onClick={() => onPick(v.name)}
              className="border border-border px-2 py-1 font-mono text-xs"
            >
              {v.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const humanDur = (ms: number) => {
  const m = Math.floor(ms / 60_000);
  return m < 1 ? "under a minute" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

function Timeline({
  S,
  onAgent,
  run,
  onPick,
  onHover,
  history,
  setHistory,
}: {
  S: Scenario;
  onAgent: (name: string) => void;
  run: Entry[];
  onPick: (k: NodeKey) => void;
  onHover: (k: NodeKey | null) => void;
  history: boolean;
  setHistory: (v: boolean) => void;
}) {
  const LANES = [S.agents.budget, S.agents.venue, "Cosign", S.agents.invites, "You"];
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const steps = run.filter(
    (e) => e.kind !== "contract" && nodeKeyOf(e) && (history || e.status !== "superseded"),
  );
  if (!steps.length) return null;
  const t0 = Math.min(...run.map((e) => +new Date(e.created_at)));
  const slot = 100 / (steps.length + 1);
  const pending = run.filter((e) => e.status === "pending");
  const pauseStart = pending.length
    ? Math.min(...pending.map((e) => +new Date(e.created_at)))
    : null;
  const firstPendingIdx = pending.length
    ? Math.max(
        0,
        steps.findIndex((s) => s.status === "pending"),
      )
    : -1;
  return (
    <div className="mt-6 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs uppercase text-muted-foreground">Timeline</p>
        <label className="flex items-center gap-2 font-mono text-xs uppercase text-muted-foreground">
          <Switch checked={history} onCheckedChange={setHistory} aria-label="Show history" />
          Show history
        </label>
      </div>
      <div className="mt-2 space-y-1">
        {LANES.map((lane) => (
          <div key={lane} className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
            {agentRole(S, lane) ? (
              <button
                type="button"
                onClick={() => onAgent(lane)}
                aria-label={`${lane} settings`}
                className="text-left font-mono text-[10px] uppercase text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
              >
                {agentShort(lane)}
              </button>
            ) : (
              <span className="font-mono text-[10px] uppercase text-muted-foreground">{lane}</span>
            )}
            <div className="relative h-5 bg-muted/50">
              {lane === "You"
                ? pauseStart != null && (
                    <span
                      className="absolute inset-y-0 flex items-center overflow-hidden whitespace-nowrap bg-src-pending/70 px-1 font-mono text-[10px]"
                      style={{ left: `${firstPendingIdx * slot}%`, right: 0 }}
                    >
                      Waiting on you · {humanDur(now - pauseStart)}
                    </span>
                  )
                : steps.map((e, i) => {
                    if (e.agent !== lane) return null;
                    const k = nodeKeyOf(e)!;
                    const lbl = `${S.bars[k]} ${mmss(+new Date(e.created_at) - t0)}`;
                    return (
                      <button
                        key={e.id}
                        type="button"
                        title={`${e.action} · ${lbl}`}
                        aria-label={`${lane}: ${lbl}`}
                        onClick={() => onPick(k)}
                        onMouseEnter={() => onHover(k)}
                        onMouseLeave={() => onHover(null)}
                        className={`absolute inset-y-0.5 overflow-hidden truncate whitespace-nowrap bg-foreground px-1 text-left font-mono text-[10px] text-background ${e.status === "superseded" ? "opacity-25" : ""}`}
                        style={{ left: `${i * slot}%`, width: `calc(${slot}% - 2px)` }}
                      >
                        {lbl}
                      </button>
                    );
                  })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
