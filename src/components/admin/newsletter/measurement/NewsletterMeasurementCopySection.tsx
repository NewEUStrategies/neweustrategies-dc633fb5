// Molekuła: wejście edytora treści maila „Poproś o zgodę na pomiar" (I9d-Y2)
// na stronie treści maili newslettera.
//
// LENIWY CHUNK: edytor (słowniki, zod, zapytania) ładuje się przez `lazy()`
// dopiero, gdy ma się pokazać - sekcja newslettera go nie niesie.
//
// KTO WIDZI. Wyłącznie administrator najemcy - te same role co bramka
// `requireAdmin` funkcji serwerowych treści prośby (admin, super_admin);
// redaktor dostałby tylko odmowę. To NIE jest bramka trasy (tę trzyma layout
// `/admin`), tylko zgodność widoku z regułą serwera. Bez najemcy sesji
// (render serwera) sekcji nie ma.
import { lazy, Suspense } from "react";

import { useAuth } from "@/hooks/useAuth";

const NewsletterMeasurementCopyEditor = lazy(() => import("./NewsletterMeasurementCopyEditor"));

export function NewsletterMeasurementCopySection() {
  const { tenantId, isAdmin } = useAuth();
  if (!tenantId || !isAdmin) return null;
  return (
    <Suspense fallback={null}>
      <NewsletterMeasurementCopyEditor />
    </Suspense>
  );
}
