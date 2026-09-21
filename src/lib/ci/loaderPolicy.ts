/**
 * POLITYKA LOADERA TRASY PUBLICZNEJ - inwariant bramki `check:loader-policy`.
 *
 * PO CO TA BRAMKA ISTNIEJE. Audyt CWV z 2026-09-20 (§4.4, wzorce systemowe
 * W1/W2/W4 oraz ustalenie F07) nie znalazł pojedynczej zepsutej trasy - znalazł
 * TRZY WZORCE, które powtarzały się w kilkudziesięciu plikach, bo nic ich nie
 * pilnowało. Trasy zostały naprawione ręcznie przez strumienie Q2/Q3/Q5/R; ten
 * moduł zamyka je MECHANIZMEM, żeby nie wróciły następnym plikiem:
 *
 *   W1. LOADER, KTÓRY MOŻE ZDEGRADOWAĆ, MUSI SAM OGŁOSIĆ SWOJĄ POLITYKĘ
 *       CACHE'U. `analyzeSsrBudgets` (`ssrBudgets.ts`, budżet 4) pilnuje już
 *       przypadku „nagłówek ustawiony, ale nieprzepuszczony przez
 *       `resilientCacheControl`". NIE WIDZI natomiast przypadku znacznie
 *       częstszego, bo NIEWIDOCZNEGO W PLIKU TRASY: loader, który nie ustawia
 *       ŻADNEGO nagłówka. Taka odpowiedź nie wychodzi bez polityki - dostaje
 *       DOMYŚLNĄ `public, s-maxage=900, stale-while-revalidate=86400`
 *       z `defaultCacheControlMiddleware` (`lib/http/defaultCacheControl.ts`),
 *       czyli render zdegradowany utrwala się na brzegu na 15 minut świeżości
 *       plus dobę okna stale. Audyt naliczył 42 takie trasy publiczne.
 *
 *       CZEGO `loadResilient` NIE ROBI - sprostowanie, bo pomyłka w tę stronę
 *       zostawiłaby dziurę w regule. `loadResilient` (`lib/ssr/resilientLoad.ts`)
 *       NIE ustawia żadnego nagłówka: oddaje wyłącznie flagę `degraded`, którą
 *       wołający MUSI podać do `resilientCacheControl` i dalej do
 *       `setCacheControlHeader`. Punkt 4 doktryny w tamtym pliku mówi to wprost
 *       („wywołujący MUSI zdjąć nagłówek cache'a wspólnego"). Dlatego samo
 *       użycie `loadResilient` NIE zwalnia z tej reguły.
 *
 *   W2. LOADER PUBLICZNY WOŁAJĄCY SIEĆ MUSI MIEĆ BUDŻET. Bez budżetu czas do
 *       pierwszego bajtu jest ograniczony wyłącznie watchdogiem zapytań SSR,
 *       a ten kończy się RZUTEM, czyli statusem 500 - dokładnie tym trybem
 *       awarii, dla którego powstał `loadResilient`.
 *
 *   W4. PARYTET KLUCZY LOADER/KOMPONENT. Loader grzeje `xKeys.bySlug`,
 *       a komponent czyta `xKeys.bySlugViewer` - obie strony wyglądają
 *       poprawnie z osobna, a razem dają NAJDROŻSZY z możliwych układów:
 *       pełny round-trip przed pierwszym bajtem, którego wynik nie zasila
 *       renderu, więc ten sam odczyt leci DRUGI raz po hydratacji, a SSR i tak
 *       oddaje szkielet. Tak działało czternaście tras `/club/$clubSlug/**`
 *       (audyt F09, naprawione przez Q5 w `src/routes/club.$clubSlug.tsx`).
 *
 * CO Z TEGO DA SIĘ ZBADAĆ STATYCZNIE - powiedziane wprost razem z granicami,
 * bo bramka, która obiecuje więcej, niż mierzy, jest gorsza od jej braku:
 *
 *   W1: TAK, bez przybliżenia. „Może zdegradować" to obecność `.catch(`,
 *       `Promise.allSettled`, `loadResilient`, `withBudget` albo
 *       `settleWithinBudget` w ciele loadera; „ogłasza politykę" to obecność
 *       `setCacheControlHeader(` albo `resilientCacheControl(` w tym samym
 *       ciele. Oba są wywołaniami w pliku trasy.
 *
 *       DWA ZAWĘŻENIA, OBA ŚWIADOME. (a) Liczy się CIAŁO LOADERA, nie
 *       `beforeLoad`: o polityce ma decydować to miejsce, które WIE, czy render
 *       jest zdegradowany, a `beforeLoad` biegnie przed danymi. (b) Nagłówek
 *       ustawiony przez trasę-RODZICA nie zwalnia dziecka - rodzic nie wie
 *       o degradacji dziecka, więc jego `resilientCacheControl(false)` byłby
 *       właśnie tym fałszywym „czysto", którego ta reguła pilnuje. Oba
 *       zawężenia dają dziś ZERO fałszywych alarmów (zmierzone na 66 loaderach
 *       tras publicznych).
 *
 *   W2: TAK dla ZAMKNIĘTEJ listy sygnałów sieci (niżej, `NETWORK_SIGNALS`).
 *       CZEGO NIE WIDZI: funkcji serwerowej zawołanej pod dowolnym aliasem
 *       (`await pobierzCos()`), bo „czy ten identyfikator chodzi do sieci" nie
 *       jest pytaniem o kształt pliku, tylko o graf wywołań. Rozszerzanie
 *       wzorca na `await <cokolwiek>(` dawałoby czerwień na każdym loaderze
 *       i zostałoby wyciszone w tydzień.
 *
 *   W4: TAK, ale WĄSKO Z PREMEDYTACJĄ. Porównujemy NAZWY FABRYK klucza
 *       (`*QueryOptions`, `*QueryKey`, `xKeys.y` - to samo kryterium, którego
 *       używa `publicRouteLoaders.ts`) użyte w loaderze i w `useQuery` /
 *       `useSuspenseQuery` / `useQueries` W TYM SAMYM PLIKU. Naruszeniem jest
 *       WYŁĄCZNIE para, która różni się SUFIKSEM WIDZA (`Viewer`, `ForUser`,
 *       …) - czyli podpis defektu F09. Rodziny w rodzaju
 *       `billingKeys.plansActive` vs `billingKeys.mySubscription` to dwa różne
 *       byty, nie rozjazd, i szersza heurystyka („wspólny przedrostek")
 *       zapalałaby się na nich fałszywie - zmierzone na tym drzewie przed
 *       wyborem reguły.
 *
 * DLACZEGO OSOBNA BRAMKA, A NIE KOLEJNY BUDŻET W `ssrBudgets.ts`: tamten moduł
 * mierzy LICZBY (ms, odnogi, wpisy) i jego sufity są liczbami. Tutaj nie ma
 * czego zliczać - są REGUŁY KSZTAŁTU z imienną listą wyjątków. Zlepienie obu
 * dałoby jeden komunikat, w którym „5500 > 5500" sąsiaduje z „brak nagłówka",
 * i jeden plik, którego nikt nie czyta w całości.
 *
 * Cienki runner: `scripts/check-loader-policy.ts`. Test jednostkowy z KONTROLĄ
 * NEGATYWNĄ (dowodem, że bramka oblewa na zepsutym wejściu):
 * `src/lib/ci/__tests__/loaderPolicy.test.ts`.
 */
import {
  balancedArgs,
  hasSsrDisabled,
  keyFactorySymbols,
  routeOptionsBlock,
  topLevelOption,
} from "./publicRouteLoaders";
import { blankNonCode } from "./ssrBudgets";

/**
 * ZAMROŻONE trasy, których degradowalny loader NIE ogłasza własnej polityki
 * cache'u (reguła W1) - plik -> powód, dla którego dług jeszcze stoi.
 *
 * ZMIERZONE 2026-09-20 NA DRZEWIE PO PRACY Q2/Q3/Q5/R: z 66 publicznych
 * loaderów naruszają regułę DOKŁADNIE TE TRZY. Audyt (F07) zaczynał od 42 -
 * reszta dostała `setCacheControlHeader(resilientCacheControl(...))` w ramach
 * strumieni Q2/Q3/Q5.
 *
 * LISTA MOŻE SIĘ WYŁĄCZNIE SKRACAĆ i jest MEMBERSHIPOWA, nie licznikowa:
 * wpis, którego trasa już nie narusza, OBLEWA bramkę jako „nieodebrana
 * naprawa". Bez tego warunku naprawiona trasa zostawia na liście wolny slot,
 * w który ta sama regresja wraca bez sygnału - pełne uzasadnienie tego
 * mechanizmu stoi przy `coldRouteRatchetFailed` w `publicRouteLoaders.ts`.
 */
export const FROZEN_DEGRADED_WITHOUT_CACHE_CONTROL: Readonly<Record<string, string>> = {
  // `/checkout/success` stoi na `PUBLIC_DOCUMENT_DENY_PREFIXES`, więc domyślna
  // polityka wspólna do niego NIE dojeżdża (a od 2026-09-20 deny-lista dostaje
  // jawne `private, no-store` - `lib/http/defaultCacheControl.ts`). Promień
  // rażenia jest więc dziś zerowy, ale doktryna „loader ogłasza swoją politykę"
  // obowiązuje także tutaj: wyjęcie trasy spod deny-listy nie może po cichu
  // wpuścić zdegradowanego potwierdzenia zakupu do wspólnego cache'u.
  "src/routes/checkout.success.tsx":
    "dokument potwierdzenia zakupu poza cache'em dokumentów (deny-lista) - dług doktrynalny, nie ekspozycja",
  // 2026-09-20: `support.tsx` i `contribute.tsx` (realny dług: render bez treści
  // wchodził do wspólnego cache'u) spłacone tego samego dnia - oba loadery
  // ogłaszają politykę przez `resilientCacheControl`.
};

/**
 * ZAMROŻONE trasy publiczne, których loader woła sieć BEZ budżetu czasu
 * (reguła W2) - plik -> powód.
 *
 * ZMIERZONE 2026-09-20: dwie, spłacone tego samego dnia (zero). Ta sama zasada
 * skracania i ten sam warunek „nieodebrana naprawa oblewa", co wyżej.
 */
export const FROZEN_UNBUDGETED_NETWORK_LOADERS: Readonly<Record<string, string>> = {
  // 2026-09-20: `sitemap.tsx` (`settleWithinBudget` 2 000 ms) i `contribute.tsx`
  // (`loadResilient` z terminem) spłacone tego samego dnia - lista pusta i taka
  // ma zostać.
};

/**
 * ZAMROŻONE trasy z rozjazdem klucza loader/komponent (reguła W4).
 *
 * LISTA JEST PUSTA I TO JEST JEJ TREŚĆ - dokładnie jak
 * `FROZEN_UNGATED_CACHE_CONTROL` w `ssrBudgets.ts`. Czternaście tras
 * `/club/$clubSlug/**` (audyt F09) zostało naprawionych przez Q5 JEDNYM
 * loaderem w układzie `src/routes/club.$clubSlug.tsx`, który grzeje
 * `clubKeys.bySlugViewer(slug, null)` - czyli TEN klucz, który czyta komponent
 * dla widza anonimowego. Pusty rekord znaczy: KAŻDY taki rozjazd oblewa.
 */
export const FROZEN_KEY_PARITY_BREAKS: Readonly<Record<string, string>> = {};

/** Plik źródłowy w kształcie, w którym bramka go czyta. */
export interface LoaderPolicySource {
  readonly file: string;
  readonly source: string;
}

export interface LoaderPolicyInput {
  readonly sources: readonly LoaderPolicySource[];
}

export type LoaderPolicyRule = "degradedCacheControl" | "unbudgetedNetwork" | "keyParity";

/**
 * `nowy-dlug` = trasa narusza regułę i NIE MA jej na zamrożonej liście.
 * `nieodebrana-naprawa` = wpis z listy, którego trasa już nie narusza. Oba
 * oblewają - uzasadnienie drugiego przy `FROZEN_DEGRADED_WITHOUT_CACHE_CONTROL`.
 */
export type LoaderPolicyKind = "nowy-dlug" | "nieodebrana-naprawa";

export interface LoaderPolicyViolation {
  readonly rule: LoaderPolicyRule;
  readonly kind: LoaderPolicyKind;
  readonly file: string;
  readonly detail: string;
}

/** Rozjazd klucza: co grzeje loader kontra co czyta komponent tego pliku. */
export interface KeyParityBreak {
  readonly warmed: string;
  readonly read: string;
  readonly line: number;
}

export interface LoaderPolicyFacts {
  readonly file: string;
  /** Praca, która może wrócić bez danych NIE rzucając. */
  readonly canDegrade: boolean;
  /** Ciało loadera woła `setCacheControlHeader` albo `resilientCacheControl`. */
  readonly declaresCacheControl: boolean;
  /** Rozpoznane sygnały wyjścia do sieci (nazwy, nie liczba wywołań). */
  readonly networkSignals: readonly string[];
  /** Ciało loadera niesie budżet czasu albo wspólny termin żądania. */
  readonly budgeted: boolean;
  readonly keyParityBreaks: readonly KeyParityBreak[];
}

export interface LoaderPolicyReport {
  readonly loaders: readonly LoaderPolicyFacts[];
  readonly violations: readonly LoaderPolicyViolation[];
  /** Ile plików w ogóle weszło do skanu - liczba kontrolna martwego parsera. */
  readonly scannedFiles: number;
}

const ROUTE_DIR = "src/routes/";

/**
 * Gałęzie, które NIE SĄ publiczną stroną SSR i dlatego nie podlegają tym
 * regułom. Kryterium jest ŚCIEŻKOWE (pierwszy segment pliku trasy), bo
 * konwencja nazw w tym repozytorium jest płaska: `admin.billing.tsx`,
 * `api.public.newsletter.confirm.ts`, `platform/…`, `preview.$token.tsx`.
 *
 * `preview` jest na liście, choć renderuje HTML: podgląd redakcyjny z definicji
 * nie wchodzi do wspólnego cache'u (`PUBLIC_DOCUMENT_DENY_PREFIXES` + własne
 * `contentCacheControl({ preview: true })`).
 */
const NON_PUBLIC_SEGMENTS = new Set(["admin", "api", "platform", "preview", "lovable", "email"]);

/**
 * Czy plik jest trasą, na której obowiązują te reguły.
 *
 * `__root.tsx` JEST WYŁĄCZONY I TO NIE JEST PRZEOCZENIE. Loader korzenia
 * degraduje (dwie fale `Promise.allSettled`) i nie ustawia nagłówka - ale
 * politykę dokumentu ogłasza trasa LIŚCIOWA, a korzeń jedzie pod każdym
 * adresem, także pod `/admin`. Objęcie go regułą W1 znaczyłoby „korzeń ma
 * ustawić jedną politykę dla całego serwisu", czyli coś przeciwnego do
 * doktryny.
 */
export function isPublicRouteFile(file: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  if (!normalized.startsWith(ROUTE_DIR)) return false;
  if (!/\.tsx?$/.test(normalized) || normalized.endsWith(".d.ts")) return false;
  const rest = normalized.slice(ROUTE_DIR.length);
  if (rest === "__root.tsx") return false;
  // Pliki generowane i pomocnicze: `routeTree.gen.ts` to sklejenie bez loaderów,
  // `-nazwa.test.ts` i `__tests__/…` to testy (generator tras pomija przedrostek
  // `-`), a plik testowy cytujący `ensureQueryData` nie jest loaderem.
  //
  // ODSIEWAMY WYŁĄCZNIE PRZEDROSTEK `-`, A NIE KAŻDY ZNAK NIELITEROWY. Szersze
  // `[-_]` wyglądało równoważnie na dzisiejszym drzewie (jedyne pliki na `_` to
  // `__root.tsx` i `__tests__/`), ale wycinałoby też UKŁADY BEZŚCIEŻKOWE
  // (`_uklad.konto.tsx`) - a to są normalne trasy z loaderem. Bramka, która po
  // cichu przestaje widzieć całą klasę tras, jest gorsza od jej braku.
  if (rest.endsWith("routeTree.gen.ts")) return false;
  if (/(^|\/)-/.test(rest)) return false;
  if (/\.(?:test|spec)\.[tj]sx?$/.test(rest)) return false;
  if (rest.includes("__tests__/")) return false;
  const head = rest.split(/[./]/)[0] ?? "";
  return !NON_PUBLIC_SEGMENTS.has(head);
}

/**
 * Praca, która może wrócić BEZ DANYCH, nie rzucając. Rzut jest bezpieczny:
 * zamienia się w status, którego `documentStorePolicy` i tak nie zapisze.
 * `.catch(` jest tu obok prymitywów budżetowych, bo w tym repozytorium to
 * NAJCZĘSTSZA forma cichej degradacji w loaderze (`.catch(() => null)`).
 */
const DEGRADABLE_WORK_RE =
  /\.\s*catch\s*\(|Promise\s*\.\s*allSettled\s*\(|\b(?:loadResilient|with(?:Ssr)?Budget|settleWithinBudget)\s*\(/;

/**
 * Ogłoszenie polityki cache'u przez SAM loader. `resilientCacheControl` bez
 * `setCacheControlHeader` nie występuje w repozytorium, ale liczy się tak samo:
 * obecność którejkolwiek z tych funkcji znaczy, że autor loadera podjął
 * decyzję o nagłówku, zamiast oddać ją domyślnej polityce middleware.
 */
const DECLARES_CACHE_CONTROL_RE = /\b(?:setCacheControlHeader|resilientCacheControl)\s*\(/;

/**
 * ZAMKNIĘTA lista sygnałów „ten loader wychodzi do sieci". Zamknięta, bo
 * wzorzec otwarty (`await <cokolwiek>(`) zapalałby się na każdym loaderze -
 * patrz nagłówek pliku, granice reguły W2.
 */
const NETWORK_SIGNALS: readonly (readonly [string, RegExp])[] = [
  ["ensureQueryData", /\bensureQueryData\s*\(/],
  ["ensureInfiniteQueryData", /\bensureInfiniteQueryData\s*\(/],
  ["fetchQuery", /\bfetchQuery\s*\(/],
  ["fetchInfiniteQuery", /\bfetchInfiniteQuery\s*\(/],
  ["prefetchQuery", /\bprefetchQuery\s*\(/],
  ["prefetchInfiniteQuery", /\bprefetchInfiniteQuery\s*\(/],
  // `loadResilient` woła `ensureQueryData` w środku, więc JEST wyjściem do
  // sieci - i jest tu po to, żeby licznik „ilu loaderów dotyczy reguła W2"
  // mówił prawdę. Naruszenia z tego nie będzie nigdy: ten sam prymityw niesie
  // własny budżet, więc odsiewa go warunek `budgeted`.
  ["loadResilient", /\bloadResilient\s*\(/],
  ["supabase.", /\bsupabase\s*\./],
  [".rpc(", /\.\s*rpc\s*\(/],
  ["edgeTtlCache(", /\bedgeTtlCache\s*\(/],
  ["createServerFn", /\bcreateServerFn\b/],
  // Gołe `fetch(` - z wykluczeniem `foo.fetch(` i `prefetch(`, żeby metoda
  // o tej nazwie nie udawała wyjścia do sieci.
  ["fetch(", /(?<![.\w])fetch\s*\(/],
];

/**
 * Budżet czasu ALBO wspólny termin żądania. `deadlineAt` jest tu nazwą pola
 * opcji `loadResilient` i `routeSsrDeadline` - loader, który je przekazuje,
 * jedzie pod terminem absolutnym, nawet jeśli sam nie woła `withBudget`.
 *
 * `withSsrBudget` (`src/lib/asyncBudget.ts`) liczy się jak `withBudget`: to ten
 * sam termin, tylko honorowany WYŁĄCZNIE w renderze serwerowym - a reguła W2
 * pilnuje czasu do pierwszego bajtu, czyli dokładnie tej ścieżki. Przy
 * nawigacji SPA loader czeka na zapytanie z premedytacją (wynik loadera jest
 * niezmienny, więc degradacja z zegara zamarzłaby jako fałszywa awaria).
 */
const BUDGET_RE =
  /\b(?:with(?:Ssr)?Budget|settleWithinBudget|loadResilient|routeSsrDeadline|remainingBudget)\s*\(|\bdeadlineAt\b/;

/** Czytające hooki React Query - te same, co w `publicRouteLoaders.ts`. */
const QUERY_HOOK_RE = /\buse(?:Suspense)?(?:Infinite)?Quer(?:y|ies)\s*\(/g;

/**
 * SUFIKSY TOŻSAMOŚCI WIDZA. Podpis defektu F09: ta sama rodzina klucza w dwóch
 * wariantach, z których loader grzeje jeden, a komponent czyta drugi. Lista
 * jest zamknięta i wyprowadzona z KODU (`clubKeys.bySlug` vs
 * `clubKeys.bySlugViewer`), a nie z nazw wymyślonych na zapas.
 */
const VIEWER_SUFFIX_RE = /(?:Viewer|ForViewer|ForUser|WithViewer|Anon|Anonymous|Guest)$/;

/**
 * RODZINA fabryki klucza: nazwa po odcięciu sufiksu tożsamości widza.
 *
 * Dwa kształty, obie formy używane w repozytorium:
 *   `publicEventBySlugQueryOptions` -> `publicEventBySlug|opcje`
 *   `clubKeys.bySlugViewer`         -> `clubKeys.bySlug`
 */
export function keyFamily(symbol: string): string {
  const options = /^(.*?)(QueryOptions|QueryKey)$/.exec(symbol);
  if (options !== null) return `${options[1].replace(VIEWER_SUFFIX_RE, "")}|opcje`;
  const member = /^(.*?[Kk]eys)\.(.*)$/.exec(symbol);
  if (member !== null) return `${member[1]}.${member[2].replace(VIEWER_SUFFIX_RE, "")}`;
  return symbol;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === "\n") line += 1;
  return line;
}

/**
 * Fakty polityki JEDNEGO pliku trasy. `null`, gdy plik nie jest publiczną trasą
 * z loaderem - bramka nie ma wtedy czego oceniać.
 */
export function loaderPolicyFacts(file: string, source: string): LoaderPolicyFacts | null {
  if (!isPublicRouteFile(file)) return null;
  // Wygaszamy komentarze I TREŚĆ literałów napisowych: komentarz cytujący
  // `setCacheControlHeader(...)` nie jest wywołaniem, a napis
  // `"ensureQueryData("` nie jest wyjściem do sieci. Numery linii zostają
  // nietknięte, więc komunikat bramki nadal wskazuje to samo miejsce w pliku.
  const clean = blankNonCode(source);
  const block = routeOptionsBlock(clean);
  if (block === null) return null;
  const loader = topLevelOption(block, "loader");
  if (loader === null) return null;
  // `ssr: false` = trasa nie ma SSR-owego HTML-a, więc ani polityka dokumentu,
  // ani czas do pierwszego bajtu nie są jej problemem.
  if (hasSsrDisabled(source)) return null;

  const warmedSymbols = new Set(keyFactorySymbols(loader));
  const keyParityBreaks: KeyParityBreak[] = [];
  for (const match of clean.matchAll(QUERY_HOOK_RE)) {
    const at = match.index ?? 0;
    const open = at + match[0].length - 1;
    for (const read of keyFactorySymbols(balancedArgs(clean, open))) {
      // Klucz, który loader grzeje WPROST, nie jest rozjazdem - niezależnie od
      // tego, ile innych fabryk stoi obok.
      if (warmedSymbols.has(read)) continue;
      for (const warmed of warmedSymbols) {
        if (warmed === read) continue;
        if (keyFamily(warmed) !== keyFamily(read)) continue;
        keyParityBreaks.push({ warmed, read, line: lineOf(clean, at) });
      }
    }
  }

  return {
    file,
    canDegrade: DEGRADABLE_WORK_RE.test(loader),
    declaresCacheControl: DECLARES_CACHE_CONTROL_RE.test(loader),
    networkSignals: NETWORK_SIGNALS.filter(([, re]) => re.test(loader)).map(([name]) => name),
    budgeted: BUDGET_RE.test(loader),
    keyParityBreaks,
  };
}

/** Czy dany plik narusza daną regułę - jedno miejsce dla obu kierunków zapadki. */
function violates(facts: LoaderPolicyFacts, rule: LoaderPolicyRule): boolean {
  switch (rule) {
    case "degradedCacheControl":
      return facts.canDegrade && !facts.declaresCacheControl;
    case "unbudgetedNetwork":
      return facts.networkSignals.length > 0 && !facts.budgeted;
    case "keyParity":
      return facts.keyParityBreaks.length > 0;
  }
}

const RULE_FROZEN: Readonly<Record<LoaderPolicyRule, Readonly<Record<string, string>>>> = {
  degradedCacheControl: FROZEN_DEGRADED_WITHOUT_CACHE_CONTROL,
  unbudgetedNetwork: FROZEN_UNBUDGETED_NETWORK_LOADERS,
  keyParity: FROZEN_KEY_PARITY_BREAKS,
};

function detailFor(facts: LoaderPolicyFacts, rule: LoaderPolicyRule): string {
  switch (rule) {
    case "degradedCacheControl":
      return "loader niesie pracę mogącą wrócić BEZ DANYCH nie rzucając (`.catch` / `allSettled` / budżet), a nie woła `setCacheControlHeader` - odpowiedź dostanie z `defaultCacheControlMiddleware` domyślne `public, s-maxage=900, stale-while-revalidate=86400`, więc render niepełny utrwali się na brzegu na 15 minut świeżości PLUS dobę okna stale. Domknięcie: `setCacheControlHeader(resilientCacheControl(degraded))` (doktryna: src/lib/ssr/resilientLoad.ts)";
    case "unbudgetedNetwork":
      return `loader wychodzi do sieci (${facts.networkSignals.join(", ")}) bez budżetu czasu - czas do pierwszego bajtu ogranicza wyłącznie watchdog zapytań SSR, który kończy się RZUTEM, czyli statusem 500. Domknięcie: \`loadResilient\` albo \`withBudget(..., STALA_MS)\` / wspólny \`deadlineAt\` z \`routeSsrDeadline\``;
    case "keyParity":
      return `${facts.keyParityBreaks
        .map(
          (b) => `loader grzeje \`${b.warmed}\`, a komponent czyta \`${b.read}\` (linia ${b.line})`,
        )
        .join(
          "; ",
        )} - rozgrzewka zasila wyłącznie \`head()\`, a ciało strony i tak pyta bazę: jeden round-trip przed pierwszym bajtem I drugi po hydratacji, przy szkielecie w SSR (audyt F09)`;
  }
}

export function analyzeLoaderPolicy(input: LoaderPolicyInput): LoaderPolicyReport {
  const loaders: LoaderPolicyFacts[] = [];
  for (const { file, source } of input.sources) {
    const facts = loaderPolicyFacts(file, source);
    if (facts !== null) loaders.push(facts);
  }

  const violations: LoaderPolicyViolation[] = [];
  const byFile = new Map(loaders.map((facts) => [facts.file, facts]));
  for (const rule of Object.keys(RULE_FROZEN) as LoaderPolicyRule[]) {
    const frozen = RULE_FROZEN[rule];
    for (const facts of loaders) {
      if (!violates(facts, rule)) continue;
      if (frozen[facts.file] !== undefined) continue;
      violations.push({
        rule,
        kind: "nowy-dlug",
        file: facts.file,
        detail: detailFor(facts, rule),
      });
    }
    // NIEODEBRANA NAPRAWA OBLEWA. Nie jest to karanie za poprawę, tylko warunek,
    // bez którego zapadka nie zapada: dopóki naprawiona trasa stoi na liście,
    // ma tam WOLNY SLOT i ta sama regresja wraca bez zapalenia bramki. Pełny
    // wywód z trzyetapową sekwencją: `coldRouteRatchetFailed`
    // w `publicRouteLoaders.ts`.
    for (const file of Object.keys(frozen)) {
      const facts = byFile.get(file);
      // Plik ZNIKNĄŁ ze skanu (usunięty albo przemianowany) - też jest
      // nieodebraną naprawą: wpis na liście nie ma już czego opisywać.
      if (facts !== undefined && violates(facts, rule)) continue;
      violations.push({
        rule,
        kind: "nieodebrana-naprawa",
        file,
        detail:
          facts === undefined
            ? "pliku nie ma już w skanie - zdejmij wpis z zamrożonej listy"
            : "trasa NIE narusza już tej reguły - zdejmij wpis z zamrożonej listy w TYM SAMYM PR-ze, w którym powstała naprawa",
      });
    }
  }

  return { loaders, violations, scannedFiles: input.sources.length };
}

export function loaderPolicyFailed(report: LoaderPolicyReport): boolean {
  // Pusty skan to AWARIA PARSERA, nie zielony wynik: bramka, która nie widzi
  // ANI JEDNEGO loadera trasy publicznej, nie pilnuje niczego. Na tym drzewie
  // jest ich 66.
  if (report.loaders.length === 0) return true;
  return report.violations.length > 0;
}

const RULE_LABEL: Readonly<Record<LoaderPolicyRule, string>> = {
  degradedCacheControl: "W1 degradowalny loader BEZ własnego Cache-Control",
  unbudgetedNetwork: "W2 publiczny loader woła sieć BEZ budżetu",
  keyParity: "W4 rozjazd klucza loader/komponent",
};

export function renderLoaderPolicyReport(report: LoaderPolicyReport): string {
  const lines: string[] = [];
  if (report.loaders.length === 0) {
    return [
      `✗ [loader-policy] skan ${report.scannedFiles} plików nie znalazł ANI JEDNEGO loadera trasy publicznej.`,
      "  To nie jest zielone światło - to zepsuta kotwica parsera albo pusty zestaw wejściowy.",
    ].join("\n");
  }

  const degradable = report.loaders.filter((l) => l.canDegrade);
  const networked = report.loaders.filter((l) => l.networkSignals.length > 0);
  lines.push(
    `Polityka loaderów tras publicznych: ${report.loaders.length} loaderów przeskanowanych (z ${report.scannedFiles} plików).`,
  );
  lines.push(
    `  ${RULE_LABEL.degradedCacheControl}: ${degradable.filter((l) => !l.declaresCacheControl).length} (degradowalnych łącznie: ${degradable.length}, zamrożonych wyjątków: ${Object.keys(FROZEN_DEGRADED_WITHOUT_CACHE_CONTROL).length})`,
  );
  lines.push(
    `  ${RULE_LABEL.unbudgetedNetwork}: ${networked.filter((l) => !l.budgeted).length} (wołających sieć łącznie: ${networked.length}, zamrożonych wyjątków: ${Object.keys(FROZEN_UNBUDGETED_NETWORK_LOADERS).length})`,
  );
  lines.push(
    `  ${RULE_LABEL.keyParity}: ${report.loaders.filter((l) => l.keyParityBreaks.length > 0).length} (zamrożonych wyjątków: ${Object.keys(FROZEN_KEY_PARITY_BREAKS).length})`,
  );

  if (report.violations.length === 0) {
    lines.push("");
    lines.push("✓ Wszystkie trzy reguły polityki loaderów spełnione.");
    return lines.join("\n");
  }

  lines.push("");
  for (const v of report.violations) {
    lines.push(
      v.kind === "nowy-dlug"
        ? `✗ ${v.file}: ${RULE_LABEL[v.rule]} - ${v.detail}`
        : `✗ ${v.file}: NIEODEBRANA NAPRAWA (${RULE_LABEL[v.rule]}) - ${v.detail}`,
    );
  }
  lines.push("");
  lines.push("ZAMROŻONE LISTY WOLNO WYŁĄCZNIE SKRACAĆ. Dopisanie pliku do listy wyjątków");
  lines.push("nie jest naprawą - jest decyzją, która MUSI nieść w komentarzu powód, dla");
  lines.push("którego ten konkretny render może utrwalić niepełną treść albo czekać bez");
  lines.push("budżetu.");
  return lines.join("\n");
}
