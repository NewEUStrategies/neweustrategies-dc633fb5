// Wspólny przycisk „Importuj z pliku" dla danych wykresu i mapy.
//
// JEDEN KOMPONENT DLA OBU POWIERZCHNI. Edytor bloku (Gutenberg) i panel
// widgetu (Elementor) trzymają dane w innym kształcie - blok w polach JSON,
// widget w textarei - ale CZYTANIE PLIKU jest w obu identyczne. Rozdzielenie
// tego na dwie kopie skończyłoby się tak, jak już raz skończyło się z listą
// rodzajów wykresu: jedna strona umie .ods, druga nie, i nikt tego nie widzi.
// Ten sam wzorzec co `AdminColorPicker` - komponent mieszka w `blocks/`,
// a builder go importuje.
//
// KOMPONENT NIE WIE, CZYM SĄ DANE. Dostaje wiersze, oddaje je wywołującemu
// i pokazuje listę problemów, którą tamten zwróci. Dzięki temu mapowanie
// „wiersze -> serie" i „wiersze -> kraje" zostaje przy właścicielu danych,
// a tu zostaje wyłącznie odczyt pliku i wybór arkusza.
//
// PROBLEMY SĄ CZĘŚCIĄ WYNIKU, NIE DODATKIEM. Import, który po cichu obcina
// serie albo gubi nieznany kraj, wygląda dla redaktora jak sukces - dlatego
// `onRows` zwraca listę problemów, a ten komponent ma obowiązek ją wypisać.
import { useId, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, Upload } from "@/lib/lucide-shim";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import {
  IMPORT_ACCEPT,
  IMPORT_MAX_BYTES,
  isImportableName,
  readWorkbook,
  type ImportProblem,
  type ImportedSheet,
} from "@/lib/charts/importTable";
import "@/lib/i18n-admin-blocks";

interface Props {
  /**
   * Dostaje wiersze wybranego arkusza, zwraca listę problemów do pokazania.
   * Wywoływane dopiero po wyborze arkusza, więc nigdy nie dostanie pustki
   * z nieodczytanego pliku.
   */
  onRows: (rows: string[][]) => ImportProblem[];
  /** Podpowiedź o oczekiwanym układzie kolumn - inna dla wykresu i mapy. */
  hint?: string;
  className?: string;
}

type Stan =
  | { faza: "idle" }
  | { faza: "czytam" }
  | { faza: "arkusze"; sheets: ImportedSheet[] }
  | { faza: "blad"; klucz: string; opts?: Record<string, unknown> }
  | { faza: "gotowe"; problems: ImportProblem[] };

/** Etykieta problemu - kody są stabilne, teksty idą przez słownik. */
function problemText(
  p: ImportProblem,
  tr: (key: string, opts?: Record<string, unknown>) => string,
): string {
  switch (p.code) {
    case "seriesTruncated":
      return tr("pSeriesTruncated", { count: p.dropped });
    case "categoriesTruncated":
      return tr("pCategoriesTruncated", { count: p.dropped });
    case "nonNumericCells":
      return tr("pNonNumeric", { count: p.count });
    case "rowsSkipped":
      return tr("pRowsSkipped", { count: p.count });
    case "unknownCountries":
      return tr("pUnknownCountries", { labels: p.labels.join(", ") });
    case "duplicateCountries":
      return tr("pDuplicateCountries", { labels: p.labels.join(", ") });
  }
}

export function DataImportControl({ onRows, hint, className }: Props) {
  const bt = useBlocksI18n();
  const tr = (key: string, opts?: Record<string, unknown>) => bt.editor("dataImport", key, opts);
  const [stan, setStan] = useState<Stan>({ faza: "idle" });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const statusId = useId();

  const zastosuj = (sheet: ImportedSheet) => {
    if (sheet.rows.length === 0) {
      setStan({ faza: "blad", klucz: "errEmpty" });
      return;
    }
    setStan({ faza: "gotowe", problems: onRows(sheet.rows) });
  };

  const wybierzPlik = async (file: File) => {
    if (!isImportableName(file.name)) {
      setStan({ faza: "blad", klucz: "errUnsupported" });
      return;
    }
    if (file.size > IMPORT_MAX_BYTES) {
      setStan({
        faza: "blad",
        klucz: "errTooLarge",
        opts: { mb: Math.round(IMPORT_MAX_BYTES / (1024 * 1024)) },
      });
      return;
    }
    setStan({ faza: "czytam" });
    try {
      const book = await readWorkbook(file);
      const niepuste = book.sheets.filter((s) => s.rows.length > 0);
      if (niepuste.length === 0) setStan({ faza: "blad", klucz: "errEmpty" });
      else if (niepuste.length === 1) zastosuj(niepuste[0]);
      else setStan({ faza: "arkusze", sheets: niepuste });
    } catch {
      // Powód nie idzie do UI celowo: komunikat biblioteki bywa po angielsku
      // i mówi o wewnętrznym formacie, co redaktorowi nic nie daje.
      setStan({ faza: "blad", klucz: "errRead" });
    }
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
          disabled={stan.faza === "czytam"}
          onClick={() => inputRef.current?.click()}
        >
          {stan.faza === "czytam" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Upload className="w-3.5 h-3.5" />
          )}
          {tr("button")}
        </button>
        <span className="text-[11px] text-muted-foreground">{hint ?? tr("hintChart")}</span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={IMPORT_ACCEPT}
        className="sr-only"
        aria-label={tr("button")}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Wyzerowanie pozwala wybrać TEN SAM plik drugi raz (po poprawce
          // w Excelu) - bez tego `change` już nie wystrzeli.
          e.target.value = "";
          if (file) void wybierzPlik(file);
        }}
      />

      {/* `aria-live` BEZ `role="status"`. Rola jest skrótem, który tę samą
          uprzejmą zapowiedź dokłada do drzewa dostępności jako osobny punkt
          „status" - a ten komponent bywa osadzony w powierzchni, która
          własny status już ma (arkusz danych w builderze pokazuje w nim stan
          synchronizacji). Dwa statusy w jednym widoku znaczą, że ani czytnik
          ekranu, ani test nie wie, o który chodzi. Sam `aria-live` daje
          zapowiedź i nie zabiera tamtemu tożsamości. */}
      <div id={statusId} aria-live="polite" className="mt-1.5 space-y-1.5">
        {stan.faza === "arkusze" && (
          <div className="rounded-md border border-border bg-muted/40 p-2">
            <div className="text-[11px] font-medium mb-1.5">{tr("chooseSheet")}</div>
            <div className="flex flex-wrap gap-1.5">
              {stan.sheets.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  className="rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
                  onClick={() => zastosuj(s)}
                >
                  {s.name}
                  <span className="text-muted-foreground">
                    {" "}
                    ({tr("sheetRows", { count: s.rows.length })})
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {stan.faza === "blad" && (
          <p className="flex items-start gap-1.5 text-[11px] text-destructive">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            {tr(stan.klucz, stan.opts)}
          </p>
        )}

        {stan.faza === "gotowe" && (
          <>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Check className="w-3.5 h-3.5 shrink-0" />
              {tr("ok")}
            </p>
            {stan.problems.length > 0 && (
              <ul className="space-y-0.5 rounded-md border border-border bg-muted/40 p-2 text-[11px]">
                {stan.problems.map((p, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground" />
                    <span>{problemText(p, tr)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
