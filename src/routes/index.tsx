import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/Chip";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cosign — find the decisions nobody made" },
      {
        name: "description",
        content:
          "A responsibility ledger that traces every AI agent action to you, an approval, a contract rule, or an unchosen default.",
      },
      { property: "og:title", content: "Cosign — find the decisions nobody made" },
      {
        property: "og:description",
        content: "Trace every agent action to its source, and resolve the defaults nobody chose.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[1120px] items-center justify-between px-6 py-6">
        <span className="font-display text-2xl">
          Cosign<span className="text-accent">.</span>
        </span>
      </header>
      <main className="mx-auto max-w-[1120px] px-6 pb-24 pt-16">
        <p className="stamp inline-block text-accent">Responsibility Ledger</p>
        <h1 className="mt-6 max-w-4xl text-6xl leading-[1.02] md:text-8xl">
          Find the decisions <em className="text-accent">nobody made.</em>
        </h1>
        <p className="mt-8 max-w-xl text-lg text-muted-foreground">
          Delegate to AI agents without losing track. Every action is traced to its source, every
          irreversible step is previewed, and every silent default gets your decision: keep it, use
          it once, or override it.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-6">
          <Button asChild variant="stamp" size="lg">
            <Link to="/contract">Try the demo</Link>
          </Button>
        </div>
        <ExampleRow />
      </main>
    </div>
  );
}

/** One ledger row whose chip moves from DEFAULT to YOU CHOSE after a simulated "Override" click. Loops every 6s. */
function ExampleRow() {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setT((x) => (x + 1) % 6), 1000);
    return () => clearInterval(id);
  }, []);
  const pressed = t === 2,
    chosen = t >= 3;
  return (
    <figure
      className="mt-20 max-w-3xl border border-border bg-card p-5"
      aria-label="Example: an agent's default becomes your choice"
    >
      <figcaption className="font-mono text-[10px] uppercase text-muted-foreground">
        Example ledger row
      </figcaption>
      <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-4 sm:grid-cols-[7rem_1fr_auto_auto]">
        <span className="hidden font-mono text-xs uppercase text-muted-foreground sm:block">
          Dates
        </span>
        <span className="font-display text-2xl transition-all duration-300 ease-out">
          Picked dates {chosen ? "Mar 21–22" : "Mar 14–15"}
        </span>
        <span
          className={`hidden rounded-sm border border-border px-3 py-1 text-sm transition-all duration-150 sm:inline-block ${pressed ? "scale-95 bg-secondary" : ""} ${chosen ? "opacity-0" : ""}`}
          aria-hidden
        >
          Override
        </span>
        <span className="transition-all duration-300 ease-out">
          {chosen ? <Chip kind="you" /> : <Chip kind="default" />}
        </span>
      </div>
    </figure>
  );
}
