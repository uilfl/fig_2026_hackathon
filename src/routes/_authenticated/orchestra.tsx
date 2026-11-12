import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ledgerQuery } from "@/lib/queries";
import { latestRun, type Entry } from "@/lib/decisions";
import {
  initialsOf,
  scenarioOfRows,
  slotName,
  slotOf,
  type AgentRole,
  type Scenario,
} from "@/lib/scenarios";
import { AGENT_ROLES, customAgentsFor } from "@/lib/agents";
import { NEW_AGENT_TEXT } from "@/components/NewAgentDialog.constants";
import { forRun } from "@/lib/engine";
import { contractQuery } from "@/lib/queries";
import { AgentPanel } from "@/components/AgentPanel";
import { useAgentActivity } from "@/lib/settings";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/orchestra")({
  head: () => ({
    meta: [
      { title: "Orchestra — Cosign" },
      {
        name: "description",
        content: "See how the agents hand work to each other in the latest run.",
      },
      { property: "og:title", content: "Orchestra — Cosign" },
      {
        property: "og:description",
        content: "See how the agents hand work to each other in the latest run.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(ledgerQuery),
  component: OrchestraGate,
});

/** Seats and colours are per speaker slot (agents by role), so every case draws the same network. */
const COLOR: Record<string, string> = {
  You: "var(--src-user)",
  budget: "var(--src-approved)",
  venue: "var(--src-contract)",
  invites: "var(--src-pending)",
  Cosign: "var(--accent)",
};
/** Curved path between two nodes, bent sideways so it never runs through the Cosign hub. */
function curve(f: { x: number; y: number }, t: { x: number; y: number }, trim = 38) {
  const dx = t.x - f.x,
    dy = t.y - f.y,
    L = Math.hypot(dx, dy);
  const ux = dx / L,
    uy = dy / L;
  const a = { x: f.x + ux * trim, y: f.y + uy * trim },
    b = { x: t.x - ux * trim, y: t.y - uy * trim };
  const bend = (f.x === 300 && f.y === 200) || (t.x === 300 && t.y === 200) ? 0 : 120;
  const c = { x: (a.x + b.x) / 2 - uy * bend, y: (a.y + b.y) / 2 + ux * bend };
  return `M${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`;
}
const POS: Record<string, { x: number; y: number }> = {
  You: { x: 300, y: 60 },
  budget: { x: 110, y: 200 },
  Cosign: { x: 300, y: 200 },
  venue: { x: 490, y: 200 },
  invites: { x: 300, y: 310 },
};
type Beat = { from: string; to: string; what: string; e: Entry; held: boolean };

/** Each step hands off to the next agent that acts; paused steps route through you via Cosign. */
function beats(run: Entry[], S: Scenario): Beat[] {
  return run.map((e, i) => {
    const held = e.status === "pending" || e.status === "blocked";
    const next = run.slice(i + 1).find((n) => n.agent !== e.agent)?.agent ?? e.agent;
    return {
      from: slotOf(S, e.agent),
      to: held ? "You" : slotOf(S, next),
      what: e.action,
      e,
      held,
    };
  });
}

function OrchestraGate() {
  const [on] = useAgentActivity();
  if (!on)
    return (
      <div className="py-24 text-center">
        <h1 className="text-4xl">Agent activity is off.</h1>
        <p className="mt-3 text-muted-foreground">
          Turn on “Show agent activity” in the menu to see the Orchestra map.
        </p>
      </div>
    );
  return <OrchestraPage />;
}

function OrchestraPage() {
  const { data: all } = useSuspenseQuery(ledgerQuery);
  const { data: contract } = useSuspenseQuery(contractQuery);
  const [agentOpen, setAgentOpen] = useState<AgentRole | null>(null);
  const run = latestRun(all).filter((e) => e.status !== "superseded");
  const S = scenarioOfRows(run);
  const name = (slot: string) => slotName(S, slot);
  const list = beats(run, S);
  const [at, setAt] = useState(list.length - 1);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (at >= list.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setAt((a) => a + 1), 1200);
    return () => clearTimeout(t);
  }, [playing, at, list.length]);
  if (!run.length)
    return (
      <div className="py-24 text-center">
        <h1 className="text-4xl">No run yet.</h1>
        <Link to="/contract">
          <Button className="mt-6">Set the contract</Button>
        </Link>
      </div>
    );
  const cur = list[at];

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-4xl">Orchestra</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setAt(0);
            setPlaying(true);
          }}
        >
          {playing ? "Playing…" : "▶ Replay"}
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Who passes work to whom in the latest run. Tap a step to jump to it, or an agent to see its
        settings.
      </p>

      <div className="mt-6 border border-border bg-card">
        <svg viewBox="0 0 600 380" className="w-full" role="img" aria-label="Agent network">
          <defs>
            <marker
              id="arr"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
            </marker>
          </defs>
          {/* every hand-off so far, thicker = more traffic */}
          {[
            ...new Set(
              list
                .slice(0, at + 1)
                .filter((x) => x.from !== x.to)
                .map((x) => `${x.from}|${x.held ? "Cosign" : x.to}`),
            ),
          ].map((k) => {
            const [f, t] = k.split("|") as [string, string];
            const n = list
              .slice(0, at + 1)
              .filter((x) => `${x.from}|${x.held ? "Cosign" : x.to}` === k).length;
            return (
              <path
                key={k}
                d={curve(POS[f]!, POS[t]!)}
                fill="none"
                stroke="var(--border)"
                strokeWidth={1 + n * 1.5}
              />
            );
          })}
          {cur &&
            cur.from !== cur.to &&
            (() => {
              const f = POS[cur.from]!,
                t = POS[cur.held ? "Cosign" : cur.to]!;
              const d = curve(f, t);
              return (
                <g key={at}>
                  <path
                    d={d}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="2.5"
                    strokeDasharray="6 5"
                    markerEnd="url(#arr)"
                  >
                    <animate
                      attributeName="stroke-dashoffset"
                      from="44"
                      to="0"
                      dur="0.8s"
                      repeatCount="indefinite"
                    />
                  </path>
                  <circle r="6" fill="var(--accent)">
                    <animateMotion dur="1.1s" repeatCount="indefinite" path={d} />
                  </circle>
                </g>
              );
            })()}
          {Object.entries(POS).map(([a, p]) => {
            const on = cur && (cur.from === a || cur.to === a || (a === "Cosign" && cur.held));
            const role = AGENT_ROLES.find((r) => r === a);
            const open = role
              ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": `${name(a)} settings`,
                  className:
                    "cursor-pointer transition-opacity duration-500 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring",
                  onClick: () => setAgentOpen(role),
                  onKeyDown: (ev: React.KeyboardEvent) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      setAgentOpen(role);
                    }
                  },
                }
              : { className: "transition-opacity duration-500" };
            return (
              <g key={a} {...open} opacity={on ? 1 : 0.45}>
                {on && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r="40"
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="1.5"
                  >
                    <animate
                      attributeName="r"
                      from="32"
                      to="46"
                      dur="1.4s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      from="0.8"
                      to="0"
                      dur="1.4s"
                      repeatCount="indefinite"
                    />
                  </circle>
                )}
                <circle cx={p.x} cy={p.y} r={a === "Cosign" ? 34 : 30} fill={COLOR[a]} />
                <text
                  x={p.x}
                  y={p.y + 4}
                  textAnchor="middle"
                  fill="var(--background)"
                  className="font-mono text-[11px]"
                >
                  {initialsOf(name(a))}
                </text>
                <text
                  x={p.x}
                  y={p.y + 52}
                  textAnchor="middle"
                  className="fill-foreground text-[12px]"
                >
                  {name(a)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {/* Your own agents take no steps, so they have no place in the hand-off graph. */}
      {(() => {
        const own = customAgentsFor(forRun(contract, run));
        return (
          own.length > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              {NEW_AGENT_TEXT.orchestra(own.map((a) => a.name).join(", "))}
            </p>
          )
        );
      })()}

      {cur && (
        <div className="mt-4 border-l-4 border-accent bg-card p-4">
          <p className="font-mono text-xs text-muted-foreground">
            Step {at + 1} · {name(cur.from)} →{" "}
            {cur.held ? "Cosign → You" : cur.to === cur.from ? "done" : name(cur.to)}
          </p>
          <p className="mt-1 text-lg">{cur.what}</p>
          {cur.e.rationale && (
            <p className="mt-1 text-sm italic text-muted-foreground">“{cur.e.rationale}”</p>
          )}
          {cur.held && (
            <p className="mt-1 text-sm text-src-pending-text">
              {cur.e.status === "blocked"
                ? "Blocked — waiting on an earlier approval."
                : "Held for your approval by your contract."}
            </p>
          )}
        </div>
      )}

      <AgentPanel
        role={agentOpen}
        onClose={() => setAgentOpen(null)}
        S={S}
        contract={forRun(contract, run)}
        run={run}
      />
      <ol className="mt-6 border-t border-border">
        {list.map((b, i) => (
          <li key={b.e.id}>
            <button
              onClick={() => {
                setPlaying(false);
                setAt(i);
              }}
              className={`grid w-full grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-border py-3 text-left text-sm ${i === at ? "bg-secondary" : i > at ? "opacity-40" : ""}`}
            >
              <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
              <span>{b.what}</span>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                {initialsOf(name(b.from))} →{" "}
                {b.held ? "YOU" : b.to === b.from ? "DONE" : initialsOf(name(b.to))}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
