// Jedna semantyka toastów dla mutacji masowych (posty, strony, kosz).
// Serwer zwraca uczciwy wynik (BulkResult: count = wiersze realnie zmienione,
// requested = zadane), a ten helper mapuje go na sukces / częściowe
// niepowodzenie / odmowę - zamiast fałszywego "zrobiono N" liczonego z żądania.
import { toast } from "sonner";
import type { TFunction } from "i18next";
import type { BulkResult } from "@/lib/content.functions";

/**
 * Pokazuje toast adekwatny do realnego wyniku mutacji masowej.
 *
 * @param t          - funkcja tłumaczeń (i18next)
 * @param result     - uczciwy wynik z serwera ({ count, requested })
 * @param successKey - klucz i18n komunikatu pełnego sukcesu (z {{count}})
 * @returns true, gdy przynajmniej jeden wiersz został zmieniony
 */
export function toastBulkResult(t: TFunction, result: BulkResult, successKey: string): boolean {
  if (result.count === 0) {
    toast.error(
      t("admin.bulkResult.none", {
        defaultValue: "Nie wykonano - brak uprawnień lub elementy juz nie istnieją",
      }),
    );
    return false;
  }
  if (result.count < result.requested) {
    toast.warning(
      t("admin.bulkResult.partial", {
        defaultValue:
          "Wykonano {{count}} z {{requested}} - pozostałe odrzucone (brak uprawnień lub element nie istnieje)",
        count: result.count,
        requested: result.requested,
      }),
    );
    return true;
  }
  toast.success(t(successKey, { count: result.count }));
  return true;
}
