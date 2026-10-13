// Atom: podgląd kwoty wpisanej w pole ceny (TIX-14a) - „899,00 zł" dokładnie
// tak, jak zobaczy ją kupujący, liczony z TEGO SAMEGO parsera, którym formularz
// zamienia tekst na grosze (`parseMoneyInput`).
//
// PO CO. Pole ceny mówi w jednostce głównej waluty, a parser odmawia zapisów
// niejednoznacznych („8,999"). Podgląd obok pola pokazuje, co z wpisu zostanie
// zapisane, zanim redaktor kliknie „Zapisz" - zapis, którego nie da się
// przeczytać, nie ma podglądu, a komunikat przy polu pojawia się przy zapisie.
//
// MIEJSCE JEST STAŁE. Atom rezerwuje szerokość także wtedy, gdy nie ma czego
// pokazać - inaczej pole skakałoby w bok przy każdej literze, która psuje albo
// naprawia kwotę. Podgląd nie jest regionem `aria-live`: czytnik ekranu czyta
// wartość pola, a ogłaszanie kwoty po każdym znaku byłoby szumem.
import { useTranslation } from "react-i18next";

import { parseMoneyInput } from "@/lib/billing/moneyInput";
import { formatMoney } from "@/lib/billing/types";
import { cn } from "@/lib/utils";

export function MoneyInputPreview({
  value,
  currency,
  className,
}: {
  /** Tekst pola ceny w jednostce głównej waluty. */
  value: string;
  /** Kod waluty biletu (`PLN`, `EUR`). */
  currency: string;
  className?: string;
}) {
  const { i18n } = useTranslation();
  const cents = parseMoneyInput(value);
  return (
    <span
      data-money-preview=""
      className={cn(
        "min-w-[6.5rem] shrink-0 text-right text-xs tabular-nums text-muted-foreground",
        className,
      )}
    >
      {cents === null ? "" : formatMoney(cents, currency, i18n.language)}
    </span>
  );
}
