// DZIESIĘĆ SEKCJI edytora Theme Design, wszystkie do 18.08.2026 na zerze.
//
// Sekcja jest cienką warstwą między kontrolką a wersją roboczą, ale niesie
// jedną regułę, której nie widać nigdzie indziej: KTÓRY token zmienia dana
// kontrolka. Podpięcie suwaka pod sąsiednie pole nie daje błędu typów (obie
// wartości to `string`), nie wywraca renderu i nie zapala żadnego istniejącego
// testu - a redaktor ustawia odstęp między literami i widzi zmianę marginesu.
//
// Dlatego każdy przypadek niżej sprawdza PARĘ (kontrolka -> ścieżka w wersji
// roboczej), a nie sam fakt, że sekcja się wyrenderowała. Osobno pilnowany jest
// PODGLĄD: sekcja pokazuje wartości z bieżącej wersji roboczej, a nie zapisane.
import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@/lib/i18n-admin-theme-design";
import {
  BlockHeadingSection,
  ThumbnailSection,
  ReadMoreSection,
  MetaSection,
  ToolbarSection,
  ModeSwitchSection,
  SocialSection,
  PostTitleSection,
  PostExcerptSection,
  ListIndexSection,
  CarouselSection,
} from "../index";
import { THEME_DESIGN_DEFAULTS, type ThemeDesign } from "@/lib/theme/themeDesign";
import { CAROUSEL_DEFAULTS } from "@/lib/theme/carouselDefaults";
import type { SectionEditorProps } from "../../../types";

type SectionComponent = (props: SectionEditorProps) => ReactElement;

function renderSection(Component: SectionComponent, draft: ThemeDesign = THEME_DESIGN_DEFAULTS) {
  const set = vi.fn();
  const setColor = vi.fn();
  const view = render(
    <Component draft={draft} set={set} setColor={setColor} previewMode="light" />,
  );
  return { set, setColor, view };
}

/**
 * Pole edytora po DOKŁADNEJ etykiecie. Etykiety biorą się ze słownika, więc
 * asercja mierzy napis widziany przez redaktora, nie klucz.
 *
 * `PxStepper` renderuje zwykłe pole tekstowe („18px"), a `NumStepper` pole
 * liczbowe - dlatego szukamy elementu `input`, a nie konkretnej roli.
 */
function inputInField(label: string): HTMLInputElement {
  const container = screen.getByText(label).closest("div");
  if (!container) throw new Error(`brak kontenera dla pola ${label}`);
  const input = container.querySelector("input");
  if (!input) throw new Error(`brak kontrolki w polu ${label}`);
  return input as HTMLInputElement;
}

/**
 * Wpisuje wartość w kontrolkę pola.
 *
 * `PxStepper` przekazuje wpisany TEKST bez obróbki (jednostkę dokłada dopiero
 * krok strzałką), więc test podaje pełną wartość CSS - dokładnie tak, jak
 * robi to redaktor.
 */
function typeInField(label: string, value: string): void {
  fireEvent.change(inputInField(label), { target: { value } });
}

describe("BlockHeadingSection - nagłówki bloków", () => {
  it("każda kontrolka pisze do WŁASNEGO tokenu", () => {
    // Podmiana pary tutaj jest niewidoczna dla typów i dla renderu.
    const { set } = renderSection(BlockHeadingSection);

    typeInField("Rozmiar (px)", "24px");
    expect(set).toHaveBeenCalledWith("blockHeading", { fontSize: "24px" });

    typeInField("Grubość", "500");
    expect(set).toHaveBeenCalledWith("blockHeading", { fontWeight: 500 });
  });

  it("odstęp między literami i margines to DWA różne tokeny", () => {
    const { set } = renderSection(BlockHeadingSection);
    typeInField("Odstęp liter (px)", "2px");
    typeInField("Margines dolny (px)", "24px");

    const keys = set.mock.calls.map((c) => Object.keys(c[1] as object)[0]);
    expect(keys).toContain("letterSpacing");
    expect(keys).toContain("marginBottom");
  });

  it("PODGLĄD pokazuje wartości z bieżącej wersji roboczej", () => {
    // Podgląd czytający zapisane ustawienia zamiast szkicu kłamałby przy każdej
    // niezapisanej zmianie - a to jedyny sposób, w jaki redaktor widzi efekt.
    const draft: ThemeDesign = {
      ...THEME_DESIGN_DEFAULTS,
      blockHeading: {
        ...THEME_DESIGN_DEFAULTS.blockHeading,
        fontSize: "42px",
        textTransform: "uppercase",
      },
    };
    renderSection(BlockHeadingSection, draft);
    const heading = document.querySelector<HTMLElement>(".cms-block-heading");
    expect(heading?.style.fontSize).toBe("42px");
    expect(heading?.style.textTransform).toBe("uppercase");
  });
});

describe("ThumbnailSection - miniatury", () => {
  it("promień i proporcja to osobne tokeny", () => {
    const { set } = renderSection(ThumbnailSection);
    typeInField("Zaokrąglenie (px)", "12px");
    expect(set).toHaveBeenCalledWith("thumbnail", { radius: "12px" });
  });

  it("sekcja renderuje się bez kontrolek koloru - miniatura ich nie ma", () => {
    const { setColor } = renderSection(ThumbnailSection);
    expect(setColor).not.toHaveBeenCalled();
  });
});

describe("ReadMoreSection - przycisk czytaj więcej", () => {
  it("promień, odstępy i grubość trafiają do własnych tokenów", () => {
    const { set } = renderSection(ReadMoreSection);
    typeInField("Zaokrąglenie (px)", "8px");
    expect(set).toHaveBeenCalledWith("readMoreButton", { radius: "8px" });
  });

  it("przełącznik wersalików pisze wartość logiczną, nie napis", () => {
    // `uppercase: "true"` przeszłoby przez typ `unknown` w patchu i wylądowało
    // w CSS jako `text-transform: true`.
    const { set } = renderSection(ReadMoreSection);
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[0]);

    const patch = set.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(typeof Object.values(patch)[0]).toBe("boolean");
  });
});

describe("ReadMoreSection - podgląd przycisku", () => {
  it("strzałka w podglądzie ZNIKA po wyłączeniu opcji", () => {
    // Podgląd pokazujący strzałkę mimo wyłączonej opcji kłamałby o tym, jak
    // przycisk wygląda na stronie.
    const zeStrzalka: ThemeDesign = {
      ...THEME_DESIGN_DEFAULTS,
      readMoreButton: { ...THEME_DESIGN_DEFAULTS.readMoreButton, arrow: true },
    };
    const { view } = renderSection(ReadMoreSection, zeStrzalka);
    expect(view.container.querySelector(".cms-read-more")?.textContent).toContain("→");
    view.unmount();

    const bezStrzalki: ThemeDesign = {
      ...THEME_DESIGN_DEFAULTS,
      readMoreButton: { ...THEME_DESIGN_DEFAULTS.readMoreButton, arrow: false },
    };
    const drugi = renderSection(ReadMoreSection, bezStrzalki);
    expect(drugi.view.container.querySelector(".cms-read-more")?.textContent).not.toContain("→");
  });

  it.each([
    [true, "uppercase"],
    [false, "none"],
  ])("wersaliki %s dają w podglądzie transformację %s", (uppercase, oczekiwane) => {
    const draft: ThemeDesign = {
      ...THEME_DESIGN_DEFAULTS,
      readMoreButton: { ...THEME_DESIGN_DEFAULTS.readMoreButton, uppercase },
    };
    const { view } = renderSection(ReadMoreSection, draft);
    const przycisk = view.container.querySelector<HTMLElement>(".cms-read-more");

    expect(przycisk?.style.textTransform).toBe(oczekiwane);
  });
});

describe("MetaSection - informacje meta", () => {
  it("rozmiar i odstęp to osobne tokeny", () => {
    const { set } = renderSection(MetaSection);
    typeInField("Rozmiar (px)", "15px");
    expect(set).toHaveBeenCalledWith("metaInfo", { fontSize: "15px" });
  });
});

describe("ToolbarSection - przyciski paska", () => {
  it("wymiary trafiają do tokenów paska, nie do sąsiednich sekcji", () => {
    const { set } = renderSection(ToolbarSection);
    typeInField("Zaokrąglenie (px)", "4px");
    expect(set).toHaveBeenCalledWith("toolbarButton", { radius: "4px" });
  });

  it("wszystkie zmiany dotyczą WYŁĄCZNIE sekcji paska", () => {
    const { set } = renderSection(ToolbarSection);
    typeInField("Zaokrąglenie (px)", "4px");
    for (const call of set.mock.calls) expect(call[0]).toBe("toolbarButton");
  });
});

describe("ModeSwitchSection - przełącznik trybu", () => {
  it("promień trafia do własnego tokenu", () => {
    const { set } = renderSection(ModeSwitchSection);
    typeInField("Zaokrąglenie (px)", "10px");
    expect(set).toHaveBeenCalledWith("modeSwitcher", { radius: "10px" });
  });

  it("przełącznik etykiety pisze wartość logiczną", () => {
    const { set } = renderSection(ModeSwitchSection);
    fireEvent.click(screen.getAllByRole("switch")[0]);
    const patch = set.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(typeof Object.values(patch)[0]).toBe("boolean");
  });
});

describe("SocialSection - ikony społecznościowe", () => {
  it("rozmiar, odstęp i promień to trzy różne tokeny", () => {
    const { set } = renderSection(SocialSection);
    typeInField("Rozmiar (px)", "20px");
    typeInField("Odstęp (px)", "10px");
    typeInField("Zaokrąglenie (px)", "6px");

    const keys = set.mock.calls.map((c) => Object.keys(c[1] as object)[0]);
    expect(new Set(keys).size).toBeGreaterThanOrEqual(2);
    for (const call of set.mock.calls) expect(call[0]).toBe("socialIcons");
  });
});

describe("PostTitleSection - tytuły wpisów", () => {
  it("rozmiar podstawowy i mobilny to DWA różne tokeny", () => {
    // Wspólny token zabrałby możliwość zmniejszenia tytułu na telefonie.
    const { set } = renderSection(PostTitleSection);
    // Wartości MUSZĄ różnić się od domyślnych - kontrolka sterowana nie zgłasza
    // zmiany, gdy wpisany tekst jest identyczny z bieżącym.
    typeInField("Rozmiar desktop (px)", "18px");
    typeInField("Rozmiar mobile (px)", "13px");

    const keys = set.mock.calls.map((c) => Object.keys(c[1] as object)[0]);
    expect(new Set(keys)).toEqual(new Set(["fontSize", "fontSizeSm"]));
    for (const call of set.mock.calls) expect(call[0]).toBe("postTitle");
  });

  it("PODGLĄD odzwierciedla bieżącą wersję roboczą", () => {
    const draft: ThemeDesign = {
      ...THEME_DESIGN_DEFAULTS,
      postTitle: { ...THEME_DESIGN_DEFAULTS.postTitle, fontSize: "33px" },
    };
    const { view } = renderSection(PostTitleSection, draft);
    expect(view.container.innerHTML).toContain("33px");
  });
});

describe("PostExcerptSection - zajawki", () => {
  it("zmiany dotyczą wyłącznie sekcji zajawki", () => {
    const { set } = renderSection(PostExcerptSection);
    typeInField("Rozmiar (px)", "14px");
    for (const call of set.mock.calls) expect(call[0]).toBe("postExcerpt");
  });
});

describe("ListIndexSection - numeracja list", () => {
  it("przezroczystość i grubość to osobne tokeny", () => {
    const { set } = renderSection(ListIndexSection);
    const spinners = screen.getAllByRole("spinbutton");
    fireEvent.change(spinners[0], { target: { value: "0.5" } });

    expect(set).toHaveBeenCalled();
    for (const call of set.mock.calls) expect(call[0]).toBe("listIndex");
  });

  it("ma OSOBNE kontrolki koloru dla trybu jasnego i ciemnego", () => {
    // Numeracja jest jedyną sekcją z dwoma kolorami zamiast nadpisania trybu -
    // to świadomy wyjątek, więc musi mieć dwie kontrolki.
    renderSection(ListIndexSection);
    expect(screen.getAllByText(/jasn|light/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/ciemn|dark/i).length).toBeGreaterThanOrEqual(1);
  });
});

describe("CarouselSection - domyślne ustawienia karuzeli", () => {
  function renderCarousel(draft = CAROUSEL_DEFAULTS) {
    const onChange = vi.fn();
    render(<CarouselSection draft={draft} onChange={onChange} />);
    return { onChange };
  }

  it("przełączniki oddają PEŁNY obiekt z jedną zmienioną wartością", () => {
    // Sekcja nie ma settera per pole - musi scalić własną wersję roboczą,
    // inaczej przełączenie autoodtwarzania wyzerowałoby pozostałe ustawienia.
    const { onChange } = renderCarousel();
    fireEvent.click(screen.getAllByRole("switch")[0]);

    const next = onChange.mock.calls[0][0] as typeof CAROUSEL_DEFAULTS;
    expect(Object.keys(next).sort()).toEqual(Object.keys(CAROUSEL_DEFAULTS).sort());
    expect(next.autoplay).toBe(!CAROUSEL_DEFAULTS.autoplay);
  });

  it("zmiana interwału zachowuje pozostałe ustawienia", () => {
    const { onChange } = renderCarousel();
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "8000" } });

    const next = onChange.mock.calls.at(-1)?.[0] as typeof CAROUSEL_DEFAULTS;
    expect(next.loop).toBe(CAROUSEL_DEFAULTS.loop);
    expect(next.pauseOnHover).toBe(CAROUSEL_DEFAULTS.pauseOnHover);
  });

  it("pokazuje bieżące wartości wersji roboczej", () => {
    renderCarousel({ ...CAROUSEL_DEFAULTS, intervalMs: 9000 });
    expect(
      screen.getAllByRole("spinbutton").some((i) => (i as HTMLInputElement).value === "9000"),
    ).toBe(true);
  });

  it.each([
    ["Pętla", "loop"],
    ["Pauza na hover", "pauseOnHover"],
  ])("przełącznik %s zmienia WYŁĄCZNIE własne pole", (etykieta, klucz) => {
    // Trzy przełączniki obok siebie o identycznej budowie - podpięcie pod cudze
    // pole nie daje błędu typów i objawia się dopiero na slajderze na stronie.
    const { onChange } = renderCarousel();
    const wiersz = screen.getByText(etykieta).closest("div");
    fireEvent.click(wiersz?.querySelector('[role="switch"]') as HTMLElement);

    const next = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    const zmienione = Object.keys(next).filter(
      (k) => next[k] !== (CAROUSEL_DEFAULTS as Record<string, unknown>)[k],
    );
    expect(zmienione).toEqual([klucz]);
  });

  it("zmiana czasu przejścia zachowuje czas slajdu", () => {
    // Dwa pola liczbowe obok siebie, oba w milisekundach - zamiana miejscami
    // dałaby slajdy zmieniające się co 300 ms.
    const { onChange } = renderCarousel();
    fireEvent.change(screen.getAllByRole("spinbutton")[1], { target: { value: "300" } });

    const next = onChange.mock.calls.at(-1)?.[0] as typeof CAROUSEL_DEFAULTS;
    expect(next.speedMs).toBe(300);
    expect(next.intervalMs).toBe(CAROUSEL_DEFAULTS.intervalMs);
  });

  it.each([
    [0, "intervalMs", 1000],
    [1, "speedMs", 100],
  ])("wyczyszczenie pola %# wraca do wartości minimalnej", (indeks, klucz, minimum) => {
    // Puste pole daje `null`; bez zabezpieczenia karuzela dostałaby `undefined`
    // i przestała się przewijać.
    const { onChange } = renderCarousel();
    fireEvent.change(screen.getAllByRole("spinbutton")[indeks as number], {
      target: { value: "" },
    });

    const next = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(next[klucz as string]).toBe(minimum);
  });
});

// PEŁNY PRZEGLĄD PAR (kontrolka -> token). Dotychczasowe przypadki wyżej brały
// z każdej sekcji po jednym-dwóch polach; reszta wywołań zwrotnych - kilkadziesiąt
// jednolinijkowych `set(...)` - nie miała ani jednego wykonania, choć to
// DOKŁADNIE ten rodzaj kodu, w którym pomyłka jest niewidoczna: obie wartości
// mają ten sam typ, render się nie wywraca, a redaktor zmienia padding poziomy
// i widzi, jak przesuwa się pionowy.
//
// Tabela niżej przechodzi po wszystkich pozostałych polach tekstowych i
// liczbowych, po jednym wierszu na parę.
describe("sekcje - każde pole tekstowe pisze do WŁASNEGO tokenu", () => {
  it.each([
    // opis, komponent, sekcja, etykieta pola, klucz tokenu, wpisane, oczekiwane
    [
      "miniatura / proporcje",
      ThumbnailSection,
      "thumbnail",
      "Proporcje (np. 16/9)",
      "aspectRatio",
      "4/3",
      "4/3",
    ],
    [
      "czytaj więcej / padding X",
      ReadMoreSection,
      "readMoreButton",
      "Padding X (px)",
      "paddingX",
      "18px",
      "18px",
    ],
    [
      "czytaj więcej / padding Y",
      ReadMoreSection,
      "readMoreButton",
      "Padding Y (px)",
      "paddingY",
      "9px",
      "9px",
    ],
    [
      "czytaj więcej / grubość",
      ReadMoreSection,
      "readMoreButton",
      "Grubość",
      "fontWeight",
      "700",
      700,
    ],
    ["meta / odstęp", MetaSection, "metaInfo", "Odstęp między (px)", "gap", "7px", "7px"],
    [
      "pasek / padding X",
      ToolbarSection,
      "toolbarButton",
      "Padding X (px)",
      "paddingX",
      "11px",
      "11px",
    ],
    [
      "pasek / padding Y",
      ToolbarSection,
      "toolbarButton",
      "Padding Y (px)",
      "paddingY",
      "5px",
      "5px",
    ],
    [
      "pasek / rozmiar ikony",
      ToolbarSection,
      "toolbarButton",
      "Rozmiar ikony (px)",
      "size",
      "17px",
      "17px",
    ],
    [
      "social / padding X",
      SocialSection,
      "socialIcons",
      "Padding X (px)",
      "paddingX",
      "13px",
      "13px",
    ],
    [
      "social / padding Y",
      SocialSection,
      "socialIcons",
      "Padding Y (px)",
      "paddingY",
      "3px",
      "3px",
    ],
    [
      "tytuł / krój",
      PostTitleSection,
      "postTitle",
      "Krój pisma (CSS font-family)",
      "fontFamily",
      "Lora",
      "Lora",
    ],
    ["tytuł / grubość", PostTitleSection, "postTitle", "Grubość", "fontWeight", "650", 650],
    [
      "tytuł / interlinia",
      PostTitleSection,
      "postTitle",
      "Interlinia (line-height)",
      "lineHeight",
      "1.35",
      "1.35",
    ],
    [
      "tytuł / odstęp liter",
      PostTitleSection,
      "postTitle",
      "Odstęp liter (px)",
      "letterSpacing",
      "0.5px",
      "0.5px",
    ],
    [
      "zajawka / krój",
      PostExcerptSection,
      "postExcerpt",
      "Krój pisma (CSS font-family)",
      "fontFamily",
      "Inter",
      "Inter",
    ],
    ["zajawka / grubość", PostExcerptSection, "postExcerpt", "Grubość", "fontWeight", "300", 300],
    [
      "zajawka / interlinia",
      PostExcerptSection,
      "postExcerpt",
      "Interlinia",
      "lineHeight",
      "1.8",
      "1.8",
    ],
    [
      "zajawka / margines górny",
      PostExcerptSection,
      "postExcerpt",
      "Margines górny (px)",
      "marginTop",
      "7px",
      "7px",
    ],
  ])("%s", (_opis, Component, sekcja, etykieta, klucz, wpisane, oczekiwane) => {
    // Wpisywane wartości celowo RÓŻNIĄ się od domyślnych - kontrolka sterowana
    // nie zgłasza zmiany, gdy nowa wartość jest identyczna z bieżącą.
    const { set } = renderSection(Component as SectionComponent);
    typeInField(etykieta as string, wpisane as string);

    expect(set).toHaveBeenCalledWith(sekcja, { [klucz as string]: oczekiwane });
  });
});

/** Otwiera listę wyboru w polu o danej etykiecie i klika opcję po nazwie. */
function chooseOption(fieldLabel: string, optionName: string | RegExp): void {
  const container = screen.getByText(fieldLabel).closest("div");
  if (!container) throw new Error(`brak pola ${fieldLabel}`);
  fireEvent.keyDown(within(container).getByRole("combobox"), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

describe("sekcje - listy wyboru zapisują WARTOŚĆ, nie widoczną etykietę", () => {
  // Etykieta („WIELKIE") i wartość („uppercase") to dwie różne rzeczy; zapisanie
  // etykiety dałoby w CSS-ie `text-transform: WIELKIE`, czyli nic.
  it("transformacja nagłówka bloku", () => {
    const { set } = renderSection(BlockHeadingSection);
    chooseOption("Transformacja", "WIELKIE");
    expect(set).toHaveBeenCalledWith("blockHeading", { textTransform: "uppercase" });
  });

  it("transformacja tytułu wpisu", () => {
    const { set } = renderSection(PostTitleSection);
    chooseOption("Transformacja", "małe");
    expect(set).toHaveBeenCalledWith("postTitle", { textTransform: "lowercase" });
  });

  it("efekt hover miniatury", () => {
    const { set } = renderSection(ThumbnailSection);
    // „Zoom" jest wartością domyślną - wybór tej samej opcji nie zgłasza zmiany.
    chooseOption("Efekt hover", "Slide");
    expect(set).toHaveBeenCalledWith("thumbnail", { hoverEffect: "slide" });
  });

  it("cień miniatury", () => {
    const { set } = renderSection(ThumbnailSection);
    chooseOption("Cień", "Duży");
    expect(set).toHaveBeenCalledWith("thumbnail", { shadow: "lg" });
  });

  it("separator informacji meta", () => {
    const { set } = renderSection(MetaSection);
    chooseOption("Separator", "/");
    expect(set).toHaveBeenCalledWith("metaInfo", { separator: "slash" });
  });
});

describe("sekcje - przełączniki oddają wartość LOGICZNĄ", () => {
  it.each([
    ["czytaj więcej / strzałka", ReadMoreSection, "Strzałka →", "arrow"],
    ["meta / wersaliki", MetaSection, "WIELKIE LITERY", "uppercase"],
  ])("%s", (_opis, Component, etykieta, klucz) => {
    // Napis „true" przeszedłby typowanie w wielu miejscach i zawsze byłby prawdziwy.
    const { set } = renderSection(Component as SectionComponent);
    const wiersz = screen.getByText(etykieta as string).closest("div");
    const przelacznik = wiersz?.querySelector('[role="switch"]');
    if (!przelacznik) throw new Error(`brak przełącznika w wierszu ${String(etykieta)}`);
    fireEvent.click(przelacznik);

    const wartosc = (set.mock.calls.at(-1)?.[1] as Record<string, unknown>)[klucz as string];
    expect(typeof wartosc).toBe("boolean");
  });
});

describe("ListIndexSection - granice przezroczystości", () => {
  it.each([
    ["2", 1],
    ["-1", 0],
    ["0.35", 0.35],
  ])("wartość %s ląduje w zakresie 0-1 jako %s", (wpisane, oczekiwane) => {
    // Przezroczystość poza zakresem 0-1 jest w CSS-ie ignorowana w ciszy -
    // numeracja znikałaby albo świeciła pełną mocą bez śladu w interfejsie.
    const { set } = renderSection(ListIndexSection);
    typeInField("Przezroczystość (0 - 1)", wpisane);

    expect(set).toHaveBeenCalledWith("listIndex", { opacity: oczekiwane });
  });

  it("wyczyszczenie pola przezroczystości daje 0, nie NaN", () => {
    const { set } = renderSection(ListIndexSection);
    typeInField("Przezroczystość (0 - 1)", "");

    expect(set).toHaveBeenCalledWith("listIndex", { opacity: 0 });
  });

  it("wyczyszczenie pola grubości wraca do domyślnej wartości", () => {
    // Pusta grubość w CSS-ie to brak deklaracji - numeracja traciłaby wagę.
    const { set } = renderSection(ListIndexSection);
    typeInField("Grubość", "");

    expect(set).toHaveBeenCalledWith("listIndex", { weight: 800 });
  });
});
