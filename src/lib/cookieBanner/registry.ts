// Rejestr elementów danych zbieranych przez platformę + automatyczny skaner
// środowiska przeglądarki.
//
// Jedno źródło prawdy dla:
//  - tabel podmiotów w cookie banerze (ConsentBanner),
//  - panelu „Wykryte elementy" w adminie (/admin/settings/cookie-banner).
//
// System nie polega wyłącznie na ręcznej liście: `detectCollectedElements()`
// czyta realne cookies, localStorage i sessionStorage, dopasowuje je do wzorców
// z rejestru, a wszystko, czego w rejestrze nie ma, opisuje heurystycznie
// (kategoria + opis PL/EN) i oznacza jako `auto`. Dzięki temu nowy tracker albo
// nowy klucz storage nigdy nie zniknie z deklaracji prywatności.

import type { ConsentCategory } from "@/lib/ads/consent";

export type StorageKind = "cookie" | "localStorage" | "sessionStorage" | "server";

export interface DataElement {
  /** Nazwa pokazywana użytkownikowi (wzorzec albo realny klucz). */
  name: string;
  category: ConsentCategory;
  kind: StorageKind;
  party_pl: string;
  party_en: string;
  purpose_pl: string;
  purpose_en: string;
  ttl_pl: string;
  ttl_en: string;
  /** true = wpis wygenerowany automatycznie przez skaner, nie z rejestru. */
  auto?: boolean;
  /** Realne klucze wykryte w przeglądarce dla tego wzorca. */
  detected?: string[];
}

interface RegistryEntry extends DataElement {
  /** Wzorce kluczy (glob z `*`) przypisane do tego wpisu. */
  match: string[];
}

const PLATFORM_PL = "Platforma (1st party)";
const PLATFORM_EN = "Platform (1st party)";

export const DATA_ELEMENT_REGISTRY: readonly RegistryEntry[] = [
  {
    name: "sb-access-token / sb-refresh-token",
    category: "necessary",
    kind: "cookie",
    match: ["sb-*-auth-token*", "sb-access-token", "sb-refresh-token"],
    party_pl: "Backend platformy",
    party_en: "Platform backend",
    purpose_pl: "Token sesji uwierzytelniającej użytkownika",
    purpose_en: "User authentication session token",
    ttl_pl: "1 h / 7 dni",
    ttl_en: "1 h / 7 days",
  },
  {
    name: "PKCE code verifier",
    category: "necessary",
    kind: "localStorage",
    match: ["*code-verifier*", "*pkce*"],
    party_pl: "Backend Auth",
    party_en: "Backend Auth",
    purpose_pl: "Zabezpieczenie przepływu autoryzacji OAuth (PKCE)",
    purpose_en: "Securing the OAuth authorization flow (PKCE)",
    ttl_pl: "Sesja",
    ttl_en: "Session",
  },
  {
    name: "consent:v2",
    category: "necessary",
    kind: "localStorage",
    match: ["consent*", "cookie_consent*", "gpc*"],
    party_pl: PLATFORM_PL,
    party_en: PLATFORM_EN,
    purpose_pl: "Zapis decyzji o zgodzie na pliki cookie (dowód zgody RODO)",
    purpose_en: "Storage of the cookie consent decision (GDPR proof of consent)",
    ttl_pl: "365 dni",
    ttl_en: "365 days",
  },
  {
    name: "nes_lang",
    category: "necessary",
    kind: "cookie",
    // `*lang*` obejmuje też poprzednią nazwę (`lovable_lang`), którą czytamy
    // jeszcze jako zapas - patrz LEGACY_LANG_COOKIES w lib/i18n/langCookie.ts.
    match: ["*lang*", "i18n*"],
    party_pl: PLATFORM_PL,
    party_en: PLATFORM_EN,
    purpose_pl: "Preferencja języka interfejsu (PL/EN)",
    purpose_en: "UI language preference (PL/EN)",
    ttl_pl: "365 dni",
    ttl_en: "365 days",
  },
  {
    name: "theme",
    category: "functional",
    kind: "localStorage",
    match: ["theme*", "*color-mode*"],
    party_pl: PLATFORM_PL,
    party_en: PLATFORM_EN,
    purpose_pl: "Wybrany motyw (jasny/ciemny/systemowy)",
    purpose_en: "Selected theme (light/dark/system)",
    ttl_pl: "Bez limitu",
    ttl_en: "Persistent",
  },
  {
    name: "layout:*",
    category: "functional",
    kind: "localStorage",
    match: ["layout*", "sidebar*", "admin:*"],
    party_pl: PLATFORM_PL,
    party_en: PLATFORM_EN,
    purpose_pl: "Preferencje układu list, gęstości widoku",
    purpose_en: "List layout and view density preferences",
    ttl_pl: "Bez limitu",
    ttl_en: "Persistent",
  },
  {
    name: "reading:prefs",
    category: "functional",
    kind: "localStorage",
    match: ["reading*", "tts*", "saved:*", "bookmarks*"],
    party_pl: PLATFORM_PL,
    party_en: PLATFORM_EN,
    purpose_pl: "Rozmiar tekstu, TTS, tryb czytania, zapisane artykuły",
    purpose_en: "Text size, TTS, reading mode, saved articles",
    ttl_pl: "Bez limitu",
    ttl_en: "Persistent",
  },
  {
    name: "web-vitals",
    category: "analytics",
    kind: "sessionStorage",
    match: ["web-vitals*", "vitals*", "perf:*"],
    party_pl: PLATFORM_PL,
    party_en: PLATFORM_EN,
    purpose_pl: "Pomiar wydajności strony (LCP, CLS, INP)",
    purpose_en: "Page performance metrics (LCP, CLS, INP)",
    ttl_pl: "Sesja",
    ttl_en: "Session",
  },
  {
    name: "session_id",
    category: "analytics",
    kind: "sessionStorage",
    match: ["session_id", "session:*", "analytics*", "telemetry*"],
    party_pl: PLATFORM_PL,
    party_en: PLATFORM_EN,
    purpose_pl: "Zliczanie unikalnych sesji (dane zagregowane)",
    purpose_en: "Aggregated unique-session counting",
    ttl_pl: "30 min",
    ttl_en: "30 min",
  },
  {
    name: "nl_click / nl_open",
    category: "marketing",
    kind: "server",
    match: ["nl_*", "newsletter*", "popup:*"],
    party_pl: PLATFORM_PL,
    party_en: PLATFORM_EN,
    purpose_pl: "Pomiar otwarć i kliknięć newslettera, limity wyświetleń popupów",
    purpose_en: "Newsletter opens/clicks measurement, popup frequency capping",
    ttl_pl: "365 dni",
    ttl_en: "365 days",
  },
  {
    name: "ad_event",
    category: "marketing",
    kind: "server",
    match: ["ad_*", "ads:*", "utm*", "campaign*"],
    party_pl: PLATFORM_PL,
    party_en: PLATFORM_EN,
    purpose_pl: "Pomiar odsłon i kliknięć reklam własnych, atrybucja kampanii",
    purpose_en: "Own-ad impression/click measurement, campaign attribution",
    ttl_pl: "180 dni",
    ttl_en: "180 days",
  },
];

/** Znane trackery zewnętrzne - rozpoznawane po kluczu i po skrypcie na stronie. */
const THIRD_PARTY_SIGNATURES: ReadonlyArray<{
  test: RegExp;
  name: string;
  category: ConsentCategory;
  party: string;
  purpose_pl: string;
  purpose_en: string;
}> = [
  {
    test: /^_ga|^_gid|^_gcl|googletagmanager|google-analytics/i,
    name: "Google Analytics",
    category: "analytics",
    party: "Google Ireland Ltd.",
    purpose_pl: "Statystyki ruchu i zachowań użytkowników",
    purpose_en: "Traffic and user-behaviour statistics",
  },
  {
    test: /^_fbp|^_fbc|facebook|connect\.facebook/i,
    name: "Meta Pixel",
    category: "marketing",
    party: "Meta Platforms Ireland Ltd.",
    purpose_pl: "Remarketing i pomiar konwersji reklamowych",
    purpose_en: "Remarketing and ad conversion measurement",
  },
  {
    test: /hotjar|^_hj/i,
    name: "Hotjar",
    category: "analytics",
    party: "Hotjar Ltd.",
    purpose_pl: "Mapy ciepła i nagrania sesji",
    purpose_en: "Heatmaps and session recordings",
  },
  {
    test: /linkedin|^li_|^bcookie/i,
    name: "LinkedIn Insight",
    category: "marketing",
    party: "LinkedIn Ireland Unlimited Company",
    purpose_pl: "Atrybucja kampanii i remarketing B2B",
    purpose_en: "Campaign attribution and B2B remarketing",
  },
  {
    test: /stripe|__stripe_mid|__stripe_sid|js\.stripe\.com/i,
    name: "Stripe",
    category: "necessary",
    party: "Stripe, Inc. / Stripe Payments Europe, Ltd.",
    purpose_pl: "Obsługa procesu płatności i zapobieganie oszustwom",
    purpose_en: "Checkout processing and fraud prevention",
  },
];

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === "*" ? "\u0000" : `\\${c}`));
  return new RegExp(`^${escaped.split("\u0000").join(".*")}$`, "i");
}

const COMPILED = DATA_ELEMENT_REGISTRY.map((entry) => ({
  entry,
  patterns: entry.match.map(globToRegExp),
}));

/** Dopasowanie klucza do rejestru; null gdy nieznany. */
export function classifyKey(key: string): RegistryEntry | null {
  for (const { entry, patterns } of COMPILED) {
    if (patterns.some((p) => p.test(key))) return entry;
  }
  return null;
}

/**
 * Heurystyczny opis nieznanego klucza - nazwa nadal trafia do deklaracji,
 * tylko z etykietą „wykryte automatycznie".
 */
function describeUnknown(key: string, kind: StorageKind): DataElement {
  const third = THIRD_PARTY_SIGNATURES.find((s) => s.test.test(key));
  if (third) {
    return {
      name: `${third.name} (${key})`,
      category: third.category,
      kind,
      party_pl: third.party,
      party_en: third.party,
      purpose_pl: third.purpose_pl,
      purpose_en: third.purpose_en,
      ttl_pl: kind === "sessionStorage" ? "Sesja" : "Wg dostawcy",
      ttl_en: kind === "sessionStorage" ? "Session" : "Per vendor",
      auto: true,
      detected: [key],
    };
  }
  const marketing = /(utm|ref|affil|promo|coupon|ad)/i.test(key);
  const analytics = /(stat|metric|event|track|visit|view|count)/i.test(key);
  const category: ConsentCategory = marketing
    ? "marketing"
    : analytics
      ? "analytics"
      : "functional";
  return {
    name: key,
    category,
    kind,
    party_pl: PLATFORM_PL,
    party_en: PLATFORM_EN,
    purpose_pl:
      category === "marketing"
        ? "Wykryty automatycznie identyfikator kampanii lub źródła wejścia."
        : category === "analytics"
          ? "Wykryty automatycznie licznik/zdarzenie użycia interfejsu."
          : "Wykryta automatycznie preferencja interfejsu zapisana lokalnie.",
    purpose_en:
      category === "marketing"
        ? "Automatically detected campaign or referral identifier."
        : category === "analytics"
          ? "Automatically detected usage counter or interface event."
          : "Automatically detected interface preference stored locally.",
    ttl_pl: kind === "sessionStorage" ? "Sesja" : "Bez limitu",
    ttl_en: kind === "sessionStorage" ? "Session" : "Persistent",
    auto: true,
    detected: [key],
  };
}

function readKeys(store: Storage | null): string[] {
  if (!store) return [];
  const out: string[] = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (k) out.push(k);
    }
  } catch {
    /* storage zablokowany przez przeglądarkę - pomijamy */
  }
  return out;
}

function readCookieNames(): string[] {
  if (typeof document === "undefined" || !document.cookie) return [];
  return document.cookie
    .split(";")
    .map((c) => c.split("=")[0]?.trim() ?? "")
    .filter(Boolean);
}

export interface InventoryResult {
  /** Wpisy rejestru (zawsze pełne) wzbogacone o realnie wykryte klucze. */
  known: DataElement[];
  /** Klucze bez wpisu w rejestrze - opisane heurystycznie. */
  auto: DataElement[];
  /** Wszystko razem, pogrupowane po kategorii. */
  byCategory: Record<ConsentCategory, DataElement[]>;
  scannedAt: string;
  scannedKeys: number;
}

const EMPTY_BY_CATEGORY = (): Record<ConsentCategory, DataElement[]> => ({
  necessary: [],
  functional: [],
  analytics: [],
  marketing: [],
});

/**
 * Skan środowiska przeglądarki. Bezpieczny na serwerze - bez `window` zwraca
 * sam rejestr, bez wykrytych kluczy.
 */
export function detectCollectedElements(): InventoryResult {
  const sources: Array<[StorageKind, string[]]> = [
    ["cookie", readCookieNames()],
    [
      "localStorage",
      readKeys(typeof window === "undefined" ? null : (window.localStorage ?? null)),
    ],
    [
      "sessionStorage",
      readKeys(typeof window === "undefined" ? null : (window.sessionStorage ?? null)),
    ],
  ];

  const detectedByEntry = new Map<string, Set<string>>();
  const auto: DataElement[] = [];
  const seenAuto = new Set<string>();
  let scannedKeys = 0;

  for (const [kind, keys] of sources) {
    for (const key of keys) {
      scannedKeys += 1;
      const entry = classifyKey(key);
      if (entry) {
        const set = detectedByEntry.get(entry.name) ?? new Set<string>();
        set.add(key);
        detectedByEntry.set(entry.name, set);
        continue;
      }
      if (seenAuto.has(key)) continue;
      seenAuto.add(key);
      auto.push(describeUnknown(key, kind));
    }
  }

  const known: DataElement[] = DATA_ELEMENT_REGISTRY.map(({ match: _match, ...rest }) => ({
    ...rest,
    detected: Array.from(detectedByEntry.get(rest.name) ?? []),
  }));

  const byCategory = EMPTY_BY_CATEGORY();
  for (const item of [...known, ...auto]) byCategory[item.category].push(item);

  return {
    known,
    auto,
    byCategory,
    scannedAt: new Date().toISOString(),
    scannedKeys,
  };
}

/** Statyczny widok rejestru pogrupowany po kategorii (SSR-safe). */
export const REGISTRY_BY_CATEGORY: Record<ConsentCategory, DataElement[]> = (() => {
  const map = EMPTY_BY_CATEGORY();
  for (const { match: _match, ...rest } of DATA_ELEMENT_REGISTRY) map[rest.category].push(rest);
  return map;
})();
