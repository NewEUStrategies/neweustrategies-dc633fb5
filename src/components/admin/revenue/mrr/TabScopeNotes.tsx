// Molekuła: zakres liczb zakładki Przychód / Retencja (S7-C) - w jakiej
// walucie liczą się wskaźniki ilorazowe i których kart nie zawęża segment.
//
// Z-S2-05. Migawka liczy NRR, GRR i quick ratio w JEDNEJ walucie wiodącej
// (największy MRR albo wybrana filtrem), bez przeliczania pozostałych.
// Bez podpisu admin z przychodem w PLN i EUR czytałby NRR jako wynik całej
// firmy - a to wynik złotówkowej części.
//
// SEGMENT. Most MRR i migawka przyjmują segment, a szereg, powody odejść,
// przychód zrealizowany, kohorty, przepływ anulowania i windykacja - nie
// (RPC S2 nie mają tego parametru). Karta bez segmentu pod wybranym filtrem
// wyglądałaby na zawężoną; zdanie mówi to wprost, zamiast ukrywać karty.
import { useTranslation } from "react-i18next";

import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { RevenueSegment } from "@/lib/revenue/search";
import { segmentNarrowed } from "./mrrModel";

export interface TabScopeNotesProps {
  leadingCurrency: string | null | undefined;
  segment: RevenueSegment | null;
  /** Zdanie o kartach bez segmentu - inne w zakładce Przychód i Retencja. */
  segmentNoteKey: string;
}

export function TabScopeNotes({ leadingCurrency, segment, segmentNoteKey }: TabScopeNotesProps) {
  ensureI18n();
  const { t } = useTranslation();
  const narrowed = segmentNarrowed(segment);
  if (!leadingCurrency && !narrowed) return null;
  return (
    <div className="space-y-1 text-xs text-muted-foreground" data-testid="tab-scope-notes">
      {leadingCurrency ? (
        <p className="m-0" data-note="ratio-currency">
          {t("adminRevenue.mrr.ratioCurrency", { currency: leadingCurrency })}
        </p>
      ) : null}
      {narrowed ? (
        <p className="m-0" data-note="all-segments">
          {t(segmentNoteKey)}
        </p>
      ) : null}
    </div>
  );
}
