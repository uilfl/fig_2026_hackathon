import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Lock, Zap } from "lucide-react";
import type { Entry } from "@/lib/decisions";
import { REV_LABEL, type Criterion, type Preview, type Reversibility } from "@/lib/engine";
import { impactOf, nodeKeyOf, nodeValue, type NodeChange, type NodeKey } from "@/lib/map";
import { srcOf } from "@/components/Ledger";
import { agentShort, scenarioOf, scenarioOfRows } from "@/lib/scenarios";

const REV_ICON: Record<Reversibility, string> = {
  free: "↺",
  fee: "↺",
  until_deadline: "⏳",
  never: "⛔",
};
const CRIT: Record<Criterion["source"], { label: string; cls: string }> = {
  you: { label: "You", cls: "text-src-user" },
  contract: { label: "Contract", cls: "text-src-contract" },
  rule: { label: "Contract rule", cls: "text-src-contract" },
  resource: { label: "Resource", cls: "text-src-resource" },
  default: { label: "Default", cls: "text-src-default-text" },
};
const critLabel = (c: Criterion) =>
  c.source === "resource" && c.resource ? `From ${c.resource}` : CRIT[c.source].label;
// Nodes live in the top band; the band below is kept free for the one floating card, so it never covers a node.
const NH = 88,
  BAND = 300,
  MAP_H = 540,
  MIN_GAP = 40;

/** Kept for other screens (receipt) that style a step by who owns it. */
export function ownerStyle(e: Entry): string {
  if (e.status === "pending") return "border-2 border-src-pending bg-src-pending/20";
  if (e.status === "blocked") return "border border-border bg-muted text-muted-foreground";
  if (e.status === "declined" || e.status === "cancelled" || e.status === "expired")
    return "border border-border bg-card opacity-60";
  if (e.source === "user") return "border-2 border-src-user bg-card";
  if (e.source === "approved") return "border-2 border-src-approved bg-card";
  if (e.source === "contract") return "border-2 border-foreground bg-card";
  if (e.source === "resource") return "border-2 border-src-resource bg-card";
  if (e.source === "default") return "border-2 border-dashed border-src-default bg-card";
  return "border border-border bg-card";
}

function decidedBy(e: Entry): string {
  const when = new Date(e.decided_at ?? e.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  if (e.status === "pending") return "Waiting on you";
  if (e.status === "blocked") return "Blocked · waits on an upstream decision";
  if (e.criterion === "venue_conflict") {
    const S = scenarioOf(e.scenario);
    return `You · ${when} · settled a disagreement between ${agentShort(S.agents.venue)} and ${agentShort(S.agents.budget)} agents`;
  }
  if (e.source === "user") return `You · ${when}`;
  if (e.source === "approved") return `You approved · ${when}`;
  if (e.source === "contract") {
    const c = ((e.criteria as Criterion[] | null) ?? []).find(
      (x) => x.source === "rule" || x.source === "contract",
    );
    return `Contract rule${c ? `: ${c.label}` : ""}`;
  }
  if (e.source === "default")
    return e.resolution
      ? `Default · ${srcOf(e).label}`
      : `Default · nobody chose — ${e.agent} assumed it`;
  return srcOf(e).label;
}

export function HoverCard({ e }: { e: Entry }) {
  const crit = (e.criteria as Criterion[] | null) ?? [];
  const mismatch = crit.some((c) => !c.verified);
  return (
    <>
      <p className="font-mono uppercase text-muted-foreground">Decided by</p>
      <p className="mt-0.5 text-sm">{decidedBy(e)}</p>
      <p className="mt-3 font-mono uppercase text-muted-foreground">Agent says</p>
      <p className="mt-1 italic">“{e.rationale || e.action}”</p>
      <p className="mt-3 font-mono uppercase text-muted-foreground">Cosign checked</p>
      {crit.length ? (
        <ul className="mt-1 space-y-1">
          {crit.map((c) => (
            <li key={c.key} className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span>
                {c.verified ? "✓" : <span className="text-destructive">!</span>} {c.label}
              </span>
              <span className={`stamp shrink-0 ${CRIT[c.source].cls}`}>{critLabel(c)}</span>
              {c.note && <span className="basis-full text-muted-foreground">{c.note}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-muted-foreground">No criteria logged.</p>
      )}
      {mismatch && (
        <p className="mt-3 border-t border-destructive pt-2 text-destructive">
          Explanation doesn’t match the record.
        </p>
      )}
    </>
  );
}

type Box = { k: NodeKey; x: number; y: number; w: number; h: number };
type Float = { kind: "node"; k: NodeKey } | { kind: "edge"; id: string } | null;

export function DecisionMap({
  nodes,
  ghosts,
  selected,
  onSelect,
  highlight,
  lit,
  changes,
  onClear,
  flash,
  tentative,
  openKeys,
  resolvedInPreview,
  choiceHover,
  setChoiceHover,
  settledConflict,
  venueShare,
}: {
  nodes: Map<NodeKey, Entry>;
  ghosts: Entry[];
  selected?: NodeKey | undefined;
  onSelect: (k: NodeKey) => void;
  highlight?: NodeKey | null;
  lit: Set<NodeKey> | null;
  changes: Map<NodeKey, NodeChange> | null;
  onClear: () => void;
  flash: number;
  tentative: Map<NodeKey, number>;
  openKeys: Set<NodeKey>;
  resolvedInPreview: Set<NodeKey>;
  choiceHover: string | null;
  setChoiceHover: (v: string | null) => void;
  settledConflict: boolean;
  venueShare: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [float, setFloat] = useState<Float>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    setFloat(null);
  }, [selected]);
  const hoverIn = (f: Float) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFloat(f), 250);
  };
  const hoverOut = () => {
    if (timer.current) clearTimeout(timer.current);
    setFloat(null);
  };

  const S = scenarioOfRows([...nodes.values()]);
  const NODE_TITLE = S.titles;
  const pref = S.options.find((v) => v.name === S.preference)!;
  // Simple layered layout: 4 columns, left to right.
  const conflictOpen = nodes.get("conflict")?.status === "pending";
  const col2: NodeKey = conflictOpen ? "conflict" : "venue";
  // Nodes are 200px wide when there's room; the conflict is 420×120 with halves side by side, or stacks its halves when space is tight.
  const CW = conflictOpen ? Math.min(420, Math.max(200, width - 3 * 200 - 3 * MIN_GAP)) : 0;
  const stacked = conflictOpen && CW < 380;
  const CH = stacked ? 188 : 120;
  const NW = Math.max(
    150,
    Math.min(
      200,
      Math.floor((width - (conflictOpen ? CW : 0) - 3 * MIN_GAP) / (conflictOpen ? 3 : 4)),
    ),
  );
  const widths = [NW, conflictOpen ? CW : NW, NW, NW];
  const sum = widths.reduce((a, b) => a + b, 0);
  const gap = Math.max(MIN_GAP, (width - sum) / 3);
  const xs = widths.reduce<number[]>(
    (acc, w, i) => [...acc, i === 0 ? 0 : acc[i - 1]! + widths[i - 1]! + gap],
    [],
  );
  const total = xs[3]! + NW;
  const cy = 148;
  const boxes = new Map<NodeKey, Box>();
  const place = (k: NodeKey, col: number, yc: number, w = NW, h = NH) => {
    if (nodes.has(k)) boxes.set(k, { k, x: xs[col]!, y: yc - h / 2, w, h });
  };
  place("split", 0, cy);
  place(col2, 1, cy, conflictOpen ? CW : NW, conflictOpen ? CH : NH);
  for (const b of boxes.values()) if (b.k !== col2) b.w = NW;
  place("dates", 2, cy);
  place("deposit", 3, 48);
  place("catering", 3, cy);
  place("invites", 3, 248);

  const edges: { id: string; from: NodeKey; to: NodeKey; tag?: string | undefined }[] = [];
  const link = (from: NodeKey, to: NodeKey) => {
    const f = nodes.get(from),
      t = nodes.get(to);
    if (!f || !t || !boxes.has(from) || !boxes.has(to)) return;
    const inherited =
      f.source === "default" &&
      !f.resolution &&
      ((t.criteria as Criterion[] | null) ?? []).some(
        (c) => c.key === f.criterion && c.source === "default",
      );
    edges.push({
      id: `${from}-${to}`,
      from,
      to,
      tag: inherited
        ? `inherited: ${f.default_label?.replace(/^Spend /, "").replace(/ of the budget on the .*$/, " split") ?? f.criterion}, nobody chose`
        : undefined,
    });
  };
  link("split", col2);
  link(col2, "dates");
  for (const k of ["deposit", "catering", "invites"] as NodeKey[]) link("dates", k);

  const dim = (k: NodeKey) => lit && !lit.has(k);
  const floatNode = float?.kind === "node" && float.k !== selected ? boxes.get(float.k) : undefined;

  return (
    <div ref={wrap} className="overflow-x-auto snap-x snap-mandatory">
      <div
        className="relative"
        style={{ width: Math.max(total, width), height: MAP_H, minWidth: total }}
        onClick={(ev) => {
          if (ev.target === ev.currentTarget) onClear();
        }}
      >
        <svg
          className="pointer-events-none absolute inset-0"
          width={Math.max(total, width)}
          height={MAP_H}
          aria-hidden
        >
          {edges.map((g) => {
            const a = boxes.get(g.from)!,
              b = boxes.get(g.to)!;
            const x1 = a.x + a.w,
              y1 = a.y + a.h / 2,
              x2 = b.x,
              y2 = b.y + b.h / 2,
              mx = (x1 + x2) / 2;
            const on = lit ? lit.has(g.from) && lit.has(g.to) : true;
            return (
              <path
                key={`${g.id}-${flash}`}
                d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                fill="none"
                stroke={g.tag ? "var(--src-default)" : "var(--foreground)"}
                strokeWidth={g.tag ? 1.5 : 1}
                strokeDasharray={g.tag ? "5 4" : undefined}
                opacity={on ? 0.7 : 0.15}
                className={lit && on ? "edge-flash" : ""}
              />
            );
          })}
        </svg>
        {edges
          .filter((g) => g.tag)
          .map((g) => {
            const a = boxes.get(g.from)!,
              b = boxes.get(g.to)!;
            const x1 = a.x + a.w,
              x2 = b.x,
              my = (a.y + a.h / 2 + b.y + b.h / 2) / 2;
            const fits = x2 - x1 - 16 >= g.tag!.length * 6.2 + 12;
            const open = float?.kind === "edge" && float.id === g.id;
            return (
              <div
                key={`t-${g.id}`}
                className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 ${dim(g.to) ? "opacity-30" : ""}`}
                style={{ left: (x1 + x2) / 2, top: my }}
                onMouseEnter={() => hoverIn({ kind: "edge", id: g.id })}
                onMouseLeave={hoverOut}
              >
                {fits ? (
                  <span className="block whitespace-nowrap rounded-full border border-dashed border-src-default bg-background px-2 font-mono text-[10px] text-src-default-text">
                    {g.tag}
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={g.tag}
                    onFocus={() => setFloat({ kind: "edge", id: g.id })}
                    onBlur={hoverOut}
                    className="flex h-4 w-4 items-center justify-center rounded-full border border-src-default bg-background text-[9px] text-src-default-text"
                  >
                    ⚠
                  </button>
                )}
                {open && (
                  <div
                    role="tooltip"
                    className="absolute left-1/2 top-6 z-40 w-64 -translate-x-1/2 border border-foreground bg-background p-3 text-xs shadow-lg"
                  >
                    <p className="font-mono uppercase text-src-default-text">
                      Inherited assumption
                    </p>
                    <p className="mt-1">
                      {NODE_TITLE[g.to]} was built on “{nodes.get(g.from)?.default_label}”. Nobody
                      chose it — the {nodes.get(g.from)?.agent} assumed it.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        {ghosts.map((e, i) => {
          const k = nodeKeyOf(e);
          const b = k && boxes.get(k);
          if (!b) return null;
          return (
            <div
              key={e.id}
              aria-hidden
              className="pointer-events-none absolute border border-dashed border-border bg-card p-2 text-xs opacity-25"
              style={{
                left: b.x + 6 + (i % 3) * 4,
                top: b.y + 6 + (i % 3) * 4,
                width: b.w,
                height: b.h,
              }}
            >
              <s>{nodeValue(e)}</s>
            </div>
          );
        })}
        {[...boxes.values()].map((b) => {
          const k = b.k,
            e = nodes.get(k)!;
          const pv = e.preview as Preview | null;
          const ch = changes?.get(k);
          const src = srcOf(e);
          const tent = !openKeys.has(k) ? (tentative.get(k) ?? 0) : 0;
          const resolvedPv = resolvedInPreview.has(k);
          const impact = impactOf(e.seq, [...nodes.values()]).count;
          const state = ch
            ? "preview"
            : e.status === "pending"
              ? "waiting on you"
              : tent
                ? `tentative, depends on ${tent} open item${tent > 1 ? "s" : ""}`
                : e.source === "default" && !e.resolution
                  ? "default, nobody chose"
                  : src.label.toLowerCase();
          const label = `${NODE_TITLE[k === "conflict" ? "venue" : k]} ${nodeValue(e)}, ${state}${impact ? `, affects ${impact} decision${impact > 1 ? "s" : ""}` : ""}`;
          const look = ch
            ? "border-2 border-dotted border-foreground bg-card"
            : e.status === "pending"
              ? "border-2 border-src-pending bg-src-pending/20 pulse-border"
              : tent
                ? "border border-dashed border-border bg-card"
                : e.source === "default" && !e.resolution
                  ? "border-2 border-dashed border-src-default bg-card"
                  : ownerStyle(e);
          const val = nodeValue(e);
          return (
            <div
              key={k}
              className="absolute snap-start"
              style={{ left: b.x, top: b.y, width: b.w, height: b.h, zIndex: 2 }}
              onMouseEnter={() => hoverIn({ kind: "node", k })}
              onMouseLeave={hoverOut}
            >
              <button
                type="button"
                data-node={k}
                aria-pressed={selected === k}
                aria-label={label}
                aria-describedby={floatNode?.k === k ? `float-${k}` : undefined}
                onClick={() => onSelect(k)}
                onFocus={() => {
                  if (timer.current) clearTimeout(timer.current);
                  setFloat({ kind: "node", k });
                }}
                onBlur={hoverOut}
                onKeyDown={(ev) => {
                  if (ev.key === "Escape" && float) {
                    setFloat(null);
                    ev.stopPropagation();
                  }
                }}
                className={`relative flex h-full w-full flex-col justify-between overflow-hidden p-2.5 text-left transition-[opacity,box-shadow,border-color] duration-200 ease-out animate-in fade-in ${look} ${dim(k) ? "opacity-30" : ""} ${selected === k ? "outline outline-2 outline-offset-2 outline-foreground" : ""} ${highlight === k ? "ring-2 ring-src-pending" : ""}`}
              >
                {k === "conflict" && e.status === "pending" ? (
                  <>
                    <span className="flex items-center gap-1 font-mono text-[10px] uppercase text-accent">
                      <Zap className="h-3 w-3" />
                      Agents disagree
                      {resolvedPv && (
                        <span className="ml-auto flex items-center gap-1 text-src-approved">
                          <Check className="h-3 w-3" />
                          Resolved in preview
                        </span>
                      )}
                    </span>
                    <div
                      className={`grid flex-1 items-center gap-1 pt-1 ${stacked ? "grid-rows-[1fr_auto_1fr]" : "grid-cols-[1fr_auto_1fr] gap-2"}`}
                    >
                      <span
                        className={`p-1 ${choiceHover === "venue" ? "bg-src-pending/40" : ""}`}
                        onMouseEnter={() => setChoiceHover("venue")}
                        onMouseLeave={() => setChoiceHover(null)}
                      >
                        <span className="block font-mono text-[10px] uppercase text-muted-foreground">
                          {S.agents.venue}
                        </span>
                        <span className="block whitespace-nowrap font-display text-base leading-tight">
                          {pref.name}
                        </span>
                        <span className="block whitespace-nowrap text-[11px] text-muted-foreground">
                          {S.fits(pref.cap)} · {S.requirement.tag} · ${pref.price.toLocaleString()}
                        </span>
                      </span>
                      <span className="text-center font-mono text-[10px] uppercase text-muted-foreground">
                        vs
                      </span>
                      <span
                        className={`p-1 ${choiceHover === "budget" ? "bg-src-pending/40" : ""}`}
                        onMouseEnter={() => setChoiceHover("budget")}
                        onMouseLeave={() => setChoiceHover(null)}
                      >
                        <span className="block font-mono text-[10px] uppercase text-muted-foreground">
                          {S.agents.budget}
                        </span>
                        <span className="block whitespace-nowrap font-display text-base leading-tight">
                          Stay within {venueShare}
                        </span>
                        <span className="block whitespace-nowrap text-[11px] text-muted-foreground">
                          {S.preferenceShort} is {e.action.match(/by (\$[\d,]+)/)?.[1] ?? "over"}{" "}
                          over
                        </span>
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="flex items-center justify-between gap-1 truncate font-mono text-[10px] uppercase text-muted-foreground">
                      <span className="truncate">
                        {k === "venue" && settledConflict
                          ? `You settled ${agentShort(S.agents.venue)} vs ${agentShort(S.agents.budget)}`
                          : e.agent}
                      </span>
                      {(tent > 0 || e.status === "blocked") && (
                        <Lock className="h-3 w-3 shrink-0" aria-label="Locked" />
                      )}
                    </span>
                    <span className="truncate whitespace-nowrap font-display text-base leading-tight">
                      {ch && ch.from !== ch.to ? (
                        <>
                          <s className="text-muted-foreground">{ch.from}</s> →{" "}
                          <strong>{ch.to}</strong>
                        </>
                      ) : tent ? (
                        <span className="italic text-muted-foreground">
                          {k === "venue" ? S.short(val) : val}?
                        </span>
                      ) : (
                        <>
                          {NODE_TITLE[k]}: {val}
                        </>
                      )}
                    </span>
                    <span className="flex items-center justify-between gap-1">
                      <span
                        className={`stamp truncate text-[9px] tracking-normal ${ch ? "text-foreground" : e.status === "pending" ? "text-src-pending-text" : tent ? "text-muted-foreground" : src.cls}`}
                      >
                        {ch
                          ? "Preview"
                          : e.status === "pending"
                            ? "Waiting on you"
                            : tent
                              ? `Depends on ${tent} open item${tent > 1 ? "s" : ""}`
                              : e.source === "default" && !e.resolution
                                ? "Default · nobody chose"
                                : src.label}
                      </span>
                      {resolvedPv && (
                        <Check
                          className="h-3 w-3 text-src-approved"
                          aria-label="Resolved in preview"
                        />
                      )}
                      {pv && (pv.amount != null || e.kind === "send") ? (
                        <span
                          className="font-mono text-xs"
                          title={REV_LABEL[pv.reversibility]}
                          aria-label={REV_LABEL[pv.reversibility]}
                        >
                          {REV_ICON[pv.reversibility]}
                        </span>
                      ) : null}
                    </span>
                  </>
                )}
              </button>
            </div>
          );
        })}
        {floatNode && (
          <div
            role="tooltip"
            id={`float-${floatNode.k}`}
            className="absolute z-30 w-72 border border-foreground bg-background p-3 text-left text-xs shadow-lg animate-in fade-in duration-150"
            style={{
              top: BAND + 8,
              left: Math.max(0, Math.min(floatNode.x, Math.max(total, width) - 288)),
            }}
          >
            <HoverCard e={nodes.get(floatNode.k)!} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Map nodes present, with the venue hidden while the agents still disagree (the conflict takes its place). */
export function NODE_ORDER_PRESENT(nodes: Map<NodeKey, Entry>): NodeKey[] {
  const conflictOpen = nodes.get("conflict")?.status === "pending";
  return (
    ["split", "conflict", "venue", "dates", "deposit", "catering", "invites"] as NodeKey[]
  ).filter(
    (k) => nodes.has(k) && !(k === "venue" && conflictOpen) && !(k === "conflict" && !conflictOpen),
  );
}
