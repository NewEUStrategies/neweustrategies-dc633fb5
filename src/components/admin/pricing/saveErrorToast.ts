// Komunikat nieudanego zapisu w edytorach źródłowych S1 (paywall, cennik,
// członkostwo) - JEDNO miejsce rozróżnienia „konflikt" od „błąd".
//
// DLACZEGO. Mutatory S1 (`planQueries`, `tierMutations`, `meteringQueries`,
// `contentAccessQueries`, `useCheckoutSettings`, `retention/mutations`) przy
// nieaktualnym tokenie `updated_at` rzucają błąd z kodem `40001`. To nie jest
// awaria, tylko informacja „ktoś zapisał wcześniej" - admin musi zobaczyć cudzą
// zmianę, a jego szkic ma przetrwać. `toastError` nie zna tego kodu
// (zgłoszenie „Do integracji" PLAN S1 §3.2 pkt 11), a gdyby każdy ekran
// tłumaczył go sam, ten sam konflikt brzmiałby w trzech panelach inaczej.
//
// Szkic NIE jest tu kasowany: akcja „Wczytaj aktualne" woła `onReload`, który
// ekran implementuje po swojemu (paywall nakłada szkic na świeży wiersz,
// ustawienia odświeżają bazę formularza).
import { toast } from "sonner";
import type { TFunction } from "i18next";

import { isStaleWriteError, SYNC_MESSAGE_KEYS } from "@/lib/billing/planQueries";
import { toastError, type ToastErrorKind } from "@/lib/toastError";

export function showSaveError(
  err: unknown,
  t: TFunction,
  onReload: () => void,
  fallback: ToastErrorKind = "save",
): void {
  if (isStaleWriteError(err)) {
    toast.error(t(SYNC_MESSAGE_KEYS.staleWrite), {
      description: t(SYNC_MESSAGE_KEYS.staleWriteHint),
      action: { label: t(SYNC_MESSAGE_KEYS.reload), onClick: onReload },
      cancel: { label: t(SYNC_MESSAGE_KEYS.keepDraft), onClick: () => undefined },
    });
    return;
  }
  toastError(err, fallback);
}
