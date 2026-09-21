// Mapa PLIK -> MODUŁ, przepisana z rozdziału 9.1 audytu pokrycia
// (`docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`).
//
// PO CO TEN PLIK ISTNIEJE. Do wydania 8 mapa żyła WYŁĄCZNIE jako tabela
// w dokumencie. Tabela nie da się uruchomić, więc nikt nie mógł sprawdzić,
// czy reguła, którą opisuje, robi to, co obiecuje - a robiła coś innego
// (patrz CARVE_OUTS niżej). Od tej zmiany mapa jest kodem: `features.mjs`
// liczy z niej tabele, a `npm run check:feature-taxonomy` pilnuje, żeby
// żaden plik nie wisiał poza taksonomią i żeby żadna reguła nie była martwa.
//
// KOLEJNOŚĆ MA ZNACZENIE: pierwsze trafienie wygrywa, moduły są sprawdzane
// rosnąco po numerze - dokładnie tak, jak opisuje rozdział 9.1.

/**
 * WYJĄTKI O WYŻSZYM PIERWSZEŃSTWIE NIŻ REGUŁY KATALOGOWE.
 *
 * TO JEST NAPRAWA REALNEGO DEFEKTU TAKSONOMII, nie ozdobnik. Rozdział 9.1
 * przypisuje modułowi 22 pięć wzorców wycinających pliki wydarzeń z katalogów
 * społeczności (`components/community/Event*`, `ticketDocument`,
 * `EventsListSkeleton`, `admin/community/EventSpeaker*`, `AddToCalendar`)
 * oraz dwie trasy (`admin.community.events`, `club.$clubSlug.e.`). Wszystkie
 * siedem jest MARTWYCH przy regule „pierwsze trafienie wygrywa, moduły rosnąco":
 * moduł 16 dopada te pliki swoimi wzorcami katalogowymi
 * (`^src/components/community/`, `^src/routes/.*(club|community|comment|badge)`)
 * dziesięć wierszy wcześniej i moduł 22 nigdy ich nie widzi.
 *
 * Skutkiem był wiersz funkcjonalności „Społeczność: odznaki, zaangażowanie,
 * Q&A, ankiety", w którym 235 z 428 niepokrytych linii to bilety i prelegenci
 * wydarzeń, a plików Q&A nie było ANI JEDNEGO.
 *
 * Wyjątki są sprawdzane PRZED regułami modułów, więc intencja rozdziału 9.1
 * (te pliki należą do modułu 22) jest wreszcie wykonywana.
 */
export const CARVE_OUTS = [
  { module: 22, pattern: /^src\/components\/community\/Event/ },
  { module: 22, pattern: /^src\/components\/community\/ticketDocument/ },
  { module: 22, pattern: /^src\/components\/community\/EventsListSkeleton/ },
  { module: 22, pattern: /^src\/components\/community\/AddToCalendar/ },
  { module: 22, pattern: /^src\/components\/admin\/community\/EventSpeaker/ },
  { module: 22, pattern: /^src\/routes\/admin\.community\.events/ },
  { module: 22, pattern: /^src\/routes\/club\.\$clubSlug\.e\./ },
  // `lib/community/calendar.ts` ma jednego konsumenta - `AddToCalendar.tsx`,
  // wycięty wyżej do modułu 22. Reguła warstwy idzie tam, gdzie jej widok;
  // rozdzielenie ich dawało wiersz „społeczności", w którym połowa niepokrytych
  // linii dotyczyła formatu ICS wydarzenia.
  { module: 22, pattern: /^src\/lib\/community\/calendar/ },
  // `admin.events_.$eventId.onsite.badges.tsx` to identyfikatory uczestników
  // przy wejściu na wydarzenie, a nie odznaki reputacyjne społeczności - moduł 16
  // dopadał go swoim członem `badge` osiem wierszy przed regułą modułu 22.
  { module: 22, pattern: /^src\/routes\/admin\.events/ },
  // Panele Q&A i ankiet społeczności. Bez tych dwóch wyjątków łapacz tras
  // MODUŁU 7 (`^src/routes/.*(...|poll|qa|...)`) zabiera je dziewięć wierszy
  // przed modułem 16 - i tak było do wydania 8 włącznie. Skutek: dwa największe
  // zera modułu społeczności (0/122 i 0/78 linii) nie były widoczne ani
  // w module 16, ani jako funkcjonalność, bo wiersze modułu 7 mówią o typach
  // treści, a nie o panelu społeczności.
  { module: 16, pattern: /^src\/routes\/admin\.community\.(qa|polls)/ },
];

/** Moduły w kolejności rozstrzygania (rosnąco po numerze). */
export const MODULES = [
  {
    id: 1,
    name: "Wpisy: doświadczenie czytelnika",
    patterns: [
      /^src\/lib\/access\//,
      /^src\/lib\/toc\//,
      /^src\/lib\/footnotes/,
      /^src\/lib\/manualToc/,
      /^src\/lib\/keyTakeaways\//,
      /^src\/lib\/citations\//,
      /^src\/lib\/audio\//,
      /^src\/lib\/readingTime/,
      /^src\/lib\/postLayouts/,
      /^src\/lib\/relatedPosts/,
      /^src\/lib\/relatedInsights/,
      /^src\/lib\/relatedClickBeacon/,
      /^src\/components\/post\//,
      /^src\/components\/PostLayoutRenderer/,
      /^src\/components\/Paywall/,
      /^src\/components\/author\//,
      /^src\/components\/audio\//,
      /^src\/components\/molecules\/MeterBanner/,
      /^src\/components\/atoms\/QuotaMeter/,
      /^src\/hooks\/(useContentAccess|useUnlockedContent|usePasswordUnlock|useRecordPostView|useSaveArticle|useBookmarks|useReadingTimeSettings|usePostLayoutSettings|useRecommendedPosts)/,
      /^src\/components\/readingList\//,
      /^src\/routes\/post\./,
      /^src\/routes\/preview\./,
      /^src\/routes\/admin\.(key-takeaways|toc|post-layouts|related-posts)/,
      /^src\/routes\/api\/public\/(post-tts|related-click)/,
      /^src\/routes\/api\/(tts|stt)/,
    ],
  },
  {
    id: 2,
    name: "Edytor wpisów i workflow redakcyjny",
    patterns: [
      /^src\/components\/admin\/post-editor\//,
      /^src\/components\/admin\/versions\//,
      /^src\/components\/admin\/workflows\//,
      /^src\/lib\/revisions/,
      /^src\/lib\/posts-migrate/,
      /^src\/hooks\/useAutosave/,
      /^src\/hooks\/useEditPresence/,
      /^src\/hooks\/useHistory/,
      /^src\/hooks\/useUnsavedChangesGuard/,
      /^src\/lib\/unsavedChanges/,
      /^src\/routes\/admin\.(posts|scheduler|calendar)/,
      /^src\/routes\/admin\.(versions|workflows|redirects|import-wordpress|contributors)/,
      /^src\/components\/admin\/(PostEditor|PostGeneralOverview)/,
    ],
  },
  {
    id: 3,
    name: "Silniki treści: bloki + page builder",
    patterns: [
      /^src\/lib\/blocks\//,
      /^src\/lib\/builder\//,
      /^src\/lib\/content\//,
      /^src\/lib\/content-model\//,
      /^src\/lib\/sidebarBuilder\//,
      /^src\/lib\/patterns\//,
      /^src\/lib\/wp-import/,
      /^src\/lib\/wordpress-import/,
      /^src\/lib\/sanitize/,
      /^src\/lib\/content\.functions/,
      /^src\/components\/blocks\//,
      /^src\/components\/builder\//,
      /^src\/components\/patterns\//,
      /^src\/components\/content\//,
      /^src\/components\/admin\/blocks\//,
      /^src\/components\/admin\/builder\//,
      /^src\/components\/admin\/sidebarBuilder\//,
    ],
  },
  {
    id: 4,
    name: "Strony, wygląd, motyw, media, import",
    patterns: [
      /^src\/lib\/theme\//,
      /^src\/lib\/media/,
      /^src\/lib\/layout\//,
      /^src\/lib\/pageTemplates/,
      /^src\/lib\/archive-layout-settings/,
      /^src\/lib\/expertLayouts/,
      /^src\/lib\/cropSizes/,
      /^src\/lib\/cardImageSizes/,
      /^src\/lib\/brand/,
      /^src\/lib\/icons\//,
      /^src\/lib\/icon/,
      /^src\/components\/media\//,
      /^src\/components\/theme\//,
      /^src\/components\/icons\//,
      /^src\/components\/pages\//,
      /^src\/components\/admin\/media\//,
      /^src\/components\/admin\/theme-design\//,
      /^src\/components\/admin\/archiveLayout\//,
      /^src\/hooks\/(useGlobalColors|useExpertLayoutSettings)/,
      /^src\/routes\/admin\.(appearance|media|pages|theme|categor|tags?)/,
      /^src\/routes\/admin\.(icons|crop-sizes|content-area|custom-meta)/,
    ],
  },
  {
    id: 5,
    name: "Strona główna, archiwa, chrome",
    patterns: [
      /^src\/components\/header\//,
      /^src\/components\/footer\//,
      /^src\/components\/menu\//,
      /^src\/components\/megaMenu\//,
      /^src\/components\/mobile\//,
      /^src\/components\/archive\//,
      /^src\/components\/home\//,
      /^src\/lib\/menus\//,
      /^src\/lib\/megaMenu\//,
      /^src\/lib\/mobileBottomBar\//,
      /^src\/lib\/mobileDrawer/,
      /^src\/lib\/breadcrumbs/,
      /^src\/lib\/categoryAreas/,
      /^src\/components\/admin\/menu\//,
      /^src\/routes\/(category|tag|blog|series|publications)\./,
    ],
  },
  {
    id: 6,
    name: "Wyszukiwarka",
    patterns: [
      /^src\/lib\/search\//,
      /^src\/components\/search\//,
      /^src\/hooks\/useSavedSearches/,
      /^src\/routes\/search/,
    ],
  },
  {
    id: 7,
    name: "Typy treści specjalne",
    patterns: [
      /^src\/lib\/tracker\//,
      /^src\/components\/tracker\//,
      /^src\/lib\/experts\//,
      /^src\/components\/experts\//,
      /^src\/components\/admin\/experts\//,
      /^src\/lib\/programs\//,
      /^src\/components\/programs\//,
      /^src\/lib\/podcast\//,
      /^src\/components\/podcast\//,
      /^src\/components\/admin\/podcasts\//,
      /^src\/lib\/web-stories\//,
      /^src\/components\/web-stories\//,
      /^src\/components\/quiz\//,
      /^src\/lib\/files\//,
      /^src\/components\/files\//,
      /^src\/lib\/maps\//,
      /^src\/components\/maps\//,
      /^src\/routes\/.*(tracker|expert|program|podcast|web-stor|quiz|librar|glossar|poll|qa|live)/,
    ],
  },
  {
    id: 8,
    name: "SEO, feedy, dane strukturalne",
    patterns: [
      /^src\/lib\/seo\//,
      /^src\/components\/seo\//,
      /^src\/lib\/social\//,
      /^src\/lib\/links\//,
      /^src\/lib\/customMeta/,
      /^src\/components\/share\//,
      /^src\/components\/admin\/seo\//,
      /^src\/routes\/.*(sitemap|robots|rss|feed|llms|og-|seo)/,
    ],
  },
  {
    id: 9,
    name: "Czat / komunikator",
    patterns: [
      /^src\/lib\/chat\//,
      /^src\/components\/chat\//,
      /^src\/lib\/composer\//,
      /^src\/components\/composer\//,
      /^src\/lib\/mentions\//,
      /^src\/components\/mentions\//,
      /^src\/routes\/.*(chat|messages)/,
    ],
  },
  {
    id: 10,
    name: "Sieć / networking",
    patterns: [
      /^src\/lib\/network\//,
      /^src\/components\/network\//,
      /^src\/hooks\/useFollow/,
      /^src\/routes\/.*network/,
    ],
  },
  {
    id: 11,
    name: "Newsletter i e-mail",
    patterns: [
      /^src\/routes\/api\/public\/popup-event/,
      /^src\/lib\/newsletter/,
      /^src\/components\/newsletter\//,
      /^src\/components\/admin\/newsletter\//,
      /^src\/lib\/email/,
      /^src\/lib\/system-emails/,
      /^src\/lib\/tx-email-preview/,
      /^src\/lib\/auth-email/,
      /^src\/hooks\/useMyNewsletterStatus/,
      /^src\/hooks\/useNewsletterSettings/,
      /^src\/components\/popups\//,
      /^src\/routes\/.*newsletter/,
      /^src\/routes\/.*email/,
      /^src\/routes\/(unsubscribe|api\/public\/nl-)/,
      /^src\/components\/admin\/popups\//,
    ],
  },
  {
    id: 12,
    name: "Realtime / powiadomienia / web-push",
    patterns: [
      /^src\/lib\/realtime\//,
      /^src\/lib\/notifications\//,
      /^src\/components\/notifications\//,
      /^src\/routes\/.*notification/,
    ],
  },
  {
    id: 13,
    name: "Monetyzacja: checkout / subskrypcje / billing",
    patterns: [
      /^src\/lib\/billing\//,
      /^src\/lib\/stripe/,
      /^src\/lib\/pricing\//,
      /^src\/components\/billing\//,
      /^src\/components\/checkout\//,
      /^src\/components\/pricing\//,
      /^src\/components\/membership-join\//,
      /^src\/components\/admin\/billing\//,
      /^src\/components\/admin\/pricing\//,
      /^src\/hooks\/useCheckout/,
      /^src\/routes\/.*(billing|checkout|pricing|membership|subscription)/,
      /^src\/routes\/(plans|api\/public\/payments|api\/public\/fx-rate)/,
    ],
  },
  {
    id: 14,
    name: "Monetyzacja: kupony / darowizny / prezenty / reklamy",
    patterns: [
      /^src\/routes\/api\/public\/ad-event/,
      /^src\/lib\/gifting/,
      /^src\/components\/gifting\//,
      /^src\/components\/donations\//,
      /^src\/lib\/ads\//,
      /^src\/components\/ads\//,
      /^src\/components\/admin\/coupons\//,
      /^src\/hooks\/useValidateCoupon/,
      /^src\/routes\/.*(gift|donat|coupon|ads)/,
    ],
  },
  {
    id: 15,
    name: "Profil i konto",
    patterns: [
      /^src\/components\/people\//,
      /^src\/lib\/profile\//,
      /^src\/lib\/account/,
      /^src\/lib\/auth\//,
      /^src\/lib\/authSettings/,
      /^src\/lib\/interests\//,
      /^src\/lib\/retention\//,
      /^src\/lib\/onboarding\//,
      /^src\/components\/profile\//,
      /^src\/components\/auth\//,
      /^src\/components\/interests\//,
      /^src\/components\/admin\/auth\//,
      /^src\/components\/admin\/onboarding\//,
      /^src\/hooks\/useAuth/,
      /^src\/hooks\/useAuthSettings/,
      /^src\/hooks\/useInterests/,
      /^src\/routes\/(login|signup|account|profile|auth)/,
      /^src\/routes\/.*(profile|account|onboarding)/,
      /^src\/routes\/(reset-password|support|contribute)/,
    ],
  },
  {
    id: 16,
    name: "Społeczność: kluby, komentarze, moderacja",
    patterns: [
      /^src\/lib\/clubs\//,
      /^src\/lib\/community\//,
      /^src\/lib\/comments\//,
      /^src\/components\/clubs\//,
      /^src\/components\/community\//,
      /^src\/components\/comments\//,
      /^src\/components\/admin\/clubs\//,
      /^src\/components\/admin\/community\//,
      /^src\/routes\/.*(club|community|comment|badge)/,
    ],
  },
  {
    id: 17,
    name: "Analityka i BI",
    patterns: [
      /^src\/routes\/api\/public\/experiment-event/,
      /^src\/lib\/analytics\//,
      /^src\/lib\/observability\//,
      /^src\/lib\/charts\//,
      /^src\/lib\/counters\//,
      /^src\/lib\/views\//,
      /^src\/lib\/webVitals/,
      /^src\/lib\/tracker-admin/,
      /^src\/components\/charts\//,
      /^src\/components\/admin\/analytics\//,
      /^src\/components\/admin\/performance\//,
      /^src\/routes\/.*(analytics|semantic)/,
      /^src\/routes\/api\/public\/(track|vitals|client-errors)/,
      /^src\/routes\/admin\.(performance|experiments|link-monitor)/,
    ],
  },
  {
    id: 18,
    name: "CRM",
    patterns: [
      /^src\/lib\/crm/,
      /^src\/components\/admin\/crm\//,
      /^src\/lib\/organizations\//,
      /^src\/lib\/csv\//,
      /^src\/routes\/.*crm/,
      /^src\/routes\/admin\.(companies|contact)/,
    ],
  },
  {
    id: 19,
    name: "Ustawienia / integracje / users / multi-tenant / RODO",
    patterns: [
      /^src\/lib\/authz\//,
      /^src\/lib\/consent/,
      /^src\/lib\/cookieBanner\//,
      /^src\/lib\/legal\//,
      /^src\/lib\/integrations\//,
      /^src\/lib\/tenant/,
      /^src\/lib\/features\//,
      /^src\/lib\/personalization\//,
      /^src\/lib\/greetings\//,
      /^src\/lib\/admin\//,
      /^src\/lib\/adminToasts/,
      /^src\/lib\/useSiteSetting/,
      /^src\/lib\/joinUsSync/,
      /^src\/lib\/contact\.functions/,
      /^src\/components\/legal\//,
      /^src\/components\/consent\//,
      /^src\/components\/admin\/permissions\//,
      /^src\/components\/admin\/users\//,
      /^src\/components\/admin\/settings\//,
      /^src\/components\/admin\/cookie-banner\//,
      /^src\/components\/admin\/google-source\//,
      /^src\/hooks\/(usePersonalizedSettings|useCheckoutSettings)/,
      /^src\/routes\/admin\.(settings|users|integrations|permissions|consent|organizations|audience)/,
      /^src\/routes\/admin\.(greetings|names|personalized|popups)/,
    ],
  },
  {
    id: 21,
    name: "Rekrutacja / kariera",
    patterns: [
      /^src\/lib\/careers\//,
      /^src\/lib\/jobs\//,
      /^src\/components\/careers\//,
      /^src\/routes\/.*(career|job)/,
      /^src\/routes\/admin\.hiring/,
      // PUBLICZNA STRONA KARIERY. Wzorce wyżej łapią angielskie `career`/`job`
      // i panel `admin.hiring`, ale trasa, na którą wchodzi KANDYDAT, nazywa
      // się po polsku - `zatrudniamy.tsx` - i nie ma w nazwie ani jednego z
      // tych członów. Nie należała więc do żadnego z modułów 1-19, a łapacz
      // `^src\/routes\//` modułu 20 („Platforma / backend / infrastruktura /
      // SSR") brał ją jako ostatni. Skutek: moduł „Rekrutacja / kariera" nie
      // zawierał strony rekrutacyjnej. To 34 linie, 11 funkcji i 22 gałęzie na
      // ZERZE (zmierzone) - i jednocześnie KORZEŃ ZŁOŻENIA całego modułu:
      // ta trasa spina hero, wartości, listę ról, proces, formularz i sekcję
      // zamykającą, trzyma filtr działu, wybraną rolę i licznik intencji
      // aplikowania (`applySignal`), a w `head()` decyduje o kanonicznym
      // adresie i o `noindex`. Żaden wiersz tabeli nie mógł tego pokazać.
      /^src\/routes\/zatrudniamy/,
    ],
  },
  {
    id: 22,
    name: "Wydarzenia: event builder, rejestracja, onsite",
    patterns: [
      /^src\/lib\/events\//,
      /^src\/components\/events\//,
      /^src\/components\/admin\/events\//,
      /^src\/routes\/admin\.events/,
      /^src\/routes\/events[._]/,
      /^src\/routes\/events\.tsx$/,
      /^src\/routes\/meetings\./,
      /^src\/routes\/scanner/,
      /^src\/routes\/profile\.events/,
      /^src\/hooks\/useEventSeatsRealtime/,
      /^src\/hooks\/useBarcodeScanner/,
      /^src\/components\/profile\/ParticipantTicketsPanel/,
      /^src\/components\/profile\/events\//,
    ],
  },
  {
    id: 20,
    name: "Platforma / backend / infrastruktura / SSR",
    patterns: [
      /^src\/lib\/ssr/,
      /^src\/lib\/server\//,
      /^src\/lib\/http\//,
      /^src\/lib\/supabase/,
      /^src\/integrations\//,
      /^src\/lib\/ci\//,
      /^src\/lib\/queries\//,
      /^src\/lib\/async/,
      /^src\/lib\/errors\//,
      /^src\/lib\/error/,
      /^src\/lib\/watchdog\//,
      /^src\/lib\/routing\//,
      /^src\/lib\/a11y\//,
      /^src\/lib\/code\//,
      /^src\/lib\/mcp\//,
      /^src\/lib\/prerender/,
      /^src\/lib\/edgeCache/,
      /^src\/lib\/platform-error-reporting/,
      /^src\/lib\/cacheBusting/,
      /^src\/lib\/ai-gateway/,
      /^src\/lib\/redirects/,
      /^src\/lib\/text\//,
      /^src\/lib\/utils/,
      /^src\/lib\/deepMerge/,
      /^src\/lib\/storageKeys/,
      /^src\/lib\/rafThrottle/,
      /^src\/lib\/smoothAnchorScroll/,
      /^src\/lib\/overlayCoordinator/,
      /^src\/lib\/appDialogs/,
      /^src\/lib\/loginPopupBus/,
      /^src\/lib\/toastError/,
      /^src\/lib\/countries/,
      /^src\/components\/error\//,
      /^src\/(router|server|start)\./,
      /^src\/utils\//,
      /^src\/routes\//,
      /^src\/lib\//,
    ],
  },
];

/**
 * Kubełki PRZEKROJOWE z rozdziału 9.1 - nie są modułami produktowymi i nie
 * wchodzą do tabeli modułów, ale muszą być rozstrzygane PRZED łapaczem
 * modułu 20 (`^src/lib/`, `^src/routes/`). W tabeli dokumentu stoją PO module
 * 22, co przy dosłownym czytaniu „pierwsze trafienie wygrywa" czyniłoby regułę
 * `^src/lib/i18n-` martwą - a audyt raportuje ten kubełek ze 135 plikami,
 * więc pomiar go stosował wcześniej. Kod zapisuje faktyczną kolejność.
 */
export const CROSS_CUTTING = [
  {
    key: "i18n",
    name: "PRZEKROJOWE: słowniki i18n",
    patterns: [
      /^src\/lib\/i18n-/,
      /^src\/lib\/i18n\.ts$/,
      /^src\/lib\/i18n\//,
      /^src\/lib\/locale\//,
      /^src\/components\/admin\/i18n\//,
    ],
  },
  {
    key: "design-system",
    name: "PRZEKROJOWE: design system (components/ui)",
    patterns: [/^src\/components\/ui\//],
  },
  {
    key: "admin-shell",
    name: "PRZEKROJOWE: powłoka panelu admin + atomy/molekuły",
    patterns: [
      /^src\/components\/(atoms|molecules|forms|features)\//,
      /^src\/components\/admin\/(atoms|molecules|hooks)\//,
      /^src\/lib\/(features|hooks)\//,
      /^src\/components\/admin\//,
      /^src\/components\//,
      /^src\/hooks\//,
    ],
  },
];

/** Łapacz modułu 20 - świadomie OSTATNI (patrz komentarz przy CROSS_CUTTING). */
const MODULE_20_CATCH_ALL = [/^src\/routes\//, /^src\/lib\//];

/**
 * Rozstrzygnięcie ścieżki: `{ module: number|null, crossCutting: string|null }`.
 * Kolejność: wyjątki -> moduły 1-19, 21, 22 -> kubełki przekrojowe -> łapacz 20.
 */
export function classifyPath(path) {
  for (const carve of CARVE_OUTS) {
    if (carve.pattern.test(path)) return { module: carve.module, crossCutting: null };
  }
  for (const mod of MODULES) {
    if (mod.id === 20) continue;
    for (const pattern of mod.patterns) {
      if (pattern.test(path)) return { module: mod.id, crossCutting: null };
    }
  }
  const mod20 = MODULES.find((m) => m.id === 20);
  for (const pattern of mod20.patterns) {
    if (MODULE_20_CATCH_ALL.some((c) => c.source === pattern.source)) continue;
    if (pattern.test(path)) return { module: 20, crossCutting: null };
  }
  for (const bucket of CROSS_CUTTING) {
    for (const pattern of bucket.patterns) {
      if (pattern.test(path)) return { module: null, crossCutting: bucket.key };
    }
  }
  for (const pattern of MODULE_20_CATCH_ALL) {
    if (pattern.test(path)) return { module: 20, crossCutting: null };
  }
  return { module: null, crossCutting: null };
}

/** Numer modułu dla ścieżki repo-względnej (POSIX), albo `null`. */
export function moduleForPath(path) {
  return classifyPath(path).module;
}

export const MODULE_NAMES = new Map(MODULES.map((m) => [m.id, m.name]));
