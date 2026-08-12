// Wybor kotwicy watku: akt prawny, wpis redakcyjny albo wydarzenie.
//
// DLACZEGO TO ISTNIEJE. Kotwica byla w modelu danych od A1, w grafie powiazan
// (`cross_references`) od A12 i na stronie aktu prawnego (`ClubAnchorThreads`)
// takze od A12 - ale zadna sciezka w interfejsie nie pozwalala jej USTAWIC.
// Karta "o tym rozmawiaja w klubach" na stronie aktu prawnego byla wiec z
// definicji pusta: konsument bez producenta.
//
// Kotwica to nie ozdobny link. Wedlug projektu (V1 §1.4) jest krawedzia
// w istniejacym grafie, przez ktora dossier pokazuje dyskusje, a zdarzenie
// `policy.updated.v1` moze OBUDZIC wątek sprzed miesiaca ("dossier przeszlo
// do trilogu - wasza dyskusja moze wymagac aktualizacji"). Bez producenta
// cala ta mechanika nie ma na czym pracowac.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized, type LocaleCode } from "@/lib/i18n/pickLocalized";
import { Link2, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useClubAnchorSuggestions } from "@/lib/clubs/useClubs";
import type { ClubAnchorSuggestion, ClubAnchorType } from "@/lib/clubs/types";
import { ensureClubI18n } from "@/lib/i18n-club";

export interface ClubAnchorValue {
  anchorType: ClubAnchorType;
  anchorId: string;
  label: string;
}

export function ClubAnchorPicker({
  value,
  onChange,
  disabled,
  anchorType = null,
  fieldLabel,
}: {
  value: ClubAnchorValue | null;
  onChange: (value: ClubAnchorValue | null) => void;
  disabled?: boolean;
  /**
   * Zawężenie do JEDNEGO typu encji. Kompozytor wątku go nie podaje (czytelnik
   * szuka tematu, nie kategorii), ale kampania segmentowa musi: reguła
   * `policy_follow` przyjmuje wyłącznie akt prawny, a `event_rsvp` wyłącznie
   * wydarzenie - podpowiedź spoza typu dałaby regułę, która rozwiązuje się
   * w bazie na zbiór pusty.
   */
  anchorType?: ClubAnchorType | null;
  /** Nadpisanie etykiety pola - kampania nie mówi o "kotwicy", tylko o regule. */
  fieldLabel?: string;
}) {
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  // Jezyk TRESCI podpowiedzi (blizniacze kolumny), nie etykiet interfejsu.
  const lang = uiLang(i18n.language);
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 250);

  const suggestionsQ = useClubAnchorSuggestions({
    query: debounced,
    // Domyslnie BEZ zawezenia typu: czytelnik szuka TEMATU, a nie kategorii
    // encji - droplista "gdzie szukac" przed polem wyszukiwania to pytanie, na
    // ktore nikt nie chce odpowiadac przed zobaczeniem wynikow. Wolajacy, ktory
    // POTRZEBUJE jednego typu (kampania segmentowa), podaje go jawnie.
    anchorType,
    enabled: !disabled && value === null,
  });

  // `pickLocalized` zamiast `a_en || a_pl || a_en`: ciag z samych spacji liczy
  // sie jako pusty, wiec podpowiedz z "pusta" etykieta siega po drugi jezyk,
  // a nie renderuje bialej plamy na liscie wyboru.
  const label = (row: ClubAnchorSuggestion): string => pickLocalized(row, "label", lang);

  if (value !== null) {
    return (
      <div className="space-y-1.5">
        <Label>{fieldLabel ?? t("club.anchorPicker.label")}</Label>
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
          <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Badge variant="outline" className="shrink-0 text-[11px]">
            {t(`club.anchorType.${value.anchorType}`)}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-sm">{value.label}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 px-2"
            disabled={disabled}
            aria-label={t("club.anchorPicker.clear")}
            onClick={() => {
              onChange(null);
              setQuery("");
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  const rows = suggestionsQ.data ?? [];
  const searching = debounced.trim().length >= 2;

  return (
    <div className="space-y-1.5">
      <Label htmlFor="club-anchor-query">{fieldLabel ?? t("club.anchorPicker.label")}</Label>
      <p className="text-xs text-muted-foreground">{t("club.anchorPicker.hint")}</p>
      <div className="relative">
        <Input
          id="club-anchor-query"
          value={query}
          disabled={disabled}
          placeholder={t("club.anchorPicker.placeholder")}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && suggestionsQ.isFetching ? (
          <Loader2
            className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        ) : null}
      </div>

      {searching ? (
        rows.length === 0 && !suggestionsQ.isFetching ? (
          <p className="rounded-md border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
            {t("club.anchorPicker.empty")}
          </p>
        ) : (
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border/60 p-1">
            {rows.map((row) => (
              <li key={`${row.anchor_type}:${row.anchor_id}`}>
                <button
                  type="button"
                  disabled={disabled}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  onClick={() =>
                    onChange({
                      anchorType: row.anchor_type as ClubAnchorType,
                      anchorId: row.anchor_id,
                      label: label(row),
                    })
                  }
                >
                  <Badge variant="outline" className="shrink-0 text-[11px]">
                    {t(`club.anchorType.${row.anchor_type}`)}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate">{label(row)}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
