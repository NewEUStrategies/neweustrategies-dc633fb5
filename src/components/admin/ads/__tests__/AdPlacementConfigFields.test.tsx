// Molekuła konfiguracji pozycji: co pyta `mid_post`, `in_feed`, `footer_slideup`.
//
// CO TEN PLIK DOWODZI.
//   1. POLE KONFIGURACJI POJAWIA SIĘ WYŁĄCZNIE PRZY SWOJEJ POZYCJI. Pole „po
//      którym paragrafie" widoczne przy `sidebar` sugerowałoby ustawienie,
//      którego renderer nigdy nie przeczyta.
//   2. POKAZANA WARTOŚĆ DOMYŚLNA NIE JEST ZAPISYWANA. To jest DEFEKT stanu
//      zastanego (`value={cfg.paragraph ?? 4}` bez zapisu), przeniesiony
//      ekstrakcją znak w znak: pole pokazuje 4, a nietknięty formularz zostawia
//      `config` puste. Dziś nikt na tym nie traci, bo renderery mają identyczne
//      fallbacki - i punkt 3 pilnuje właśnie tego.
//   3. LICZBY DOMYŚLNE PANELU I RENDERERÓW SĄ TE SAME. Panel obiecuje 4 / 5 /
//      3000 ms / „można zamknąć", a `MidPostAds`, `useInFeedAds` i
//      `FooterSlideup` czytają `?? 4`, `?? 5`, `?? 3000`, `?? true`. Te same
//      liczby żyją w CZTERECH plikach bez żadnego wiązania w typach - rozjazd
//      przesunąłby reklamę w inne miejsce wpisu, niż mówi panel, i nie zapaliłby
//      niczego poza tą asercją.
//   4. ZMIANA POLA ODDAJE PARĘ (klucz, wartość) DLA `config`, a nie cały obiekt -
//      klucz jest kontraktem z rendererem (`paragraph`, `every`, `delay_ms`,
//      `dismissible`).
//
// Fallbacki rendererów są WCZYTYWANE ZE ŹRÓDŁA (regex po plikach), nie
// przepisane z ręki: przepisana liczba rozjechałaby się razem z produkcją.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Ładunku insertu pozycji - test organizmu
// `AdPlacementsPanel`. (2) Zachowania samych rendererów reklam - ich własne
// testy w `src/components/ads/__tests__`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-ads-admin", () => ({ ensureI18n: () => undefined }));
// Radix Switch nie przełącza się pod happy-dom (potrzebuje zdarzeń wskaźnika).
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);

import { AdPlacementConfigFields } from "@/components/admin/ads/molecules/AdPlacementConfigFields";
import { AD_POSITION_LABEL_KEYS, type AdPosition } from "@/lib/ads/types";

/** Źródła warstwy emisji reklam (bez testów) - rekurencyjnie. */
function emissionSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === "__tests__" ? [] : emissionSources(path);
    }
    return /\.tsx?$/.test(entry) ? [readFileSync(path, "utf8")] : [];
  });
}

function renderFields(position: AdPosition, config: Record<string, unknown> = {}) {
  const onSet = vi.fn();
  const utils = render(
    <AdPlacementConfigFields position={position} config={config} onSet={onSet} />,
  );
  return { onSet, ...utils };
}

const PARAGRAPH_FIELD = "adsAdmin.placements.fieldAfterParagraph";
const EVERY_FIELD = "Co N kart";
const DELAY_FIELD = "adsAdmin.placements.fieldDelayMs";
const DISMISSIBLE_FIELD = "adsAdmin.placements.fieldDismissible";

describe("konfiguracja pozycji: rozłączność pól", () => {
  it("mid_post pyta TYLKO o numer paragrafu", () => {
    renderFields("mid_post");
    expect(screen.getByLabelText(PARAGRAPH_FIELD)).toBeTruthy();
    expect(screen.queryByLabelText(EVERY_FIELD)).toBeNull();
    expect(screen.queryByLabelText(DELAY_FIELD)).toBeNull();
    expect(screen.queryByText(DISMISSIBLE_FIELD)).toBeNull();
  });

  it("in_feed pyta TYLKO o co ile kart", () => {
    renderFields("in_feed");
    expect(screen.getByLabelText(EVERY_FIELD)).toBeTruthy();
    expect(screen.queryByLabelText(PARAGRAPH_FIELD)).toBeNull();
  });

  it("footer_slideup pyta o opóźnienie ORAZ o możliwość zamknięcia", () => {
    renderFields("footer_slideup");
    expect(screen.getByLabelText(DELAY_FIELD)).toBeTruthy();
    expect(screen.getByText(DISMISSIBLE_FIELD)).toBeTruthy();
    expect(screen.getByRole("switch")).toBeTruthy();
  });

  it.each<AdPosition>(["header_banner", "top_of_post", "bottom_of_post", "sidebar"])(
    "pozycja %s nie ma ŻADNEGO pola konfiguracji",
    (position) => {
      const { container } = renderFields(position);
      expect(container.querySelectorAll("input").length).toBe(0);
    },
  );

  it("każda wartość unii AdPosition jest obsłużona bez wyjątku", () => {
    // Nowy wariant `AdPosition` bez gałęzi w tej molekule ma renderować pusto,
    // a nie wywalić panel - ta asercja jedzie po CAŁEJ unii z map etykiet.
    for (const position of Object.keys(AD_POSITION_LABEL_KEYS) as AdPosition[]) {
      expect(() => renderFields(position)).not.toThrow();
    }
  });
});

describe("konfiguracja pozycji: wartości domyślne", () => {
  it("mid_post pokazuje 4, in_feed 5, footer_slideup 3000 ms i włączone zamykanie", () => {
    renderFields("mid_post");
    expect((screen.getByLabelText(PARAGRAPH_FIELD) as HTMLInputElement).value).toBe("4");
    renderFields("in_feed");
    expect((screen.getByLabelText(EVERY_FIELD) as HTMLInputElement).value).toBe("5");
    renderFields("footer_slideup");
    expect((screen.getByLabelText(DELAY_FIELD) as HTMLInputElement).value).toBe("3000");
    expect((screen.getByRole("switch") as HTMLInputElement).checked).toBe(true);
  });

  it("wartość z konfiguracji WYGRYWA nad pokazywaną domyślną", () => {
    renderFields("mid_post", { paragraph: 7 });
    expect((screen.getByLabelText(PARAGRAPH_FIELD) as HTMLInputElement).value).toBe("7");
  });

  it("wartość fałszywa ale prawidłowa (dismissible: false) NIE wraca do domyślnej", () => {
    renderFields("footer_slideup", { dismissible: false });
    expect((screen.getByRole("switch") as HTMLInputElement).checked).toBe(false);
  });

  it("pokazana domyślna NIE jest zapisywana - dopóki nikt nie dotknie pola, cisza", () => {
    // To jest defekt stanu zastanego, przeniesiony ekstrakcją bez zmian:
    // `config` zostaje puste, mimo że pole pokazuje liczbę.
    const { onSet } = renderFields("mid_post");
    expect(onSet).not.toHaveBeenCalled();
  });

  it("liczby domyślne panelu są TE SAME, co fallbacki warstwy emisji", () => {
    // Skanujemy CAŁĄ warstwę emisji (`lib/ads` + `components/ads`), a nie trzy
    // wskazane pliki: fallbacki wędrują między modułami przy każdej ekstrakcji
    // (`?? 4` przeprowadziło się z `MidPostAds.tsx` do `lib/ads/injection.ts`),
    // a przedmiotem dowodu jest ISTNIENIE tej samej liczby po drugiej stronie,
    // nie jej adres.
    const sources = [
      ...emissionSources("src/lib/ads"),
      ...emissionSources("src/components/ads"),
    ].join("\n");

    expect(sources).toMatch(/paragraph[\s\S]{0,80}\?\?\s*4/);
    expect(sources).toMatch(/every[\s\S]{0,80}\?\?\s*5/);
    expect(sources).toMatch(/delay_ms[\s\S]{0,80}\?\?\s*3000/);
    expect(sources).toMatch(/dismissible[\s\S]{0,80}\?\?\s*true/);
  });
});

describe("konfiguracja pozycji: co idzie do kolumny config", () => {
  it("numer paragrafu leci pod kluczem `paragraph` jako LICZBA", () => {
    const { onSet } = renderFields("mid_post");
    fireEvent.change(screen.getByLabelText(PARAGRAPH_FIELD), { target: { value: "7" } });
    expect(onSet).toHaveBeenCalledWith("paragraph", 7);
  });

  it("co ile kart leci pod kluczem `every`", () => {
    const { onSet } = renderFields("in_feed");
    fireEvent.change(screen.getByLabelText(EVERY_FIELD), { target: { value: "3" } });
    expect(onSet).toHaveBeenCalledWith("every", 3);
  });

  it("opóźnienie leci pod kluczem `delay_ms`, a zamykanie pod `dismissible`", () => {
    const { onSet } = renderFields("footer_slideup");
    fireEvent.change(screen.getByLabelText(DELAY_FIELD), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("switch"));
    expect(onSet).toHaveBeenNthCalledWith(1, "delay_ms", 500);
    expect(onSet).toHaveBeenNthCalledWith(2, "dismissible", false);
  });

  it("wyczyszczone pole liczbowe daje 0, a nie NaN - reklama trafia nad pierwszy paragraf", () => {
    // `Number("")` to 0, nie NaN. Konsekwencja jest widoczna dla czytelnika:
    // `paragraph: 0` znaczy „przed treścią", a nie „zostaw domyślne 4".
    const { onSet } = renderFields("mid_post");
    fireEvent.change(screen.getByLabelText(PARAGRAPH_FIELD), { target: { value: "" } });
    expect(onSet).toHaveBeenCalledWith("paragraph", 0);
  });
});
