// Molekuła: wejście sekcji „treść zgody i pomiar" (I9d-Y2) w przeglądzie
// newslettera (`/admin/newsletter/overview`).
//
// LENIWY CHUNK: karty (słownik panelu zgody, zapytania, sanitizer podglądu,
// okno potwierdzenia) ładują się przez `lazy()` dopiero, gdy mają się
// pokazać - przegląd newslettera ich nie niesie (budżet D-08).
//
// KTO WIDZI. Administrator i redaktor (treść zgody na newsletter zapisują
// oboje - `admin_newsletter_settings_patch`); prośbę o zgodę na pomiar
// i przełącznik pomiaru - wyłącznie administrator. To NIE jest bramka trasy (tę trzyma layout `/admin`), tylko
// zgodność widoku z regułą serwera: panel nie pokazuje sekcji, której odczyt
// i tak zostałby odrzucony. Bez najemcy sesji (render serwera) sekcji nie ma.
import { lazy, Suspense } from "react";

import { useAuth } from "@/hooks/useAuth";

const NewsletterMeasurementPanel = lazy(() => import("./NewsletterMeasurementPanel"));

export function NewsletterMeasurementSection() {
  const { tenantId, isAdmin, roles } = useAuth();
  const canEdit = isAdmin || roles.includes("editor");
  if (!tenantId || !canEdit) return null;
  return (
    <Suspense fallback={null}>
      <NewsletterMeasurementPanel tenantId={tenantId} isAdmin={isAdmin} />
    </Suspense>
  );
}
