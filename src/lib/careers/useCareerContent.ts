// Hooki treści strony kariery: oferty (z fallbackiem i18n) i sekcje.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import {
  careerRolesQueryOptions,
  careerSectionsQueryOptions,
  fallbackOffers,
  rowToOffer,
  sectionState,
  type CareerLang,
  type CareerOffer,
  type CareerSectionKey,
  type CareerSectionState,
} from "./catalog";

function currentLang(language: string): CareerLang {
  return language.toLowerCase().startsWith("en") ? "en" : "pl";
}

/** Opublikowane oferty w aktywnym języku; przy pustej bazie - katalog i18n. */
export function useCareerOffers(): { offers: CareerOffer[]; isLoading: boolean } {
  const { t, i18n } = useTranslation();
  const lang = currentLang(i18n.language);
  const { data, isLoading } = useQuery(careerRolesQueryOptions());

  const offers = useMemo(() => {
    if (data && data.length > 0) return data.map((row) => rowToOffer(row, lang));
    if (isLoading) return [];
    return fallbackOffers(t);
  }, [data, isLoading, lang, t]);

  return { offers, isLoading };
}

/** Stan sekcji strony (widoczność + nadpisania nagłówków). */
export function useCareerSection(key: CareerSectionKey): CareerSectionState {
  const { i18n } = useTranslation();
  const lang = currentLang(i18n.language);
  const { data } = useQuery(careerSectionsQueryOptions());
  return useMemo(() => sectionState(data, key, lang), [data, key, lang]);
}
