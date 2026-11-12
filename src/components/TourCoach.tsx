import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ledgerQuery } from "@/lib/queries";
import { getState, sortedLedger } from "@/lib/store";
import { SCENARIO_LIST, scenarioOf } from "@/lib/scenarios";
import { LAST_STEP, nextStep, prevStep, settle, TOUR, type TourRoute } from "@/lib/tour";
import { useTour } from "@/lib/tour-store";
import { Button } from "@/components/ui/button";

/** Card width and spacing around the highlighted element (px). */
const CARD_W = 340;
const GAP = 12;
const RING_PAD = 6;
/** Below this width the card docks to the bottom of the screen. */
const NARROW = 640;
const PAGE_NAME: Record<TourRoute, string> = {
  "/contract": "Contract",
  "/run": "Run",
  "/ledger": "Receipts",
};

type Box = { top: number; left: number; width: number; height: number };
const sameBox = (a: Box | null, b: Box | null) =>
  !!a &&
  !!b &&
  a.top === b.top &&
  a.left === b.left &&
  a.width === b.width &&
  a.height === b.height;

/** Where the step's target is on screen, tracked every frame while the tour shows (scroll, resize, late renders). */
function useTargetBox(target: string | null, enabled: boolean): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  const scrolled = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !target) {
      setBox(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
      if (el && scrolled.current !== target) {
        scrolled.current = target;
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      const r = el?.getBoundingClientRect();
      const next =
        r && r.width ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
      setBox((prev) => (sameBox(prev, next) || (!prev && !next) ? prev : next));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      scrolled.current = null;
    };
  }, [target, enabled]);
  return box;
}

/** Card position next to the target: below if there's room, else above, else centred. */
function place(box: Box | null, cardH: number): React.CSSProperties {
  const vw = window.innerWidth,
    vh = window.innerHeight;
  if (vw < NARROW) return { left: GAP, right: GAP, bottom: GAP };
  if (!box) return { left: (vw - CARD_W) / 2, top: Math.max(GAP, (vh - cardH) / 2) };
  const left = Math.min(Math.max(GAP, box.left), vw - CARD_W - GAP);
  const below = box.top + box.height + GAP;
  if (below + cardH < vh) return { left, top: below };
  if (box.top - GAP - cardH > 0) return { left, top: box.top - GAP - cardH };
  // Tall target: sit beside it, or at the bottom edge.
  const side = box.left + box.width + GAP;
  if (side + CARD_W < vw)
    return { left: side, top: Math.max(GAP, Math.min(box.top, vh - cardH - GAP)) };
  if (box.left - GAP - CARD_W > 0)
    return {
      left: box.left - GAP - CARD_W,
      top: Math.max(GAP, Math.min(box.top, vh - cardH - GAP)),
    };
  return { left, bottom: GAP };
}

/** The guided walkthrough's coachmark: an intro card to pick a case, then one card per step on the real UI. */
export function TourCoach() {
  const { active, step, caseId, start, go, close } = useTour();
  const { data: ledger = [] } = useQuery(ledgerQuery);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(0);
  const S = scenarioOf(caseId);
  const s = TOUR[step];
  const here = !!s && (s.route === null || s.route === pathname);
  const box = useTargetBox(s?.target ?? null, active && here);

  // Doing what the step asks moves the tour on.
  useEffect(() => {
    if (!active || step === 0) return;
    const to = settle(step, ledger);
    if (to !== step) go(Math.min(to, LAST_STEP));
  }, [active, step, ledger, go]);

  useEffect(() => {
    if (active) cardRef.current?.focus({ preventScroll: true });
  }, [active, step]);
  // Measure the card after each render; the guard stops the update loop once the height is stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs every render
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight ?? 0;
    if (h !== cardH) setCardH(h);
  });

  if (!active || !s) return null;

  async function begin(id: string) {
    await qc.cancelQueries();
    getState().reset(id);
    await qc.invalidateQueries();
    await navigate({ to: "/contract" });
    start(id, nextStep(0, sortedLedger()));
  }
  /** Moving to a step on another page takes you there. */
  const goTo = (n: number) => {
    const r = TOUR[n]?.route;
    if (r && r !== pathname) void navigate({ to: r });
    go(n);
  };
  const next = () => {
    const n = nextStep(step, ledger);
    if (n > LAST_STEP) close();
    else goTo(n);
  };
  const waiting = !!s.done && !s.done(ledger);
  const titleId = "tour-title";
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };

  if (step === 0) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/20 p-4 sm:items-center"
        onKeyDown={onKey}
      >
        <div
          ref={cardRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="w-full max-w-xl border-2 border-foreground bg-card p-6 shadow-xl outline-none rise-in"
        >
          <p className="stamp inline-block text-muted-foreground">Guided tour</p>
          <h2 id={titleId} className="mt-3 text-3xl">
            {s.title}
          </h2>
          <p className="mt-3 text-sm leading-relaxed">{s.body(S)}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {SCENARIO_LIST.map((x) => {
              const pref = x.options.find((o) => o.name === x.preference)!;
              return (
                <button
                  key={x.id}
                  onClick={() => {
                    void begin(x.id);
                  }}
                  className="flex flex-col items-start gap-1 border border-border bg-background p-4 text-left hover:border-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="font-display text-xl">{x.title}</span>
                  <span className="text-sm text-muted-foreground">{x.blurb}</span>
                  <span className="mt-1 text-xs">
                    The {x.agents.venue} and {x.agents.budget} will clash over {pref.name}.
                  </span>
                  <span className="mt-2 font-mono text-[10px] uppercase text-accent">
                    Start this tour →
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Starting resets the demo to a fresh run of that case.
          </p>
          <div className="mt-4 flex justify-end">
            <Button variant="ghost" onClick={close}>
              Skip the tour
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const pos = place(here ? box : null, cardH);
  return (
    <>
      {here && box && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-40 rounded-sm ring-2 ring-accent ring-offset-2 ring-offset-background transition-all duration-200 ease-out"
          style={{
            top: box.top - RING_PAD,
            left: box.left - RING_PAD,
            width: box.width + RING_PAD * 2,
            height: box.height + RING_PAD * 2,
          }}
        />
      )}
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        onKeyDown={onKey}
        className="fixed z-50 border-2 border-foreground bg-card p-4 shadow-xl outline-none"
        style={{ width: window.innerWidth < NARROW ? undefined : CARD_W, ...pos }}
      >
        <p className="font-mono text-[10px] uppercase text-muted-foreground">
          {S.title} · Step {step} of {LAST_STEP}
        </p>
        <h2 id={titleId} className="mt-1 text-xl">
          {s.title}
        </h2>
        {here ? (
          <p className="mt-2 text-sm leading-relaxed">{s.body(S)}</p>
        ) : (
          <p className="mt-2 text-sm">
            This step is on {PAGE_NAME[s.route!]}.{" "}
            <Link to={s.route!} className="underline underline-offset-4">
              Go to {PAGE_NAME[s.route!]} →
            </Link>
          </p>
        )}
        {here && s.target && !box && (
          <p className="mt-2 text-xs text-muted-foreground">
            Nothing to point at right now — press Next.
          </p>
        )}
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="px-0" onClick={close}>
            Skip tour
          </Button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <Button variant="outline" size="sm" onClick={() => goTo(prevStep(step, ledger))}>
                Back
              </Button>
            )}
            {waiting && here && box && (
              <span className="font-mono text-[10px] uppercase text-accent">{s.hint}</span>
            )}
            {(!waiting || s.skippable || !box) && (
              <Button size="sm" onClick={next}>
                {step === LAST_STEP ? "Finish" : "Next"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
