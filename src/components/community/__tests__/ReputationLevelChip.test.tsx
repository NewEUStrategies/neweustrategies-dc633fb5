// CHIP POZIOMU REPUTACJI - jedyne miejsce, w którym poziom staje się widoczny.
//
// CO DOWODZI TEN PLIK. Chip zamienia liczbę punktów na TYTUŁ, IKONĘ i BARWĘ.
// Wszystkie trzy rzeczy są odczytywane z map indeksowanych kluczem poziomu,
// a pomyłka w takiej mapie nie rzuca wyjątku i nie psuje układu: użytkownik
// dostaje po prostu cudzą odznakę. Dlatego mapowanie jest tu sprawdzane TABELĄ
// PRZYPADKÓW przez wszystkie pięć poziomów naraz - a tabela jest wyprowadzona
// z katalogu `REPUTATION_LEVELS`, nie przepisana obok niego, więc szósty poziom
// dopisany bez ikony i barwy oblewa test zamiast wyrenderować chip-widmo.
// Dochodzi do tego asercja na RÓŻNORODNOŚĆ: skopiowany wiersz mapy (ikona
// eksperta przy filarze) przechodzi każdy test „czy się wyrenderowało".
//
// JĘZYK: ATRAPA `react-i18next` Z PRAWDZIWYM `t`. Komponent czyta
// `i18n.language` DOSŁOWNIE i sam sprowadza wszystko, co zaczyna się od „en",
// do angielskiego. Tej reguły NIE DA SIĘ dowieść przez prawdziwe
// `i18n.changeLanguage("en-GB")`: instancja aplikacji ma `supportedLngs:
// ["pl","en"]`, więc i18next normalizuje kod ZANIM komponent go zobaczy
// (zmierzone tutaj - patrz test „prawdziwa instancja i18next..."). Atrapa
// podaje więc surowy kod języka, a `t` bierze z `@/test/i18nReal`, czyli
// z tej samej instancji, której używa aplikacja - żaden napis nie pochodzi
// z atrapy tłumacza.
//
// DLACZEGO FABRYKA `vi.mock` NIC NIE IMPORTUJE. Udokumentowany skrót
// `vi.mock("react-i18next", async () => (...).reactI18nextMock(lang))`
// ZAKLESZCZA ten plik: fabryka importuje `@/lib/i18n`, a ten importuje
// `react-i18next`, czyli moduł właśnie mockowany (sprawdzone: przebieg wisi
// bez jednej linii logu aż do zabicia procesu; ten sam wniosek ma
// `notifications/__tests__/ConsentsPanel.test.tsx`). Fabryka jest tu więc
// synchroniczna i pusta w zależnościach, a prawdziwy tłumacz wjeżdża zwykłym
// importem NA GÓRZE pliku i jest wstrzykiwany do atrapy po jego rozwiązaniu.
//
// NAZWY POZIOMÓW NIE IDĄ PRZEZ `t`. Katalog `REPUTATION_LEVELS` niesie parę
// PL/EN przy progu, żeby próg i jego nazwa nie mogły się rozjechać między
// modułem a słownikiem - dlatego asercje czytają katalog, a nie słownik.
//
// GRANICA DOWODU. Który punkt daje który poziom, dowodzi
// `src/lib/community/reputation.test.ts`; tutaj sprawdzamy tylko, że chip pyta
// o poziom PUNKTAMI. Kontrastu barw happy-dom nie mierzy - `axeViolations`
// wyłącza tę regułę (patrz `@/test/axe`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Surowy kod języka, jaki komponent zobaczy w `i18n.language`. */
  language: "pl",
  /** Prawdziwy `getFixedT`, wstrzyknięty poniżej - fabryka nic nie importuje. */
  fixedT: null as null | typeof realT,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: h.fixedT?.(h.language.startsWith("en") ? "en" : "pl"),
    i18n: { language: h.language },
    ready: true,
  }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import {
  REPUTATION_LEVELS,
  type ReputationLevel,
  type ReputationLevelKey,
} from "@/lib/community/reputation";
import { ReputationLevelChip } from "../ReputationLevelChip";

h.fixedT = realT;

/**
 * Oczekiwane wiązanie poziom -> ikona i barwa. Celowo WPISANE TU JESZCZE RAZ,
 * a nie zaimportowane z komponentu: mapa zaczytana z pliku, który jest
 * przedmiotem dowodu, przechodzi każdą zamianę wierszy.
 */
const EXPECTED: Record<ReputationLevelKey, { icon: string; style: string }> = {
  observer: { icon: "lucide-sprout", style: "bg-muted" },
  participant: { icon: "lucide-users", style: "bg-primary/10" },
  voice: { icon: "lucide-megaphone", style: "bg-sky-500/15" },
  expert: { icon: "lucide-award", style: "bg-amber-500/15" },
  pillar: { icon: "lucide-landmark", style: "bg-emerald-500/15" },
};

function renderChip(props: { points: number; size?: "sm" | "md"; className?: string }) {
  const { container } = render(<ReputationLevelChip {...props} />);
  const chip = container.firstElementChild;
  if (!(chip instanceof HTMLElement)) throw new Error("Chip nie wyrenderował elementu");
  const icon = chip.querySelector("svg");
  if (!icon) throw new Error("Chip nie wyrenderował ikony");
  return { container, chip, icon };
}

beforeEach(() => {
  h.language = "pl";
});

afterEach(() => {
  cleanup();
});

describe("mapowanie poziomu na tytuł, ikonę i barwę", () => {
  it.each<ReputationLevel>([...REPUTATION_LEVELS])(
    "$key (od $min pkt) ma własną nazwę, ikonę i styl",
    (level) => {
      const { chip, icon } = renderChip({ points: level.min });

      expect(chip.textContent).toBe(level.pl);
      // `title` dubluje treść, bo chip bywa ścięty w wąskiej kolumnie tablicy
      // kontrybutorów - wtedy tooltip jest jedynym nośnikiem nazwy.
      expect(chip.getAttribute("title")).toBe(level.pl);
      expect(icon.getAttribute("class")).toContain(EXPECTED[level.key].icon);
      expect(chip.className).toContain(EXPECTED[level.key].style);
    },
  );

  it("żadne dwa poziomy nie dzielą ikony ani barwy", () => {
    const icons = REPUTATION_LEVELS.map(
      (level) => renderChip({ points: level.min }).icon.getAttribute("class") ?? "",
    );
    const styles = REPUTATION_LEVELS.map(
      (level) => renderChip({ points: level.min }).chip.className,
    );

    expect(new Set(icons).size).toBe(REPUTATION_LEVELS.length);
    expect(new Set(styles).size).toBe(REPUTATION_LEVELS.length);
  });

  it("każdy klucz katalogu ma wpis w tabeli oczekiwań tego testu", () => {
    // Strażnik samego testu: poziom dopisany do katalogu bez ikony i barwy
    // musi oblać tutaj, a nie wyrenderować chip bez ikony.
    for (const level of REPUTATION_LEVELS) {
      expect(EXPECTED[level.key]).toBeDefined();
    }
    expect(Object.keys(EXPECTED)).toHaveLength(REPUTATION_LEVELS.length);
  });

  it("poziom bierze się z PUNKTÓW, a nie z pozycji na liście", () => {
    // Punkt pod progiem i dokładnie na progu - dowód, że chip woła
    // `levelForPoints`, zamiast dostawać gotowy poziom z zewnątrz.
    expect(renderChip({ points: 49 }).chip.textContent).toBe("Obserwator");
    expect(renderChip({ points: 50 }).chip.textContent).toBe("Uczestnik");
    expect(renderChip({ points: 1000 }).chip.textContent).toBe("Filar społeczności");
  });

  it("punkty spoza zakresu nie psują chipu", () => {
    expect(renderChip({ points: Number.NaN }).chip.textContent).toBe("Obserwator");
    expect(renderChip({ points: -20 }).chip.textContent).toBe("Obserwator");
  });
});

describe("język interfejsu", () => {
  it.each<[string, "pl" | "en"]>([
    ["pl", "pl"],
    ["en", "en"],
    ["en-GB", "en"],
    ["de", "pl"],
  ])("kod języka %s renderuje nazwę %s", (language, expected) => {
    // `en-GB` to nie teoria: detekcja przeglądarki i preferencja konta
    // potrafią oddać kod regionalny, a chip sprowadza go sam
    // (`language.startsWith("en")`), bo katalog zna tylko „pl" i „en".
    h.language = language;
    const level = REPUTATION_LEVELS[2];

    const { chip } = renderChip({ points: level.min });

    const wanted = expected === "en" ? level.en : level.pl;
    expect(chip.textContent).toBe(wanted);
    expect(chip.getAttribute("title")).toBe(wanted);
  });

  it("prawdziwa instancja i18next sprowadza en-GB do en JESZCZE PRZED chipem", async () => {
    // Zmierzone, nie założone: `supportedLngs: ["pl","en"]` w `@/lib/i18n`
    // normalizuje kod regionalny, a język nieobsługiwany schodzi do „pl".
    // Reguła w komponencie jest więc DRUGĄ linią obrony (np. dla instancji
    // podanej przez test albo przyszłej konfiguracji z regionami) - i tylko
    // dlatego jej dowód wymaga atrapy podającej surowy kod.
    await i18n.changeLanguage("en-GB");
    expect(i18n.language).toBe("en");
    await i18n.changeLanguage("de");
    expect(i18n.language).toBe("pl");
    await i18n.changeLanguage("pl");
  });

  it("nazwy PL i EN naprawdę się różnią na każdym poziomie", () => {
    // Bez tego test wyżej przechodziłby także wtedy, gdyby chip zawsze
    // pokazywał polszczyznę.
    for (const level of REPUTATION_LEVELS) {
      expect(level.pl).not.toBe(level.en);
    }
  });
});

describe("rozmiary i klasy", () => {
  it("domyślny rozmiar to sm", () => {
    const { chip, icon } = renderChip({ points: 0 });

    expect(chip.className).toContain("px-1.5");
    expect(chip.className).toContain("text-[10px]");
    expect(icon.getAttribute("class")).toContain("h-3 w-3");
  });

  it("rozmiar md podnosi tekst i ikonę", () => {
    const { chip, icon } = renderChip({ points: 0, size: "md" });

    expect(chip.className).toContain("px-2");
    expect(chip.className).toContain("text-xs");
    expect(chip.className).not.toContain("text-[10px]");
    expect(icon.getAttribute("class")).toContain("h-3.5 w-3.5");
  });

  it("className z zewnątrz jest DOKLEJANE, nie zastępuje stylu poziomu", () => {
    const { chip } = renderChip({ points: 1000, className: "ml-2 shrink-0" });

    expect(chip.className).toContain("ml-2");
    expect(chip.className).toContain("shrink-0");
    expect(chip.className).toContain(EXPECTED.pillar.style);
    expect(chip.className).toContain("inline-flex");
  });
});

describe("dostępność", () => {
  it("ikona jest dekoracją: aria-hidden na każdym poziomie", () => {
    // Nazwa poziomu stoi już w treści chipu; ikona ogłoszona osobno czytałaby
    // się jako drugi, bezsensowny węzeł.
    for (const level of REPUTATION_LEVELS) {
      const { icon } = renderChip({ points: level.min });
      expect(icon.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("nie wnosi naruszeń axe - oba rozmiary i oba języki", async () => {
    const pl = render(
      <div>
        <ReputationLevelChip points={0} />
        <ReputationLevelChip points={150} size="md" />
        <ReputationLevelChip points={1000} size="md" className="ml-2" />
      </div>,
    );
    const plViolations = await axeViolations(pl.container);
    expect(plViolations, summarize(plViolations)).toEqual([]);

    h.language = "en";
    const en = render(<ReputationLevelChip points={400} size="md" />);
    const enViolations = await axeViolations(en.container);
    expect(enViolations, summarize(enViolations)).toEqual([]);
  });
});
