// Etykiety stopnia oddalenia - jedno miejsce, w którym powierzchnia sieci
// dotyka słownika i18n dla tego pojęcia.
//
// Po co osobny hook zamiast `t()` w każdym komponencie: odznaka, ścieżka
// („Ty -> Anna -> Marek") i nagłówek profilu mówią o TYM SAMYM stopniu.
// Rozjazd między nimi („2°" obok opisu 3. stopnia) byłby błędem cichym, więc
// klucze żyją w jednym module, a nie w trzech plikach JSX.
//
// Klucze celowo w formie `network.degree.<grupa>.<first|second|third>` -
// bramka rozjazdu kod <-> PL/EN (networkI18nKeys.gate) widzi wtedy prefiks
// gałęzi i pilnuje, żeby oba języki miały IDENTYCZNY zbiór podkluczy.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DEGREE_I18N_SUFFIX } from "@/lib/network/degree";

export type DegreeI18nSuffix = (typeof DEGREE_I18N_SUFFIX)[1 | 2 | 3];

export interface NetworkDegreeLabels {
  /** Skrót wizualny: „1°" / „2°" / „3°". */
  short: (suffix: DegreeI18nSuffix) => string;
  /** Pełne zdanie dla czytnika ekranu i tooltipa myszy. */
  description: (suffix: DegreeI18nSuffix) => string;
  /** „Ty" - pierwszy węzeł ścieżki. */
  you: string;
  /** Węzeł nienazwany (osoba spoza mojej sieci na ścieżce 3. stopnia). */
  hidden: string;
  /** Etykieta całej ścieżki dla czytnika ekranu. */
  pathAria: (path: string) => string;
  /** „przez {{name}}" - skrót mostu na gęstych kartach. */
  via: (name: string) => string;
}

export function useNetworkDegreeLabels(): NetworkDegreeLabels {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      short: (suffix: DegreeI18nSuffix) => t(`network.degree.short.${suffix}`),
      description: (suffix: DegreeI18nSuffix) => t(`network.degree.description.${suffix}`),
      you: t("network.degree.you"),
      hidden: t("network.degree.hiddenNode"),
      pathAria: (path: string) => t("network.degree.pathAria", { path }),
      via: (name: string) => t("network.degree.via", { name }),
    }),
    [t],
  );
}
