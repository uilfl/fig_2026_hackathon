import { useEffect, useRef, useState } from "react";
import type { Entry } from "@/lib/decisions";
import { resourceAnswers } from "@/lib/receipt";
import { initialsOf, scenarioOfRows, slotOf, type Scenario } from "@/lib/scenarios";

/** Avatar colour per speaker slot (agents by role, so every case keeps the same colours). */
const SLOT_CLS: Record<string, string> = {
  You: "bg-src-user text-primary-foreground",
  budget: "bg-src-approved text-primary-foreground",
  venue: "bg-src-contract text-primary-foreground",
  invites: "bg-src-pending text-foreground",
  Cosign: "bg-accent text-accent-foreground",
};

type Msg = { who: string; text: string; tone?: "flag" | "pause" | "block" };

export function toMessages(run: Entry[]): Msg[] {
  const out: Msg[] = [];
  for (const e of run) {
    out.push({ who: e.agent, text: e.rationale ? `${e.action}. ${e.rationale}` : e.action });
    for (const c of resourceAnswers(e)) out.push({ who: "Cosign", text: `Answered from ${c.resource}: ${c.label}.${c.note ? ` ${c.note}.` : ""}` });
    if (e.status === "pending") out.push({ who: "Cosign", tone: "pause", text: `Holding “${e.action}” — your contract says to ask first. It's waiting on you.` });
    else if (e.status === "blocked") out.push({ who: "Cosign", tone: "block", text: `Blocked until the step it depends on is approved.` });
    else if (e.source === "default" && !!e.default_key && !e.resolution) out.push({ who: "Cosign", tone: "flag", text: `No rule covers “${e.default_label ?? e.criterion}”. Flagged as a default for you to decide.` });
  }
  return out;
}

export function Avatar({ who, S }: { who: string; S: Scenario }) {
  return <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full font-mono text-[10px] ${SLOT_CLS[slotOf(S, who)] ?? "bg-muted"}`}>{initialsOf(who)}</span>;
}

export function Typing({ who, S }: { who: string; S: Scenario }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar who={who} S={S} />
      <div className="flex gap-1 rounded-2xl border border-border bg-card px-4 py-3">
        {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 150}ms` }} />)}
      </div>
      <span className="font-mono text-xs text-muted-foreground">{who} is thinking…</span>
    </div>
  );
}

/** Replays a run as a group chat between agents, with Cosign calling out pauses and defaults. */
export function AgentChat({ run, animate }: { run: Entry[]; animate: boolean }) {
  const msgs = toMessages(run);
  const S = scenarioOfRows(run);
  const [shown, setShown] = useState(animate ? 0 : msgs.length);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (shown >= msgs.length) return;
    const t = setTimeout(() => setShown((s) => s + 1), 1100);
    return () => clearTimeout(t);
  }, [shown, msgs.length]);
  useEffect(() => { if (animate) end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [shown, animate]);
  return (
    <div className="space-y-4">
      {msgs.slice(0, shown).map((m, i) => (
        <div key={i} className="flex animate-in fade-in slide-in-from-bottom-2 gap-3 duration-500">
          <Avatar who={m.who} S={S} />
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">{m.who}</p>
            <p className={`mt-1 rounded-2xl rounded-tl-none border px-4 py-2 text-sm ${m.tone === "pause" ? "border-src-pending bg-secondary" : m.tone === "flag" ? "border-src-default bg-secondary" : m.tone === "block" ? "border-dashed border-border bg-muted" : "border-border bg-card"}`}>{m.text}</p>
          </div>
        </div>
      ))}
      {shown < msgs.length && <Typing who={msgs[shown]!.who} S={S} />}
      {animate && shown >= msgs.length && <p className="font-mono text-xs text-muted-foreground">— run finished · decisions waiting are on the right —</p>}
      <div ref={end} />
    </div>
  );
}
