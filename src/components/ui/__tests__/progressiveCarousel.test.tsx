// `ProgressSlider` - progresywny slider z paskiem postępu na przyciskach.
//
// CO TEN PLIK DOWODZI.
//   1. A1 (zlecenie design systemu, pozycja blokująca): klik w przycisk slajdu
//      PRZEŁĄCZA slajd, gdy kursor jest nad karuzelą i gdy przycisk ma ognisko -
//      bez `mouseLeave` i bez `blur`. Dawniej klik zapisywał wyłącznie refy,
//      a pętla animacji pod kursorem nie biegła: slajd przeskakiwał dopiero po
//      zjechaniu kursorem, a w podglądzie edytora (`paused`) wcale.
//   2. Pasek po kliknięciu DOBIEGA od bieżącego postępu, a nie od zera.
//   3. Auto-play: pełny czas slajdu, zawinięcie, pauza pod kursorem i przy
//      ognisku (niezależnie), brak przy `prefers-reduced-motion`.
//   4. Postęp co klatkę nie renderuje slajdów (osobny kontekst).
//   5. Pierwszy slajd jest aktywny już w HTML-u serwera, gdy wywołujący go wskaże.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Profiler, useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProgressSlider,
  SliderBtn,
  SliderBtnGroup,
  SliderContent,
  SliderWrapper,
  useProgressSliderContext,
  type ProgressSliderProps,
} from "@/components/ui/progressive-carousel";

const SLAJDY = ["most", "gory", "morze"];

function Karuzela(props: Partial<ProgressSliderProps> & { slajdy?: string[] }) {
  const { slajdy = SLAJDY, ...rest } = props;
  return (
    <ProgressSlider aria-label="Galeria" duration={1000} fastDuration={200} {...rest}>
      <SliderContent>
        {slajdy.map((v) => (
          <SliderWrapper key={v} value={v}>
            <p>Slajd {v}</p>
          </SliderWrapper>
        ))}
      </SliderContent>
      <SliderBtnGroup>
        {slajdy.map((v) => (
          <SliderBtn key={v} value={v} progressBarClass="pasek">
            Przycisk {v}
          </SliderBtn>
        ))}
      </SliderBtnGroup>
    </ProgressSlider>
  );
}

const sekcja = () => screen.getByRole("region", { name: "Galeria" });
const przycisk = (v: string) => screen.getByRole("button", { name: `Przycisk ${v}` });
const aktywny = () =>
  screen.getAllByRole("group", { hidden: true }).find((g) => g.dataset.active === "true")
    ?.textContent;
const pasek = (v: string) =>
  przycisk(v).querySelector<HTMLElement>('[data-testid="progress-bar"]') as HTMLElement;
const czas = (ms: number) => act(() => vi.advanceTimersByTime(ms));
/** Szerokość/wysokość paska w procentach; klatki co ~16 ms dają tolerancję kilku pp. */
const procent = (v: string, wymiar: "width" | "height" = "width") =>
  parseFloat(pasek(v).style[wymiar]);

function mockReducedMotion() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout"],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ProgressSlider - A1: klik przełącza slajd", () => {
  it("przy kursorze nad karuzelą - bez zdarzenia mouseLeave", () => {
    render(<Karuzela />);
    expect(aktywny()).toBe("Slajd most");
    fireEvent.mouseEnter(sekcja());
    fireEvent.click(przycisk("gory"));
    czas(250);
    expect(aktywny()).toBe("Slajd gory");
    expect(przycisk("gory").getAttribute("aria-current")).toBe("true");
    expect(przycisk("most").getAttribute("aria-current")).toBe("false");
  });

  it("z klawiatury - ognisko na przycisku i Enter, bez blur", () => {
    render(<Karuzela />);
    fireEvent.focus(przycisk("morze"));
    fireEvent.click(przycisk("morze"));
    czas(250);
    expect(aktywny()).toBe("Slajd morze");
  });

  it("w podglądzie edytora (`paused`) nawigacja działa, a auto-play stoi", () => {
    render(<Karuzela paused />);
    czas(5000);
    expect(aktywny()).toBe("Slajd most");
    fireEvent.click(przycisk("gory"));
    czas(250);
    expect(aktywny()).toBe("Slajd gory");
    expect(pasek("gory").style.width).toBe("0%");
    czas(5000);
    expect(aktywny()).toBe("Slajd gory");
  });

  it("przy prefers-reduced-motion klik przełącza od razu, bez animacji paska", async () => {
    mockReducedMotion();
    render(<Karuzela />);
    await act(async () => {});
    fireEvent.click(przycisk("morze"));
    expect(aktywny()).toBe("Slajd morze");
    expect(pasek("morze").style.width).toBe("0%");
  });

  it("klik w aktywny slajd w trakcie dobiegu odwołuje dobieg", () => {
    render(<Karuzela paused />);
    fireEvent.click(przycisk("gory"));
    czas(50);
    fireEvent.click(przycisk("most"));
    czas(500);
    expect(aktywny()).toBe("Slajd most");
    expect(pasek("most").style.width).toBe("0%");
  });
});

describe("ProgressSlider - pasek postępu", () => {
  it("auto-play wypełnia pasek aktywnego przycisku i przechodzi dalej z zawinięciem", () => {
    render(<Karuzela />);
    czas(500);
    expect(procent("most")).toBeGreaterThan(40);
    expect(procent("most")).toBeLessThan(55);
    expect(pasek("gory").style.width).toBe("0%");
    expect(pasek("most").className).toContain("pasek");
    czas(520);
    expect(aktywny()).toBe("Slajd gory");
    czas(1020);
    czas(1020);
    expect(aktywny()).toBe("Slajd most");
  });

  it("pod kursorem pasek stoi na zerze, a klik uruchamia dobieg w czasie `fastDuration`", () => {
    render(<Karuzela />);
    czas(500);
    fireEvent.mouseEnter(sekcja());
    expect(pasek("most").style.width).toBe("0%");
    fireEvent.click(przycisk("gory"));
    czas(100);
    expect(procent("most")).toBeGreaterThan(35);
    expect(procent("most")).toBeLessThan(60);
    expect(aktywny()).toBe("Slajd most");
  });

  it("dobieg w trakcie auto-play startuje od narysowanego postępu, nie od zera", () => {
    render(<Karuzela />);
    czas(600);
    const przedKlikiem = procent("most");
    expect(przedKlikiem).toBeGreaterThan(50);
    fireEvent.click(przycisk("morze"));
    czas(20);
    expect(procent("most")).toBeGreaterThanOrEqual(przedKlikiem);
    czas(80);
    // Połowa dobiegu: mniej więcej w pół drogi między narysowanym postępem a 100%.
    expect(procent("most")).toBeGreaterThan(70);
    expect(procent("most")).toBeLessThan(90);
    czas(150);
    expect(aktywny()).toBe("Slajd morze");
  });

  it("w układzie pionowym pasek rośnie w wysokość", () => {
    render(<Karuzela vertical />);
    czas(250);
    expect(procent("most", "height")).toBeGreaterThan(15);
    expect(procent("most", "height")).toBeLessThan(30);
    expect(pasek("gory").style.height).toBe("0%");
    expect(pasek("most").className).toContain("w-full");
  });
});

describe("ProgressSlider - pauza auto-play", () => {
  it("staje pod kursorem i rusza po zjechaniu", () => {
    render(<Karuzela />);
    fireEvent.mouseEnter(sekcja());
    czas(3000);
    expect(aktywny()).toBe("Slajd most");
    fireEvent.mouseLeave(sekcja());
    czas(1050);
    expect(aktywny()).toBe("Slajd gory");
  });

  it("ognisko trzyma pauzę po zjechaniu myszą i przy Tab między przyciskami", () => {
    render(<Karuzela />);
    fireEvent.mouseEnter(sekcja());
    fireEvent.focus(przycisk("most"));
    fireEvent.blur(przycisk("most"), { relatedTarget: przycisk("gory") });
    fireEvent.focus(przycisk("gory"));
    fireEvent.mouseLeave(sekcja());
    czas(3000);
    expect(aktywny()).toBe("Slajd most");
    fireEvent.blur(przycisk("gory"), { relatedTarget: document.body });
    czas(1050);
    expect(aktywny()).toBe("Slajd gory");
  });

  it("nie rusza przy prefers-reduced-motion ani z jednym slajdem", async () => {
    mockReducedMotion();
    const { unmount } = render(<Karuzela />);
    await act(async () => {});
    czas(5000);
    expect(aktywny()).toBe("Slajd most");
    unmount();
    vi.unstubAllGlobals();
    render(<Karuzela slajdy={["jedyny"]} />);
    czas(5000);
    expect(aktywny()).toBe("Slajd jedyny");
    expect(pasek("jedyny").style.width).toBe("0%");
  });
});

describe("ProgressSlider - slajdy i kontekst", () => {
  it("nieaktywne slajdy są ukryte dla czytnika i nieklikalne", () => {
    render(<Karuzela paused />);
    const grupy = screen.getAllByRole("group", { hidden: true });
    expect(grupy.map((g) => g.getAttribute("aria-hidden"))).toEqual(["false", "true", "true"]);
    expect(grupy.every((g) => g.getAttribute("aria-roledescription") === "slide")).toBe(true);
    expect(grupy[1].className).toContain("pointer-events-none");
    expect(sekcja().getAttribute("aria-roledescription")).toBe("carousel");
  });

  it("`activeSlider` wskazuje slajd startowy i przełącza go po zmianie", () => {
    const { rerender } = render(<Karuzela paused activeSlider="morze" />);
    expect(aktywny()).toBe("Slajd morze");
    rerender(<Karuzela paused activeSlider="gory" />);
    expect(aktywny()).toBe("Slajd gory");
  });

  it("HTML serwera ma aktywny slajd wskazany przez `activeSlider`", () => {
    const html = renderToString(<Karuzela activeSlider="most" />);
    expect(html).toMatch(/data-active="true"[^>]*>(<!-- -->)?<p>Slajd (<!-- -->)?most/);
    expect(html.match(/data-active="true"/g)).toHaveLength(1);
  });

  it("dołożenie slajdu nie przestawia aktywnego", () => {
    const { rerender } = render(<Karuzela paused />);
    fireEvent.click(przycisk("gory"));
    czas(250);
    rerender(<Karuzela paused slajdy={[...SLAJDY, "las"]} />);
    expect(aktywny()).toBe("Slajd gory");
    expect(screen.getAllByRole("group", { hidden: true })).toHaveLength(4);
  });

  it("domyślnie slajd trwa 5 s, a dobieg po kliknięciu 0,4 s", () => {
    render(
      <ProgressSlider aria-label="Galeria">
        {SLAJDY.map((v) => (
          <SliderWrapper key={v} value={v}>
            <p>Slajd {v}</p>
          </SliderWrapper>
        ))}
        {SLAJDY.map((v) => (
          <SliderBtn key={v} value={v}>
            Przycisk {v}
          </SliderBtn>
        ))}
      </ProgressSlider>,
    );
    czas(4900);
    expect(aktywny()).toBe("Slajd most");
    czas(150);
    expect(aktywny()).toBe("Slajd gory");
    fireEvent.click(przycisk("morze"));
    czas(350);
    expect(aktywny()).toBe("Slajd gory");
    czas(100);
    expect(aktywny()).toBe("Slajd morze");
  });

  it("dwa slajdy o tej samej wartości rejestrują się raz, więc auto-play nie stoi w miejscu", () => {
    render(
      <ProgressSlider aria-label="Galeria" duration={1000}>
        <SliderWrapper key="1" value="a">
          <p>Slajd a</p>
        </SliderWrapper>
        <SliderWrapper key="2" value="a">
          <p>Kopia a</p>
        </SliderWrapper>
        <SliderWrapper key="3" value="b">
          <p>Slajd b</p>
        </SliderWrapper>
      </ProgressSlider>,
    );
    czas(1050);
    expect(aktywny()).toBe("Slajd b");
  });

  it("usunięcie aktywnego slajdu aktywuje pierwszy z pozostałych", () => {
    const { rerender } = render(<Karuzela paused activeSlider={undefined} />);
    fireEvent.click(przycisk("gory"));
    czas(250);
    rerender(<Karuzela paused slajdy={["most", "morze"]} />);
    expect(aktywny()).toBe("Slajd most");
  });

  it("postęp co klatkę nie renderuje ponownie slajdów", () => {
    const onRender = vi.fn();
    render(
      <ProgressSlider duration={1000}>
        <Profiler id="slajdy" onRender={onRender}>
          <SliderContent>
            {SLAJDY.map((v) => (
              <SliderWrapper key={v} value={v}>
                {v}
              </SliderWrapper>
            ))}
          </SliderContent>
        </Profiler>
        <SliderBtnGroup>
          {SLAJDY.map((v) => (
            <SliderBtn key={v} value={v}>
              {v}
            </SliderBtn>
          ))}
        </SliderBtnGroup>
      </ProgressSlider>,
    );
    onRender.mockClear();
    czas(400);
    expect(onRender).not.toHaveBeenCalled();
  });

  it("hook kontekstu poza karuzelą rzuca czytelnym błędem", () => {
    const Sonda = () => {
      useProgressSliderContext();
      return null;
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Sonda />)).toThrow(
      "useProgressSliderContext must be used within a ProgressSlider",
    );
  });

  it("hook kontekstu w karuzeli widzi aktywny slajd, postęp i orientację", () => {
    const odczyty: string[] = [];
    const Sonda = () => {
      const ctx = useProgressSliderContext();
      odczyty.push(`${ctx.active}:${Math.round(ctx.progress)}:${ctx.vertical}`);
      return null;
    };
    function Z() {
      const [jest] = useState(true);
      return (
        <ProgressSlider duration={1000} vertical>
          {jest ? <Sonda /> : null}
          <SliderWrapper value="a">a</SliderWrapper>
          <SliderWrapper value="b">b</SliderWrapper>
        </ProgressSlider>
      );
    }
    render(<Z />);
    czas(500);
    expect(odczyty.at(-1)).toMatch(/^a:5\d:true$/);
  });
});
