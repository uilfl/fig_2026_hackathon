import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Copy, FileDown, Lock, Share2, Undo2 } from "lucide-react";
import { getState } from "@/lib/store";
import type { Json } from "@/lib/model";
import {
  accountability,
  resourceAnswers,
  changePairs,
  previousOfCase,
  sameCase,
  decisionGroups,
  receiptNumbers,
  receiptSummary,
  runState,
  runStats,
  type DecisionGroup,
  type Pair,
} from "@/lib/receipt";
import {
  contractQuery,
  ledgerQuery,
  profileQuery,
  versionAt,
  versionsQuery,
  type ContractRow,
} from "@/lib/queries";
import { scenarioOfRows } from "@/lib/scenarios";
import { REV_LABEL, type Criterion, type Preview } from "@/lib/engine";
import { flagShouldHaveAsked, type Entry } from "@/lib/decisions";
import { CriteriaRows, DefaultResolver } from "@/components/Ledger";
import { Chip, chipFor, type ChipKind } from "@/components/Chip";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/_authenticated/ledger")({
  validateSearch: (s: Record<string, unknown>): { run?: number } =>
    Number(s["run"]) > 0 ? { run: Number(s["run"]) } : {},
  head: () => ({
    meta: [
      { title: "Decision Receipt — Cosign" },
      {
        name: "description",
        content: "Who decided each key thing, what it cost, and what the agents assumed.",
      },
      { property: "og:title", content: "Decision Receipt — Cosign" },
      {
        property: "og:description",
        content: "Who decided each key thing, what it cost, and what the agents assumed.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) =>
    Promise.all(
      [ledgerQuery, contractQuery, versionsQuery, profileQuery].map((q) =>
        context.queryClient.ensureQueryData(q as typeof ledgerQuery),
      ),
    ),
  component: LedgerPage,
});

const FILTERS = {
  all: "Everyone",
  you: "You",
  contract: "Contract",
  resource: "Resources",
  default: "Defaults",
  open: "Waiting on you",
} as const;
type Filter = keyof typeof FILTERS;
const matches = (e: Entry, f: Filter) => {
  if (f === "all") return true;
  if (f === "you")
    return (
      e.source === "user" ||
      e.source === "approved" ||
      e.status === "declined" ||
      (e.source === "default" && !!e.resolution && e.resolution !== "keep")
    );
  if (f === "contract") return e.source === "contract" || e.resolution === "keep";
  if (f === "resource") return resourceAnswers(e).length > 0;
  if (f === "default") return e.source === "default";
  return e.status === "pending" || (e.source === "default" && !!e.default_key && !e.resolution);
};
const STATE_CHIP: Record<string, ChipKind> = {
  "Waiting on you": "waiting",
  "In progress": "neutral",
  Complete: "approved",
  Stopped: "blocked",
};
const fmt = (d: string) =>
  new Date(d).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const money = (n: number) => `$${n.toLocaleString()}`;

function LedgerPage() {
  const { data: entries } = useSuspenseQuery(ledgerQuery);
  const { data: contract } = useSuspenseQuery(contractQuery);
  const { data: versions } = useSuspenseQuery(versionsQuery);
  const { data: profile } = useSuspenseQuery(profileQuery);
  const { run: pick } = Route.useSearch();
  const navigate = useNavigate({ from: "/ledger" });
  const [filter, setFilter] = useState<Filter>("all");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const byRun = new Map<string, Entry[]>();
  for (const e of entries) byRun.set(e.run_id, [...(byRun.get(e.run_id) ?? []), e]);
  const runs = [...byRun.values()]
    .map((r) => [...r].sort((a, b) => a.seq - b.seq || a.created_at.localeCompare(b.created_at)))
    .reverse(); // oldest first
  if (!runs.length)
    return (
      <div className="py-24 text-center">
        <h1 className="text-5xl">No receipts yet.</h1>
        <p className="mt-3 text-muted-foreground">
          Sign the contract and run the agents to get your first receipt.
        </p>
        <Link to="/contract">
          <Button className="mt-8">Go to contract</Button>
        </Link>
      </div>
    );
  const n = pick && pick <= runs.length ? pick : runs.length;
  const rows = runs[n - 1]!;
  const isLatest = n === runs.length;
  const steps = rows.filter((r) => r.kind !== "contract");
  const ver = versionAt(versions, rows[0]!.created_at);
  const state = runState(steps);
  const nums = receiptNumbers(steps);
  const acc = accountability(steps);
  const groups = decisionGroups(steps);
  const counts = Object.fromEntries(
    (Object.keys(FILTERS) as Filter[]).map((f) => [
      f,
      groups.filter((g) => matches(g.row, f)).length,
    ]),
  ) as Record<Filter, number>;
  const shown = groups.filter((g) => matches(g.row, filter));
  const prev = previousOfCase(runs, n - 1);
  const pairs = prev ? changePairs(prev, rows) : [];
  const anyChange = pairs.some((p) => p.changed);

  return (
    <div>
      {!isLatest && (
        <button
          onClick={() => navigate({ search: {} })}
          className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 font-mono text-xs uppercase hover:bg-secondary"
        >
          <Undo2 className="h-3 w-3" />
          Back to latest
        </button>
      )}
      <PageHeader
        eyebrow={`${profile?.team || "Your team"} · Receipts`}
        title={`${scenarioOfRows(rows).title} · Run ${n}`}
        aside={
          <span className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
            {fmt(rows[0]!.created_at)}
            {ver ? ` · under contract v${ver}` : ""}
            <Chip kind={STATE_CHIP[state]!}>{state}</Chip>
          </span>
        }
        subtitle="Who decided each key thing, what it cost, and what the agents assumed."
        actions={
          <Button variant="outline" onClick={() => setSharing(true)}>
            <Share2 className="h-4 w-4" />
            Share receipt
          </Button>
        }
      />

      <dl
        data-tour="receipt"
        className="mt-8 grid grid-cols-2 gap-px border border-border bg-border lg:grid-cols-4"
      >
        <Num
          label="Committed"
          value={money(nums.committed)}
          sub={nums.refundable ? `+${money(nums.refundable)} refundable` : "nothing refundable"}
        />
        <Num label="Decided by you" value={String(nums.byYou)} />
        <Num
          label="By contract"
          value={String(nums.byContract)}
          sub={nums.byResource ? `+${nums.byResource} answered by connected resources` : undefined}
        />
        <Num
          label="Agent assumptions"
          value={`${nums.openAssumptions} open`}
          sub={`${nums.resolvedAssumptions} resolved`}
          warn={nums.openAssumptions > 0}
        />
      </dl>
      <p className="mt-6 max-w-3xl font-display text-2xl leading-snug">
        {acc.text}
        {acc.open > 0 && isLatest && (
          <>
            {" "}
            <Link to="/run" className="text-src-pending-text underline underline-offset-4">
              {acc.open} decision{acc.open === 1 ? "" : "s"} still need{acc.open === 1 ? "s" : ""}{" "}
              you →
            </Link>
          </>
        )}
      </p>

      <section className="mt-10" aria-labelledby="dl-h">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="dl-h" className="text-2xl">
            Decisions
          </h2>
          <div
            role="tablist"
            aria-label="Filter by who decided"
            className="inline-flex border border-border bg-card p-0.5"
          >
            {(Object.keys(FILTERS) as Filter[]).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 font-mono text-xs uppercase transition-colors duration-150 ${filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {FILTERS[f]} <span className="opacity-70">{counts[f]}</span>
              </button>
            ))}
          </div>
        </div>
        <ul className="mt-4 border-t border-border">
          {shown.length ? (
            shown.map((g) => (
              <DecisionRow
                key={g.key}
                g={g}
                open={openKey === g.key}
                onToggle={() => setOpenKey(openKey === g.key ? null : g.key)}
                contract={contract}
                live={isLatest}
              />
            ))
          ) : (
            <li className="py-6 text-sm text-muted-foreground">Nothing matches this filter.</li>
          )}
        </ul>
      </section>

      {prev && (
        <section className="mt-10 border border-border bg-card p-5" aria-labelledby="ch-h">
          <h2 id="ch-h" className="text-2xl">
            {anyChange ? "Changed since last run" : `Same outcome as Run ${n - 1}.`}
          </h2>
          {anyChange && (
            <ul className="mt-3 divide-y divide-border border-y border-border">
              {pairs
                .filter((p) => p.changed || p.label === "Committed" || p.label === "Approvals")
                .map((p) => (
                  <PairRow key={p.label} p={p} />
                ))}
            </ul>
          )}
        </section>
      )}

      {runs.length > 1 && (
        <EarlierRuns
          runs={runs}
          current={n}
          versions={versions}
          onPick={(r) => navigate({ search: r === runs.length ? {} : { run: r } })}
        />
      )}

      <ShareDrawer
        open={sharing}
        onOpenChange={setSharing}
        rows={steps}
        n={n}
        ver={ver}
        runId={rows[0]!.run_id}
        nums={nums}
        acc={acc.text}
        groups={groups}
      />
    </div>
  );
}

function Num({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub?: string | undefined;
  warn?: boolean;
}) {
  return (
    <div className="bg-card p-5">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className={`mt-1 font-display text-4xl ${warn ? "text-src-pending-text" : ""}`}>
        {value}
      </dd>
      {sub && <dd className="font-mono text-xs text-muted-foreground">{sub}</dd>}
    </div>
  );
}

function PairRow({ p }: { p: Pair }) {
  return (
    <li
      className={`grid grid-cols-[8rem_1fr] gap-4 py-2 text-sm ${p.changed ? "" : "text-muted-foreground"} ${p.ownerChanged ? "bg-accent/5" : ""}`}
    >
      <span>
        {p.label}
        {p.ownerChanged && (
          <span className="ml-2 font-mono text-[10px] uppercase text-accent">owner changed</span>
        )}
      </span>
      <span className="font-mono text-xs">
        {p.from} → {p.to}
        {!p.changed && " (unchanged)"}
      </span>
    </li>
  );
}

const revIcon = (p: Preview | null) =>
  p?.reversibility === "never" ? (
    <Lock className="h-3.5 w-3.5" aria-label="Cannot be undone" />
  ) : p ? (
    <span className="font-mono text-[10px]" aria-label={REV_LABEL[p.reversibility]}>
      ↺
    </span>
  ) : null;

function DecisionRow({
  g,
  open,
  onToggle,
  contract,
  live,
}: {
  g: DecisionGroup<Entry>;
  open: boolean;
  onToggle: () => void;
  contract: ContractRow;
  live: boolean;
}) {
  const [showEarlier, setShowEarlier] = useState(false);
  const e = g.row;
  const chip = chipFor(e);
  const p = e.preview as Preview | null;
  return (
    <li className="border-b border-border rise-in">
      <button
        aria-expanded={open}
        onClick={onToggle}
        className="grid w-full grid-cols-[1fr_auto] items-center gap-3 py-3 text-left transition-colors duration-150 hover:bg-secondary/50 sm:grid-cols-[8rem_1fr_auto_auto_auto]"
      >
        <span className="hidden font-mono text-xs uppercase text-muted-foreground sm:block">
          {g.title}
        </span>
        <span className="min-w-0">
          <span className="sm:hidden font-mono text-xs uppercase text-muted-foreground">
            {g.title} ·{" "}
          </span>
          {e.action}
        </span>
        <span className="hidden stamp text-muted-foreground sm:inline-block">{e.agent}</span>
        <span className="hidden w-20 items-center justify-end gap-2 font-mono text-xs sm:flex">
          {p?.amount != null ? money(p.amount) : ""}
          {revIcon(p)}
        </span>
        <span className="flex items-center gap-2">
          <Chip kind={chip.kind}>{chip.label}</Chip>
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {g.earlier.length > 0 && (
        <div className="-mt-1 pb-2 sm:ml-[8.75rem]">
          <button
            className="font-mono text-[10px] uppercase text-muted-foreground underline"
            aria-expanded={showEarlier}
            onClick={() => setShowEarlier(!showEarlier)}
          >
            {g.earlier.length} earlier version{g.earlier.length === 1 ? "" : "s"}
          </button>
          {showEarlier && (
            <ul className="mt-1 space-y-0.5">
              {g.earlier.map(({ row, why }) => (
                <li key={row.id} className="text-sm text-muted-foreground">
                  <s>{row.action}</s> <span className="font-mono text-[10px]">— {why}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {open && <Trace e={e} contract={contract} live={live} />}
    </li>
  );
}

function Trace({ e, contract, live }: { e: Entry; contract: ContractRow; live: boolean }) {
  const qc = useQueryClient();
  const p = e.preview as Preview | null;
  const filtered = (e.filtered_out as { option: string; reason: string }[] | null) ?? [];
  const considered = (e.options_considered as string[] | null) ?? [];
  const chip = chipFor(e);
  return (
    <div className="grid gap-5 pb-5 text-sm sm:ml-[8.75rem] lg:grid-cols-2 rise-in">
      <CriteriaRows criteria={(e.criteria as Criterion[] | null) ?? []} fallback={e.criterion} />
      <div>
        <p className="font-mono text-xs uppercase text-muted-foreground">Options considered</p>
        <ul className="mt-1 space-y-0.5">
          {considered.length ? (
            considered.map((o) => {
              const f = filtered.find((x) => x.option === o);
              return (
                <li key={o}>
                  {f ? (
                    <>
                      <s className="text-muted-foreground">{o}</s>{" "}
                      <span className="text-xs text-muted-foreground">— {f.reason}</span>
                    </>
                  ) : (
                    o
                  )}
                </li>
              );
            })
          ) : (
            <li className="text-muted-foreground">—</li>
          )}
        </ul>
      </div>
      <div className="border border-border bg-card p-3">
        <p className="font-mono text-xs uppercase text-muted-foreground">Agent says</p>
        <p className="mt-1 italic">{e.rationale ? `“${e.rationale}”` : "—"}</p>
      </div>
      <div className="border border-border bg-card p-3">
        <p className="font-mono text-xs uppercase text-muted-foreground">Cosign checked</p>
        <p className="mt-1">
          Source: {chip.label}
          {p ? ` · ${REV_LABEL[p.reversibility]} — ${p.reversibility_note}` : ""}
        </p>
        {e.source === "contract" &&
          e.status === "done" &&
          (e.resolution === "should_have_asked" ? (
            <Chip kind="waiting" className="mt-2">
              You flagged: should have asked
            </Chip>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="mt-2 px-0"
              onClick={async () => {
                await flagShouldHaveAsked(e);
                qc.invalidateQueries({ queryKey: ["ledger"] });
                toast("Flagged — Contract will suggest tightening");
              }}
            >
              This should have asked me
            </Button>
          ))}
      </div>
      {e.source === "default" && !!e.default_key && live && !e.resolution && (
        <div className="lg:col-span-2">
          <DefaultResolver e={e} contract={contract} />
        </div>
      )}
    </div>
  );
}

function EarlierRuns({
  runs,
  current,
  versions,
  onPick,
}: {
  runs: Entry[][];
  current: number;
  versions: { version: number; signed_at: string }[];
  onPick: (n: number) => void;
}) {
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  // newest first, grouping consecutive runs with the same outcome
  const items = runs.map((r, i) => ({ n: i + 1, r })).reverse();
  const groups: { n: number; r: Entry[] }[][] = [];
  for (const it of items) {
    const last = groups.at(-1);
    if (
      last &&
      sameCase(it.r, last.at(-1)!.r) &&
      !changePairs(it.r, last.at(-1)!.r).some((p) => p.changed)
    )
      last.push(it);
    else groups.push([it]);
  }
  const Row = ({ n, r }: { n: number; r: Entry[] }) => {
    const s = runStats(r),
      nums = receiptNumbers(r.filter((x) => x.kind !== "contract")),
      v = versionAt(versions, r[0]!.created_at);
    return (
      <tr
        onClick={() => onPick(n)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onPick(n);
        }}
        tabIndex={0}
        aria-label={`Open Run ${n}`}
        className={`cursor-pointer border-b border-border hover:bg-secondary/60 focus-visible:outline-2 focus-visible:outline-ring ${n === current ? "bg-secondary" : ""}`}
      >
        <td className="py-2 pr-4">Run {n}</td>
        <td className="pr-4">{new Date(r[0]!.created_at).toLocaleDateString()}</td>
        <td className="pr-4">{v ? `v${v}` : "—"}</td>
        <td className="pr-4">{money(nums.committed)}</td>
        <td className="pr-4">{s.approvals}</td>
        <td className="pr-4">{nums.openAssumptions + nums.resolvedAssumptions}</td>
        <td>{runState(r)}</td>
      </tr>
    );
  };
  return (
    <section className="mt-10" aria-labelledby="er-h">
      <h2 id="er-h" className="font-mono text-xs uppercase text-muted-foreground">
        All runs
      </h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left font-mono text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="py-2 font-normal">Run</th>
              <th className="font-normal">Date</th>
              <th className="font-normal">Contract</th>
              <th className="font-normal">Committed</th>
              <th className="font-normal">Approvals</th>
              <th className="font-normal">Assumptions</th>
              <th className="font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) =>
              g.length === 1 ? (
                <Row key={g[0]!.n} {...g[0]!} />
              ) : (
                <GroupRows
                  key={g[0]!.n}
                  g={g}
                  open={openGroup === g[0]!.n}
                  onToggle={() => setOpenGroup(openGroup === g[0]!.n ? null : g[0]!.n)}
                  Row={Row}
                />
              ),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function GroupRows({
  g,
  open,
  onToggle,
  Row,
}: {
  g: { n: number; r: Entry[] }[];
  open: boolean;
  onToggle: () => void;
  Row: (p: { n: number; r: Entry[] }) => React.ReactElement;
}) {
  const lo = g.at(-1)!.n,
    hi = g[0]!.n;
  return (
    <>
      <tr className="border-b border-border">
        <td colSpan={7} className="py-2">
          <button
            aria-expanded={open}
            onClick={onToggle}
            className="flex items-center gap-2 uppercase text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            />
            Runs {lo}–{hi} · same outcome
          </button>
        </td>
      </tr>
      {open && g.map((it) => <Row key={it.n} {...it} />)}
    </>
  );
}

function ShareDrawer({
  open,
  onOpenChange,
  rows,
  n,
  ver,
  runId,
  nums,
  acc,
  groups,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rows: Entry[];
  n: number;
  ver: number | null;
  runId: string;
  nums: ReturnType<typeof receiptNumbers>;
  acc: string;
  groups: DecisionGroup<Entry>[];
}) {
  const navigate = useNavigate();
  const [id, setId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function ensure(): Promise<string | null> {
    if (id) return id;
    setBusy(true);
    try {
      const summary = {
        ...receiptSummary(rows),
        run_number: n,
        contract_version: ver,
        numbers: nums,
        accountability: acc,
        groups: groups.map((g) => ({
          title: g.title,
          action: g.row.action,
          who: chipFor(g.row).label,
          amount: (g.row.preview as Preview | null)?.amount ?? null,
        })),
      };
      const row = getState().addShared(runId, summary as unknown as Json);
      setId(row.id);
      return row.id;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not share");
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    const x = await ensure();
    if (!x) return;
    await navigator.clipboard.writeText(`${window.location.origin}/r/${x}`);
    toast.success("Link copied");
  }
  // Same tab: the demo data lives in memory, so a new tab would start from the seed.
  async function pdf() {
    const x = await ensure();
    if (x) navigate({ to: "/r/$id", params: { id: x }, search: { print: true } });
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Share receipt</SheetTitle>
          <SheetDescription>
            This is exactly what the recipient sees. Traces aren't included. Demo data lives in this
            tab, so links open only while it stays open.
          </SheetDescription>
        </SheetHeader>
        <div className="mx-4 mt-4 border border-border bg-background p-5">
          <p className="stamp inline-block text-muted-foreground">Receipt · read-only</p>
          <h3 className="mt-2 text-3xl">
            {scenarioOfRows(rows).title} · Run {n}
          </h3>
          <div className="mt-4 grid grid-cols-2 gap-3 font-mono text-xs">
            <span>Committed {money(nums.committed)}</span>
            <span>By you {nums.byYou}</span>
            <span>By contract {nums.byContract}</span>
            <span>
              Assumptions {nums.openAssumptions} open / {nums.resolvedAssumptions} resolved
            </span>
          </div>
          <p className="mt-4 font-display text-lg leading-snug">{acc}</p>
          <ul className="mt-4 divide-y divide-border border-y border-border text-sm">
            {groups.map((g) => (
              <li key={g.key} className="flex justify-between gap-3 py-1.5">
                <span>
                  {g.title} · <span className="text-muted-foreground">{g.row.action}</span>
                </span>
                <Chip kind={chipFor(g.row).kind}>{chipFor(g.row).label}</Chip>
              </li>
            ))}
          </ul>
          <p className="mt-4 font-mono text-[10px] text-muted-foreground">
            Shared from Cosign{ver ? ` · ran under contract v${ver}` : ""}
          </p>
        </div>
        <div className="mx-4 mt-4 flex gap-2 pb-6">
          <Button variant="outline" disabled={busy} onClick={copy}>
            <Copy className="h-4 w-4" />
            Copy link
          </Button>
          <Button disabled={busy} onClick={pdf}>
            <FileDown className="h-4 w-4" />
            Download PDF
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
