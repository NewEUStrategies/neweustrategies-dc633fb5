// `SignupShowcase` - galeria w lewej kolumnie popupu rejestracji.
//
// CO TEN PLIK DOWODZI (wydajność dostarczania zdjęć ma osobny plik
// `signupShowcasePerformance.test.tsx`).
//   1. ATRAMENT Z KONTRASTU, NIE Z PROGU. Półton (#8a8a8a, luminancja ~0,25)
//      przy progu 0,4 dostawał biały tekst o kontraście ~3,4:1, choć ciemny
//      atrament galerii daje na nim ~5,7:1.
//   2. AUTO-ROTACJA podpisu stoi pod kursorem i przy ognisku w galerii, nie
//      startuje przy `prefers-reduced-motion` i ma interwał przycięty do 0,8-30 s.
//      Rusza dopiero po otwarciu bramki ruchu (P3.5: pierwsza interakcja albo
//      punkt ciszy - tu atrapa).
//   3. UKŁADY SIATKI (referencyjny 1-4 kafle, mozaika, pojedynczy kadr), bloki
//      w kolejności z panelu i każdy blok opcjonalny.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignupShowcase, type ShowcaseImage } from "@/components/ui/signup-showcase";
import { __openMotionGateForTests, __resetMotionGateForTests } from "@/lib/performance/motionGate";
import { defaultNewsletterSettings } from "@/hooks/useNewsletterSettings";
import {
  resolvePopupPalette,
  type PopupGalleryDesign,
  type PopupPalette,
} from "@/lib/newsletter/popupDesign";

const settings = defaultNewsletterSettings();
const PALETA = resolvePopupPalette(settings, "dark");
const DESIGN = settings.popup_design.gallery;

const zdjecia = (n: number): ShowcaseImage[] =>
  Array.from({ length: n }, (_, i) => ({
    url: `/media/kadr-${i}.jpg`,
    caption: `Opis ${i}`,
    title: `Tytuł ${i}`,
  }));

interface Opcje {
  images?: ShowcaseImage[];
  design?: Partial<PopupGalleryDesign>;
  palette?: Partial<PopupPalette>;
  brand?: string;
  logoUrl?: string | null;
  tagline?: string;
  captionPrefix?: string;
  rotateMs?: number;
  showBrand?: boolean;
  showCaption?: boolean;
  showDots?: boolean;
  autoRotate?: boolean;
}

function galeria(o: Opcje = {}) {
  return render(
    <SignupShowcase
      images={o.images ?? zdjecia(4)}
      design={{ ...DESIGN, ...o.design }}
      palette={{ ...PALETA, ...o.palette }}
      brand={o.brand ?? "NES"}
      logoUrl={o.logoUrl ?? null}
      tagline={o.tagline}
      captionPrefix={o.captionPrefix}
      radiusPx={6}
      rotateMs={o.rotateMs ?? 1000}
      showBrand={o.showBrand ?? true}
      showCaption={o.showCaption ?? true}
      showDots={o.showDots ?? true}
      dotLabel="Kadr"
      nextLabel="Następny kadr"
      autoRotate={o.autoRotate ?? false}
    />,
  );
}

const korzen = (c: HTMLElement) =>
  c.querySelector<HTMLElement>("[data-showcase-root]") as HTMLElement;
const kropka = (n: number) => screen.getByRole("button", { name: `Kadr ${n}` });
const kafle = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>("[data-showcase-grid] .grid > div"));

// Punkt ciszy bramki ruchu tylko na żądanie testu.
vi.mock("@/lib/performance/whenQuiescent", () => ({ onQuiescent: () => () => {} }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  __resetMotionGateForTests();
});

describe("SignupShowcase - atrament galerii", () => {
  it("półton dostaje ciemny atrament, bo ten ma lepszy kontrast", () => {
    const { container } = galeria({ palette: { gradFrom: "#8a8a8a" } });
    expect(korzen(container).style.getPropertyValue("--nl-fg")).toBe("#0b0b0f");
    expect(korzen(container).style.getPropertyValue("--nl-muted")).toBe("rgba(11,11,15,0.62)");
  });

  it("ciemna baza dostaje jasny atrament", () => {
    const { container } = galeria({ palette: { gradFrom: "#101014" } });
    expect(korzen(container).style.getPropertyValue("--nl-fg")).toBe("#ffffff");
  });

  it("nieczytelna baza (color-mix) liczy się jak ciemne tło panelu", () => {
    const { container } = galeria({
      palette: { gradFrom: "color-mix(in oklab, var(--nl-bg) 80%, black)" },
    });
    expect(korzen(container).style.getPropertyValue("--nl-fg")).toBe("#ffffff");
  });
});

describe("SignupShowcase - bloki", () => {
  it("nagłówek marki: wgrane logo z nazwą marki jako tekstem alternatywnym", () => {
    const { container } = galeria({ logoUrl: "/media/logo.svg", brand: "Marka" });
    const logo = container.querySelector<HTMLImageElement>("[data-showcase-logo]");
    expect(logo?.getAttribute("alt")).toBe("Marka");
    expect(screen.getByText("Marka")).toBeTruthy();
  });

  it("bez wgranego logo pokazuje wbudowany znak, a bez marki logo ma alt „logo”", () => {
    const pierwszy = galeria({ brand: "Marka" });
    expect(pierwszy.container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    pierwszy.unmount();
    const drugi = galeria({ brand: "", logoUrl: "/media/logo.svg" });
    expect(drugi.container.querySelector("[data-showcase-logo]")?.getAttribute("alt")).toBe("logo");
  });

  it("nagłówek znika bez marki i logo albo przy wyłączonym bloku", () => {
    const bezLogo = galeria({ brand: "", design: { showLogo: false } });
    expect(bezLogo.container.querySelector(".sticky")).toBeNull();
    bezLogo.unmount();
    const wylaczony = galeria({ showBrand: false });
    expect(screen.queryByText("NES")).toBeNull();
    expect(wylaczony.container.querySelector(".sticky")).toBeNull();
  });

  it("sama nazwa marki bez logo jest dozwolona", () => {
    const { container } = galeria({ design: { showLogo: false } });
    expect(screen.getByText("NES")).toBeTruthy();
    expect(container.querySelector("[data-showcase-logo]")).toBeNull();
  });

  it("bloki idą w kolejności z panelu", () => {
    const { container } = galeria({
      tagline: "Hasło",
      design: { order: ["tagline", "dots", "caption", "grid", "brand"] },
    });
    const dzieci = Array.from(korzen(container).children);
    expect(dzieci[0].textContent).toBe("Hasło");
    expect(dzieci[1].querySelectorAll("button")).toHaveLength(4);
    expect(dzieci[3].hasAttribute("data-showcase-grid")).toBe(true);
    expect(dzieci[4].textContent).toContain("NES");
  });

  it("wyrównanie do lewej przestawia marki, kropki i hasło", () => {
    const { container } = galeria({ tagline: "Hasło", design: { align: "left" } });
    expect(korzen(container).className).toContain("items-start");
    expect(screen.getByText("Hasło").className).toContain("text-left");
    expect(kropka(1).parentElement?.className).toContain("self-start");
  });

  it("podpis: prefiks, opis i tytuł aktywnego kadru, ramka przerywana albo pełna", () => {
    const { container, unmount } = galeria({ captionPrefix: "/imagine" });
    expect(screen.getByText("/imagine")).toBeTruthy();
    expect(screen.getByText("Opis 0")).toBeTruthy();
    expect(screen.getByText("Tytuł 0")).toBeTruthy();
    expect(container.querySelector(".border-dashed")).not.toBeNull();
    unmount();
    const pelna = galeria({ design: { captionDashed: false } });
    expect(pelna.container.querySelector(".border-dashed")).toBeNull();
  });

  it("podpis znika, gdy nie ma czego pokazać albo jest wyłączony", () => {
    const pusty = galeria({ images: [{ url: "/a.jpg" }, { url: "/b.jpg" }] });
    expect(screen.queryByRole("button", { name: "Następny kadr" })).toBeNull();
    pusty.unmount();
    galeria({ showCaption: false });
    expect(screen.queryByText("Opis 0")).toBeNull();
  });

  it("sam tytuł bez opisu i prefiksu daje jeden wiersz podpisu", () => {
    galeria({ images: [{ url: "/a.jpg", title: "Tylko tytuł" }] });
    const tytul = screen.getByText("Tylko tytuł");
    expect(tytul.parentElement?.querySelectorAll("p")).toHaveLength(1);
  });

  it("strzałka przechodzi do następnego kadru z zawinięciem", () => {
    galeria({ images: zdjecia(2) });
    const dalej = screen.getByRole("button", { name: "Następny kadr" });
    fireEvent.click(dalej);
    expect(screen.getByText("Opis 1")).toBeTruthy();
    fireEvent.click(dalej);
    expect(screen.getByText("Opis 0")).toBeTruthy();
  });

  it("strzałki nie ma przy jednym kadrze ani gdy panel ją wyłączył", () => {
    const jeden = galeria({ images: zdjecia(1) });
    expect(screen.queryByRole("button", { name: "Następny kadr" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Kadr 1" })).toBeNull();
    jeden.unmount();
    galeria({ design: { showArrow: false } });
    expect(screen.queryByRole("button", { name: "Następny kadr" })).toBeNull();
  });

  it("kropki oznaczają aktywny kadr i przełączają go", () => {
    galeria();
    expect(kropka(1).getAttribute("aria-current")).toBe("true");
    fireEvent.click(kropka(3));
    expect(kropka(3).getAttribute("aria-current")).toBe("true");
    expect(kropka(1).getAttribute("aria-current")).toBe("false");
    expect(screen.getByText("Opis 2")).toBeTruthy();
  });

  it("bez zdjęć nie ma siatki ani kropek, a wyłączone kropki znikają", () => {
    const pusta = galeria({ images: [] });
    expect(pusta.container.querySelector("[data-showcase-grid]")).toBeNull();
    pusta.unmount();
    galeria({ showDots: false });
    expect(screen.queryByRole("button", { name: "Kadr 1" })).toBeNull();
  });
});

describe("SignupShowcase - siatka", () => {
  it.each([
    [1, [["1 / span 2", "1 / span 3"]]],
    [
      2,
      [
        ["1", "1 / span 3"],
        ["2", "1 / span 3"],
      ],
    ],
    [
      3,
      [
        ["1", "1 / span 2"],
        ["2", "1 / span 2"],
        ["1 / span 2", "3"],
      ],
    ],
    [
      4,
      [
        ["1", "1 / span 2"],
        ["2", "1"],
        ["2", "2"],
        ["1 / span 2", "3"],
      ],
    ],
  ])("układ referencyjny rozkłada %i kafle według projektu", (n, oczekiwane) => {
    const { container } = galeria({ images: zdjecia(n) });
    expect(kafle(container).map((k) => [k.style.gridColumn, k.style.gridRow])).toEqual(oczekiwane);
  });

  it("mozaika ma siatkę 3x3 i rozmieszczenie z pierwszego wdrożenia", () => {
    const { container } = galeria({ design: { grid: "mosaic" } });
    const siatka = container.querySelector<HTMLElement>(
      "[data-showcase-grid] .grid",
    ) as HTMLElement;
    expect(siatka.style.gridTemplateColumns).toBe("repeat(3, 1fr)");
    expect(kafle(container)[0].style.gridColumn).toBe("span 2");
    expect(kafle(container)[3].style.gridColumn).toBe("span 3");
  });

  it("nieaktywne kafle są przygaszone, a przygaszenie jest przycięte do 100%", () => {
    const { container } = galeria({ design: { inactiveDim: 250 } });
    const obrazy = Array.from(
      container.querySelectorAll<HTMLImageElement>("[data-showcase-grid] img"),
    );
    expect(obrazy[0].style.opacity).toBe("1");
    expect(obrazy[0].style.filter).toBe("none");
    expect(Number(obrazy[1].style.opacity)).toBeCloseTo(0.4, 5);
  });

  it("narożniki celownika są widoczne tylko na aktywnym kaflu i dają się wyłączyć", () => {
    const { container, unmount } = galeria();
    const naroza = (k: HTMLElement) => k.querySelectorAll("span.pointer-events-none");
    const [aktywny, drugi] = kafle(container);
    expect(naroza(aktywny)).toHaveLength(4);
    expect(naroza(aktywny)[0].className).toContain("opacity-100");
    expect(naroza(drugi)[0].className).toContain("opacity-0");
    unmount();
    const bez = galeria({ design: { showCorners: false } });
    expect(naroza(kafle(bez.container)[0])).toHaveLength(0);
  });

  it("pojedynczy kadr pokazuje tylko aktywne zdjęcie z narożnikami", () => {
    const { container } = galeria({ design: { grid: "single" } });
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelectorAll("[data-showcase-grid] span.opacity-100")).toHaveLength(4);
  });

  it("wygaszenia krawędzi siedzą pod zdjęciami i dają się wyłączyć", () => {
    const { container, unmount } = galeria();
    expect(container.querySelectorAll('[data-showcase-grid] > [aria-hidden="true"]')).toHaveLength(
      2,
    );
    unmount();
    const bez = galeria({ design: { showFades: false } });
    expect(
      bez.container.querySelectorAll('[data-showcase-grid] > [aria-hidden="true"]'),
    ).toHaveLength(0);
  });
});

describe("SignupShowcase - auto-rotacja", () => {
  beforeEach(() => __openMotionGateForTests());

  it("przed otwarciem bramki ruchu stoi 30 s; pierwszy kadr pełny interwał po otwarciu", () => {
    __resetMotionGateForTests();
    vi.useFakeTimers();
    galeria({ autoRotate: true, rotateMs: 1000 });
    // Krokami po 0,5 s: skok 30 s mógłby wrócić na pierwszy kadr po pełnych obrotach.
    for (let step = 0; step < 60; step += 1) {
      act(() => vi.advanceTimersByTime(500));
      expect(kropka(1).getAttribute("aria-current")).toBe("true");
    }
    act(() => __openMotionGateForTests());
    act(() => vi.advanceTimersByTime(999));
    expect(kropka(1).getAttribute("aria-current")).toBe("true");
    act(() => vi.advanceTimersByTime(1));
    expect(kropka(2).getAttribute("aria-current")).toBe("true");
  });

  it("przechodzi do następnego kadru co interwał, nie częściej niż co 0,8 s", () => {
    vi.useFakeTimers();
    galeria({ autoRotate: true, rotateMs: 10 });
    act(() => vi.advanceTimersByTime(799));
    expect(kropka(1).getAttribute("aria-current")).toBe("true");
    act(() => vi.advanceTimersByTime(1));
    expect(kropka(2).getAttribute("aria-current")).toBe("true");
  });

  it("interwał nie przekracza 30 s", () => {
    vi.useFakeTimers();
    galeria({ autoRotate: true, rotateMs: 999_999 });
    act(() => vi.advanceTimersByTime(30_000));
    expect(kropka(2).getAttribute("aria-current")).toBe("true");
  });

  it("stoi pod kursorem i przy ognisku w galerii, także po zjechaniu myszą", () => {
    vi.useFakeTimers();
    const { container } = galeria({ autoRotate: true, rotateMs: 1000 });
    fireEvent.mouseEnter(korzen(container));
    fireEvent.focus(kropka(1));
    fireEvent.blur(kropka(1), { relatedTarget: kropka(2) });
    fireEvent.focus(kropka(2));
    fireEvent.mouseLeave(korzen(container));
    act(() => vi.advanceTimersByTime(5000));
    expect(kropka(1).getAttribute("aria-current")).toBe("true");
    fireEvent.blur(kropka(2), { relatedTarget: document.body });
    act(() => vi.advanceTimersByTime(1000));
    expect(kropka(2).getAttribute("aria-current")).toBe("true");
  });

  it("nie rusza przy prefers-reduced-motion ani w podglądzie admina", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    vi.useFakeTimers();
    const ruch = galeria({ autoRotate: true, rotateMs: 1000 });
    await act(async () => {});
    act(() => vi.advanceTimersByTime(5000));
    expect(kropka(1).getAttribute("aria-current")).toBe("true");
    ruch.unmount();
    vi.unstubAllGlobals();
    galeria({ autoRotate: false, rotateMs: 1000 });
    act(() => vi.advanceTimersByTime(5000));
    expect(kropka(1).getAttribute("aria-current")).toBe("true");
  });

  it("skrócenie listy zdjęć wraca na pierwszy kadr", () => {
    const { rerender } = galeria();
    fireEvent.click(kropka(4));
    rerender(
      <SignupShowcase
        images={zdjecia(2)}
        design={DESIGN}
        palette={PALETA}
        brand="NES"
        logoUrl={null}
        radiusPx={6}
        rotateMs={1000}
        showBrand
        showCaption
        showDots
        dotLabel="Kadr"
        nextLabel="Następny kadr"
        autoRotate={false}
      />,
    );
    expect(kropka(1).getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("Opis 0")).toBeTruthy();
  });
});
