// Przewodnik po Ścieżkach (I9, Z-S8-01): zakładka huba i edytor ścieżki.
//
// Kroki i napisy dał S8 (`JOURNEYS_TOUR_STEPS`, `JOURNEY_EDITOR_TOUR_STEPS`,
// `admin.onboarding.journeys*` w słowniku rdzenia panelu), kotwice
// `data-tour` stoją w komponentach S8. Tu jest wyłącznie montaż.
//
// DLACZEGO NAKŁADKA LENIWIE. `CoachmarkTour` jest potrzebny raz w życiu
// przeglądarki (zamknięcie zapisuje się w `localStorage`), więc statyczny
// import dokładałby jego kod do chunku zakładki przy każdym wejściu. Hak
// stanu jest mały i zostaje statyczny - nakładka dociąga się dopiero, gdy
// przewodnik naprawdę rusza.
//
// DLACZEGO `ready`. Hak startuje jedną klatkę po włączeniu; kotwice muszą już
// stać w drzewie (lista wczytana, kanwa narysowana), inaczej pierwszy krok
// trafiłby na środek ekranu zamiast na element, który opisuje.
import { lazy, Suspense } from "react";

import type { TourStep } from "@/lib/onboarding/types";
import { useOnboardingTour } from "@/lib/onboarding/useOnboardingTour";

const CoachmarkTour = lazy(() =>
  import("@/components/admin/onboarding/CoachmarkTour").then((mod) => ({
    default: mod.CoachmarkTour,
  })),
);

/** Identyfikatory przewodników Ścieżek - klucze zamknięcia w `tourStorage`. */
export type JourneyTourId = "journeys" | "journey-editor";

export function JourneyTour({
  id,
  steps,
  ready,
}: {
  id: JourneyTourId;
  steps: TourStep[];
  /** Kotwice przewodnika są już w drzewie (dane wczytane, widok narysowany). */
  ready: boolean;
}) {
  const tour = useOnboardingTour({ id, steps, enabled: ready });
  if (!tour.active) return null;
  return (
    <Suspense fallback={null}>
      <CoachmarkTour controller={tour} />
    </Suspense>
  );
}
