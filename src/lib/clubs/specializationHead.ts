// SEO dla stron specjalizacji klubu (/club/specialization/$slug).
//
// DLACZEGO OSOBNY PLIK, A NIE SLOWNIK i18n. `head()` biegnie na serwerze przed
// renderem komponentu i NIE MOZE czytac globalnego singletona i18next: ta sama
// instancja obsluguje rownolegle zadania w workerze, wiec jej `language` potrafi
// nalezec do innego uzytkownika (patrz komentarz w `lib/seo/head.ts`). Jezyk
// bierzemy z adresu zadania (`activeLang`), a teksty ze stalej mapy PL/EN
// zapisanej tutaj - dzieki temu kazda z osmiu stron ma WLASNY, unikalny tytul
// i opis w obu jezykach, niezaleznie od tego, czy chunk slownika klubu zdazyl
// sie zarejestrowac.
//
// Opisy sa pisane pod snippet wyszukiwarki: 130-158 znakow, konkret zamiast
// hasel, bez powielania tego samego zdania miedzy specjalizacjami.
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead, type Lang } from "@/lib/seo/meta";
import { findClubSpecialization } from "./specializations";

export interface SpecializationSeoCopy {
  title: string;
  description: string;
}

/** Klucz specjalizacji -> tekst SEO w obu jezykach. */
export const CLUB_SPECIALIZATION_SEO: Record<string, Record<Lang, SpecializationSeoCopy>> = {
  defence: {
    pl: {
      title: "Wojskowość i geopolityka - klub dyskusyjny",
      description:
        "Zamknięty klub o architekturze bezpieczeństwa Europy: odstraszanie, wschodnia flanka NATO, budżety obronne i przemysł zbrojeniowy. Zgłoś się do składu.",
    },
    en: {
      title: "Defence and geopolitics - discussion club",
      description:
        "A closed club on Europe's security architecture: deterrence, NATO's eastern flank, defence budgets and the arms industry. Apply to join the roster.",
    },
  },
  finance: {
    pl: {
      title: "Finanse i gospodarka - klub dyskusyjny",
      description:
        "Debata praktyków o polityce fiskalnej i monetarnej, unii rynków kapitałowych, inwestycjach i konkurencyjności europejskich gospodarek.",
    },
    en: {
      title: "Finance and the economy - discussion club",
      description:
        "Practitioner debate on fiscal and monetary policy, the capital markets union, investment and the competitiveness of European economies.",
    },
  },
  transport: {
    pl: {
      title: "Transport i infrastruktura - klub dyskusyjny",
      description:
        "Kolej, porty, lotnictwo i mobilność wojskowa: korytarze transeuropejskie, modele finansowania i odporność łańcuchów dostaw w jednym klubie.",
    },
    en: {
      title: "Transport and infrastructure - discussion club",
      description:
        "Rail, ports, aviation and military mobility: trans-European corridors, funding models and supply-chain resilience in a single club.",
    },
  },
  energy: {
    pl: {
      title: "Energetyka - klub dyskusyjny",
      description:
        "Bezpieczeństwo dostaw, atom, OZE, sieci i połączenia transgraniczne oraz cena energii - rozmowa osób, które te decyzje przygotowują.",
    },
    en: {
      title: "Energy - discussion club",
      description:
        "Security of supply, nuclear, renewables, grids and cross-border interconnection, plus energy prices - debated by the people preparing those decisions.",
    },
  },
  technology: {
    pl: {
      title: "Technologia i cyberbezpieczeństwo - klub dyskusyjny",
      description:
        "Suwerenność cyfrowa, regulacja AI, ochrona infrastruktury krytycznej, chmura i półprzewodniki - klub dla praktyków bezpieczeństwa cyfrowego.",
    },
    en: {
      title: "Technology and cybersecurity - discussion club",
      description:
        "Digital sovereignty, AI regulation, critical infrastructure protection, cloud and semiconductors - a club for digital security practitioners.",
    },
  },
  diplomacy: {
    pl: {
      title: "Dyplomacja i stosunki międzynarodowe - klub dyskusyjny",
      description:
        "Rozszerzenie UE i NATO, relacje transatlantyckie, sankcje i polityka sąsiedztwa - zamknięta debata o wpływie Europy w świecie.",
    },
    en: {
      title: "Diplomacy and international relations - discussion club",
      description:
        "EU and NATO enlargement, transatlantic ties, sanctions and neighbourhood policy - a closed debate on Europe's global influence.",
    },
  },
  legislation: {
    pl: {
      title: "Legislacja i regulacje - klub dyskusyjny",
      description:
        "Proces legislacyjny krajowy i unijny, ocena skutków regulacji, wdrażanie dyrektyw i compliance - praktyka, nie teoria stanowienia prawa.",
    },
    en: {
      title: "Legislation and regulation - discussion club",
      description:
        "National and EU lawmaking, regulatory impact assessment, directive implementation and compliance - practice rather than legal theory.",
    },
  },
  culture: {
    pl: {
      title: "Polityka kulturalna i historyczna - klub dyskusyjny",
      description:
        "Narracja, pamięć i miękka siła państwa: dyplomacja kulturalna, polityka historyczna i instytucje, które budują wizerunek Europy.",
    },
    en: {
      title: "Cultural and historical policy - discussion club",
      description:
        "Narrative, memory and soft power: cultural diplomacy, historical policy and the institutions shaping Europe's image.",
    },
  },
};

const FALLBACK: Record<Lang, SpecializationSeoCopy> = {
  pl: {
    title: "Specjalizacje klubów dyskusyjnych",
    description:
      "Osiem specjalizacji klubów dyskusyjnych New European Strategies - wybierz obszar i zgłoś się do zamkniętego składu ekspertów.",
  },
  en: {
    title: "Discussion club specialisations",
    description:
      "Eight New European Strategies discussion club specialisations - pick your field and apply to a closed roster of experts.",
  },
};

/** Tekst SEO dla sluga w danym jezyku (fallback, gdy slug nieznany). */
export function specializationSeoCopy(slug: string, lang: Lang): SpecializationSeoCopy {
  const spec = findClubSpecialization(slug);
  if (spec === null) return FALLBACK[lang];
  return CLUB_SPECIALIZATION_SEO[spec.key]?.[lang] ?? FALLBACK[lang];
}

/**
 * Naglowek trasy specjalizacji. Nieznany slug dostaje `noindex` - trasa i tak
 * rzuca `notFound()`, a indeks nie ma prawa zebrac adresow, ktore nie istnieja.
 */
export function buildSpecializationHead(slug: string): ReturnType<typeof buildContentHead> {
  const url = getRequestUrl() || `/club/specialization/${slug}`;
  const lang = activeLang(url);
  const known = findClubSpecialization(slug) !== null;
  const copy = specializationSeoCopy(slug, lang);

  return buildContentHead({
    url,
    lang,
    type: "website",
    title: copy.title,
    description: copy.description,
    robots: known ? "index, follow" : "noindex, nofollow",
  });
}
