// Atom: kwota rozliczeniowa jako element MASZYNOWO CZYTELNY.
//
// Kwota jest formatowana pod język strony (`formatMoney`), ale trafia też do
// `<data value="4900:PLN">`. Powód jest praktyczny, nie akademicki: przy
// zgłoszeniu „widziałem inną kwotę" wsparcie musi umieć odczytać ze zrzutu DOM
// grosze i walutę, bez odgadywania ich z tekstu sformatowanego przez ICU dla
// nieznanej lokalizacji. Ten sam atrybut pozwala testom sprawdzać KWOTĘ, a nie
// napis - a napis zależy od wersji ICU w środowisku.
//
// Kontrakt dostępności: element niesie widoczny, sformatowany tekst; `value`
// jest dodatkiem, nie zamiennikiem.
import { useTranslation } from "react-i18next";

import { formatMoney } from "@/lib/billing/types";

export function MoneyText({
  cents,
  currency,
  className,
}: {
  cents: number;
  currency: string;
  className?: string;
}) {
  const { i18n } = useTranslation();
  return (
    <data value={`${cents}:${currency}`} className={className}>
      {formatMoney(cents, currency, i18n.language)}
    </data>
  );
}
