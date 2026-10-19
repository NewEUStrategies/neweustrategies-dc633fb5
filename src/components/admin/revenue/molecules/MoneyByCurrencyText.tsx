// Molekuła: kwota per waluta - waluta preferowana na wierzchu, pozostałe pod
// „+ N inne waluty" (SPEC §6.1, I5).
//
// NIGDY SUMA. Najemca sprzedaje w PLN, EUR i USD naraz; „12 400" złożone
// z 10 000 PLN i 2 400 EUR nie jest żadną kwotą, a kurs z dnia odczytu
// przepisywałby historię przy każdym odświeżeniu. Ten komponent NIE MA więc
// ani jednego dodawania - pokazuje pozycje listy `MoneyByCurrency` jedna po
// drugiej, a wybór „preferowanej" zmienia tylko kolejność.
//
// `null` ≠ `[]` ≠ 0 (`lib/revenue/money.ts`). `null` to brak danych (rola nie
// widzi kwot, RPC nie odpowiedział) i mówi „brak danych" słowem; `[]` to
// zmierzone „nic" w oknie - zero, a nie kreska, bo przychodu naprawdę nie było.
//
// FORMAT Z `Intl` przez `formatMoneyMinor` (wykładnik waluty z ICU: JPY 0,
// PLN 2) - bez tabel walut w kodzie i bez warunków na język.
//
// POPOVER, NIE DYMEK. Lista walut jest treścią, którą admin czyta i kopiuje,
// a dymek znika po zjechaniu myszą i nie działa na dotyku. Przycisk ma pełną
// nazwę („+2 inne waluty"), więc czytnik wie, co rozwija.
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatMoneyMinor } from "@/lib/analytics/semantic/format";
import type { ChartLang } from "@/lib/charts/format";
import { ensureI18n } from "@/lib/i18n-admin-revenue-shell";
import type { MoneyByCurrency } from "@/lib/revenue/money";
import { cn } from "@/lib/utils";

export interface MoneyByCurrencyTextProps {
  /** Lista kwot; `null` = brak danych. */
  amounts: readonly MoneyByCurrency[] | null;
  /** Waluta pokazywana na wierzchu (filtr `?cur=` albo waluta wiodąca). */
  preferred?: string;
  lang: ChartLang;
  className?: string;
}

/** Pozycje w kolejności wyświetlania: preferowana pierwsza, reszta jak z serwera. */
function ordered(amounts: readonly MoneyByCurrency[], preferred?: string): MoneyByCurrency[] {
  const first = preferred ? amounts.find((a) => a.currency === preferred) : undefined;
  return first ? [first, ...amounts.filter((a) => a !== first)] : [...amounts];
}

export function MoneyByCurrencyText({
  amounts,
  preferred,
  lang,
  className,
}: MoneyByCurrencyTextProps) {
  ensureI18n();
  const { t } = useTranslation();

  if (amounts === null) {
    return (
      <span data-money="no-data" className={cn("text-muted-foreground", className)}>
        {t("adminRevenue.money.noData")}
      </span>
    );
  }

  if (amounts.length === 0) {
    // Zmierzone „nic": w walucie preferowanej, jeśli ją znamy - inaczej samo
    // zero (kwota bez waluty nie istnieje, więc nie zgadujemy złotówek).
    const zero = preferred ? formatMoneyMinor(0, preferred, lang) : "0";
    return (
      <span data-money="zero" className={cn("tabular-nums", className)}>
        {zero === "-" ? "0" : zero}
      </span>
    );
  }

  const [head, ...rest] = ordered(amounts, preferred);

  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-1.5", className)}>
      <span data-money="primary" data-currency={head.currency} className="tabular-nums">
        {formatMoneyMinor(head.amountMinor, head.currency, lang)}
      </span>
      {rest.length > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-[11px] font-medium text-muted-foreground"
            >
              {t("adminRevenue.money.otherCurrencies", { count: rest.length })}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            aria-label={t("adminRevenue.money.perCurrency")}
            className="w-64 space-y-2 p-3 text-sm"
          >
            <p className="text-xs font-medium text-foreground">
              {t("adminRevenue.money.perCurrency")}
            </p>
            <ul className="space-y-1">
              {[head, ...rest].map((entry) => (
                <li
                  key={entry.currency}
                  data-currency={entry.currency}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="text-xs text-muted-foreground">{entry.currency}</span>
                  <span className="tabular-nums">
                    {formatMoneyMinor(entry.amountMinor, entry.currency, lang)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t("adminRevenue.money.neverSummed")}
            </p>
          </PopoverContent>
        </Popover>
      ) : null}
    </span>
  );
}
