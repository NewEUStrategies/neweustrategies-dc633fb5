// Reusable onboarding-tour hook. Owns active/step state, auto-starts once per
// tour id when not dismissed (deferred one animation frame so the editor's
// data-tour anchors are mounted before the overlay measures them), persists
// dismissal on skip/finish, and exposes imperative controls. No DOM /
// positioning concerns — that lives in CoachmarkTour.
import { useCallback, useEffect, useState } from "react";
import type { TourStep, TourController } from "./types";
import { isTourDismissed, dismissTour } from "./tourStorage";

export function useOnboardingTour(opts: {
  id: string;
  steps: TourStep[];
  /** Gate auto-start (e.g. wait for data to load). Default true. */
  enabled?: boolean;
  /** Auto-start once if not dismissed. Default true. */
  autoStart?: boolean;
}): TourController {
  const { id, steps, enabled = true, autoStart = true } = opts;
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!enabled || !autoStart || steps.length === 0) return;
    if (isTourDismissed(id)) return;
    // Defer so the editor's data-tour anchors exist before the overlay measures.
    const raf = requestAnimationFrame(() => setActive(true));
    return () => cancelAnimationFrame(raf);
  }, [enabled, autoStart, id, steps.length]);

  const finish = useCallback(() => {
    setActive(false);
    dismissTour(id);
  }, [id]);

  const skip = finish; // identical persistence

  const start = useCallback(() => {
    setStepIndex(0);
    setActive(true);
  }, []);

  const prev = useCallback(() => setStepIndex((i) => Math.max(0, i - 1)), []);

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i + 1 >= steps.length) {
        finish();
        return i;
      }
      return i + 1;
    });
  }, [steps.length, finish]);

  return {
    active,
    stepIndex,
    currentStep: active ? (steps[stepIndex] ?? null) : null,
    totalSteps: steps.length,
    start,
    next,
    prev,
    skip,
    finish,
  };
}
