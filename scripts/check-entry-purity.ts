/**
 * Bramka CZYSTOŚCI ŚCIEŻKI BOOTOWANIA klienta: żaden ciężki SDK zewnętrznego
 * operatora nie może być STATYCZNIE osiągalny z chunku startowego przeglądarki.
 *
 * INCYDENT 2026-08-06 (bramka `check:bundle` czerwona na mainie). Łańcuch:
 *   routes/$.tsx -> components/Paywall.tsx -> EmbeddedCheckoutDialog
 *     -> @stripe/react-stripe-js  +  lib/stripe.ts -> loadStripe (@stripe/stripe-js)
 * Wszystkie krawędzie były STATYCZNE, a `lib/stripe.ts` miało 17 importerów
 * rozsianych po aplikacji (większość tylko po helper środowiskowy do kluczy
 * zapytań). Rollup hoistuje moduł współdzielony przez wiele chunków do ich
 * wspólnego przodka - czyli do ENTRY. Skutek: KAŻDY anonimowy czytelnik
 * dowolnego artykułu pobierał i parsował SDK bramki płatniczej (marker
 * `js.stripe.com` w chunku entry), choć nigdy nie zobaczy checkoutu.
 *
 * Dlaczego osobna, statyczna bramka, skoro jest już `check:bundle`? Bo budżet
 * kilobajtów mierzy SKUTEK i to z opóźnieniem: wystarczy, że ktoś w tym samym
 * PR zetnie inne kilobajty, i regresja architektoniczna przechodzi niezauważona.
 * Ta bramka mierzy PRZYCZYNĘ - krawędź w grafie chunków - więc jest odporna na
 * kompensację i mówi wprost, który import ją złamał. Ten sam wzorzec, co
 * `check-chunk-graph.ts` (cykle) i `check-no-paddle.ts` (martwy operator).
 *
 * ZASADA: SDK operatora ma trafiać do przeglądarki wyłącznie przez `import()`
 * na INTENCJĘ zakupu (patrz `components/checkout/EmbeddedCheckoutFrame.tsx`).
 * Ładowanie leniwe jest w porządku; statyczna krawędź z bootu - nie.
 *
 * TA BRAMKA NIE WAŻY BAJTÓW - I NADAL NIE MA WAŻYĆ (2026-09-01). Domknięcie
 * liczone niżej ma od dziś swój FLOOR KILOBAJTOWY, ale w `check-bundle-size.ts`
 * (`FROZEN_BUDGET_KB.boot`, wpis X w tamtejszej kronice). Podział jest celowy:
 * suma kilobajtów jest KOMPENSOWALNA (zetnij jeden vendor, dołóż tyle samo do
 * entry - suma stoi, a bramka milczy), więc próg wagowy tutaj uczyniłby akapit
 * wyżej nieprawdziwym. Tutaj zostaje dowód architektoniczny: KTÓRA KRAWĘDŹ.
 * Tam - ile to waży, bo tylko tam istnieje mechanizm zamrażania progów
 * (`budget()` + ignorowanie env w CI), ostrzeżenie o zapasie i baseline.
 * CENA: `findBootChunks()` i filtr `import(` mają teraz DRUGI egzemplarz w tamtym
 * pliku i te dwa nie mogą się rozjechać. Trzyma je razem ta sama zmienna
 * `ENTRY_CHUNKS`, ten sam wzorzec krawędzi i te dwa odwołania w komentarzach.
 * Docelowo: wspólny `scripts/lib/bootClosure.ts` importowany przez oba - osobny
 * PR, bo dotyka charteru obu plików.
 *
 * Usage: bun run scripts/check-entry-purity.ts   (po `bun run build`)
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

/** Pakiet zewnętrzny + literały, po których go rozpoznajemy w zminifikowanym chunku. */
interface ForbiddenSdk {
  readonly label: string;
  /** Literały przetrwają minifikację (URL-e, komunikaty błędów) - identyfikatory nie. */
  readonly markers: readonly string[];
  /** Jak ma być ładowany zamiast tego. */
  readonly remedy: string;
}

const FORBIDDEN_SDKS: readonly ForbiddenSdk[] = [
  {
    label: "@stripe/stripe-js (loader Stripe.js)",
    markers: ["js.stripe.com"],
    remedy: "importuj `loadStripe` dynamicznie w `lib/stripe.ts` (`getStripe()`), nigdy statycznie",
  },
  {
    label: "@stripe/react-stripe-js (bindingi React)",
    markers: ["Unsupported prop change: options.", "in both a checkout provider"],
    remedy:
      "jedynym statycznym importerem ma być `components/checkout/StripeEmbeddedFrame.tsx`, " +
      "wciągany przez `React.lazy` w `EmbeddedCheckoutFrame`",
  },
];

/**
 * Ciężki słownik i18n + literał, po którym go poznajemy w zminifikowanym chunku.
 *
 * PO CO DRUGA KLASA REGUŁ. 2026-08-13: chunk wejściowy miał 511,4 KB przy progu
 * 513 - 1,7 KB zapasu (0,33%). Przyczyną było CZTERY STRINGI: `club.apply.tsx`
 * importowało surowe obiekty `clubPl`/`clubEn` i czytało z nich `head()`, a
 * TanStack Start trzyma `head:` EAGER w drzewie tras, czyli w chunku wejściowym
 * (`component:` jest leniwy, `head:` nie jest). Jedna statyczna krawędź po meta
 * SEO wciągała cały słownik klubów: zmierzone 47,4 KB gzip, 9,3% chunku.
 *
 * DLACZEGO NIE WYSTARCZY BUDŻET W KILOBAJTACH. Budżet mierzy SKUTEK i z dużym
 * opóźnieniem: da się go skompensować ścięciem czegoś innego w tym samym PR,
 * a wtedy regresja architektoniczna przechodzi z zieloną bramką. Kronika
 * w `check-bundle-size.ts` opisuje ten tryb trzy razy (08-01, 08-03, 08-12).
 * Ta reguła pilnuje PRZYCZYNY: słownik nie ma prawa być statycznie osiągalny
 * ze ścieżki bootowania, niezależnie od tego, ile aktualnie waży.
 *
 * MARKER MUSI BYĆ WARTOŚCIĄ, NIE ŚCIEŻKĄ KLUCZA. Ścieżka `club.role.moderator`
 * nie istnieje dosłownie w pliku o strukturze zagnieżdżonej (`role: { moderator:
 * … }`), więc sonda na klucz daje fałszywy negatyw - to pomyłka, którą audyt
 * z 2026-08-13 popełnił i skorygował (§5.1). Wartość przeżywa minifikację.
 */
interface HeavyDictionary {
  readonly label: string;
  readonly markers: readonly string[];
  readonly remedy: string;
}

const HEAVY_DICTIONARIES: readonly HeavyDictionary[] = [
  {
    label: "i18n-club (słownik klubów dyskusyjnych, ~47 KB gzip)",
    markers: ["Kluby dyskusyjne są dostępne po zalogowaniu"],
    remedy:
      "`head()` trasy NIE MOŻE czytać drzewa słownika - trzymaj meta SEO w stałej mapie " +
      "PL/EN obok trasy (wzorzec: `lib/clubs/applyHead.ts`, `lib/clubs/specializationHead.ts`), " +
      "a w komponencie wołaj `t()` po `ensureClubI18n()`",
  },
  {
    label: "i18n-builder (słownik page buildera)",
    markers: ["Ustawienia widgetu"],
    remedy: "słownik panelu ma zostać poza drzewem tras publicznych - patrz wyżej",
  },
  {
    label: "i18n-profile (słownik profilu)",
    markers: ["Twoje zainteresowania"],
    remedy: "jak wyżej",
  },
  {
    label: "i18n-clubs-admin (słownik panelu klubów)",
    markers: ["Zgłoszenia do klubów"],
    remedy: "jak wyżej - panel ma własny chunk, wołany przez `ensureAdminClubsI18n()`",
  },
  // 2026-08-18: trzy najcięższe słowniki, które wracały do entry przez
  // SIDE-EFFECTOWY import w pliku trasy (`import "@/lib/i18n-…"`). Splitter
  // nie przenosi importu bez referencji, więc słownik zostawał w shellu trasy,
  // a shelle wszystkich tras są eager. Naprawa: no-op `ensureI18n()` wołany
  // W KOMPONENCIE trasy (wzorzec i18n-club/i18n-network).
  {
    label: "i18n-admin-post-panes (słownik edytora wpisów, ~40 kB źródeł)",
    markers: ["Wgrany plik MP3 ma pierwszeństwo - dla tego języka lektor AI nie jest wołany."],
    remedy:
      "w pliku trasy zamień side-effectowy import słownika na " +
      "`import { ensureI18n } from …` wołane w komponencie trasy",
  },
  {
    label: "i18n-network (słownik Mojej sieci, ~27 kB źródeł)",
    markers: ["Sieć kontaktów jest dostępna po zalogowaniu"],
    remedy: "jak wyżej - ensureI18n() w komponencie, nigdy side-effect w pliku trasy",
  },
  {
    label: "i18n-admin-popup-signup (słownik popupu zapisu, ~17 kB źródeł)",
    markers: ["Zapisano ustawienia popupu"],
    remedy: "jak wyżej - ensureI18n() w komponencie, nigdy side-effect w pliku trasy",
  },
];

/**
 * Ciężkie moduły spoza słowników, które 2026-08-18 zeszły ze ścieżki
 * bootowania i nie mają prawa na nią wrócić. Ta sama mechanika markerów:
 * wartość-literal, która przeżywa minifikację.
 */
const HEAVY_MODULES: readonly HeavyDictionary[] = [
  {
    label: "dompurify (~82 kB źródeł)",
    // Nazwy hooków DOMPurify - klucze obiektu, esbuild ich nie mangluje.
    markers: ["beforeSanitizeElements"],
    remedy:
      "czyste helpery sanityzacji importuj z `lib/sanitizePure` (bez DOMPurify); " +
      "sanitizeHtml/sanitizeMarkdownHtml wolno wołać tylko z chunków lazy " +
      "(wzorzec: widget-view/AccordionWidget)",
  },
  {
    label: "sonner (biblioteka toastów, ~63 kB źródeł)",
    markers: ["data-sonner-toaster"],
    remedy:
      "moduły ścieżki bootowania wołają toasty przez `lib/notify` (leniwy most), " +
      "a <Toaster/> w __root.tsx jest React.lazy - nie przywracaj statycznych importów sonnera",
  },
  {
    label: "lib/builder/sectionLabelVariants (21 wariantów etykiety, ~39 kB źródeł)",
    // Wartość wariantu, nie etykieta: etykiety PL są zduplikowane w
    // lib/builder/labelsEn.ts (mapa tłumaczeń kluczowana etykietą), więc
    // marker po etykiecie wskazywałby zły moduł w komunikacie bramki.
    markers: ["slanted-ribbon-rule"],
    remedy:
      "widget section-label renderuj przez lazyWidgets.SectionLabelWidgetView, " +
      "nigdy statycznym importem w SimpleWidgets/WidgetView",
  },
  {
    label: "echarts + echarts-for-react (silnik wykresów BI, ~1 MB w bundlu)",
    // DLACZEGO TA POZYCJA ISTNIEJE. `components/admin/analytics/EChart.tsx`
    // opisuje w nagłówku, po co w ogóle jest: wciągnięcie ECharts do grafu SSR
    // (chunk routera >2,5 MB) wywalało renderer chunków Rollupa na OOM V8 przy
    // `build:dev`. Obroną jest `React.lazy` do `EChartClient.tsx` plus zakaz
    // statycznego importu - zapisany DO TEJ PORY WYŁĄCZNIE W KOMENTARZU
    // („Do NOT statically import ./EChartClient from this file"). Czyli
    // najdroższa architektonicznie niezmienność tego modułu nie miała bramki,
    // choć bramka na dokładnie tę klasę niezmienności stoi w tym pliku od
    // incydentu 2026-08-06. Jedno `import` w złym miejscu - i build pada, a
    // dowiadujemy się o tym z CI, nie z komunikatu wskazującego krawędź.
    //
    // WYBÓR MARKERÓW. Oba MUSZĄ przeżyć build PRODUKCYJNY, a nie tylko
    // deweloperski - i to jest tu pułapka nieoczywista: prawie wszystkie ładne,
    // czytelne komunikaty ECharts („There is a chart instance already
    // initialized on the dom.", „Initialize failed: invalid dom.") siedzą w
    // `if (process.env.NODE_ENV !== 'production')` i w `echarts.min.js` ich NIE
    // MA - sonda po nich dałaby bramkę, która nigdy nie zapala się na produkcji.
    // Zweryfikowane: `grep -c` na `node_modules/echarts/dist/echarts.min.js`
    // zwraca dla nich 0. Oba markery niżej zwracają 1:
    //   * `_echarts_instance_` - `DOM_ATTRIBUTE_KEY` z `lib/core/echarts.js`,
    //     klucz atrybutu DOM, więc jest wartością, nie identyfikatorem;
    //   * ` is used but not imported.` - treść `throw new Error` z
    //     `lib/util/clazz.js`, POZA jakąkolwiek bramką środowiska.
    // Dwa niezależne moduły rdzenia, żeby jedna zmiana upstreamu nie rozbroiła
    // bramki w ciszy. Żaden z nich nie występuje w `src/` ani w innym pakiecie
    // z `node_modules` (sprawdzone).
    markers: ["_echarts_instance_", " is used but not imported."],
    remedy:
      "wykresy renderuj WYŁĄCZNIE przez `components/admin/analytics/EChart.tsx` " +
      "(React.lazy -> EChartClient); NIGDY nie importuj statycznie `EChartClient`, " +
      "`echarts`, `echarts/core` ani `echarts-for-react` z pliku osiągalnego ze " +
      "ścieżki bootowania - patrz nagłówek EChart.tsx",
  },
  {
    label: "lib/legal/content/* (pełne treści dokumentów prawnych, ~37 kB źródeł)",
    // Po jednym markerze na dokument: privacy / terms / refunds.
    markers: [
      "Administratorem Twoich danych osobowych jest ",
      "Zawierasz umowę o świadczenie usług drogą elektroniczną",
      "który technicznie realizuje zwrot środków",
    ],
    remedy:
      "head() trasy prawnej czyta wyłącznie lib/legal/meta.ts - wspólna stała " +
      "head+komponent ląduje w module ?tsr-shared, czyli w entry (patrz meta.ts)",
  },
];

const CLIENT_DIR =
  process.env["CLIENT_DIR"] ??
  [".output/public/assets", "dist/client/assets"].find((d) => listJs(d).length > 0) ??
  ".output/public/assets";

/** Katalogi, w których szukamy manifestu TanStack Start (wskazuje chunk startowy). */
const SERVER_DIRS = [".output/server", "dist/server"] as const;

function listJs(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".js"));
  } catch {
    return [];
  }
}

/**
 * Chunki startowe: to, co serwer wstrzykuje jako `<script type="module">` przy
 * renderze SSR. Czytamy je z manifestu TanStack Start zamiast zgadywać po
 * nazwie/rozmiarze - manifest jest jedynym miejscem, które NAPRAWDĘ mówi, co
 * pobiera przeglądarka. Override: ENTRY_CHUNKS="a.js,b.js" - CELOWO ta sama
 * zmienna, co w `check-bundle-size.ts` (floor `boot`): jeden artefakt, jedna
 * pokrętka, żeby te dwie bramki nie mogły policzyć różnych korzeni.
 */
function findBootChunks(): string[] {
  const override = process.env["ENTRY_CHUNKS"];
  if (override) return override.split(",").map((s) => basename(s.trim()));

  const scriptRe = /scripts:\s*\[[^\]]*?src:\s*["']\/assets\/([A-Za-z0-9._$-]+\.js)["']/g;
  const found = new Set<string>();
  for (const dir of SERVER_DIRS) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of entries) {
      if (!file.endsWith(".mjs") && !file.endsWith(".js")) continue;
      const src = readFileSync(join(dir, file), "utf8");
      for (const m of src.matchAll(scriptRe)) found.add(m[1]);
    }
    if (found.size > 0) break;
  }
  return [...found];
}

/**
 * Statyczne krawędzie chunk -> chunk. `import(` NIE tworzy krawędzi
 * inicjalizacyjnej (ten sam filtr, co w `check-chunk-graph.ts` i co
 * `STATIC_EDGE_RE` w `check-bundle-size.ts`). UWAGA na trzeci wzorzec w tamtym
 * pliku: `EDGE_RE` w `adminOnlyByGraph()` dopasowuje `import(` ŚWIADOMIE, bo
 * pyta o OSIĄGALNOŚĆ, nie o inicjalizację. Nie „ujednolicaj" ich.
 */
const IMPORT_RE = /(import\s*\(?\s*|from\s*)["'](\.\/[^"']+\.js)["']/g;

function staticEdges(files: readonly string[]): Map<string, Set<string>> {
  const edges = new Map<string, Set<string>>();
  for (const f of files) {
    const src = readFileSync(join(CLIENT_DIR, f), "utf8");
    const out = new Set<string>();
    for (const m of src.matchAll(IMPORT_RE)) {
      if (m[1].trimEnd().endsWith("(")) continue;
      const target = basename(m[2]);
      if (target !== f) out.add(target);
    }
    edges.set(f, out);
  }
  return edges;
}

function reachable(roots: readonly string[], edges: Map<string, Set<string>>): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop() as string;
    if (seen.has(node) || !edges.has(node)) continue;
    seen.add(node);
    for (const next of edges.get(node) ?? []) stack.push(next);
  }
  return seen;
}

function main(): void {
  const files = listJs(CLIENT_DIR);
  if (files.length === 0) {
    console.error(`✗ Brak chunków JS w ${CLIENT_DIR}. Najpierw \`bun run build\`.`);
    process.exit(1);
  }

  const boot = findBootChunks().filter((f) => files.includes(f));
  if (boot.length === 0) {
    console.error(
      "✗ Nie udalo sie ustalic chunku startowego z manifestu TanStack Start.\n" +
        `  Szukano \`scripts:[{attrs:{src:"/assets/*.js"}}]\` w: ${SERVER_DIRS.join(", ")}.\n` +
        "  Jesli adapter zmienil uklad artefaktu, podaj chunk jawnie: ENTRY_CHUNKS=index-HASH.js",
    );
    process.exit(1);
  }

  const edges = staticEdges(files);
  const bootGraph = reachable(boot, edges);

  const violations: string[] = [];
  for (const sdk of FORBIDDEN_SDKS) {
    const hits: string[] = [];
    for (const chunk of bootGraph) {
      const src = readFileSync(join(CLIENT_DIR, chunk), "utf8");
      if (sdk.markers.some((marker) => src.includes(marker))) hits.push(chunk);
    }
    if (hits.length > 0) {
      violations.push(
        `  • ${sdk.label}\n` +
          hits.map((h) => `      w chunku startowym: ${h}`).join("\n") +
          `\n      naprawa: ${sdk.remedy}`,
      );
    }
  }

  for (const dict of HEAVY_DICTIONARIES) {
    const hits: string[] = [];
    for (const chunk of bootGraph) {
      const src = readFileSync(join(CLIENT_DIR, chunk), "utf8");
      if (dict.markers.some((marker) => src.includes(marker))) hits.push(chunk);
    }
    if (hits.length > 0) {
      violations.push(
        `  • ${dict.label}\n` +
          hits.map((h) => `      w chunku startowym: ${h}`).join("\n") +
          `\n      naprawa: ${dict.remedy}`,
      );
    }
  }

  for (const mod of HEAVY_MODULES) {
    const hits: string[] = [];
    for (const chunk of bootGraph) {
      const src = readFileSync(join(CLIENT_DIR, chunk), "utf8");
      if (mod.markers.some((marker) => src.includes(marker))) hits.push(chunk);
    }
    if (hits.length > 0) {
      violations.push(
        `  • ${mod.label}\n` +
          hits.map((h) => `      w chunku startowym: ${h}`).join("\n") +
          `\n      naprawa: ${mod.remedy}`,
      );
    }
  }

  console.log(
    `Sciezka bootowania: ${boot.join(", ")} -> ${bootGraph.size} chunkow statycznie osiagalnych ` +
      `(z ${files.length}). Wage tego domkniecia bramkuje floor \`boot\` w check:bundle.`,
  );

  if (violations.length > 0) {
    console.error(
      `\n✗ Na sciezce bootowania czytelnika sa rzeczy, ktorych tam byc nie moze:\n${violations.join("\n")}`,
    );
    console.error(
      "\n  Kazdy anonimowy czytelnik pobiera i parsuje ten kod, zanim zobaczy tresc -\n" +
        "  a niemal nikt z nich nie wchodzi w checkout. SDK ma sie ladowac przez\n" +
        "  `import()` na intencje zakupu (checkoutIntentHandlers + React.lazy).",
    );
    process.exit(1);
  }

  console.log(
    "✓ Sciezka bootowania czysta.\n" +
      `  SDK operatora:     ${FORBIDDEN_SDKS.map((s) => s.label).join(", ")}\n` +
      `  ciezkie slowniki:  ${HEAVY_DICTIONARIES.map((d) => d.label.split(" ")[0]).join(", ")}\n` +
      `  ciezkie moduly:    ${HEAVY_MODULES.map((m) => m.label.split(" ")[0]).join(", ")}`,
  );
}

main();
