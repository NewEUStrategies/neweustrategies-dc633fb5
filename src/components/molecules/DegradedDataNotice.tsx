// Uczciwy komunikat renderu ZDEGRADOWANEGO (atomic design: molecule).
//
// Kontekst: `lib/ssr/resilientLoad` zamienia blip backendu w HTTP 200 z pustym
// fallbackiem - to naprawia transport (CDN, monitory, crawler), ale samo w sobie
// KŁAMIE w warstwie treści: pusta lista wygląda dokładnie jak „nie ma jeszcze
// wydarzeń". Trasa, która dostała `degraded: true`, renderuje więc ten komponent
// ZAMIAST pustego stanu - czytelnik widzi prawdę i przycisk ponowienia, a nie
// fałszywe „brak wyników".
//
// Copy pochodzi ze wspólnej warstwy `errorCopy` (PL/EN, działa też poza
// providerem i18next), więc nie ma tu żadnego własnego słownika.
import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";
import { DEGRADED_ERROR } from "@/lib/errorCopy";

export interface DegradedDataNoticeProps {
  /**
   * "page" = samodzielna treść trasy (wyśrodkowana karta),
   * "inline" = panel wewnątrz istniejącego layoutu, gdy reszta strony jest OK.
   */
  readonly variant?: "page" | "inline";
  /** Nadpisanie nagłówka, np. „Nie udało się załadować wydarzeń". */
  readonly title?: string;
}

export function DegradedDataNotice({ variant = "inline", title }: DegradedDataNoticeProps) {
  return (
    <FriendlyErrorPage
      error={DEGRADED_ERROR}
      variant={variant === "page" ? "page" : "compact"}
      title={title}
    />
  );
}
