// Trasa `/admin/tracker-guide` NA PRAWDZIWYM SŁOWNIKU - dokumentacja panelu
// Trackera UE (kroki konfiguracji + opis zachowania systemu).
//
// DLACZEGO OSOBNY PLIK. `adminTrackerRoute.test.tsx` mockuje `react-i18next`
// atrapą-echem kluczy, a przy niej `t(..., { returnObjects: true })` oddaje
// CIĄG - lista kroków jest tam więc z konstrukcji pusta i strażnik kształtu
// kroku (`isStep`) nie biegł ani razu. Tutaj `t` jest prawdziwe
// (`@/test/i18nReal`), więc dowód dotyczy tego, co redaktor naprawdę widzi.
//
// TRZY REGUŁY:
//   1. KROKI POCHODZĄ ZE SŁOWNIKA, w kolejności słownika, z tytułem I treścią.
//      Trasa niosła wcześniej dwie tablice kroków wybierane ternarem po
//      języku - dokumentację, której nie widziała bramka parytetu PL/EN.
//   2. OBA JĘZYKI MAJĄ TĘ SAMĄ LICZBĘ KROKÓW. Krok dopisany tylko po polsku
//      to instrukcja, której angielskojęzyczny redaktor nie dostaje wcale.
//   3. WPIS O ZŁYM KSZTAŁCIE JEST POMIJANY, A NIE WYWRACA STRONY.
//      `returnObjects: true` nie gwarantuje kształtu (tłumacz może zgubić
//      `body`), a strona bez jednego kroku jest lepsza niż biały ekran.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// Harness montuje JEDNĄ trasę, więc `/admin/tracker` nie istnieje w drzewie -
// `Link` zamieniamy na zwykły odnośnik i asertujemy CEL.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const react = await import("react");
  return {
    ...actual,
    Link: ({ to, children }: { to: string; children?: ReactNode }) =>
      react.createElement("a", { href: to }, children as never),
  };
});

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-tracker-guide";
import { renderRoute } from "@/test/routeHarness";
import { Route as TrackerGuideRoute } from "@/routes/admin.tracker-guide";

const PATH = "/admin/tracker-guide";

interface GuideStep {
  title: string;
  body: string;
}

/** Kroki ze słownika danego języka - z twardym błędem, gdy to nie tablica. */
function dictionarySteps(lang: "pl" | "en"): GuideStep[] {
  const steps: unknown = i18n.getResource(lang, "translation", "adminTrackerGuide.steps");
  if (!Array.isArray(steps)) throw new Error(`test: słownik ${lang} nie ma tablicy kroków`);
  return steps as GuideStep[];
}

/** Tytuły kroków w kolejności renderu (kroki są jedynymi `div.font-medium` w karcie). */
function renderedStepTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".font-medium")).map((el) => el.textContent ?? "");
}

async function mount() {
  return renderRoute({ route: TrackerGuideRoute, path: PATH, initialEntry: PATH });
}

const ORIGINAL_PL_STEPS = dictionarySteps("pl");
/** Cała gałąź słownika przewodnika - reguła 3 podmienia ją i przywraca w całości. */
const ORIGINAL_PL_GUIDE: unknown = i18n.getResource("pl", "translation", "adminTrackerGuide");

/**
 * Podmienia gałąź `adminTrackerGuide` słownika PL. PŁYTKIE dodanie pakietu
 * (`deep: false`) zastępuje gałąź w całości; głębokie scalanie łatałoby
 * tablicę kroków indeks po indeksie oryginałem i „krok bez treści" dostałby
 * treść z prawdziwego słownika.
 */
function replacePlGuide(guide: unknown): void {
  i18n.addResourceBundle("pl", "translation", { adminTrackerGuide: guide }, false, true);
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
});

afterEach(async () => {
  cleanup();
  // Reguła 3 podmienia kroki w słowniku - przywracamy oryginał, żeby kolejny
  // test nie mierzył cudzej atrapy.
  replacePlGuide(ORIGINAL_PL_GUIDE);
  await i18n.changeLanguage("pl");
});

describe("admin.tracker-guide - kroki ze słownika", () => {
  it("REGUŁA 1: po polsku renderuje KAŻDY krok słownika, w jego kolejności, z treścią", async () => {
    const view = await mount();
    const steps = dictionarySteps("pl");

    expect(steps.length).toBeGreaterThan(0);
    expect(renderedStepTitles(view.container)).toEqual(steps.map((step) => step.title));
    for (const step of steps) expect(screen.getByText(step.body)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Tracker UE - jak to działa",
    );
  });

  it("REGUŁA 1: po angielsku kroki i nagłówek są angielskie, a powrót prowadzi do panelu", async () => {
    await i18n.changeLanguage("en");
    const view = await mount();

    expect(renderedStepTitles(view.container)).toEqual(
      dictionarySteps("en").map((step) => step.title),
    );
    expect(screen.queryByText(ORIGINAL_PL_STEPS[0].title)).not.toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/admin/tracker");
  });

  it("REGUŁA 2: oba języki mają TĘ SAMĄ liczbę kroków", () => {
    expect(dictionarySteps("en")).toHaveLength(dictionarySteps("pl").length);
  });

  it("REGUŁA 3: wpis o złym kształcie jest pomijany, poprawne kroki zostają", async () => {
    replacePlGuide({
      steps: [
        { title: "Krok poprawny", body: "Treść poprawnego kroku." },
        { title: "Krok bez treści" },
        "goły napis zamiast obiektu",
        null,
        { title: 7, body: "Tytuł liczbą" },
      ],
    });
    const view = await mount();

    expect(renderedStepTitles(view.container)).toEqual(["Krok poprawny"]);
    expect(screen.queryByText("Krok bez treści")).not.toBeInTheDocument();
    expect(screen.queryByText("Tytuł liczbą")).not.toBeInTheDocument();
  });
});
