// Tłumaczenie napisów edytora danych wykresu (`chartEditor.*`).
//
// DWA JĘZYKI, DWA ŹRÓDŁA. Edytor bloku CMS mówi językiem PANELU (język
// interfejsu admina), a arkusz widgetu buildera - językiem przekazanym
// z pola panelu (`lang`, tak jak dotąd jego własne napisy). Ten sam
// komponent siatki służy obu, więc język jest parametrem: brak = język
// interfejsu, podany = wymuszony opcją `lng` przy każdym kluczu.
//
// Import nakładki stoi TUTAJ, a każdy komponent edytora woła ten hak - więc
// komponent, który używa kluczy `chartEditor.*`, zawsze ma je zarejestrowane.
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-chart-data-editor";

export type EditorLang = "pl" | "en";

/** Tłumaczy PEŁNY klucz słownika; wstawki `{{...}}` z `opts`. */
export type ChartEditorT = (key: string, opts?: Record<string, unknown>) => string;

export function useChartEditorT(lang?: EditorLang): ChartEditorT {
  const { t } = useTranslation();
  return useCallback(
    (key: string, opts?: Record<string, unknown>) =>
      String(t(key, lang === undefined ? opts : { ...opts, lng: lang })),
    [t, lang],
  );
}
