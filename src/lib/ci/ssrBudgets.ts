/**
 * BUDŻETY WEWNĘTRZNE POTOKU SSR - inwariant bramki `check:ssr-budgets`.
 *
 * PO CO TA BRAMKA ISTNIEJE. Czas pierwszego wczytania ma w tym repozytorium
 * bramkę NA WYNIKU: `e2e/boot-timing.spec.ts` mierzy TTFB, gotowość hydratacji,
 * transfer bootu i FCP na zbudowanym artefakcie, twardo, w CI. Czego nie ma
 * NIC - to bramki na PRZYCZYNY, czyli na liczby, z których ten wynik się
 * składa, a które są zapisane wprost w źródłach i każdą z nich można podnieść
 * jedną stałą w jednym pliku. Trzy takie liczby:
 *
 *   (1) SZEREGOWANY BUDŻET PRZED PIERWSZYM BAJTEM. Loader korzenia awaituje
 *       dwie fale rozgrzewki (2 500 + 500 ms). Loader trasy jedzie RÓWNOLEGLE
 *       do korzenia (`@tanstack/router-core`, `load-matches`: wszystkie
 *       dopasowania łańcucha startują razem i są awaitowane przez
 *       `Promise.all`), ale WEWNĄTRZ jednego loadera budżety są szeregowe -
 *       i to one dominują. Nic nie broni przed dołożeniem trzeciej fali.
 *
 *   (2) LICZBA RÓWNOLEGŁYCH PODŻĄDAŃ W LOADERZE. Runtime Cloudflare Workers
 *       ma limit 6 równoległych subrequestów na żądanie. W repozytorium ta
 *       liczba występowała WYŁĄCZNIE jako zdanie w komentarzach - ani limitera,
 *       ani semafora, ani batcha, ani stałej (sprawdzone: zero trafień dla
 *       `MAX_SUBREQUEST`, `SUBREQUEST_LIMIT`, `MAX_PARALLEL`, `MAX_CONCURRENT`,
 *       `p-limit`, `semaphore`).
 *
 *   (3) DEHYDRATOWANY STAN wstrzykiwany do HTML-a przy KAŻDYM renderze.
 *
 * CO Z TEGO DA SIĘ ZBADAĆ STATYCZNIE - powiedziane wprost, razem z granicami,
 * bo bramka, która obiecuje więcej, niż mierzy, jest gorsza od jej braku:
 *
 *   (1) TAK, i to najmocniej. Budżety są literałami w `const *_BUDGET_MS`
 *       w tym samym pliku, co ich użycie.
 *
 *   (2) TAK, ale tylko dla tablic LITERAŁOWYCH BEZ ROZWINIĘĆ
 *       (`Promise.all([a, b, c])`). Tablica budowana zmienną
 *       (`Promise.allSettled(chromeWarm)`) ORAZ tablica z rozwinięciem
 *       (`Promise.all([a, ...xs])`) są niemierzalne z definicji - bramka
 *       raportuje je jako niemierzalne i NIE przypisuje im liczby. Cicha zła
 *       liczba jest gorsza od braku liczby: rozwinięcie liczone jako jedna
 *       odnoga przepuszczało loader z dowolną liczbą podżądań. Dziury z tej
 *       kategorii są ZAMROŻONE imiennie (`FROZEN_UNMEASURABLE_PARALLEL`),
 *       więc każda NOWA oblewa bramkę.
 *
 *   (3) NIE - ROZMIARU nie da się. Payload serializuje framework, a jego waga
 *       zależy od danych z bazy, nie od źródeł. Statycznie da się natomiast
 *       przypiąć TRZY INWARIANTY STRUKTURALNE, które decydują, co do tego
 *       payloadu w ogóle wchodzi (`src/router.tsx`), plus DOLNE OSZACOWANIE
 *       liczby wpisów: ile razy loader pisze do cache'u zapytań. To jest
 *       PROXY, nie pomiar bajtów, i jest tu opisane jako proxy.
 *
 * DLACZEGO PODŁOGI SĄ ZAMROŻONE W KODZIE, a nie w zmiennej środowiskowej:
 * ta sama zasada, co w `scripts/check-bundle-size.ts` - „bramka, którą wolno
 * rozluźnić jedną zmienną w workflow, nie jest bramką". Tutaj idziemy o krok
 * dalej i nie ma NAWET nadpisania lokalnego: te liczby są ceniami dzisiejszego
 * stanu, a nie parametrem.
 *
 * Cienki runner: `scripts/check-ssr-budgets.ts`. Test jednostkowy (z KONTROLĄ
 * NEGATYWNĄ, czyli dowodem, że bramka oblewa na zepsutym wejściu):
 * `src/lib/ci/__tests__/ssrBudgets.test.ts`.
 */
import { stripTsComments } from "../../../scripts/lib/stripComments";
import { balancedArgs, topLevelOption } from "./publicRouteLoaders";

/**
 * SUFITY. Wolno je wyłącznie OBNIŻAĆ. Każda liczba jest ZMIERZONA na drzewie
 * z 2026-09-03 i jest CENĄ STANU DZISIEJSZEGO, nie celem.
 *
 * TE LICZBY SĄ Z TEGO HOSTA, nie z runnera - ale w odróżnieniu od floorów
 * bundla nie ma to tu znaczenia: bramka czyta ŹRÓDŁA, więc jej wynik jest
 * identyczny na każdej maszynie. To jest cała zaleta bramki statycznej i powód,
 * dla którego biegnie w jobie `verify`, a nie w `build`.
 */
export const FROZEN_SSR_BUDGETS = {
  /**
   * Suma budżetów rozgrzewki loadera KORZENIA - `ROOT_WARM_BUDGET_MS` (2 500)
   * + `CHROME_WARM_BUDGET_MS` (500). ZERO ZAPASU z premedytacją: to jest
   * dokładnie ta liczba, którą zlecenie wydania 9 nazwało „jedną liczbą
   * w jednym pliku", więc podniesienie którejkolwiek ze stałych choćby o 1 ms
   * MA zapalić tę bramkę. Jeśli trzecia fala jest naprawdę potrzebna, decyzja
   * należy do człowieka i ma zostawić ślad w tym pliku.
   */
  rootWarmChainMs: 3_000,
  /**
   * Najgorszy SZEREGOWANY łańcuch budżetów w JEDNYM loaderze trasy.
   *
   * ZMIERZONE: `src/routes/$.tsx` = 13 000 ms (`PRIMARY_CONTENT_BUDGET_MS`
   * 5 000 + `SECONDARY_PREFETCH_BUDGET_MS` 3 000 + `PRIMARY_CONTENT_BUDGET_MS`
   * 5 000, trzy `await withBudget` na tym samym poziomie ciała loadera).
   * Drugi: `blog.index.tsx` = 8 000. Trzeci: `tracker.index.tsx` = 5 500.
   *
   * SPROSTOWANIE, KTÓRE TA LICZBA NIESIE. Zapis wydania 9 mówił, że
   * „maksymalny sekwencyjny budżet przed pierwszym bajtem to dziś 3 000 ms".
   * To prawda o łańcuchu KORZENIA i nieprawda o dokumencie: loader trasy
   * catch-all ma 13 000 ms własnego szeregowanego budżetu i jedzie RÓWNOLEGLE
   * do korzenia, więc sufitem dokumentu jest max(3 000, 13 000) = 13 000 ms.
   * Ta podłoga jest wpisana jako CENA TEGO STANU, żeby nie rosła dalej po
   * cichu - a nie jako zgoda na 13 sekund.
   */
  loaderChainMs: 13_000,
  /**
   * Równoległe podżądania w JEDNEJ tablicy `Promise.all`/`allSettled` loadera.
   *
   * 6 NIE JEST WYBRANE - to twardy limit równoległych subrequestów na żądanie
   * w runtime Cloudflare Workers, na którym ten serwis stoi.
   *
   * ZMIERZONE TĄ BRAMKĄ: maksimum 5 odnóg (`src/routes/$.tsx`). Sufit stoi
   * jednak na 6, a NIE na „zmierzone + zapas", i to jest świadome: 6 nie jest
   * ceną stanu dzisiejszego, tylko GRANICĄ PLATFORMY. Obniżanie go poniżej
   * limitu runtime bramkowałoby coś innego, niż ta liczba znaczy.
   *
   * CZEGO TA LICZBA NIE OBEJMUJE, powiedziane wprost: (a) odnóg dokładanych
   * warunkowo poza tablicą literałową; (b) RÓWNOLEGŁOŚCI MIĘDZY LOADERAMI -
   * loader korzenia trzyma swoje podżądania w tym samym czasie, co loader
   * trasy, więc szczyt na żądanie jest WYŻSZY od maksimum z jednego loadera;
   * (c) `prefetchWidgets` (`src/lib/builder/prefetch.ts`), które odpala jedno
   * `Promise.allSettled` nad tablicą o długości wziętej z DOKUMENTU Z BAZY -
   * niemierzalnej ze źródeł z definicji. Zielony wynik tej bramki NIE JEST
   * więc dowodem, że równoległość jest ograniczona do 6.
   */
  parallelQueriesPerLoader: 6,
  /**
   * PROXY dehydracji: ile razy JEDEN loader pisze do cache'u zapytań
   * (`ensureQueryData` / `prefetchQuery` / `fetchQuery` / `setQueryData` /
   * `prefetch*Queries` / `loadResilient`). Każdy taki wpis, jeśli się
   * rozstrzygnie sukcesem, wchodzi do dehydratowanego stanu w HTML-u.
   *
   * TO JEST DOLNE OSZACOWANIE LICZBY WPISÓW, A NIE POMIAR BAJTÓW - i tak
   * właśnie ma być czytane. Wagi payloadu nie da się wyznaczyć ze źródeł
   * (zależy od danych), więc bramka pilnuje jedynej rzeczy, którą źródła
   * ustalają: LICZBY MIEJSC, które go zasilają.
   *
   * ZMIERZONE: maksimum 11 w `src/routes/__root.tsx`.
   */
  dehydrationWritesPerLoader: 11,
} as const;

/**
 * ZAMROŻONE miejsca, w których RÓWNOLEGŁOŚCI NIE DA SIĘ policzyć ze źródeł -
 * plik -> liczba takich miejsc w jego loaderze.
 *
 * PO CO LISTA, a nie samo raportowanie. Miejsce niemierzalne jest DZIURĄ
 * w budżecie (2): przez tablicę budowaną zmienną albo przez rozwinięcie
 * (`...xs`) można wprowadzić dowolnie wiele podżądań, a bramka nie ma czym
 * tego policzyć. Samo wypisanie takiej dziury na liście informacyjnej
 * znaczyłoby, że dziury wolno DOKŁADAĆ - więc lista jest ZAMKNIĘTA: te,
 * które istniały przy powstaniu bramki, są opisane i przepuszczone; KAŻDE
 * NOWE oblewa.
 *
 * ZMIERZONE 2026-09-03: dokładnie DWA miejsca, oba w loaderze korzenia
 * (`Promise.all(menuWarm)` i `Promise.allSettled(chromeWarm)` - tablice
 * budowane zmienną, `__root.tsx:326` i `:508`). ZERO rozwinięć w tablicach
 * literałowych w całym `src/routes`. Ta liczba wolno wyłącznie MALEĆ.
 */
export const FROZEN_UNMEASURABLE_PARALLEL: Readonly<Record<string, number>> = {
  "src/routes/__root.tsx": 2,
};

/** Plik źródłowy w kształcie, w którym bramka go czyta. */
export interface SsrBudgetSource {
  readonly file: string;
  readonly source: string;
}

export interface SsrBudgetInput {
  readonly sources: readonly SsrBudgetSource[];
}

/** Jedno `await withBudget(..., STAŁA)` z rozwiązaną wartością budżetu. */
export interface BudgetSite {
  readonly line: number;
  readonly constName: string;
  readonly ms: number | null;
}

/** Jedna tablica `Promise.all`/`allSettled` z policzonymi odnogami. */
export interface ParallelSite {
  readonly line: number;
  /** `null` = tablica budowana zmienną, czyli NIEMIERZALNA statycznie. */
  readonly arms: number | null;
}

export interface LoaderBudgetFacts {
  readonly file: string;
  readonly budgetSites: readonly BudgetSite[];
  /** Suma budżetów - GÓRNE oszacowanie łańcucha szeregowego (patrz niżej). */
  readonly chainMs: number;
  readonly parallelSites: readonly ParallelSite[];
  readonly maxParallelArms: number;
  readonly cacheWrites: number;
}

/** Inwariant strukturalny dehydracji w `src/router.tsx`. */
export interface DehydrationInvariant {
  readonly name: string;
  readonly present: boolean;
  readonly why: string;
}

export interface SsrBudgetViolation {
  readonly budget: string;
  readonly file: string;
  readonly measured: number;
  readonly ceiling: number;
  readonly detail: string;
}

export interface SsrBudgetReport {
  readonly loaders: readonly LoaderBudgetFacts[];
  /** Suma budżetów loadera korzenia; `null`, gdy pliku nie było na wejściu. */
  readonly rootWarmChainMs: number | null;
  readonly dehydrationInvariants: readonly DehydrationInvariant[];
  readonly violations: readonly SsrBudgetViolation[];
  /**
   * Miejsca, których bramka NIE POTRAFI zmierzyć - raportowane jawnie, żeby
   * zielony wynik nie był czytany jako „wszystko policzone". Te, które
   * przekraczają `FROZEN_UNMEASURABLE_PARALLEL`, wchodzą DODATKOWO do
   * `violations` i oblewają bramkę.
   */
  readonly unmeasurable: readonly string[];
}

const ROOT_ROUTE_FILE = "src/routes/__root.tsx";
const ROUTER_FILE = "src/router.tsx";

/**
 * Wygaszenie KOMENTARZY i TREŚCI LITERAŁÓW NAPISOWYCH. Oba są konieczne:
 * komentarz cytujący `await withBudget(...)` nie jest wywołaniem, a napis
 * `"Promise.all"` nie jest tablicą. Podstawiamy spacje, więc numery linii
 * i kolumn zostają nietknięte i komunikaty bramki nadal wskazują to samo
 * miejsce w pliku.
 */
export function blankNonCode(source: string): string {
  const noComments = stripTsComments(source);
  let out = "";
  let i = 0;
  while (i < noComments.length) {
    const ch = noComments[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < noComments.length) {
        const c = noComments[i];
        if (c === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (c === quote) break;
        // Znak nowej linii ZOSTAJE (literały szablonowe bywają wielolinijkowe),
        // reszta idzie na spację.
        out += c === "\n" ? "\n" : " ";
        i += 1;
      }
      if (i < noComments.length) {
        out += noComments[i];
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Ciało opcji trasy. KOTWICA JEST SZERSZA NIŻ W `routeOptionsBlock`
 * (`publicRouteLoaders.ts:519`) I TO JEST NAPRAWA, NIE WARIANT: tamta kotwiczy
 * WYŁĄCZNIE na `createFileRoute(...)({`, a `src/routes/__root.tsx` - jedyny
 * plik niosący budżet (1) - deklaruje się przez
 * `createRootRouteWithContext<...>()({`. Bramka na tamtej kotwicy pomijałaby
 * więc PLIK, KTÓREGO PILNUJE, i byłaby zielona z tego powodu. Przypięte
 * testem.
 */
export function routeOptionsBlockWide(source: string): string | null {
  const clean = blankNonCode(source);
  const call =
    /createFileRoute\s*\([^)]*\)\s*\(\s*\{|createRootRouteWithContext\s*<[\s\S]*?>\s*\(\s*\)\s*\(\s*\{|createRootRoute\s*\(\s*\{/.exec(
      clean,
    );
  if (call === null) return null;
  const open = clean.indexOf("{", call.index + call[0].length - 1);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < clean.length; i += 1) {
    const ch = clean[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return clean.slice(open + 1, i);
    }
  }
  return null;
}

/** Numeryczne stałe pliku: `const NAZWA = 1_234;` (także `export const`). */
export function numericConstants(cleanSource: string): Map<string, number> {
  const out = new Map<string, number>();
  const re =
    /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*number\s*)?=\s*(\d[\d_]*)\s*[;,\n]/g;
  for (const m of cleanSource.matchAll(re)) {
    const name = m[1];
    const value = Number(m[2].replaceAll("_", ""));
    if (name !== undefined && Number.isFinite(value)) out.set(name, value);
  }
  return out;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === "\n") line += 1;
  return line;
}

/** Rozbicie listy argumentów po przecinkach NA NAJWYŻSZYM poziomie. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * Liczba odnóg tablicy literałowej - niepuste człony najwyższego poziomu.
 *
 * `null` = NIE DA SIĘ policzyć, bo któryś człon jest ROZWINIĘCIEM (`...xs`).
 * Bez tego `Promise.all([fixedQuery(), ...queries])` liczyło się jako DWIE
 * odnogi, choć `...queries` może odpalić dowolnie wiele podżądań - czyli
 * loader mógł przekroczyć sufit 6 subrequestów, a bramka raportowała 2
 * i przechodziła. Cicha zła liczba jest gorsza od braku liczby, więc
 * rozwinięcie daje `null`, a nie „tyle, ile widać".
 */
function countArms(arrayBody: string): number | null {
  const parts = splitTopLevel(arrayBody).filter((p) => p.trim() !== "");
  if (parts.some((p) => p.trim().startsWith("..."))) return null;
  return parts.length;
}

const CACHE_WRITE_RE =
  /\b(?:ensureQueryData|prefetchQuery|fetchQuery|setQueryData|loadResilient|prefetch[A-Za-z]*Queries)\s*\(/g;

/**
 * Fakty budżetowe JEDNEGO loadera.
 *
 * `chainMs` jest GÓRNYM OSZACOWANIEM łańcucha szeregowego: sumuje WSZYSTKIE
 * `await withBudget(...)` w ciele loadera, także te w rozłącznych gałęziach
 * `if`. Dla sufitu to właściwy kierunek błędu (nigdy nie zaniża), i tak jest
 * opisane w komunikacie bramki - ale nie wolno tej liczby czytać jako
 * „tyle dokładnie czeka każdy render".
 */
export function loaderBudgetFacts(
  file: string,
  source: string,
  /**
   * Stałe z POZOSTAŁYCH przeskanowanych plików. Budżet nie musi być literałem
   * w pliku trasy: `src/routes/support.tsx:38` przekazuje
   * `SUPPORT_DOC_BUDGET_MS` IMPORTOWANY z `@/lib/supportRouteConfig`. Bez tej
   * mapy bramka raportowała go jako niemierzalny - czyli budżet dałoby się
   * podnieść w innym pliku i bramka nie powiedziałaby ani słowa.
   */
  externalConstants: ReadonlyMap<string, number> = new Map(),
): LoaderBudgetFacts | null {
  const block = routeOptionsBlockWide(source);
  if (block === null) return null;
  const loader = topLevelOption(block, "loader");
  if (loader === null) return null;

  const consts = numericConstants(blankNonCode(source));
  // Linie raportujemy BEZWZGLĘDNIE (numer w pliku), nie względnie do ciała
  // loadera: komunikat bramki ma dać się kliknąć w edytorze. Ciało loadera
  // wycinamy z tekstu, więc offset trzeba dodać z powrotem.
  const clean = blankNonCode(source);
  const loaderAt = clean.indexOf(loader.slice(0, Math.min(60, loader.length)));
  const baseLine = loaderAt === -1 ? 1 : lineOf(clean, loaderAt);

  const budgetSites: BudgetSite[] = [];
  const budgetRe = /await\s+withBudget\s*\(/g;
  for (const m of loader.matchAll(budgetRe)) {
    const open = loader.indexOf("(", (m.index ?? 0) + m[0].length - 1);
    const args = balancedArgs(loader, open);
    // The second argument is the phase ceiling. The optional absolute
    // deadline (third argument) can only shorten it. A trailing comma must
    // not make either form disappear from the static report.
    const parts = splitTopLevel(args);
    const constName = parts[1]?.trim() ?? "";
    const literal = /^\d[\d_]*$/.test(constName)
      ? Number(constName.replaceAll("_", ""))
      : (consts.get(constName) ?? externalConstants.get(constName) ?? null);
    budgetSites.push({ line: baseLine + lineOf(loader, m.index ?? 0) - 1, constName, ms: literal });
  }

  const parallelSites: ParallelSite[] = [];
  const parallelRe = /Promise\s*\.\s*(?:all|allSettled)\s*\(/g;
  for (const m of loader.matchAll(parallelRe)) {
    const open = loader.indexOf("(", (m.index ?? 0) + m[0].length - 1);
    const args = balancedArgs(loader, open).trim();
    const line = baseLine + lineOf(loader, m.index ?? 0) - 1;
    if (args.startsWith("[")) {
      parallelSites.push({ line, arms: countArms(args.slice(1, args.lastIndexOf("]"))) });
    } else {
      // Tablica budowana zmienną - NIEMIERZALNA. `null`, nie zero.
      parallelSites.push({ line, arms: null });
    }
  }

  const chainMs = budgetSites.reduce((sum, s) => sum + (s.ms ?? 0), 0);
  const armCounts = parallelSites.map((s) => s.arms).filter((a): a is number => a !== null);
  return {
    file,
    budgetSites,
    chainMs,
    parallelSites,
    maxParallelArms: armCounts.length > 0 ? Math.max(...armCounts) : 0,
    cacheWrites: [...loader.matchAll(CACHE_WRITE_RE)].length,
  };
}

/**
 * TRZY INWARIANTY DEHYDRACJI z `src/router.tsx`. To one, a nie żadna stała,
 * decydują o tym, CO wchodzi do payloadu wstrzykiwanego w HTML - więc ich
 * zniknięcie jest dokładnie tą regresją, której budżet (3) ma pilnować.
 */
export function dehydrationInvariants(routerSource: string | null): DehydrationInvariant[] {
  // UWAGA: TYLKO komentarze, LITERAŁY NAPISOWE ZOSTAJĄ. Te trzy inwarianty
  // rozpoznaje się PO LITERAŁACH (`status === "success"`, `reason: "dehydrate"`),
  // więc `blankNonCode` - który wygasza treść napisów - dawał tu FAŁSZYWĄ
  // CZERWIEŃ na poprawnym `src/router.tsx`. Wygaszanie napisów jest właściwe
  // przy LICZENIU wzorców kodu (i tam zostaje), a błędne przy dopasowywaniu
  // wzorców, których napis jest częścią.
  const clean = routerSource === null ? "" : stripTsComments(routerSource);
  // WYWOŁANIE, NIE PIERWSZE WYSTĄPIENIE IDENTYFIKATORA - i to jest naprawa
  // defektu, który czynił ten inwariant PUSTYM na prawdziwym pliku.
  // `src/router.tsx:13` IMPORTUJE `sweepQueryCacheForSerialization`, a samo
  // wywołanie stoi w `:160`. `indexOf(nazwa)` trafiał więc w import, który
  // ZAWSZE poprzedza deklarację `integrationDehydrate` - czyli warunek
  // „zamiatanie PRZED dehydracją" był spełniony niezależnie od tego, gdzie
  // naprawdę stoi wywołanie. Przeniesienie sweepa POD
  // `await integrationDehydrate?.()` - dokładnie ta regresja, której ten
  // inwariant ma pilnować - przechodziło na zielono. Zmierzone na
  // prawdziwym `src/router.tsx`, nie na atrapie.
  //
  // `nazwa\s*\(` pomija import z konstrukcji: `import { nazwa } from "..."`
  // nie ma nawiasu po identyfikatorze.
  const sweepAt = clean.search(/sweepQueryCacheForSerialization\s*\(/);
  // `?.` W WYWOŁANIU JEST TU REGUŁĄ: `src/router.tsx` woła
  // `await integrationDehydrate?.()`, więc wzorzec bez opcjonalnego łańcucha
  // nie trafiał i inwariant „zamiatanie PRZED dehydracją" raportował się jako
  // ZNIKNIĘTY na drzewie, na którym jest obecny.
  const integrationAt = clean.search(/integrationDehydrate\s*\??\.?\s*\(/);
  return [
    {
      name: "shouldDehydrateQuery zawężony do sukcesu",
      present: /shouldDehydrateQuery/.test(clean) && /status\s*===\s*"success"/.test(clean),
      why: "bez tego do HTML-a wchodzą też zapytania pending i błędne - czyli waga payloadu rośnie o dane, których klient nie może użyć",
    },
    {
      name: "zamiatanie cache'u PRZED dehydracją",
      present: sweepAt !== -1 && integrationAt !== -1 && sweepAt < integrationAt,
      why: "`sweepQueryCacheForSerialization` usuwa nierozstrzygnięte zapytania; wywołane PO dehydracji nie zmniejszyłoby payloadu ani o bajt",
    },
    {
      name: "strumień zapytań opakowany strażnikiem",
      present: /guardQueryStream\s*\(/.test(clean),
      why: "niedomknięty strumień zostawia klienta po hydratacji w oczekiwaniu na porcję, która nie przyjdzie",
    },
  ];
}

export function analyzeSsrBudgets(input: SsrBudgetInput): SsrBudgetReport {
  // MAPA STAŁYCH Z CAŁEGO WEJŚCIA, budowana PRZED analizą loaderów: budżet
  // przekazany do `withBudget` bywa importowany z innego modułu (patrz
  // `externalConstants`), a bramka, która tego nie rozwiązuje, zostawia otwartą
  // drogę do podniesienia budżetu bez jej zapalenia.
  const globalConstants = new Map<string, number>();
  for (const { source } of input.sources) {
    for (const [name, value] of numericConstants(blankNonCode(source))) {
      globalConstants.set(name, value);
    }
  }

  const loaders: LoaderBudgetFacts[] = [];
  let routerSource: string | null = null;
  for (const { file, source } of input.sources) {
    if (file === ROUTER_FILE || file.endsWith(`/${ROUTER_FILE}`)) routerSource = source;
    const facts = loaderBudgetFacts(file, source, globalConstants);
    if (facts !== null) loaders.push(facts);
  }

  const root = loaders.find((l) => l.file === ROOT_ROUTE_FILE || l.file.endsWith(ROOT_ROUTE_FILE));
  // Root now warms theme queries through loadResilient. Its configured phase
  // ceilings still count, even though they are not direct withBudget calls.
  // This is a conservative bound for non-home routes, not measured TTFB.
  const rootConstants = numericConstants(
    blankNonCode(input.sources.find((source) => source.file === root?.file)?.source ?? ""),
  );
  const indirectRootBudget = ["ROOT_WARM_BUDGET_MS", "CHROME_WARM_BUDGET_MS"].reduce(
    (sum, name) =>
      sum +
      (root?.budgetSites.some((site) => site.constName === name)
        ? 0
        : (rootConstants.get(name) ?? 0)),
    0,
  );
  const rootWarmChainMs = root ? root.chainMs + indirectRootBudget : null;
  const violations: SsrBudgetViolation[] = [];
  const unmeasurable: string[] = [];

  // ── BUDŻET 1a: łańcuch rozgrzewki KORZENIA ────────────────────────────────
  if (
    root !== undefined &&
    rootWarmChainMs !== null &&
    rootWarmChainMs > FROZEN_SSR_BUDGETS.rootWarmChainMs
  ) {
    violations.push({
      budget: "rootWarmChainMs",
      file: root.file,
      measured: rootWarmChainMs,
      ceiling: FROZEN_SSR_BUDGETS.rootWarmChainMs,
      detail: `fale rozgrzewki korzenia: ${root.budgetSites
        .map((s) => `${s.constName}=${s.ms ?? "?"}`)
        .join(" + ")}`,
    });
  }

  for (const loader of loaders) {
    // ── BUDŻET 1b: szeregowany łańcuch budżetów loadera trasy ───────────────
    if (loader.chainMs > FROZEN_SSR_BUDGETS.loaderChainMs) {
      violations.push({
        budget: "loaderChainMs",
        file: loader.file,
        measured: loader.chainMs,
        ceiling: FROZEN_SSR_BUDGETS.loaderChainMs,
        detail: `${loader.budgetSites.length} x await withBudget: ${loader.budgetSites
          .map((s) => `${s.constName}=${s.ms ?? "?"}`)
          .join(" + ")}`,
      });
    }
    // ── BUDŻET 2: równoległe podżądania ─────────────────────────────────────
    if (loader.maxParallelArms > FROZEN_SSR_BUDGETS.parallelQueriesPerLoader) {
      const worst = loader.parallelSites.find((s) => s.arms === loader.maxParallelArms);
      violations.push({
        budget: "parallelQueriesPerLoader",
        file: loader.file,
        measured: loader.maxParallelArms,
        ceiling: FROZEN_SSR_BUDGETS.parallelQueriesPerLoader,
        detail: `tablica Promise.all* w linii ${worst?.line ?? "?"} loadera ma ${loader.maxParallelArms} odnóg; runtime Workers odrzuca 7. subrequest`,
      });
    }
    // ── BUDŻET 3 (proxy): wpisy do cache'u zapytań ──────────────────────────
    if (loader.cacheWrites > FROZEN_SSR_BUDGETS.dehydrationWritesPerLoader) {
      violations.push({
        budget: "dehydrationWritesPerLoader",
        file: loader.file,
        measured: loader.cacheWrites,
        ceiling: FROZEN_SSR_BUDGETS.dehydrationWritesPerLoader,
        detail:
          "każdy rozstrzygnięty wpis wchodzi do dehydratowanego stanu w HTML-u (proxy liczby wpisów, nie bajtów)",
      });
    }
    const unmeasurableHere = loader.parallelSites.filter((s) => s.arms === null);
    for (const site of unmeasurableHere) {
      unmeasurable.push(
        `${loader.file}: Promise.all* w linii ${site.line} loadera - liczby odnóg NIE DA SIĘ ustalić ze źródeł (tablica ze zmiennej albo rozwinięcie \`...xs\`)`,
      );
    }
    // ── NOWA DZIURA W RÓWNOLEGŁOŚCI = OBLANIE ──────────────────────────────
    //
    // Miejsce niemierzalne jest dziurą w budżecie (2): tablicą ze zmiennej
    // albo rozwinięciem można wprowadzić dowolnie wiele podżądań. Dwie takie
    // dziury ISTNIAŁY przy powstaniu bramki (loader korzenia) i są opisane
    // w `FROZEN_UNMEASURABLE_PARALLEL`; KAŻDA NOWA oblewa. Bez tego
    // raportowanie dziur znaczyłoby, że dziury wolno dokładać.
    const allowed = FROZEN_UNMEASURABLE_PARALLEL[loader.file] ?? 0;
    if (unmeasurableHere.length > allowed) {
      violations.push({
        budget: "unmeasurableParallel",
        file: loader.file,
        measured: unmeasurableHere.length,
        ceiling: allowed,
        detail: `niemierzalna równoległość w liniach ${unmeasurableHere.map((s) => s.line).join(", ")} - przez tablicę ze zmiennej albo rozwinięcie \`...xs\` da się wprowadzić dowolnie wiele podżądań, a sufit ${FROZEN_SSR_BUDGETS.parallelQueriesPerLoader} przestaje cokolwiek znaczyć`,
      });
    }
    // ── BUDŻET NIEROZWIĄZANY = OBLANIE, nie adnotacja ──────────────────────
    //
    // NAPRAWA DZIURY, KTÓRA PRZEPUSZCZAŁA DOWOLNIE DUŻY BUDŻET. `chainMs`
    // sumuje `s.ms ?? 0`, więc budżet, którego bramka nie umie rozwiązać
    // (wyrażenie `2_500 + 1`, wynik funkcji, stała spoza skanu), liczył się
    // jako ZERO. Zmierzone: `ROOT_WARM_BUDGET_MS = 2_500 + 1` dawało
    // `rootWarmChainMs = 500` i `ssrBudgetsFailed() === false` - czyli
    // podniesienie budżetu o dowolną wartość przechodziło przez bramkę
    // BLOKUJĄCĄ, o ile tylko zapisano je jako wyrażenie.
    //
    // Nie da się „rozwiązać wyrażenia" statycznie w ogólności i nie o to tu
    // chodzi: bramka ma wtedy POWIEDZIEĆ, że nie wie, a nie policzyć zero.
    // Konsekwencja praktyczna: budżet MUSI być literałem albo stałą - i to
    // jest wymóg, nie ograniczenie, bo dokładnie takie są wszystkie dzisiejsze
    // (zmierzone: 13 wywołań `withBudget`, wszystkie rozwiązane).
    for (const site of loader.budgetSites) {
      if (site.ms === null) {
        violations.push({
          budget: "unresolvedBudget",
          file: loader.file,
          measured: 0,
          ceiling: 0,
          detail: `budżet \`${site.constName}\` w linii ${site.line} nie jest literałem ani stałą liczbową w zasięgu skanu - bramka policzyłaby go jako ZERO, czyli przepuściłaby dowolną wartość`,
        });
      }
    }
  }

  const invariants = dehydrationInvariants(routerSource);
  for (const inv of invariants) {
    if (!inv.present) {
      violations.push({
        budget: "dehydrationInvariant",
        file: ROUTER_FILE,
        measured: 0,
        ceiling: 1,
        detail: `${inv.name} - ${inv.why}`,
      });
    }
  }

  return {
    loaders,
    rootWarmChainMs,
    dehydrationInvariants: invariants,
    violations,
    unmeasurable,
  };
}

export function ssrBudgetsFailed(report: SsrBudgetReport): boolean {
  // Brak pliku korzenia na wejściu to AWARIA SKANU, nie zielony wynik: bramka
  // bez pliku, którego pilnuje, nie pilnuje niczego.
  if (report.rootWarmChainMs === null) return true;
  return report.violations.length > 0;
}

export function renderSsrBudgetReport(report: SsrBudgetReport): string {
  const lines: string[] = [];
  if (report.rootWarmChainMs === null) {
    lines.push(
      `✗ Nie znalazłem loadera w ${ROOT_ROUTE_FILE} - bramka nie zmierzyła pliku, którego pilnuje.`,
    );
    return lines.join("\n");
  }

  const worstChain = report.loaders.reduce(
    (a, b) => (b.chainMs > a.chainMs ? b : a),
    report.loaders[0],
  );
  const worstParallel = report.loaders.reduce(
    (a, b) => (b.maxParallelArms > a.maxParallelArms ? b : a),
    report.loaders[0],
  );
  const worstWrites = report.loaders.reduce(
    (a, b) => (b.cacheWrites > a.cacheWrites ? b : a),
    report.loaders[0],
  );

  lines.push(`Budżety wewnętrzne SSR: ${report.loaders.length} loaderów przeskanowanych.`);
  lines.push(
    `  rozgrzewka korzenia:     ${report.rootWarmChainMs} ms  (sufit ${FROZEN_SSR_BUDGETS.rootWarmChainMs} ms)`,
  );
  lines.push(
    `  najdłuższy łańcuch:      ${worstChain?.chainMs ?? 0} ms  (sufit ${FROZEN_SSR_BUDGETS.loaderChainMs} ms, ${worstChain?.file ?? "-"})`,
  );
  lines.push(
    `  równoległe podżądania:   ${worstParallel?.maxParallelArms ?? 0}     (sufit ${FROZEN_SSR_BUDGETS.parallelQueriesPerLoader}, ${worstParallel?.file ?? "-"})`,
  );
  lines.push(
    `  wpisy do dehydracji:     ${worstWrites?.cacheWrites ?? 0}     (sufit ${FROZEN_SSR_BUDGETS.dehydrationWritesPerLoader}, ${worstWrites?.file ?? "-"})`,
  );
  for (const inv of report.dehydrationInvariants) {
    lines.push(`  ${inv.present ? "✓" : "✗"} ${inv.name}`);
  }

  if (report.unmeasurable.length > 0) {
    lines.push("");
    lines.push(
      `NIEMIERZALNE STATYCZNIE (${report.unmeasurable.length}) - wypisane, żeby zielony wynik nie znaczył „wszystko policzone":`,
    );
    for (const u of report.unmeasurable) lines.push(`  ~ ${u}`);
  }

  if (report.violations.length === 0) {
    lines.push("");
    lines.push("✓ Wszystkie trzy budżety wewnętrzne w sufitach.");
    return lines.join("\n");
  }

  lines.push("");
  for (const v of report.violations) {
    const over = v.measured - v.ceiling;
    lines.push(
      v.budget === "dehydrationInvariant"
        ? `✗ ${v.file}: ZNIKNĄŁ inwariant dehydracji - ${v.detail}`
        : `✗ ${v.file}: ${v.budget} = ${v.measured} > ${v.ceiling} (PRZEKROCZONE O ${over}). ${v.detail}`,
    );
  }
  lines.push("");
  lines.push("PODNIESIENIE SUFITU JEST OSTATECZNOŚCIĄ: te liczby są cenami stanu dzisiejszego,");
  lines.push("a dwie z nich (rozgrzewka korzenia, równoległość) mają ZERO zapasu z premedytacją.");
  return lines.join("\n");
}
