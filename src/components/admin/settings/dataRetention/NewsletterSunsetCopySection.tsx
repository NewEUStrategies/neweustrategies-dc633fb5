// Molekuła: wejście edytora treści prośby o potwierdzenie (wygaszanie,
// I9d-Y1) na stronie treści maili newslettera.
//
// LENIWY CHUNK: edytor (słownik retencji, zod, zapytania) ładuje się przez
// `lazy()` dopiero, gdy ma się pokazać - sekcja newslettera go nie niesie.
//
// KTO WIDZI. Wyłącznie administrator najemcy - te same role co bramka
// `requireAdmin` funkcji serwerowych treści prośby (admin, super_admin);
// redaktor newslettera dostałby tylko odmowę. To NIE jest bramka trasy (tę
// trzyma layout `/admin`, `adminRouteAuthority.gate.test.ts`), tylko zgodność
// widoku z regułą serwera: panel nie pokazuje sekcji, której zapis i tak
// zostałby odrzucony. Bez najemcy sesji (render serwera) sekcji nie ma.
import { lazy, Suspense } from "react";

import { useAuth } from "@/hooks/useAuth";

const NewsletterSunsetCopyEditor = lazy(() => import("./NewsletterSunsetCopyEditor"));

export function NewsletterSunsetCopySection() {
  const { tenantId, isAdmin } = useAuth();
  if (!tenantId || !isAdmin) return null;
  return (
    <Suspense fallback={null}>
      <NewsletterSunsetCopyEditor tenantId={tenantId} />
    </Suspense>
  );
}
