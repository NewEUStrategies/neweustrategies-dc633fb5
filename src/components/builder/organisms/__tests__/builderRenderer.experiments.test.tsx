// PUBLICZNY RENDERER: TESTY A/B SEKCJI I TRYB PODGLĄDU KANWY.
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// * `isSectionVisibleForAssignments` w rendererze: PIERWSZY render (przypisania
//   jeszcze `null`) zawsze pokazuje wariant „a" - to warunek zgodności HTML-a
//   z SSR, bez którego React wyrzuca całe zhydratowane drzewo,
// * przypisanie po efekcie: odwiedzający zakwalifikowany do „b" widzi „b",
//   a wariant „a" znika z DOM (nie jest „schowany CSS-em"),
// * `editorPreview`: kanwa buildera pokazuje WSZYSTKIE warianty naraz i NIE
//   zapisuje ani jednego zdarzenia eksperymentu,
// * `ExperimentSection`: ekspozycja raz na sesję przy montażu, konwersja przy
//   kliknięciu w wariant, oraz osłona Speculation Rules - strona wyrenderowana
//   spekulacyjnie nie podbija mianownika współczynnika konwersji,
// * atrybuty `data-ab-experiment` / `data-ab-variant` na sekcji.
//
// ── CZEGO TU ŚWIADOMIE NIE MA ──────────────────────────────────────────────
// Statystyki eksperymentu (`zScore`, `conversionRate`) i rejestr w panelu mają
// własny plik `src/lib/builder/__tests__/experiments.test.ts`. Tu mierzymy
// wyłącznie to, co robi z nimi RENDERER.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import "@/test/i18nReal";
import { assignVariant, type AbVariant } from "@/lib/builder/experiments";
import { __resetBuilderDebugForTests } from "@/lib/builder/builderDebug";
import { BuilderRenderer } from "../BuilderRenderer";
import { doc, simpleSection, stubObservers } from "./builderRendererFixtures";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

const EKSPERYMENT = "exp-naglowek";

let observers: ReturnType<typeof stubObservers>;
let beacon: ReturnType<typeof vi.fn>;

beforeEach(() => {
  observers = stubObservers();
  __resetBuilderDebugForTests();
  window.localStorage.clear();
  window.sessionStorage.clear();
  beacon = vi.fn(() => true);
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    writable: true,
    value: beacon,
  });
});

afterEach(() => {
  cleanup();
  observers.restore();
  __resetBuilderDebugForTests();
  window.localStorage.clear();
  window.sessionStorage.clear();
  Reflect.deleteProperty(document as unknown as Record<string, unknown>, "prerendering");
});

/**
 * Identyfikator odwiedzającego, którego HASH kwalifikuje do zadanego wariantu.
 * Szukamy go PRAWDZIWĄ funkcją przypisania - test nie zgaduje bucketu i nie
 * powtarza jego arytmetyki.
 */
function odwiedzajacyDlaWariantu(wariant: AbVariant): string {
  for (let i = 0; i < 500; i++) {
    const kandydat = `czytelnik-${i}`;
    if (assignVariant(EKSPERYMENT, kandydat) === wariant) return kandydat;
  }
  throw new Error("Nie znaleziono identyfikatora dla wariantu " + wariant);
}

const wariantSekcji = (id: string, variant: AbVariant) =>
  simpleSection(id, { advanced: { abTest: { experimentId: EKSPERYMENT, variant } } });

const dokumentZTestem = () =>
  doc([wariantSekcji("wariant-a", "a"), wariantSekcji("wariant-b", "b")]);

const widoczneSekcje = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-sec-id]")].map((el) => el.getAttribute("data-sec-id"));

describe("wybór wariantu na stronie publicznej", () => {
  it("odwiedzający z bucketu A widzi wariant A, a B nie trafia do DOM", async () => {
    window.localStorage.setItem("cms_visitor_id", odwiedzajacyDlaWariantu("a"));
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={dokumentZTestem()} lang="pl" />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(widoczneSekcje(container)).toEqual(["wariant-a"]);
  });

  it("odwiedzający z bucketu B widzi wariant B (podmiana po hydratacji)", async () => {
    window.localStorage.setItem("cms_visitor_id", odwiedzajacyDlaWariantu("b"));
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={dokumentZTestem()} lang="pl" />,
    );
    // Przypisania liczy EFEKT - do jego wykonania widoczny jest wariant „a".
    await act(async () => {
      await Promise.resolve();
    });
    expect(widoczneSekcje(container)).toEqual(["wariant-b"]);
  });

  it("sekcje BEZ znacznika eksperymentu renderują się niezależnie od bucketu", async () => {
    window.localStorage.setItem("cms_visitor_id", odwiedzajacyDlaWariantu("b"));
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          simpleSection("zwykla"),
          wariantSekcji("wariant-a", "a"),
          wariantSekcji("wariant-b", "b"),
        ])}
        lang="pl"
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(widoczneSekcje(container)).toEqual(["zwykla", "wariant-b"]);
  });

  it("znacznik eksperymentu ląduje w atrybutach sekcji (diagnostyka i QA)", async () => {
    window.localStorage.setItem("cms_visitor_id", odwiedzajacyDlaWariantu("a"));
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={dokumentZTestem()} lang="pl" />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const sekcja = container.querySelector('[data-sec-id="wariant-a"]');
    expect(sekcja?.getAttribute("data-ab-experiment")).toBe(EKSPERYMENT);
    expect(sekcja?.getAttribute("data-ab-variant")).toBe("a");
  });
});

describe("telemetria wariantu (ExperimentSection)", () => {
  const ladunki = () =>
    beacon.mock.calls.map(([, blob]) => (blob as Blob | undefined)?.constructor?.name ?? "");

  it("ekspozycja leci raz przy montażu widocznego wariantu", async () => {
    window.localStorage.setItem("cms_visitor_id", odwiedzajacyDlaWariantu("a"));
    renderWithQueryClient(<BuilderRenderer doc={dokumentZTestem()} lang="pl" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toBe("/api/public/experiment-event");
    expect(ladunki()[0]).toBe("Blob");
    // Deduplikacja per sesja przeglądarki.
    expect(window.sessionStorage.getItem(`cms_ab_exposure_${EKSPERYMENT}`)).toBe("1");
  });

  it("kliknięcie w treść wariantu zapisuje konwersję", async () => {
    window.localStorage.setItem("cms_visitor_id", odwiedzajacyDlaWariantu("a"));
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={dokumentZTestem()} lang="pl" />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    beacon.mockClear();
    const widget = container.querySelector("[data-widget-id]");
    expect(widget).not.toBeNull();
    fireEvent.click(widget as Element);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(`cms_ab_conversion_${EKSPERYMENT}`)).toBe("1");
  });

  it("strona wyrenderowana SPEKULACYJNIE nie zgłasza ekspozycji przed aktywacją", async () => {
    // Bez tej osłony sam najazd kursora na link podbijałby MIANOWNIK
    // współczynnika konwersji - im lepszy prefetch, tym gorszy wynik testu.
    Object.defineProperty(document, "prerendering", {
      configurable: true,
      writable: true,
      value: true,
    });
    window.localStorage.setItem("cms_visitor_id", odwiedzajacyDlaWariantu("a"));
    renderWithQueryClient(<BuilderRenderer doc={dokumentZTestem()} lang="pl" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(beacon).not.toHaveBeenCalled();

    // Użytkownik faktycznie wchodzi na stronę.
    await act(async () => {
      document.dispatchEvent(new Event("prerenderingchange"));
    });
    expect(beacon).toHaveBeenCalledTimes(1);
  });
});

describe("editorPreview - podgląd w kanwie buildera", () => {
  it("pokazuje WSZYSTKIE warianty naraz, także dla odwiedzającego z bucketu B", async () => {
    window.localStorage.setItem("cms_visitor_id", odwiedzajacyDlaWariantu("b"));
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={dokumentZTestem()} lang="pl" editorPreview />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(widoczneSekcje(container)).toEqual(["wariant-a", "wariant-b"]);
  });

  it("nie zapisuje ŻADNEGO zdarzenia eksperymentu (redaktor nie jest próbą)", async () => {
    window.localStorage.setItem("cms_visitor_id", odwiedzajacyDlaWariantu("a"));
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={dokumentZTestem()} lang="pl" editorPreview />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(container.querySelector("[data-widget-id]") as Element);
    expect(beacon).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(`cms_ab_exposure_${EKSPERYMENT}`)).toBeNull();
  });

  it("editorPreview NIE otwiera treści zamkniętej bramką dostępu", async () => {
    // Podgląd kanwy zdejmuje bucketowanie A/B, ale kontrola dostępu to inna
    // reguła - redaktor widzi w kanwie to samo, co czytelnik.
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          simpleSection("jawna"),
          simpleSection("zamknieta", { advanced: { access: { auth: "user" } } }),
        ])}
        lang="pl"
        editorPreview
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(widoczneSekcje(container)).toEqual(["jawna"]);
  });

  it("bez znaczników A/B tryb podglądu nie zmienia niczego w DOM", async () => {
    const zwykly = doc([simpleSection("a"), simpleSection("b")]);
    const publiczny = renderWithQueryClient(<BuilderRenderer doc={zwykly} lang="pl" />);
    const htmlPubliczny = publiczny.container.querySelector("[data-builder-renderer]")!.innerHTML;
    cleanup();
    const podglad = renderWithQueryClient(<BuilderRenderer doc={zwykly} lang="pl" editorPreview />);
    expect(podglad.container.querySelector("[data-builder-renderer]")!.innerHTML).toBe(
      htmlPubliczny,
    );
  });
});
