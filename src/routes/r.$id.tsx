import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { getState } from "@/lib/store";
import { Button } from "@/components/ui/button";
import type { ReceiptSummary } from "@/lib/receipt";
import { scenarioOf } from "@/lib/scenarios";

type Shared = ReceiptSummary & { run_number?: number; shared_at?: string; contract_version?: number | null; accountability?: string; numbers?: { committed: number; byYou: number; byContract: number; openAssumptions: number; resolvedAssumptions: number } };
const sharedQuery = (id: string) => queryOptions({
  queryKey: ["shared", id],
  queryFn: async (): Promise<Shared | null> => {
    const row = getState().shared.find((s) => s.id === id);
    return row ? ({ ...(row.summary as unknown as Shared), shared_at: row.created_at }) : null;
  },
});

export const Route = createFileRoute("/r/$id")({
  ssr: false, // the shared receipt lives in the in-memory demo store, which only exists in the browser
  head: () => ({ meta: [
    { title: "Shared decision receipt — Cosign" }, { name: "description", content: "Who decided each key thing in an AI agent run, what it cost, and what the agents assumed." },
    { property: "og:title", content: "Shared decision receipt — Cosign" }, { property: "og:description", content: "Who decided each key thing in an AI agent run, what it cost, and what the agents assumed." },
    { property: "og:type", content: "article" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" },
  ] }),
  validateSearch: (s: Record<string, unknown>): { print?: boolean } => (s["print"] ? { print: true } : {}),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(sharedQuery(params.id)),
  component: SharedReceipt,
});

function SharedReceipt() {
  const { id } = Route.useParams();
  const { data: r } = useSuspenseQuery(sharedQuery(id));
  const { print } = Route.useSearch();
  useEffect(() => { if (print && r) setTimeout(() => window.print(), 300); }, [print, r]);
  if (!r) return <div className="py-24 text-center"><h1 className="text-4xl">This receipt link doesn’t exist.</h1><Link to="/"><Button className="mt-6">Go to Cosign</Button></Link></div>;
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link to="/" className="font-display text-2xl">Cosign<span className="text-accent">.</span></Link>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigator.clipboard.writeText(window.location.href).then(() => toast.success("Link copied"))}>Copy link</Button>
          <Button onClick={() => window.print()}>Download PDF</Button>
        </div>
      </div>
      <p className="stamp mt-10 inline-block text-muted-foreground">Receipt · read-only</p>
      <h1 className="mt-3 text-5xl">{r.case ?? scenarioOf(null).title}{r.run_number ? ` · Run ${r.run_number}` : ""}</h1>
      <p className="mt-2 font-mono text-xs text-muted-foreground">{new Date(r.run_date).toLocaleString()}</p>
      {r.numbers ? (
        <dl className="mt-6 grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4">
          {[["Committed", `$${r.numbers.committed.toLocaleString()}`], ["Decided by you", r.numbers.byYou], ["By contract", r.numbers.byContract], ["Assumptions", `${r.numbers.openAssumptions} open / ${r.numbers.resolvedAssumptions} resolved`]].map(([l, v]) => (
            <div key={String(l)} className="bg-card p-4"><dt className="font-mono text-[10px] uppercase text-muted-foreground">{l}</dt><dd className="mt-1 font-display text-2xl">{v}</dd></div>
          ))}
        </dl>
      ) : <div className="mt-6 flex gap-8 font-mono text-sm"><span>${r.money.toLocaleString()} committed</span><span>{r.approvals} approval{r.approvals === 1 ? "" : "s"}</span></div>}
      {r.accountability && <p className="mt-6 font-display text-2xl leading-snug">{r.accountability}</p>}
      <h2 className="mt-10 text-2xl">Who decided each key thing</h2>
      <ul className="mt-3 divide-y divide-border border-y border-border">
        {r.decisions.map((d) => <li key={d.item} className="flex justify-between gap-4 py-2 text-sm"><span>{d.item}{d.value ? <span className="text-muted-foreground"> · {d.value}</span> : null}</span><span className="stamp shrink-0">{d.who}</span></li>)}
      </ul>
      <h2 className="mt-10 text-2xl">What the agents assumed</h2>
      {r.assumptions.length ? (
        <ul className="mt-3 divide-y divide-border border-y border-border">
          {r.assumptions.map((a) => <li key={a.label} className="flex justify-between gap-4 py-2 text-sm"><span>{a.label}</span><span className="font-mono text-xs">{a.resolution}</span></li>)}
        </ul>
      ) : <p className="mt-3 text-sm text-muted-foreground">No defaults — every choice traced to you or your contract.</p>}
      <footer className="mt-12 border-t border-border pt-4 font-mono text-xs text-muted-foreground">Shared from Cosign{r.contract_version ? ` · ran under contract v${r.contract_version}` : ""}</footer>
    </main>
  );
}
