import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getState } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAgentActivity } from "@/lib/settings";
import { useTour } from "@/lib/tour-store";
import { ledgerQuery, versionsQuery } from "@/lib/queries";
import { isOpenConflict, isOpenDefault, latestRun } from "@/lib/decisions";

export function AppHeader() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [activity, setActivity] = useAgentActivity();
  const openTour = useTour((s) => s.open);
  const { data: ledger = [] } = useQuery(ledgerQuery);
  const { data: versions = [] } = useQuery(versionsQuery);
  const latest = latestRun(ledger);
  const needs = latest.filter((e) => e.status !== "superseded" && (e.status === "pending" || isOpenDefault(e) || isOpenConflict(e))).length;
  const runs = new Set(ledger.map((e) => e.run_id)).size;
  async function resetDemo() {
    await qc.cancelQueries();
    getState().reset();
    await qc.invalidateQueries();
    navigate({ to: "/contract", replace: true });
  }
  const link = "flex w-full items-center justify-between gap-3 font-mono text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";
  const active = { className: "text-foreground [&>span:first-child]:underline [&>span:first-child]:underline-offset-8 [&>span:first-child]:decoration-accent [&>span:first-child]:decoration-2" };
  const count = "font-mono text-[10px] normal-case tracking-normal text-muted-foreground";
  return (
    <header className="border-b border-border md:sticky md:top-0 md:h-screen md:w-[180px] md:shrink-0 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between gap-4 px-6 py-4 md:h-full md:flex-col md:items-start md:justify-start md:gap-10 md:py-8">
        <Link to="/" className="font-display text-2xl">Cosign<span className="text-accent">.</span></Link>
        <nav aria-label="Main" className="flex items-center gap-5 md:w-full md:flex-1 md:flex-col md:items-stretch md:gap-4">
          <Link to="/contract" className={link} activeProps={active} aria-label={`Contract${versions[0] ? `, version ${versions[0].version}` : ""}`}>
            <span>Contract</span><span className={count}>{versions[0] ? `v${versions[0].version}` : "draft"}</span>
          </Link>
          <Link to="/run" className={link} activeProps={active} aria-label={needs ? `Run, ${needs} waiting on you` : "Run"}>
            <span>Run</span>{needs > 0 && <span className={`${count} flex items-center gap-1 text-src-pending-text`}><span className="h-1.5 w-1.5 rounded-full bg-src-pending" />{needs}</span>}
          </Link>
          {activity && <Link to="/orchestra" className={link} activeProps={active}><span>Orchestra</span></Link>}
          <Link to="/ledger" className={link} activeProps={active} aria-label={`Receipts, ${runs} runs`}>
            <span>Receipts</span><span className={count}>{runs}</span>
          </Link>
        </nav>
        <div className="flex items-center gap-4 md:flex-col md:items-start">
          <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"><Switch checked={activity} onCheckedChange={setActivity} aria-label="Show agent activity" />Show agent activity</label>
          <Button variant="ghost" size="sm" className="md:px-0" onClick={openTour}>Take the tour</Button>
          <Button variant="ghost" size="sm" className="md:px-0" onClick={resetDemo}>Reset demo</Button>
        </div>
      </div>
    </header>
  );
}
