// Lekki indeks dokumentów prawnych: klucz -> ścieżka, etykiety i grupa
// tematyczna. Plus czysta funkcja budująca przełącznik dokumentów.
//
// PO CO OSOBNY MODUŁ, skoro `registry.ts` ma dokładnie te same trzy pola.
// Rejestr trzyma `baseline` każdego dokumentu, więc importuje TRZYNAŚCIE
// pełnych treści - ponad trzy tysiące linii źródeł. Przełącznik renderuje się
// na KAŻDEJ stronie prawnej i potrzebuje z tego wyłącznie ścieżki i etykiety.
// Gdyby sięgał do rejestru, czytelnik polityki prywatności pobierałby przy
// okazji treść dwunastu pozostałych dokumentów. Ten moduł nie importuje ani
// jednego pliku treści, a `LegalDocKey` bierze jako `import type`, więc nie
// wciąga też zoda z `./types`.
//
// JEDNO ŹRÓDŁO PRAWDY: to `registry.ts` czyta ścieżki i etykiety STĄD
// (zależność rejestr -> indeks, nigdy odwrotnie). Rozjazd jest niemożliwy,
// bo `legalDocIndexEntry()` rzuca przy starcie modułu na brakującym kluczu.
import { DEFAULT_LANG, localizedPath, stripLangPrefix } from "@/lib/i18n/localePath";
import type { AppLang } from "@/lib/i18n/localePath";
import type { LegalDocKey } from "./types";

/** Grupa tematyczna w przełączniku. Trzynaście pigułek bez podziału to ściana. */
export type LegalDocGroupId = "privacy" | "services" | "community" | "publisher";

export interface LegalDocIndexEntry {
  key: LegalDocKey;
  path: string;
  labelPl: string;
  labelEn: string;
  group: LegalDocGroupId;
}

export interface LegalDocGroup {
  id: LegalDocGroupId;
  labelPl: string;
  labelEn: string;
}

/**
 * Kolejność grup w przełączniku. Prywatność idzie pierwsza, bo to ona jest
 * stroną główną tego zestawu i najczęstszym wejściem z wyszukiwarki.
 */
export const LEGAL_DOC_GROUPS: readonly LegalDocGroup[] = [
  { id: "privacy", labelPl: "Prywatność i dane", labelEn: "Privacy and data" },
  { id: "services", labelPl: "Usługi i zakupy", labelEn: "Services and purchases" },
  { id: "community", labelPl: "Społeczność i treść", labelEn: "Community and content" },
  { id: "publisher", labelPl: "Wydawca", labelEn: "Publisher" },
];

/**
 * Indeks w kolejności wyświetlania. To jest źródło prawdy dla ścieżek i
 * etykiet - `registry.ts` dokłada do nich wyłącznie treść bazową.
 */
export const LEGAL_DOC_INDEX: readonly LegalDocIndexEntry[] = [
  // Prywatność i dane
  {
    key: "privacy",
    path: "/polityka-prywatnosci",
    labelPl: "Polityka prywatności",
    labelEn: "Privacy policy",
    group: "privacy",
  },
  {
    key: "rodo",
    path: "/rodo",
    labelPl: "RODO - Twoje prawa",
    labelEn: "GDPR - your rights",
    group: "privacy",
  },
  {
    key: "data_processing",
    path: "/polityka-przetwarzania-danych",
    labelPl: "Polityka przetwarzania danych",
    labelEn: "Data processing policy",
    group: "privacy",
  },
  {
    key: "communications",
    path: "/komunikacja-i-marketing",
    labelPl: "Komunikacja i marketing",
    labelEn: "Communications and marketing",
    group: "privacy",
  },
  {
    key: "privacy_governance",
    path: "/zarzadzanie-polityka-prywatnosci",
    labelPl: "Zarządzanie polityką prywatności",
    labelEn: "Privacy policy governance",
    group: "privacy",
  },
  // Usługi i zakupy
  {
    key: "terms",
    path: "/regulamin",
    labelPl: "Regulamin",
    labelEn: "Terms",
    group: "services",
  },
  {
    key: "subscriptions",
    path: "/regulamin-subskrypcji-i-zakupow",
    labelPl: "Subskrypcje i zakupy",
    labelEn: "Subscriptions and purchases",
    group: "services",
  },
  {
    key: "refunds",
    path: "/zwroty-i-reklamacje",
    labelPl: "Zwroty i reklamacje",
    labelEn: "Refunds",
    group: "services",
  },
  {
    key: "events",
    path: "/regulamin-wydarzen-i-biletow",
    labelPl: "Wydarzenia, bilety i skanowanie",
    labelEn: "Events, tickets and scanning",
    group: "services",
  },
  // Społeczność i treść
  {
    key: "clubs",
    path: "/regulamin-klubow-dyskusyjnych",
    labelPl: "Regulamin klubów dyskusyjnych",
    labelEn: "Discussion club rules",
    group: "community",
  },
  {
    key: "moderation",
    path: "/moderacja-komentarzy",
    labelPl: "Moderacja komentarzy i treści",
    labelEn: "Comment and content moderation",
    group: "community",
  },
  {
    key: "ai_transparency",
    path: "/przejrzystosc-ai",
    labelPl: "Sztuczna inteligencja i przejrzystość",
    labelEn: "Artificial intelligence and transparency",
    group: "community",
  },
  // Wydawca
  {
    key: "statute",
    path: "/statut",
    labelPl: "Statut i dane rejestrowe",
    labelEn: "Statute and registration details",
    group: "publisher",
  },
];

/**
 * Wpis indeksu dla klucza. RZUCA zamiast zwracać `undefined`, bo `registry.ts`
 * woła to dla wszystkich trzynastu dokumentów przy imporcie modułu - brakujący
 * wpis wywraca się więc natychmiast przy starcie i w teście, a nie dopiero
 * przy renderze jednej strony.
 */
export function legalDocIndexEntry(key: LegalDocKey): LegalDocIndexEntry {
  const found = LEGAL_DOC_INDEX.find((entry) => entry.key === key);
  if (!found) throw new Error(`Brak wpisu w LEGAL_DOC_INDEX dla dokumentu: ${key}`);
  return found;
}

export interface LegalNavItem {
  key: LegalDocKey;
  label: string;
  href: string;
  active: boolean;
}

export interface LegalNavGroup {
  id: LegalDocGroupId;
  label: string;
  items: readonly LegalNavItem[];
}

export interface LegalNav {
  lang: AppLang;
  /** Nagłówek i `aria-label` przełącznika w języku bieżącej ścieżki. */
  label: string;
  /** Klucz dokumentu spod bieżącego adresu albo `null` poza stronami prawnymi. */
  activeKey: LegalDocKey | null;
  groups: readonly LegalNavGroup[];
}

/** Napis nad przełącznikiem. Trzymany tu, razem z pozostałymi etykietami PL/EN. */
const NAV_LABEL: Record<AppLang, string> = {
  pl: "Dokumenty prawne",
  en: "Legal documents",
};

/**
 * Buduje przełącznik dla bieżącej ścieżki. CZYSTA funkcja - bierze `pathname`,
 * oddaje gotowe grupy z adresami w języku tej ścieżki. Dzięki temu zakładki są
 * prawdziwymi linkami z własnym URL-em (a nie stanem komponentu), a całość da
 * się przetestować bez routera i bez DOM-u.
 *
 * Język czytamy z samego adresu, nie z kontekstu i18n: strona prawna pod /en
 * ma prowadzić do /en pozostałych dokumentów także wtedy, gdy przyszedł na nią
 * bot albo czytelnik z linku zewnętrznego, bez ustawionego ciasteczka języka.
 */
export function resolveLegalNav(pathname: string): LegalNav {
  const { lang, pathname: bare } = stripLangPrefix(pathname);
  const resolvedLang = lang ?? DEFAULT_LANG;
  const normalized = bare.length > 1 ? bare.replace(/\/+$/, "") : bare;
  const activeEntry = LEGAL_DOC_INDEX.find((entry) => entry.path === normalized) ?? null;

  const groups = LEGAL_DOC_GROUPS.map((group) => ({
    id: group.id,
    label: resolvedLang === "en" ? group.labelEn : group.labelPl,
    items: LEGAL_DOC_INDEX.filter((entry) => entry.group === group.id).map((entry) => ({
      key: entry.key,
      label: resolvedLang === "en" ? entry.labelEn : entry.labelPl,
      href: localizedPath(entry.path, resolvedLang),
      active: entry.key === activeEntry?.key,
    })),
  })).filter((group) => group.items.length > 0);

  return {
    lang: resolvedLang,
    label: NAV_LABEL[resolvedLang],
    activeKey: activeEntry?.key ?? null,
    groups,
  };
}
