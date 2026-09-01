// Wtyczka: udostępnia RENDEROWI SERWEROWEMU nazwy plików chunków rdzenia
// słownika (`src/lib/locale/pl.ts`, `src/lib/locale/en.ts`), żeby korzeń mógł
// wysłać dla nich hint `modulepreload`.
//
// PROBLEM, KTÓRY ROZWIĄZUJE. Rdzeń słownika jest dociągany TOP-LEVEL AWAITEM
// w `src/lib/i18n.ts`, w tym samym chunku, w którym stoi `hydrateRoot`.
// Przeglądarka pobiera więc komplet preloadów manifestu korzenia, zaczyna
// wykonywać chunk wejściowy, DOPIERO WTEDY odkrywa `import("@/lib/locale/pl")`
// i płaci pełny, kolejny szeregowy hop (zmierzone: pl 26,0 KB gzip,
// en 22,8 KB gzip) - w oknie, w którym cała reszta już czeka na hydratację.
//
// DLACZEGO NIE `?url`, JAK PRZY ARKUSZU STYLÓW. `assets.appCss` bierze się
// z `import appCss from "../styles.css?url"` - to działa, bo arkusz jest ZASOBEM
// i bundler zna jego finalną nazwę już w chwili transformacji importu. Rdzeń
// słownika jest MODUŁEM: jego nazwa pliku powstaje dopiero przy podziale na
// chunki, więc `?url` nic tu nie da. Manifest klienta (`.vite/manifest.json`)
// też nie jest drogą: ten build go NIE EMITUJE (sprawdzone w artefakcie).
//
// DLACZEGO TYLKO NAGŁÓWEK HTTP `Link`, A NIE `<link>` W `<head>`.
// To jest decyzja, nie oszczędność. Wartości są znane WYŁĄCZNIE w środowisku
// serwerowym: gdy Rollup buduje bundel przeglądarki, plik z adresami jest
// transformowany ZANIM chunki dostaną nazwy, więc bundel klienta nie ma skąd
// wziąć tej samej wartości. Dodanie `<link rel="modulepreload">` do
// `<head>` znaczyłoby więc, że SSR-owy HTML niesie węzeł, którego pierwszy
// render klienta nie odtwarza - a to jest ROZJAZD TOŻSAMOŚCI W KORZENIU
// DOKUMENTU, dokładnie ta klasa awarii, którą całe to zadanie naprawia
// (React 19 odpowiada na nią przebudową drzewa).
//
// Nagłówek `Link` nie ma tego problemu z konstrukcji - nie jest częścią DOM-u -
// a przy tym jest LEPSZY: przeglądarka działa na nim, ZANIM sparsuje `<head>`,
// i NES Edge Cache utrwala go na HIT/STALE (droga do 103 Early Hints).
// Asymetria wobec `rootDocumentLinks` jest tu jedyna, świadoma i przypięta
// testem parytetu.
//
// AWARIA JEST CICHA I BEZPIECZNA: jeśli nazwy nie są znane (dev, vitest, zmiana
// układu artefaktu, inna kolejność środowisk builda), plik zostaje ze swoim
// jawnym fallbackiem `null` i korzeń po prostu nie wysyła hintu - czyli
// dokładnie dzisiejsze zachowanie. Rozjazd KSZTAŁTU literału jest zgłaszany
// ostrzeżeniem builda, nie przemilczany.
//
// DLACZEGO `enforce: "pre"` I DLACZEGO WZORZEC, A NIE LITERAŁ - jedno i drugie
// jest NAPRAWĄ, nie ostrożnością. Pierwsza wersja tej wtyczki nie miała
// `enforce` i szukała literału `"{\n  pl: null,\n  en: null,\n}"` znak
// w znak. Bez `enforce` wtyczka użytkownika trafia do koszyka „normal", czyli
// ZA rdzeniowy `vite:esbuild`, więc do `transform` przychodził już kod PO
// transpilacji TS - a esbuild USUWA PRZECINEK KOŃCOWY:
//   źródło:      `{\n  pl: null,\n  en: null,\n}`
//   po esbuildzie: `{\n  pl: null,\n  en: null\n}`
// Literał nie pasował więc ANI RAZU. Zmierzone na buildzie 2026-09-01: wtyczka
// wypisała swoje własne ostrzeżenie („nie znalazłem literału do podmiany"),
// artefakt pojechał z `null` i hint słownika był MARTWY - dokładnie ta klasa
// cichej straty, którą to zadanie zamyka, tylko wewnątrz jej własnej naprawy.
// Ostrzeżenie zadziałało; nie zadziałał test, bo karmił hook TREŚCIĄ PLIKU
// ŹRÓDŁOWEGO, czyli innym wejściem niż to, które dostaje build.
// `enforce: "pre"` przywraca zamierzone wejście (surowy TS), a wzorzec niżej
// zdejmuje samo SPRZĘŻENIE Z FORMATOWANIEM: przecinek końcowy, szerokość linii
// i styl wcięć przestają decydować o tym, czy hint istnieje. Wzorzec pozostaje
// WĄSKI - zakotwiczony na obu nazwach pól i na `null` - więc zmiana nazwy pola
// nadal daje ostrzeżenie, a nie po cichu hint wskazujący w nic.
import type { Plugin } from "vite";

/** Moduły rdzenia słownika, po jednym na język interfejsu. */
const CORE_MODULES: Readonly<Record<"pl" | "en", string>> = {
  pl: "src/lib/locale/pl.ts",
  en: "src/lib/locale/en.ts",
};

/**
 * Plik źródłowy, którego treść podmieniamy. ŚWIADOMIE nie moduł wirtualny:
 * vitest ma własną konfigurację, a moduł wirtualny zarejestrowany tylko
 * w `vite.config.ts` wywracałby każdy test importujący korzeń drzewa tras.
 */
const TARGET_MODULE = "src/lib/seo/localeChunks.ts";

/**
 * Literał, który podmieniamy. WZORZEC, nie tekst - uzasadnienie w nagłówku
 * (przecinek końcowy zniknął po transpilacji i literał nie pasował ani razu).
 *
 * Wąski celowo: wymaga OBU nazw pól i OBU wartości `null`, więc przemianowanie
 * pola nadal wywraca dopasowanie i zapala ostrzeżenie. Bez flagi `g`, bo
 * `lastIndex` współdzielonego wyrażenia z flagą globalną fałszowałby drugie
 * wywołanie w tym samym procesie (dwa środowiska builda, przypadki testowe).
 */
const PLACEHOLDER_RE = /\{\s*pl:\s*null\s*,\s*en:\s*null\s*,?\s*\}/;

export type LocaleChunkUrls = Readonly<Record<"pl" | "en", string | null>>;

function isClientOutput(dir: string | undefined): boolean {
  return /client|public/.test(dir ?? "");
}

export function localeChunkPlugin(): Plugin {
  /**
   * Nazwy plików zapisane przez `generateBundle` środowiska przeglądarki.
   *
   * STAN INSTANCJI, NIE MODUŁU - i to jest istotne. Vite tworzy wtyczkę raz
   * z konfiguracji i stosuje ją do WSZYSTKICH środowisk builda, więc jedna
   * instancja wystarcza, żeby SSR przeczytał to, co zapisał klient. Stan na
   * poziomie MODUŁU przeciekałby natomiast między niezależnymi buildami w tym
   * samym procesie (i między przypadkami testowymi), czyli wtyczka raportowałaby
   * nazwy z poprzedniego przebiegu.
   */
  const discovered: { pl: string | null; en: string | null } = { pl: null, en: null };

  return {
    name: "nes:locale-chunks",
    apply: "build",
    // PRZED rdzeniowym `vite:esbuild` - inaczej `transform` dostaje kod PO
    // transpilacji TS, a nie treść pliku (patrz nagłówek: to był defekt, który
    // unieważnił hint w całości).
    enforce: "pre",

    transform(code, id) {
      if (!id.replace(/\\/g, "/").endsWith(TARGET_MODULE)) return null;
      // W SSR (budowanym PO kliencie) `discovered` jest już wypełnione; w bundlu
      // przeglądarki nie jest - i tak ma być, bo klient tej wartości nie używa
      // (nagłówek HTTP jest wyłącznie serwerowy).
      if (discovered.pl === null && discovered.en === null) return null;
      if (!PLACEHOLDER_RE.test(code)) {
        // GŁOŚNO, nie po cichu: rozjazd kształtu literału znaczyłby hint
        // wskazujący w nic albo brak hintu bez żadnego śladu.
        this.warn(
          `nes:locale-chunks - nie znalazłem literału do podmiany w ${TARGET_MODULE}; ` +
            "hint modulepreload dla słownika NIE zostanie wysłany",
        );
        return null;
      }
      return {
        // FUNKCJA zamiast łańcucha w drugim argumencie `replace`: w łańcuchu
        // `$` jest znakiem sterującym (`$&`, `$1`), a nazwa pliku pochodzi
        // z Rollupa, nie od nas. Funkcja wstawia wartość dosłownie.
        code: code.replace(PLACEHOLDER_RE, () => JSON.stringify(discovered)),
        map: null,
      };
    },

    generateBundle(options, bundle) {
      if (!isClientOutput(options.dir)) return;
      const base = "/assets/";
      for (const [lang, moduleSuffix] of Object.entries(CORE_MODULES) as ["pl" | "en", string][]) {
        for (const output of Object.values(bundle)) {
          if (output.type !== "chunk") continue;
          // Chunk rdzenia jest dynamicznym wejściem (`import()` z i18n.ts),
          // więc `facadeModuleId` wskazuje wprost na moduł - ale sprawdzamy też
          // listę modułów, żeby zmiana strategii podziału nie ucięła hintu
          // po cichu.
          const owns =
            output.facadeModuleId?.replace(/\\/g, "/").endsWith(moduleSuffix) ||
            Object.keys(output.modules).some((m) => m.replace(/\\/g, "/").endsWith(moduleSuffix));
          if (!owns) continue;
          // Rdzeń MUSI stać we własnym chunku - inaczej hint ciągnąłby
          // niepowiązany kod i przestałby być hintem.
          const onlyCore = output.facadeModuleId?.replace(/\\/g, "/").endsWith(moduleSuffix);
          if (!onlyCore) continue;
          discovered[lang] = `${base}${output.fileName.split("/").pop()}`;
          break;
        }
      }
    },
  };
}
