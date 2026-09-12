// LISTA UPORZĄDKOWANA Z PASKIEM UDZIAŁU (ścieżki, źródła, kraje, poziomy).
//
// DLACZEGO NIE WYKRES SŁUPKOWY. Te zestawy mają etykiety DŁUGIE i o zmiennej
// długości - adres URL, nazwa portalu, klucz poziomu członkostwa. Na wykresie
// kategorialnym takie etykiety albo się urywają, albo zjadają połowę rysunku
// na oś. Lista czyta się tu lepiej, a pasek pod tekstem niesie dokładnie tę
// jedną rzecz, którą wykres dawał: udział pozycji w czołówce.
//
// PASEK JEST MIERZONY OD ZERA DO LIDERA, nie do sumy: pytanie brzmi "jak daleko
// drugiemu do pierwszego", a nie "jaki to ułamek całości" - tę drugą wielkość
// niesie procent obok liczby, i tylko wtedy, gdy wołający poda mianownik.
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { chartLangFrom } from "@/lib/charts/format";
import { formatCount } from "@/lib/admin/dashboard/compare";

export interface RankedRow {
  /** Klucz React i identyfikator wiersza. */
  id: string;
  label: string;
  value: number;
  /** Druga liczba w wierszu (np. sesje obok odsłon). */
  secondary?: number;
  href?: string;
}

export interface RankedListProps {
  rows: RankedRow[];
  /** Nagłówki kolumn - lista bez nich nie mówi, co znaczą liczby. */
  labelHeader: string;
  valueHeader: string;
  secondaryHeader?: string;
  /** Mianownik dla procentu udziału. Bez niego procent się nie pojawia. */
  total?: number;
  emptyLabel?: string;
  className?: string;
  maxRows?: number;
}

export function RankedList({
  rows,
  labelHeader,
  valueHeader,
  secondaryHeader,
  total,
  emptyLabel,
  className,
  maxRows = 8,
}: RankedListProps) {
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const shown = rows.slice(0, maxRows);
  const peak = shown.reduce((max, r) => Math.max(max, r.value), 0);

  if (shown.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-3">
        {emptyLabel ?? t("adminDashboard.state.empty")}
      </p>
    );
  }

  return (
    <table className={cn("w-full text-xs", className)}>
      <thead>
        <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
          <th scope="col" className="text-left font-medium pb-1">
            {labelHeader}
          </th>
          {secondaryHeader ? (
            <th scope="col" className="text-right font-medium pb-1 w-16">
              {secondaryHeader}
            </th>
          ) : null}
          <th scope="col" className="text-right font-medium pb-1 w-20">
            {valueHeader}
          </th>
        </tr>
      </thead>
      <tbody>
        {shown.map((row) => {
          const share = total && total > 0 ? row.value / total : null;
          return (
            <tr key={row.id} className="border-t border-border/50">
              <th scope="row" className="text-left font-normal py-1 pr-2 max-w-0">
                <span className="block truncate" title={row.label}>
                  {row.label}
                </span>
                {/* Pasek jest CZYSTĄ OZDOBĄ WARTOŚCI, którą komórka obok
                    podaje liczbą - stąd `aria-hidden`. Czytnik ekranu, który
                    ogłosiłby go osobno, powtarzałby tę samą wielkość. */}
                <span
                  aria-hidden="true"
                  className="mt-0.5 block h-1 rounded-full bg-muted overflow-hidden"
                >
                  <span
                    className="block h-full rounded-full bg-[var(--chart-1,var(--brand))]"
                    style={{ width: `${peak > 0 ? Math.max(2, (row.value / peak) * 100) : 0}%` }}
                  />
                </span>
              </th>
              {secondaryHeader ? (
                <td className="text-right tabular-nums py-1 text-muted-foreground align-top">
                  {formatCount(row.secondary ?? 0, lang)}
                </td>
              ) : null}
              <td className="text-right tabular-nums py-1 align-top">
                {formatCount(row.value, lang)}
                {share !== null ? (
                  <span className="block text-[10px] text-muted-foreground">
                    {(share * 100).toFixed(share < 0.1 ? 1 : 0)}%
                  </span>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
