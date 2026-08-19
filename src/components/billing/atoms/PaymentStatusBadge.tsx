// Atom: znacznik STANU PŁATNOŚCI.
//
// Kolor bierze z jednej reguły (`paymentStatusTone`), a napis ze słownika - do
// 19.08.2026 obie decyzje istniały w trzech kopiach z RÓŻNYMI zestawami stanów
// „czerwonych", więc ta sama płatność miała różny kolor w zależności od karty.
//
// Kontrakt dostępności: kolor NIE MOŻE być jedynym nośnikiem informacji, więc
// znacznik zawsze niesie tekst stanu. Dodatkowo `data-status` z surową wartością
// z bazy - dla testów i dla wsparcia, żeby dało się odpowiedzieć „co dokładnie
// widział klient", bez zgadywania z tłumaczenia.
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { paymentStatusTone } from "@/lib/billing/statusTone";

export function PaymentStatusBadge({
  status,
  /** Prefiks klucza tłumaczenia; domyślnie wspólny słownik profilu. */
  labelPrefix = "profile.status",
  className,
}: {
  status: string;
  labelPrefix?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Badge variant={paymentStatusTone(status)} className={className} data-status={status}>
      {t(`${labelPrefix}.${status}`)}
    </Badge>
  );
}
