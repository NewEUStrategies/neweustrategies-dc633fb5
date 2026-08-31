// KONTRAKT RODZINY EDYTORÓW BLOKÓW - bramka na WIRING, nie na zachowanie.
//
// Ten plik odpowiada na cztery pytania o powierzchnię `admin/blocks/edit/**`
// i pilnuje, żeby odpowiedzi nie zmieniły się po cichu:
//
//  1. KTO MAPUJE TYP BLOKU NA EDYTOR. Jeden `switch (block.type)` w
//     `src/components/admin/blocks/BlockEditRenderer.tsx` - nie mapa, nie
//     rejestr. Import każdego edytora jest STATYCZNY: żadnego `React.lazy`
//     ani dynamicznego `import()`, więc cały katalog (62 pliki) wchodzi do
//     bundla panelu razem z pierwszym blokiem. Bramka niżej czyta to ZE
//     ŹRÓDŁA, bo z samego typu tego nie widać.
//  2. JAKI JEST WSPÓLNY TYP PROPSÓW. NIE MA GO. Każdy plik deklaruje własne,
//     lokalne `interface Props`; kształt jest zbieżny (`{ block, onChange }`
//     plus opcjonalne `isActive` i handlery klawiatury w dwóch tekstowych),
//     ale nic tego nie wymusza. Bramka mierzy liczbę tych kopii - jeśli ktoś
//     wprowadzi wspólny typ, test wskaże, ile plików zostało do przeniesienia.
//  3. CZY TABELA TESTOWA POKRYWA CAŁY DYSPOZYTOR. Tabela
//     (`blockEditMatrix.shared.tsx`) trzyma listę 98 edytorów; ta bramka
//     porównuje ją z komponentami faktycznie wołanymi ze `switch`a, żeby nowy
//     edytor nie wszedł do panelu poza przejazdem.
//  4. CZY ISTNIEJE STAN ODMOWY. NIE ISTNIEJE. W całym katalogu nie ma ani
//     jednego wystąpienia `disabled`, `readOnly`, `canEdit` czy sprawdzenia
//     roli - żaden edytor bloku nie umie być tylko do odczytu. Bramka utrwala
//     ten fakt, bo to on wyznacza, gdzie odmowa MUSI być realizowana (warstwa
//     wyżej: kanwa i trasa panelu), i obleje się, gdy ktoś doda gating tutaj
//     bez przemyślenia całej rodziny.
//
// Czytanie ŹRÓDŁA (a nie typów) jest tu celowe i ma w repo precedens -
// `blockEditorRegistryParity.test.ts` tak samo wyciąga etykiety `case` ze
// `switch`a, bo `switch` bez wyczerpania po prostu wpada w `default`
// i TypeScript nie zgłasza nic.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

import { ALL_EDITORS, ALL_EDITOR_NAMES, MATRIX_SLICES } from "./blockEditMatrix.shared";

const EDIT_DIR = "src/components/admin/blocks/edit";
const RENDERER = "src/components/admin/blocks/BlockEditRenderer.tsx";

function editFiles(): string[] {
  return readdirSync(EDIT_DIR)
    .filter((name) => name.endsWith(".tsx"))
    .sort();
}

function rendererSource(): string {
  return readFileSync(RENDERER, "utf8");
}

/** Komponenty renderowane ze `switch`a dyspozytora. */
function dispatchedComponents(): Set<string> {
  const src = rendererSource();
  const body = src.slice(src.indexOf("switch (block.type) {"));
  const found = Array.from(body.matchAll(/return \(?\s*<(\w+)/g), (m) => m[1]);
  // Wielka litera = komponent. Małą literą jest tylko `<div>` z atrapy
  // `default:` - i to jest w tym `switch`u jedyny znacznik HTML.
  return new Set(found.filter((name) => /^[A-Z]/.test(name)));
}

describe("1. dyspozytor - jeden switch, importy statyczne", () => {
  it("mapowanie typu na edytor to `switch (block.type)`", () => {
    expect(rendererSource()).toContain("switch (block.type)");
  });

  it("żaden edytor nie jest wpięty leniwie - cały katalog wchodzi do bundla panelu", () => {
    // To NIE jest zalecenie, tylko OPIS STANU z konsekwencją: dopisanie
    // `React.lazy` zmieniłoby moment montowania edytora (Suspense w kanwie),
    // więc taka zmiana musi być świadoma, a nie przypadkowa.
    const src = rendererSource();
    expect(src).not.toContain("React.lazy");
    expect(src).not.toContain("lazy(");
    expect(src).not.toMatch(/await import\(/);
    expect(src).toMatch(/^import \{ ParagraphBlock \} from "\.\/edit\/Paragraph";$/m);
  });

  it("nieznany typ wpada w widoczną atrapę z nazwą typu, a nie w pusty obszar", () => {
    const src = rendererSource();
    expect(src).toContain("default:");
    expect(src).toMatch(/\[\{block\.type\}\]/);
  });
});

describe("2. wspólny typ propsów - NIE ISTNIEJE", () => {
  it("każdy plik edytora deklaruje WŁASNY, lokalny `interface Props`", () => {
    const zWlasnym = editFiles().filter((name) =>
      /^(interface|type) Props\b/m.test(readFileSync(`${EDIT_DIR}/${name}`, "utf8")),
    );
    // 62 pliki, 61 z lokalnym `Props` - `PageBreak.tsx` nie bierze propsów
    // w ogóle (blok nie ma żadnych opcji), więc nie ma czego deklarować.
    expect(editFiles()).toHaveLength(62);
    expect(zWlasnym).toHaveLength(61);
    expect(zWlasnym).not.toContain("PageBreak.tsx");
  });

  it("nie ma eksportowanego typu `BlockEditProps` ani wspólnego pliku propsów", () => {
    // Gdyby taki typ powstał, TA asercja ma się oblać jako pierwsza - to sygnał
    // do przeniesienia 61 lokalnych deklaracji i uproszczenia harnessu testu.
    const wszystkie = editFiles()
      .map((name) => readFileSync(`${EDIT_DIR}/${name}`, "utf8"))
      .join("\n");
    expect(wszystkie).not.toContain("BlockEditProps");
    expect(editFiles()).not.toContain("props.ts");
  });

  it("dyspozytor eksportuje własny typ propsów, ale TYLKO dla siebie", () => {
    // `BlockEditRendererProps` opisuje propsy DYSPOZYTORA (pełny zestaw
    // handlerów klawiatury), nie kontrakt pojedynczego edytora - i właśnie
    // dlatego nie da się go użyć jako wspólnego typu w `edit/`.
    expect(rendererSource()).toContain("export interface BlockEditRendererProps");
  });
});

describe("3. parytet tabeli testowej z dyspozytorem", () => {
  it("tabela zna KAŻDY komponent wołany ze switcha", () => {
    const brakujace = [...dispatchedComponents()]
      .filter((name) => name !== "GenericWidgetToolbar")
      .filter((name) => !ALL_EDITOR_NAMES.includes(name))
      .sort();
    expect(brakujace).toEqual([]);
  });

  it("tabela nie zmyśla edytorów - poza jednym NIEPODŁĄCZONYM", () => {
    // `LinkPreviewBlock` jest w tabeli ŚWIADOMIE: komponent istnieje i ma
    // 146 linii, ale `switch` nie ma dla niego `case`, więc jest nieosiągalny
    // z panelu. Ten rozjazd ma własny, pełny opis i `it.fails`
    // w `src/components/admin/blocks/__tests__/blockEditorRegistryParity.test.ts`.
    // Tutaj jest tylko po to, żeby przejazd czterech przypadków JEDNAK go
    // pokrywał - inaczej naprawa podłączenia szłaby w kod bez testów.
    const dispatched = dispatchedComponents();
    const nadmiarowe = ALL_EDITOR_NAMES.filter((name) => !dispatched.has(name));
    expect(nadmiarowe).toEqual(["LinkPreviewBlock"]);
  });

  it("tabela ma 98 wpisów i żadnej nazwy dwa razy", () => {
    expect(ALL_EDITORS).toHaveLength(98);
    expect(new Set(ALL_EDITOR_NAMES).size).toBe(98);
  });

  it("suma sześciu kawałków to DOKŁADNIE tabela - każdy edytor raz", () => {
    // Bez tej asercji edytor dopisany do tabeli i pominięty w podziale
    // przechodziłby cicho poza przejazd - i nikt by tego nie zobaczył,
    // bo liczba testów w logu i tak rośnie.
    const zKawalkow = Object.values(MATRIX_SLICES).flat();
    expect(zKawalkow.slice().sort()).toEqual(ALL_EDITOR_NAMES.slice().sort());
    expect(new Set(zKawalkow).size).toBe(zKawalkow.length);
  });

  it("żaden kawałek nie jest pusty ani nieproporcjonalnie duży", () => {
    // Budżet pamięci na plik - patrz nagłówek modułu wspólnego. Kawałek
    // grubszy niż 25 edytorów to pierwszy krok do forka ubitego SIGKILL-em.
    for (const [nazwa, lista] of Object.entries(MATRIX_SLICES)) {
      expect(lista.length, `kawałek ${nazwa} jest pusty`).toBeGreaterThan(0);
      expect(lista.length, `kawałek ${nazwa} jest zbyt duży`).toBeLessThanOrEqual(25);
    }
  });
});

describe("4. stan odmowy - w tej warstwie NIE DA SIĘ go wyrazić", () => {
  it("ŻADEN edytor bloku nie zna `disabled`, `readOnly` ani sprawdzenia roli", () => {
    // Konsekwencja: „edytor tylko do odczytu" nie jest w tej warstwie
    // osiągalny, więc odmowa MUSI stać wyżej (kanwa / trasa panelu / RLS).
    // Gdy ktoś doda gating tutaj, ta bramka wskaże plik i wymusi decyzję,
    // czy kontrakt dostaje nowy prop dla CAŁEJ rodziny (98 edytorów), czy
    // tylko dla jednego - a to drugie jest tym, jak powstaje niespójność.
    const znalezione: string[] = [];
    for (const name of editFiles()) {
      const src = readFileSync(`${EDIT_DIR}/${name}`, "utf8");
      if (/\b(disabled|readOnly|canEdit|isReadOnly|permission)\b/.test(src)) znalezione.push(name);
    }
    expect(znalezione).toEqual([]);
  });

  it("`BlockStyle` ma tylko `hidden`, i to jawnie NIE jest odmowa edycji", () => {
    const types = readFileSync("src/lib/blocks/types.ts", "utf8");
    expect(types).toContain("hidden?: boolean;");
    // Komentarz kontraktu przy polu - to on jest podstawą asercji przypadku
    // czwartego w tabeli, więc jego zniknięcie ma oblać test, a nie przejść.
    expect(types).toContain("still shown/editable in the admin canvas");
  });

  it("cztery edytory to SAM PODGLĄD - odmowa edycji w kanwie jest tam wpisana w kod", () => {
    // `HtmlBlock` przyjmuje `onChange` i JAWNIE je ignoruje, kierując
    // redaktora do prawego panelu; pozostałe trzy nie mają żadnych opcji.
    // To jedyny realny „stan odmowy" w tej rodzinie i jest strukturalny,
    // a nie warunkowy.
    const html = readFileSync(`${EDIT_DIR}/Html.tsx`, "utf8");
    expect(html).toContain("onChange: _onChange");
    expect(html).toContain("edytuj surowy HTML w panelu");
    for (const name of ["PageBreak.tsx", "Separator.tsx"]) {
      const src = readFileSync(`${EDIT_DIR}/${name}`, "utf8");
      expect(src, `${name}: pojawiło się pole edycji`).not.toMatch(/onChange=\{/);
    }
  });
});
