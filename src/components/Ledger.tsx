import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  REV_LABEL,
  RECIPIENTS_KEY,
  alternativesFor,
  forRun,
  nextAlternative,
  type Alternative,
  type Preview,
  type Criterion,
} from "@/lib/engine";
import type { ContractRow } from "@/lib/queries";
import {
  chooseAlternative,
  connectResource,
  stopRun,
  commitPlan,
  decide,
  flagShouldHaveAsked,
  resolveDefault,
  resourceOffer,
  unresolvedUpstream,
  type Entry,
  type Resolution,
} from "@/lib/decisions";
import { sortedLedger } from "@/lib/store";
import { Checkbox } from "@/components/ui/checkbox";
import { chipClass, chipFor } from "@/components/Chip";
import { answersLabel, scenarioOf, type Resource } from "@/lib/scenarios";

/** Label + text style for a step. Labels come from `chipFor` so every screen uses one vocabulary. */
export function srcOf(e: Entry) {
  const { kind, label } = chipFor(e);
  return { label, cls: chipClass(kind) };
}

const ACCENT: Record<string, string> = {
  user: "border-l-src-user",
  approved: "border-l-src-approved",
  contract: "border-l-src-contract",
  resource: "border-l-src-resource",
  default: "border-l-src-default",
  pending: "border-l-src-pending",
};
export function accentOf(e: Entry) {
  if (
    e.status === "declined" ||
    e.status === "expired" ||
    e.status === "cancelled" ||
    e.status === "superseded"
  )
    return "border-l-border";
  return ACCENT[e.source] ?? "border-l-border";
}

export function useRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["ledger"] });
    qc.invalidateQueries({ queryKey: ["contract"] });
  };
}

export function DecisionCard({ e, all }: { e: Entry; all: Entry[] }) {
  const refresh = useRefresh();
  const p = e.preview as Preview;
  const waiting = all.filter(
    (x) => x.run_id === e.run_id && x.depends_on === e.seq && x.status === "blocked",
  );
  const unresolved = unresolvedUpstream(e, all);
  async function go(ok: boolean) {
    try {
      await decide(e, ok, all);
      toast.success(
        ok ? "Approved — recorded in the ledger" : "Declined — nothing was sent or spent",
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }
  return (
    <div className="border-2 border-foreground bg-card p-5">
      {unresolved.length > 0 && (
        <div role="alert" className="mb-4 border border-src-default bg-accent/10 p-3 text-sm">
          Based on {unresolved.length} unresolved default{unresolved.length > 1 ? "s" : ""}:{" "}
          {unresolved.map((u, i) => (
            <span key={u.id}>
              {i > 0 && ", "}
              <a href={`#resolve-${u.id}`} className="underline underline-offset-2">
                {u.default_label}
              </a>
            </span>
          ))}
          . Resolve them first.
        </div>
      )}
      <p className="font-mono text-xs uppercase text-src-pending-text">
        Waiting on you · {e.agent}
      </p>
      <p className="mt-2 text-xl">{p.what}</p>
      <div className="mt-3 flex flex-wrap gap-6 font-mono text-xs">
        {p.amount != null && (
          <span>
            Amount <strong className="text-sm">${p.amount.toLocaleString()}</strong>
          </span>
        )}
        {p.total_after != null && (
          <span>
            Spent after <strong className="text-sm">${p.total_after.toLocaleString()}</strong>
          </span>
        )}
        <span className={p.reversibility === "never" ? "text-destructive" : ""}>
          {REV_LABEL[p.reversibility]} — {p.reversibility_note}
        </span>
      </div>
      <ul className="mt-3 text-sm">
        {p.blocked_by?.map((b) => (
          <li key={b}>⏸ Paused because: {b}</li>
        ))}
      </ul>
      {waiting.length > 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          Blocked until you decide: {waiting.map((w) => w.action).join(", ")}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <Button disabled={unresolved.length > 0} onClick={() => go(true)}>
          Approve {p.amount != null ? `$${p.amount.toLocaleString()}` : "send"}
        </Button>
        <Button variant="outline" onClick={() => go(false)}>
          Decline
        </Button>
      </div>
    </div>
  );
}

/** "Answer from Team calendar": connect the resource, re-plan, and offer an undo. */
export function AnswerFromResource({ e, r }: { e: Entry; r: Resource }) {
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const res = await connectResource(e, r.id, sortedLedger());
      toast.success(
        `${r.name} connected — it now answers ${answersLabel(scenarioOf(e.scenario), r.kind)}`,
        {
          duration: 6000,
          action: {
            label: "Undo",
            onClick: () => {
              void res.undo().then(refresh);
            },
          },
        },
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={() => {
        void go();
      }}
      className="border-src-resource text-src-resource"
      title={`${r.name}: “${r.evidence}”`}
    >
      Answer from {r.name}
    </Button>
  );
}

export function DefaultResolver({ e, contract }: { e: Entry; contract: ContractRow }) {
  const refresh = useRefresh();
  const [picking, setPicking] = useState(false);
  const considered = (e.options_considered as string[]) ?? [];
  const current = considered.find((o) => e.action.includes(o));
  const alternatives = considered.filter((o) => o !== current);
  const offer = resourceOffer(e, contract);
  async function go(how: Resolution, value?: string) {
    try {
      const r = await resolveDefault(e, contract, how, value);
      const base =
        how === "keep"
          ? "Now a contract rule"
          : how === "once"
            ? "Accepted for this run only"
            : `Using ${value}`;
      toast.success(
        r.replaced
          ? `${base} — ${r.replaced} later step${r.replaced > 1 ? "s" : ""} re-planned`
          : base,
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }
  if (e.resolution) {
    const r = e.resolution;
    const label =
      r === "keep"
        ? "Kept as rule"
        : r === "once"
          ? "Accepted just this time"
          : r.startsWith("override:")
            ? `Overridden → ${r.slice(9)}`
            : r;
    return <span className="stamp text-src-approved">{label}</span>;
  }
  return (
    <div className="border-l-2 border-accent pl-4">
      <p>
        No one chose <strong>“{e.default_label}”</strong> — the agent assumed it. It is not in your
        contract.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="stamp" size="sm" onClick={() => go("keep")}>
          Keep as rule
        </Button>
        <Button variant="outline" size="sm" onClick={() => go("once")}>
          Just this time
        </Button>
        <Button variant="outline" size="sm" onClick={() => setPicking(!picking)}>
          Override
        </Button>
        {offer && <AnswerFromResource e={e} r={offer} />}
      </div>
      {offer && (
        <p className="mt-2 text-xs text-muted-foreground">
          {offer.name} could answer this: “{offer.evidence}”
        </p>
      )}
      {picking && (
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="font-mono text-xs uppercase text-muted-foreground self-center">
            Use instead:
          </span>
          {alternatives.map((o) => (
            <Button key={o} size="sm" variant="secondary" onClick={() => go("override", o)}>
              {o}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function SupersededLine({ e }: { e: Entry }) {
  return (
    <p className="flex items-baseline justify-between gap-3 py-1.5 text-sm text-muted-foreground opacity-60">
      <s className="truncate">{e.action}</s>
      <span className="stamp shrink-0">Superseded</span>
    </p>
  );
}

export function StepCard({
  e,
  contract,
  live,
  waitsOn,
}: {
  e: Entry;
  contract: ContractRow;
  live: boolean;
  waitsOn?: string | undefined;
}) {
  if (e.status === "superseded")
    return (
      <div className="border border-dashed border-border px-4">
        <SupersededLine e={e} />
      </div>
    );
  const p = e.preview as Preview | null;
  const src = srcOf(e);
  const openDefault = e.source === "default" && !!e.default_key && !e.resolution;
  return (
    <article
      className={`flex h-full flex-col border border-border border-l-2 ${accentOf(e)} bg-card p-4 ${openDefault && live ? "bg-accent/5" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-xs uppercase text-muted-foreground">{e.agent}</p>
        <span className={`stamp shrink-0 ${src.cls}`}>{src.label}</span>
      </div>
      <p className="mt-2 flex-1 text-base leading-snug">{e.action}</p>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-xs">
        {p?.amount != null && <span className="text-sm">${p.amount.toLocaleString()}</span>}
        {p && (
          <span
            className={p.reversibility === "never" ? "text-destructive" : "text-muted-foreground"}
          >
            {REV_LABEL[p.reversibility]}
          </span>
        )}
      </div>
      {waitsOn && (
        <p className="mt-2 font-mono text-xs text-src-pending-text">Waits on: {waitsOn}</p>
      )}
      {openDefault && live && (
        <div className="mt-3 border-t border-border pt-3">
          <DefaultResolver e={e} contract={contract} />
        </div>
      )}
      {openDefault && !live && (
        <p className="mt-3 border-t border-border pt-3 font-mono text-xs uppercase text-src-default-text">
          Waiting on you
        </p>
      )}
    </article>
  );
}

export function TraceRow({
  e,
  contract,
  live,
}: {
  e: Entry;
  contract: ContractRow;
  live: boolean;
}) {
  if (e.status === "superseded")
    return (
      <li className="border-b border-border">
        <SupersededLine e={e} />
      </li>
    );
  return <ActiveTraceRow e={e} contract={contract} live={live} />;
}

function ActiveTraceRow({ e, contract, live }: { e: Entry; contract: ContractRow; live: boolean }) {
  const refresh = useRefresh();
  const [open, setOpen] = useState(
    e.source === "default" && !!e.default_key && !e.resolution && live,
  );
  const preview = e.preview as Preview | null;
  const filtered = (e.filtered_out as { option: string; reason: string }[]) ?? [];
  const considered = (e.options_considered as string[]) ?? [];
  const src = srcOf(e);
  return (
    <li
      className={`border-b border-border py-4 ${e.source === "default" && !e.resolution ? "bg-accent/5" : ""}`}
    >
      <button
        className="grid w-full grid-cols-[1fr_auto] items-baseline gap-3 text-left sm:grid-cols-[9rem_1fr_auto]"
        onClick={() => setOpen(!open)}
      >
        <span className="hidden font-mono text-xs text-muted-foreground sm:block">{e.agent}</span>
        <span>{e.action}</span>
        <span className={`stamp ${src.cls}`}>{src.label}</span>
      </button>
      {open && (
        <div className="mt-3 sm:ml-[10rem] space-y-3 text-sm">
          {e.rationale && <p className="italic text-muted-foreground">“{e.rationale}”</p>}
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1">
            <dt className="font-mono text-xs uppercase text-muted-foreground">Considered</dt>
            <dd>{considered.join(", ") || "—"}</dd>
            <dt className="font-mono text-xs uppercase text-muted-foreground">Source</dt>
            <dd>
              {src.label}{" "}
              <span className="text-muted-foreground">
                (decided by Cosign's check, not the agent)
              </span>
            </dd>
          </dl>
          <CriteriaRows
            criteria={(e.criteria as Criterion[] | null) ?? []}
            fallback={e.criterion}
          />
          {filtered.length > 0 && (
            <ul className="space-y-0.5">
              {filtered.map((f) => (
                <li key={f.option}>
                  <s>{f.option}</s> — {f.reason}
                </li>
              ))}
            </ul>
          )}
          {e.source === "default" && !!e.default_key && live && (
            <DefaultResolver e={e} contract={contract} />
          )}
          {preview && (
            <div className="border border-border bg-card p-3">
              <p>{preview.what}</p>
              <p className="mt-1 font-mono text-xs">
                {REV_LABEL[preview.reversibility]} — {preview.reversibility_note} · assigned by
                Cosign
              </p>
              {e.source === "contract" &&
                e.status === "done" &&
                (e.resolution === "should_have_asked" ? (
                  <span className="stamp mt-2 inline-block text-src-pending-text">
                    You flagged: should have asked
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2"
                    onClick={async () => {
                      await flagShouldHaveAsked(e);
                      refresh();
                    }}
                  >
                    This should have asked me
                  </Button>
                ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

const CRIT_SRC: Record<Criterion["source"], { label: string; cls: string }> = {
  you: { label: "You chose", cls: "text-src-user" },
  contract: { label: "Contract", cls: "text-src-contract" },
  rule: { label: "Contract rule", cls: "text-src-contract" },
  resource: { label: "Resource", cls: "text-src-resource" },
  default: { label: "Default", cls: "text-src-default-text" },
};
export function CriteriaRows({
  criteria,
  fallback,
}: {
  criteria: Criterion[];
  fallback?: string | null;
}) {
  if (!criteria.length)
    return fallback ? (
      <p className="text-xs">
        Criterion: <code>{fallback}</code>
      </p>
    ) : null;
  return (
    <div>
      <p className="font-mono text-xs uppercase text-muted-foreground">Criteria</p>
      <ul className="mt-1 divide-y divide-border border-y border-border">
        {criteria.map((c) => (
          <li key={c.key} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
            <span>
              {c.label}
              {!c.verified && (
                <span className="ml-2 border border-destructive px-1 font-mono text-[10px] uppercase text-destructive">
                  Unverified
                </span>
              )}
            </span>
            <span className={`stamp shrink-0 ${CRIT_SRC[c.source].cls}`}>
              {c.source === "resource" && c.resource
                ? `From ${c.resource}`
                : CRIT_SRC[c.source].label}
            </span>
            {c.note && <span className="basis-full text-xs text-muted-foreground">{c.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One card to approve every irreversible step of the run at once. */
export function CommitCard({
  items,
  all,
  contract,
  onJump,
  skip,
}: {
  items: Entry[];
  all: Entry[];
  contract: ContractRow;
  onJump?: (e: Entry) => void;
  skip?: Set<string>;
}) {
  const refresh = useRefresh();
  const [include, setInclude] = useState<Set<string>>(() => new Set(items.map((i) => i.id)));
  const [saveScope, setSaveScope] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = all.filter((x) => x.run_id === items[0]!.run_id && x.status !== "superseded");
  const alreadySpent = run
    .filter((x) => x.status === "done" && x.kind === "spend")
    .reduce((t, x) => t + ((x.preview as Preview | null)?.amount ?? 0), 0);
  const pendingSpend = run
    .filter(
      (x) => x.kind === "spend" && !isIrr(x) && (x.status === "pending" || x.status === "blocked"),
    )
    .reduce((t, x) => t + ((x.preview as Preview | null)?.amount ?? 0), 0);
  const committing = items
    .filter((i) => include.has(i.id))
    .reduce((t, i) => t + ((i.preview as Preview).amount ?? 0), 0);
  const total = alreadySpent + committing;
  const cap = contract.budget_cap;
  const unresolved = [
    ...new Map(
      items
        .filter((i) => include.has(i.id))
        .flatMap((i) => unresolvedUpstream(i, all))
        .map((u) => [u.id, u]),
    ).values(),
  ].filter((u) => !skip?.has(u.id));
  const invite = items.find((i) => i.kind === "send" && !(i.preview as Preview).saved_scope);
  const sends = items.filter((i) => i.kind === "send" && include.has(i.id));
  async function go(approve: boolean) {
    setBusy(true);
    try {
      await commitPlan(
        items,
        approve ? include : new Set(),
        all,
        approve && saveScope && invite ? { contract, invite } : null,
      );
      toast.success(
        approve
          ? "Plan approved — one decision, recorded in the ledger"
          : "Plan declined — nothing was spent or sent",
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="border-2 border-foreground bg-card p-5">
      {unresolved.length > 0 && (
        <div role="alert" className="mb-4 border border-src-default bg-accent/10 p-3 text-sm">
          Resolve {unresolved.length} item{unresolved.length > 1 ? "s" : ""} above first:{" "}
          {unresolved.map((u, i) => (
            <span key={u.id}>
              {i > 0 && ", "}
              {onJump ? (
                <button
                  type="button"
                  onClick={() => onJump(u)}
                  className="underline underline-offset-2"
                >
                  {u.default_label ?? `Agents disagree on the ${scenarioOf(u.scenario).place}`}
                </button>
              ) : (
                <a href={`#resolve-${u.id}`} className="underline underline-offset-2">
                  {u.default_label ?? `Agents disagree on the ${scenarioOf(u.scenario).place}`}
                </a>
              )}
            </span>
          ))}
        </div>
      )}
      <p className="font-mono text-xs uppercase text-src-pending-text">
        Commit plan · can't be undone
      </p>
      <h3 className="mt-1 text-2xl">Approve these together</h3>
      <ol className="mt-4 divide-y divide-border border-y border-border">
        {items.map((i) => {
          const p = i.preview as Preview;
          return (
            <li key={i.id} className="flex gap-3 py-3">
              {p.saved_scope ? (
                <span className="mt-1 h-4 w-4 shrink-0" />
              ) : (
                <Checkbox
                  aria-label={`Include: ${i.action}`}
                  checked={include.has(i.id)}
                  onCheckedChange={(v) => {
                    const n = new Set(include);
                    if (v) n.add(i.id);
                    else n.delete(i.id);
                    setInclude(n);
                  }}
                  className="mt-1"
                />
              )}
              <div className={`min-w-0 flex-1 ${include.has(i.id) ? "" : "opacity-50"}`}>
                <p>{p.what}</p>
                <p className="mt-1 font-mono text-xs">
                  {p.amount != null && (
                    <strong className="mr-3">${p.amount.toLocaleString()}</strong>
                  )}
                  <span className="text-destructive">{REV_LABEL[p.reversibility]}</span>
                </p>
                {i.kind === "send" && <Recipients e={i} contract={contract} />}
                {p.saved_scope ? (
                  <p className="mt-1 stamp inline-block text-src-approved">
                    Covered by saved scope
                  </p>
                ) : (
                  p.blocked_by?.map((b) => (
                    <p key={b} className="mt-1 text-xs text-muted-foreground">
                      ⏸ {b}
                    </p>
                  ))
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-4">
        <div className="flex justify-between font-mono text-xs">
          <span>
            Committed ${total.toLocaleString()}
            {pendingSpend ? ` (+$${pendingSpend.toLocaleString()} refundable pending)` : ""}
          </span>
          <span>Cap ${cap.toLocaleString()}</span>
        </div>
        <div
          className="mt-1 h-2 w-full bg-muted"
          role="meter"
          aria-label="Committed against budget cap"
          aria-valuenow={total}
          aria-valuemax={cap}
        >
          <div
            className={`h-full ${total > cap ? "bg-destructive" : "bg-foreground"}`}
            style={{ width: `${Math.min(100, (total / cap) * 100)}%` }}
          />
        </div>
      </div>
      {sends.length > 0 && (
        <p className="mt-3 text-sm">
          {sends.reduce(
            (t, x) => t + Number((x.preview as Preview).what?.match(/Email (\d+)/)?.[1] ?? 0),
            0,
          ) || "—"}{" "}
          people will be emailed
        </p>
      )}
      {invite && include.has(invite.id) && (
        <label className="mt-3 flex items-start gap-2 text-sm">
          <Checkbox
            checked={saveScope}
            onCheckedChange={(v) => setSaveScope(!!v)}
            className="mt-0.5"
          />
          Next time, send without asking if the recipients and message are the same.
        </label>
      )}
      <div className="mt-4 flex gap-2">
        <span
          title={
            unresolved.length
              ? `Locked: resolve ${unresolved.length} item${unresolved.length > 1 ? "s" : ""} above first`
              : undefined
          }
        >
          <Button
            disabled={busy || unresolved.length > 0 || include.size === 0}
            onClick={() => go(true)}
          >
            Approve — can't be undone
          </Button>
        </span>
        <Button variant="outline" disabled={busy} onClick={() => go(false)}>
          Decline
        </Button>
      </div>
    </div>
  );
}
/** Who a send goes to: named by a connected guest list, or the Invites agent's guess (with a way to answer it). */
function Recipients({ e, contract }: { e: Entry; contract: ContractRow }) {
  const c = ((e.criteria as Criterion[] | null) ?? []).find((x) => x.key === RECIPIENTS_KEY);
  if (!c) return null;
  if (c.source === "resource")
    return (
      <p className="mt-1 text-xs">
        To: the people on {c.resource}{" "}
        <span className="stamp text-src-resource">From {c.resource}</span>
      </p>
    );
  const offer = resourceOffer(e, contract);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      <span>
        To: {scenarioOf(e.scenario).guessedRecipients}{" "}
        <span className="stamp text-src-default-text">{e.agent}'s guess</span>
      </span>
      {offer && <AnswerFromResource e={e} r={offer} />}
    </div>
  );
}

const isIrr = (e: Entry) => (e.preview as Preview | null)?.reversibility === "never";

/** After a decline: pick another option the agent considered, ask for the next one, or stop the run. */
export function DeclinePanel({
  e,
  all,
  contract,
}: {
  e: Entry;
  all: Entry[];
  contract: ContractRow;
}) {
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);
  const run = all.filter((x) => x.run_id === e.run_id);
  const alts = alternativesFor(e.seq, run, forRun(contract, run));
  const next = nextAlternative(alts);
  async function pick(a: Alternative, asked = false) {
    setBusy(true);
    try {
      const r = await chooseAlternative(e, a, contract, all);
      toast.success(
        `${asked ? "Agent suggested" : "You chose"} ${a.value} — ${r.replaced} step${r.replaced === 1 ? "" : "s"} re-planned`,
      );
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    setBusy(true);
    try {
      await stopRun(e, all);
      toast.success("Run stopped — dependent steps cancelled");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  const group = (k: Alternative["kind"], title: string) => {
    const list = alts.filter((a) => a.kind === k);
    if (!list.length) return null;
    return (
      <div className="mt-4">
        <p className="font-mono text-xs uppercase text-muted-foreground">{title}</p>
        <ul className="mt-1 divide-y divide-border border-y border-border">
          {list.map((a) => (
            <li key={a.value} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p>{a.value}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {a.preview}
                  {a.note ? ` · ${a.note}` : ""}
                </p>
              </div>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => pick(a)}>
                Use this
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return (
    <div className="border-2 border-foreground bg-card p-5">
      <p className="font-mono text-xs uppercase text-src-user">You declined · {e.action}</p>
      <h3 className="mt-1 text-2xl">What should happen instead?</h3>
      {group("venue", `Other ${scenarioOf(e.scenario).place}s the agent considered`)}
      {group("dates", "Other dates the agent considered")}
      <div className="mt-4 flex flex-wrap gap-2">
        {next && (
          <Button disabled={busy} onClick={() => pick(next, true)}>
            Ask the agent for another option
          </Button>
        )}
        <Button variant="outline" disabled={busy} onClick={stop}>
          Stop the run here
        </Button>
      </div>
    </div>
  );
}
