// Shared types for the admin onboarding primitive: a data-driven TourStep and
// the controller object returned by useOnboardingTour and consumed by
// CoachmarkTour.
export type TourPlacement = "top" | "bottom" | "left" | "right";

export interface TourStep {
  /** Stable id for the step (used as a React key). */
  id: string;
  /**
   * Value of a `data-tour="…"` attribute on the element to spotlight. Omit for
   * a centered, anchorless step (e.g. a welcome/finish card).
   */
  anchor?: string;
  /** i18n key paths resolved with useTranslation() inside the overlay. */
  titleKey: string;
  bodyKey: string;
  /** Preferred tooltip side; the overlay flips it when it would overflow. */
  placement?: TourPlacement;
}

export interface TourController {
  active: boolean;
  stepIndex: number;
  currentStep: TourStep | null;
  totalSteps: number;
  /** Force-start from step 0, ignoring the dismissed flag (replay button). */
  start: () => void;
  next: () => void;
  prev: () => void;
  /** Dismiss + persist (Skip / Esc / backdrop click). */
  skip: () => void;
  /** Dismiss + persist (finished the last step). */
  finish: () => void;
}
