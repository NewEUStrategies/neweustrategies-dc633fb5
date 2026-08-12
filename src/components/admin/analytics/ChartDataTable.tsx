import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-analytics";

/**
 * Tekstowa alternatywa dla wykresu BI: te same dane, w tabeli.
 *
 * PO CO. Wykresy panelu renderuje ECharts do KANWY, a kanwa jest dla czytnika
 * ekranu pusta - bez tego komponentu caly pulpit analityczny byl dla osoby
 * niewidzacej zbiorem nieopisanych prostokatow. Silnik redakcyjny rozwiazal to
 * u siebie inaczej (SVG z `role="img"` plus lista `.sr-only` - patrz
 * `components/charts/CartesianChart.tsx:266`), ale tamta droga wymaga wlasnego
 * renderera; tutaj dane i tak jada obok wykresu na potrzeby eksportu CSV, wiec
 * tansza i uczciwsza jest tabela z tego samego zrodla.
 *
 * DLACZEGO `<details>`, a nie przelacznik na stanie. Ujawnianie tresci to
 * dokladnie semantyka `<details>/<summary>`: dziala bez JS, ma wbudowana
 * obsluge klawiatury i jest ogloszone jako grupa zwijana bez ani jednego
 * atrybutu ARIA. Tabela zostaje w DRZEWIE dostepnosci nawet zamknieta, wiec
 * czytnik dociera do danych bez rozwijania.
 *
 * Szerokie tabele przewijaja sie WEWNATRZ swojego kontenera (`overflow-x-auto`),
 * bo pulpit ma siatke dwukolumnowa od `lg` i pozioma rolka na stronie psulaby
 * uklad pozostalych kafli.
 */
export interface ChartDataTableProps {
  /** Tytul wykresu - wchodzi w dostepna nazwe tabeli. */
  readonly title: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  /** `id` do powiazania z regionem wykresu przez `aria-describedby`. */
  readonly id?: string;
}

/** Format komorki: liczby wyrownane do prawej, `null`/`undefined` jako pauza. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString() : "-";
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

function isNumeric(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Czy z tych danych powstanie tabela.
 *
 * Regula pustosci MUSI byc jedna dla komponentu i dla wolajacego: karta wiaze
 * region wykresu z tabela przez `aria-describedby`, wiec gdyby liczyla pustosc
 * osobno, przy zerowym zbiorze (pulpit w trakcie ladowania albo raport, ktory
 * legalnie nie ma wynikow) region wskazywalby na element, ktorego nie ma -
 * czytnik obiecuje opis i nie dostarcza go. Dlatego predykat mieszka TUTAJ,
 * obok warunku renderowania.
 */
export function hasChartTableData(
  csv: { headers: readonly string[]; rows: readonly (readonly unknown[])[] } | undefined,
): boolean {
  return csv !== undefined && csv.headers.length > 0 && csv.rows.length > 0;
}

export function ChartDataTable({ title, headers, rows, id }: ChartDataTableProps) {
  const { t } = useTranslation();

  if (!hasChartTableData({ headers, rows })) return null;

  return (
    <details id={id} className="group border-t border-border/60 px-4 py-2">
      <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        {t("adminAnalytics.chartCard.dataTable")}
      </summary>
      <p className="mt-1 text-[11px] text-muted-foreground/80">
        {t("adminAnalytics.chartCard.dataTableHint")}
      </p>
      <div className="mt-2 max-h-64 overflow-x-auto overflow-y-auto">
        <table className="w-full border-collapse text-left text-xs">
          <caption className="sr-only">
            {t("adminAnalytics.chartCard.chartRegion", { title })}
          </caption>
          <thead className="sticky top-0 bg-card">
            <tr>
              {headers.map((header) => (
                <th
                  key={header}
                  scope="col"
                  className="border-b border-border/60 px-2 py-1 font-medium text-muted-foreground"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="odd:bg-muted/30">
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={
                      "border-b border-border/40 px-2 py-1 " +
                      (isNumeric(cell) ? "text-right tabular-nums" : "")
                    }
                  >
                    {cellText(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
