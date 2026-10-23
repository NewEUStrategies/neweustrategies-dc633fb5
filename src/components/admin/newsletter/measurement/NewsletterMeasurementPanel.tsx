// Organizm: treść zgody i pomiar otwarć i kliknięć w przeglądzie newslettera
// (I9d-Y2, I9d-Y2b) - leniwy chunk ładowany przez `NewsletterMeasurementSection`.
//
// Dwie karty: treść zgody na newsletter PL/EN z podglądem osobnego pola
// zgody na pomiar (admin i redaktor - edytują treść; od I9d-Y2b bez
// oznaczeń admina, więc karta nie potrzebuje roli) oraz „Poproś o zgodę na
// pomiar" ze wspólnym przełącznikiem pomiaru (wyłącznie admin - te same
// role co bramki serwera).
import { ConsentTextCard } from "./ConsentTextCard";
import { MeasurementRequestCard } from "./MeasurementRequestCard";

export default function NewsletterMeasurementPanel({
  tenantId,
  isAdmin,
}: {
  tenantId: string;
  isAdmin: boolean;
}) {
  return (
    <div className="space-y-6">
      <ConsentTextCard />
      {isAdmin ? <MeasurementRequestCard tenantId={tenantId} /> : null}
    </div>
  );
}
