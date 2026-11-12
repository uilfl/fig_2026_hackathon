/** Tour progress, per browser. Kept apart from the demo store so "Reset demo" doesn't forget you've seen it. */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_SCENARIO } from "./scenarios";

export const TOUR_STORAGE_KEY = "cosign.tour";

type TourState = {
  /** A step is showing (0 = intro card). */
  active: boolean;
  step: number;
  /** Case the tour walks through. */
  caseId: string;
  /** Finished or skipped once: the intro no longer opens by itself. */
  seen: boolean;
  open: () => void;
  start: (caseId: string, step: number) => void;
  go: (step: number) => void;
  close: () => void;
};

export const useTour = create<TourState>()(
  persist(
    (set) => ({
      // First visit: the intro shows.
      active: true,
      step: 0,
      caseId: DEFAULT_SCENARIO,
      seen: false,
      open: () => set({ active: true, step: 0 }),
      start: (caseId, step) => set({ active: true, step, caseId }),
      go: (step) => set({ step }),
      close: () => set({ active: false, step: 0, seen: true }),
    }),
    {
      name: TOUR_STORAGE_KEY,
      // Demo data resets on reload, so only "seen" and the case survive; an unfinished tour starts over at the intro.
      partialize: (s) => ({ seen: s.seen, caseId: s.caseId }),
      merge: (saved, current) => {
        const p = (saved ?? {}) as Partial<TourState>;
        return { ...current, ...p, active: !p.seen, step: 0 };
      },
    },
  ),
);
