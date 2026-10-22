// Sonda licznika Diagnostyki na pasku huba (Z-S6-08; Integrator S7, 2026-10-22).
//
// DLACZEGO OSOBNY, LENIWY MODUŁ. Licznik to „otwarte krytyczne + ważne minus
// obowiązujące wyciszenia", więc liczy go ocena całego rejestru 55 reguł
// (`useDiagnosticsBadgeCount` → `evaluateFindings`). Statyczny import haka
// w `RevenueHubLayout` wciągnąłby rejestr, fakty i słownik reguł do chunku
// układu `/admin/revenue`, ładowanego przy KAŻDEJ zakładce (budżet D-08).
// Układ montuje tę sondę przez `React.lazy`: rejestr przyjeżdża we
// wspólnym chunku zapytań diagnostyki, który zakładka Diagnostyka, Kokpit
// (`AttentionCard`) i chipy w modułach i tak ładują.
//
// BEZ DODATKOWYCH ŻĄDAŃ. Hak czyta fakty i wyciszenia spod tych samych kluczy
// (`revenueKeys.facts/snoozes`) co zakładka - na Diagnostyce i Kokpicie sonda
// nie wysyła niczego nowego.
//
// SONDA NIC NIE RYSUJE. Liczbę oddaje układowi (`onCount`), a znacznik licznika
// zostaje w jednym miejscu (`HubTabLink`) - geometria taka sama jak dla
// przyszłego licznika Ścieżek (S8). `null` = nie wiadomo (ładowanie, odmowa,
// brak faktów): pasek nie pokazuje wtedy „0", które znaczyłoby „czysto".
// Odmontowanie (zmiana najemcy, utrata roli) zeruje licznik do `null`.
import { useEffect } from "react";

import { useDiagnosticsBadgeCount } from "@/lib/revenue/diagnostics/queries";

export interface DiagnosticsBadgeProbeProps {
  tenantId: string;
  /** Rola, o którą pyta `admin_revenue_facts()`: `admin` albo `editor`. */
  roleOk: boolean;
  onCount: (count: number | null) => void;
}

export function DiagnosticsBadgeProbe({ tenantId, roleOk, onCount }: DiagnosticsBadgeProbeProps) {
  const count = useDiagnosticsBadgeCount(tenantId, { roleOk });

  useEffect(() => {
    onCount(count);
  }, [count, onCount]);

  useEffect(() => () => onCount(null), [onCount]);

  return null;
}
