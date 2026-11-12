import { useRef } from "react";
import { REV_LABEL, REV_ORDER, type ActionKey, type AskAt } from "@/lib/engine";
import { COLUMN, planPreview, snapThreshold, zoneStart, type PlanInput } from "@/lib/contract";
import { scenarioOf } from "@/lib/scenarios";
import type { Triggers } from "@/lib/engine";

const W = 380, H = 240, PL = 34, PT = 12, PB = 40;
const colW = (W - PL - 8) / 4, plotH = H - PT - PB;
const AXIS = ["Free", "Fee", "Until deadline", "Can't undo"];
const ORDER: AskAt[] = ["free", "until_deadline", "never", "off"];

/** Reversibility × reach plot with a draggable "Asks you" zone. `plan` = the draft contract, for real amounts and the case's names. */
export function RiskMap({ triggers, plan, onThreshold, onToggle }: { triggers: Triggers; plan?: PlanInput; onThreshold: (a: AskAt) => void; onToggle: (k: ActionKey) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const { rows } = planPreview(triggers, plan);
  const S = scenarioOf(plan?.scenario);
  const SHORT: Record<ActionKey, string> = { plan: "Plan", catering: S.titles.catering, deposit: S.titles.deposit, invites: S.titles.invites };
  const start = zoneStart(triggers.ask_at);
  const zx = PL + start * colW;
  const colAt = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect();
    return ((clientX - r.left) * (W / r.width) - PL) / colW;
  };
  const move = (e: React.PointerEvent) => { if (dragging.current) { const t = snapThreshold(colAt(e.clientX)); if (t !== triggers.ask_at) onThreshold(t); } };
  const key = (e: React.KeyboardEvent) => {
    const i = Math.max(0, ORDER.indexOf(triggers.ask_at));
    if (e.key === "ArrowLeft" && i > 0) { e.preventDefault(); onThreshold(ORDER[i - 1]!); }
    if (e.key === "ArrowRight" && i < ORDER.length - 1) { e.preventDefault(); onThreshold(ORDER[i + 1]!); }
  };
  return (
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none" role="group" aria-label="Risk map: reversibility across, reach up"
      onPointerMove={move} onPointerUp={() => { dragging.current = false; }} onPointerLeave={() => { dragging.current = false; }}>
      {/* zone */}
      <rect x={zx} y={PT} width={Math.max(0, W - 8 - zx)} height={plotH} className="fill-src-pending/15 transition-all duration-200 ease-out" />
      {start < 4 && <text x={W - 12} y={PT + plotH - 6} textAnchor="end" className="fill-src-pending font-mono text-[9px] uppercase">Asks you</text>}
      {/* grid + axes */}
      {[0, 1, 2, 3, 4].map((i) => <line key={i} x1={PL + i * colW} x2={PL + i * colW} y1={PT} y2={PT + plotH} className="stroke-border" strokeDasharray={i === 0 ? undefined : "2 3"} />)}
      <line x1={PL} x2={W - 8} y1={PT + plotH} y2={PT + plotH} className="stroke-foreground/40" />
      {AXIS.map((a, i) => <text key={a} x={PL + (i + 0.5) * colW} y={PT + plotH + 14} textAnchor="middle" className="fill-muted-foreground font-mono text-[8.5px]">{a}</text>)}
      <text x={PL + 2 * colW} y={H - 6} textAnchor="middle" className="fill-muted-foreground font-mono text-[8px] uppercase">Reversibility →</text>
      <text x={10} y={PT + plotH / 2} textAnchor="middle" transform={`rotate(-90 10 ${PT + plotH / 2})`} className="fill-muted-foreground font-mono text-[8px] uppercase">Reach (money, people) →</text>
      {/* handle */}
      <g role="slider" tabIndex={0} aria-label="Ask threshold — drag or use arrow keys" aria-valuemin={0} aria-valuemax={3} aria-valuenow={Math.max(0, ORDER.indexOf(triggers.ask_at))} aria-valuetext={triggers.ask_at}
        className="cursor-ew-resize outline-none [&:focus-visible>rect:last-child]:stroke-ring" onKeyDown={key}
        onPointerDown={(e) => { dragging.current = true; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); }}>
        <rect x={zx - 10} y={PT} width={20} height={plotH} className="fill-transparent" />
        <line x1={zx} x2={zx} y1={PT} y2={PT + plotH} className="stroke-src-pending transition-all duration-200 ease-out" strokeWidth={2} />
        <rect x={zx - 4} y={PT + plotH / 2 - 14} width={8} height={28} rx={2} className="fill-background stroke-src-pending transition-all duration-200 ease-out" strokeWidth={1.5} />
      </g>
      {/* dots */}
      {rows.map((r) => {
        const cx = PL + (COLUMN[r.level] + 0.5) * colW, cy = PT + (1 - r.reach) * plotH;
        const right = COLUMN[r.level] < 3;
        return (
          <g key={r.key} role="button" tabIndex={0} className="cursor-pointer outline-none [&:focus-visible>circle:first-child]:stroke-ring"
            aria-label={`${S.actionLabels[r.key]} —${REV_LABEL[REV_ORDER[COLUMN[r.level]]!]}, ${r.reachLabel}. ${r.asks ? "Asks you" : "Goes ahead"}${r.overridden ? " (your override)" : ""}. Activate to switch.`}
            onClick={() => onToggle(r.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(r.key); } }}>
            <circle cx={cx} cy={cy} r={r.overridden ? 11 : 0} className="fill-none stroke-foreground/50" strokeWidth={1.5} strokeDasharray="2 2" />
            <circle cx={cx} cy={cy} r={7} className={`transition-colors duration-200 ${r.asks ? "fill-src-pending" : "fill-src-contract"}`} />
            <text x={right ? cx + 14 : cx - 14} y={cy - 1} textAnchor={right ? "start" : "end"} className="fill-foreground text-[11px]">{SHORT[r.key]}</text>
            <text x={right ? cx + 14 : cx - 14} y={cy + 10} textAnchor={right ? "start" : "end"} className={`font-mono text-[8px] uppercase ${r.asks ? "fill-src-pending" : "fill-muted-foreground"}`}>{r.asks ? "✋ asks you" : "→ goes ahead"}</text>
          </g>
        );
      })}
    </svg>
  );
}
