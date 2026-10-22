// Organizm: treść zgody i pomiar otwarć i kliknięć w przeglądzie newslettera
// (I9d-Y2) - leniwy chunk ładowany przez `NewsletterMeasurementSection`.
//
// Dwie karty: treść zgody PL/EN z ostrzeżeniem i oznaczeniem admina (admin
// i redaktor - edytują treść) oraz „Poproś o zgodę na pomiar" ze wspólnym
// przełącznikiem pomiaru (wyłącznie admin - te same role co bramki serwera).
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
      <ConsentTextCard canMark={isAdmin} />
      {isAdmin ? <MeasurementRequestCard tenantId={tenantId} /> : null}
    </div>
  );
}
