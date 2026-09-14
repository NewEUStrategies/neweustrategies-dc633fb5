// Lista uwag audytu marki - jeden wiersz na problem, z plakietką wagi.
//
// PO CO OSOBNY KOMPONENT. Ten sam wiersz rysowały DWA ekrany: kokpit
// (`/admin/seo`) i zakładka strony głównej (`/admin/seo/homepage`). Dwie kopie
// tego samego JSX-a to dwa miejsca, w których kolor wagi albo klucz komunikatu
// może się rozjechać - a rozjazd jest niewidoczny, dopóki ktoś nie otworzy obu
// ekranów obok siebie i nie porówna.
//
// DRUGI POWÓD, RÓWNIE KONKRETNY. Obie trasy podają audytowi wartości, które
// ZAWSZE mają fallback (tytuł spada na stałą marki, karta na plik marki), więc
// waga `error` jest tam nieosiągalna z konstrukcji. Gałąź obsługująca błąd
// istniała w obu plikach i w obu była martwa dla testów: nie dało się jej
// wykonać bez podstawiania nieprawdziwych danych. Tutaj jest wejściem funkcji,
// więc jej zachowanie dowodzi się wprost - a progi pokrycia tras przestają
// zależeć od tego, czy akurat da się wyprodukować błąd.
import { useTranslation } from "react-i18next";
import type { BrandFinding } from "@/lib/seo/brandAudit";

export interface BrandFindingListProps {
  findings: readonly BrandFinding[];
  /** Klucz komunikatu pokazywanego, gdy nie ma ani jednej uwagi. */
  emptyKey: string;
}

export function BrandFindingList({ findings, emptyKey }: BrandFindingListProps) {
  const { t } = useTranslation();
  if (!findings.length) {
    return <p className="text-xs text-muted-foreground">{t(emptyKey)}</p>;
  }
  return (
    <ul className="space-y-2">
      {findings.map((finding) => {
        const isError = finding.severity === "error";
        return (
          <li
            key={finding.id}
            data-testid="brand-finding"
            data-severity={finding.severity}
            className="flex items-start gap-2 rounded-lg border border-border bg-card p-3"
          >
            <span
              className={`shrink-0 text-[11px] font-medium ${
                isError ? "text-destructive" : "text-amber-500"
              }`}
            >
              {isError ? t("adminSeoHub.severityError") : t("adminSeoHub.severityWarning")}
            </span>
            {/* Klucz dynamiczny jest tu POPRAWNY: `id` z audytu to zarazem nazwa
                klucza w nakładce (`adminSeoHub.finding.<id>`), a `params` to
                wartości interpolacji komunikatu - nie tekst zapasowy. */}
            <span className="text-sm">
              {t(`adminSeoHub.finding.${finding.id}`, { ...(finding.params ?? {}) })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
