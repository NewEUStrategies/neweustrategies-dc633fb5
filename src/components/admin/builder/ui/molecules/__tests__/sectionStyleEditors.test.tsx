// Edytory stylu sekcji i kolumny: tło, nakładka, ramka, przerywnik kształtu,
// typografia i animacja wejścia. Wszystkie mają ten sam kontrakt zapisu
// (`onChange(mut)`) i wszystkie sterują WIDOCZNOŚCIĄ własnych pól typem
// wybranym wyżej - to właśnie ta zależność jest tu przypięta:
//   * tło „gradient” nie może pokazywać pola adresu obrazka (i odwrotnie),
//   * kąt gradientu ma sens tylko dla gradientu liniowego,
//   * pola ramki pojawiają się dopiero, gdy ramka nie jest „none”.
// Pomyłka w tych warunkach nie wywala niczego - po prostu redaktor ustawia
// wartość, która nigdy nie trafia do CSS.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type {
  AdvancedSettings,
  BackgroundSettings,
  BorderSettings,
  OverlaySettings,
  ShapeDividerSettings,
  TypographySettings,
} from "@/lib/builder/types";
import { MutableHost, selectWithOption, optionValues } from "@/test/builder/panels";
import { BackgroundEditor } from "../BackgroundEditor";
import { BorderEditor } from "../BorderEditor";
import { OverlayEditor } from "../OverlayEditor";
import { ShapeEditor } from "../ShapeEditor";
import { TypographyEditor } from "../TypographyEditor";
import { MotionControl } from "../MotionControl";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(React);
});

/** Pola tekstowe pickera kolorów - w tych edytorach jedyne z `font-mono`. */
const colorInputs = (): HTMLInputElement[] =>
  Array.from(document.querySelectorAll<HTMLInputElement>("input.font-mono"));

const numberInput = (index: number): HTMLInputElement => {
  const all = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"]'));
  const found = all[index];
  if (!found) throw new Error(`test: brak pola liczbowego #${index}`);
  return found;
};

describe("BackgroundEditor - typ tła rządzi widocznością pól", () => {
  function renderBg(initial: BackgroundSettings = {}) {
    const applied: BackgroundSettings[] = [];
    render(
      <MutableHost<BackgroundSettings> initial={initial} onApplied={(n) => applied.push(n)}>
        {(value, apply) => <BackgroundEditor value={value} onChange={apply} />}
      </MutableHost>,
    );
    return { last: () => applied.at(-1) };
  }

  it("oferuje pełną listę typów tła", () => {
    renderBg();
    expect(optionValues(selectWithOption("slideshow"))).toEqual([
      "none",
      "classic",
      "gradient",
      "video",
      "slideshow",
    ]);
  });

  it("brak typu to none i żadnych dodatkowych pól", () => {
    renderBg();
    expect(selectWithOption("slideshow").value).toBe("none");
    expect(screen.queryByText("builder.common.color")).toBeNull();
    expect(screen.queryByText("builder.background.imageUrl")).toBeNull();
  });

  it("zapisuje wybrany typ", () => {
    const { last } = renderBg();
    fireEvent.change(selectWithOption("slideshow"), { target: { value: "gradient" } });
    expect(last()?.type).toBe("gradient");
  });

  it.each([
    ["classic", true, true, false, false],
    ["gradient", false, false, true, false],
    ["video", true, false, false, true],
    ["slideshow", true, false, false, false],
    ["none", false, false, false, false],
  ] as const)(
    "typ %s pokazuje właściwy zestaw pól",
    (type, hasColor, hasImage, hasGradient, hasVideo) => {
      renderBg({ type });
      expect(screen.queryByText("builder.common.color") !== null).toBe(hasColor);
      expect(screen.queryByText("builder.background.imageUrl") !== null).toBe(hasImage);
      expect(screen.queryByText("builder.background.gradientType") !== null).toBe(hasGradient);
      expect(screen.queryByText("builder.background.videoUrl") !== null).toBe(hasVideo);
    },
  );

  it("tło klasyczne: adres obrazka, pozycja, powtarzanie, rozmiar, przyczepienie", () => {
    const { last } = renderBg({ type: "classic" });
    const url = document.querySelector<HTMLInputElement>('input[placeholder="https://…"]');
    if (!url) throw new Error("test: brak pola adresu obrazka");
    fireEvent.change(url, { target: { value: "https://cdn.test/bg.jpg" } });
    expect(last()?.imageUrl).toBe("https://cdn.test/bg.jpg");
    fireEvent.change(url, { target: { value: "" } });
    expect(last()?.imageUrl).toBeUndefined();

    fireEvent.change(selectWithOption("bottom right"), { target: { value: "top left" } });
    expect(last()?.position).toBe("top left");
    fireEvent.change(selectWithOption("repeat-x"), { target: { value: "repeat" } });
    expect(last()?.repeat).toBe("repeat");
    fireEvent.change(selectWithOption("contain"), { target: { value: "contain" } });
    expect(last()?.size).toBe("contain");
    fireEvent.change(selectWithOption("fixed"), { target: { value: "fixed" } });
    expect(last()?.attachment).toBe("fixed");
  });

  it("tło klasyczne zapisuje kolor podkładu", () => {
    const { last } = renderBg({ type: "classic" });
    fireEvent.change(colorInputs()[0], { target: { value: "#0b0b0b" } });
    // Kolor podkładu widać, dopóki obrazek się nie wczyta - i przez niego,
    // gdy obrazek jest przezroczysty. Dlatego jest dostępny także dla wideo.
    expect(last()?.color).toBe("#0b0b0b");
  });

  it("tło klasyczne ma domyślne wartości list, gdy zapis ich nie ma", () => {
    renderBg({ type: "classic" });
    expect(selectWithOption("bottom right").value).toBe("center center");
    expect(selectWithOption("repeat-x").value).toBe("no-repeat");
    expect(selectWithOption("contain").value).toBe("cover");
    expect(selectWithOption("fixed").value).toBe("scroll");
  });

  it("tło klasyczne czyta zapisane wartości list", () => {
    renderBg({
      type: "classic",
      position: "top right",
      repeat: "repeat-y",
      size: "auto",
      attachment: "fixed",
    });
    expect(selectWithOption("bottom right").value).toBe("top right");
    expect(selectWithOption("repeat-x").value).toBe("repeat-y");
    expect(selectWithOption("contain").value).toBe("auto");
    expect(selectWithOption("fixed").value).toBe("fixed");
  });

  it("gradient: dwa kolory, dwie lokalizacje i kąt tylko dla liniowego", () => {
    const { last } = renderBg({ type: "gradient" });
    expect(screen.getByText("builder.background.angle")).toBeInTheDocument();
    fireEvent.change(colorInputs()[0], { target: { value: "#111111" } });
    expect(last()?.gradientColor).toBe("#111111");
    fireEvent.change(colorInputs()[1], { target: { value: "#222222" } });
    expect(last()?.gradientColor2).toBe("#222222");
    fireEvent.change(numberInput(0), { target: { value: "10" } });
    expect(last()?.gradientLocation).toBe(10);
    fireEvent.change(numberInput(1), { target: { value: "90" } });
    expect(last()?.gradientLocation2).toBe(90);
    fireEvent.change(numberInput(2), { target: { value: "45" } });
    expect(last()?.gradientAngle).toBe(45);
  });

  it("gradient radialny ukrywa kąt", () => {
    const { last } = renderBg({ type: "gradient" });
    fireEvent.change(selectWithOption("radial"), { target: { value: "radial" } });
    expect(last()?.gradientType).toBe("radial");
    // Kąt w gradiencie promienistym nic nie znaczy - pole musi zniknąć,
    // inaczej redaktor ustawia wartość bez żadnego efektu.
    expect(screen.queryByText("builder.background.angle")).toBeNull();
  });

  it("wideo: zapis i czyszczenie adresu", () => {
    const { last } = renderBg({ type: "video" });
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input.h-8"));
    const videoUrl = inputs.at(-1);
    if (!videoUrl) throw new Error("test: brak pola adresu wideo");
    fireEvent.change(videoUrl, { target: { value: "https://cdn.test/v.mp4" } });
    expect(last()?.videoUrl).toBe("https://cdn.test/v.mp4");
    fireEvent.change(videoUrl, { target: { value: "" } });
    expect(last()?.videoUrl).toBeUndefined();
  });

  it("pokaz slajdów: lista adresów z pola wieloliniowego", () => {
    const { last } = renderBg({ type: "slideshow", slideshowImages: ["a.jpg"] });
    const area = document.querySelector("textarea");
    if (!area) throw new Error("test: brak pola listy obrazków");
    expect((area as HTMLTextAreaElement).value).toBe("a.jpg");
    fireEvent.change(area, { target: { value: " a.jpg \n\n b.jpg \n" } });
    // Puste linie i spacje muszą wypaść - inaczej renderer dostaje pusty
    // adres i przeglądarka strzela żądaniem po samą stronę.
    expect(last()?.slideshowImages).toEqual(["a.jpg", "b.jpg"]);
  });
});

describe("edytory bez żadnego zapisu", () => {
  // Wszystkie te edytory dostają `value` z dokumentu, w którym danej sekcji
  // ustawień MOŻE NIE BYĆ (nowa sekcja, świeży widget). Gałąź `value ?? {}`
  // jest więc stanem startowym każdej nowej sekcji, nie przypadkiem brzegowym.
  it("tło bez zapisu renderuje się na wartościach domyślnych", () => {
    render(<BackgroundEditor value={undefined} onChange={vi.fn()} />);
    expect(selectWithOption("slideshow").value).toBe("none");
  });

  it("ramka bez zapisu renderuje się na wartościach domyślnych", () => {
    render(<BorderEditor value={undefined} onChange={vi.fn()} />);
    expect(selectWithOption("groove").value).toBe("none");
  });

  it("nakładka bez zapisu nie pokazuje pól nakładki", () => {
    render(<OverlayEditor value={undefined} onChange={vi.fn()} />);
    expect(screen.queryByText("builder.overlay.opacity")).toBeNull();
  });

  it("przerywnik bez zapisu renderuje się na wartościach domyślnych", () => {
    render(<ShapeEditor value={undefined} onChange={vi.fn()} />);
    expect(selectWithOption("waves").value).toBe("none");
  });

  it("typografia bez zapisu ma cztery puste pola kolorów i lewe wyrównanie", () => {
    render(<TypographyEditor value={undefined} device="desktop" onChange={vi.fn()} />);
    expect(colorInputs().map((i) => i.value)).toEqual(["", "", "", ""]);
    expect(selectWithOption("center").value).toBe("left");
  });

  it("animacja bez zapisu ma brak efektu i włączone odtwarzanie raz", () => {
    render(<MotionControl value={undefined} onChange={vi.fn()} />);
    expect(selectWithOption("rubber").value).toBe("none");
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
});

describe("BorderEditor", () => {
  function renderBorder(initial: BorderSettings = {}) {
    const applied: BorderSettings[] = [];
    render(
      <MutableHost<BorderSettings> initial={initial} onApplied={(n) => applied.push(n)}>
        {(value, apply) => <BorderEditor value={value} onChange={apply} />}
      </MutableHost>,
    );
    return { last: () => applied.at(-1) };
  }

  it("oferuje pełną listę stylów ramki", () => {
    renderBorder();
    expect(optionValues(selectWithOption("groove"))).toEqual([
      "none",
      "solid",
      "dashed",
      "dotted",
      "double",
      "groove",
    ]);
  });

  it("bez ramki nie pokazuje grubości ani koloru", () => {
    renderBorder();
    expect(screen.queryByText("builder.border.width")).toBeNull();
    expect(screen.queryByText("builder.common.color")).toBeNull();
    // Promień i cień są niezależne od stylu ramki - one zostają.
    expect(screen.getByText("builder.border.radius")).toBeInTheDocument();
    expect(screen.getByText("builder.border.shadow")).toBeInTheDocument();
  });

  it("wybór stylu pokazuje grubość i kolor", () => {
    const { last } = renderBorder();
    fireEvent.change(selectWithOption("groove"), { target: { value: "dashed" } });
    expect(last()?.style).toBe("dashed");
    expect(screen.getByText("builder.border.width")).toBeInTheDocument();
    expect(screen.getByText("builder.common.color")).toBeInTheDocument();
  });

  it("zapisuje grubość, kolor, promień i cień", () => {
    const { last } = renderBorder({ style: "solid" });
    const sides = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    fireEvent.change(sides[0], { target: { value: "2" } });
    expect(last()?.width).toEqual({ top: 2 });
    fireEvent.change(colorInputs()[0], { target: { value: "#333333" } });
    expect(last()?.color).toBe("#333333");
    // Promień to druga grupa czterech pól liczbowych.
    fireEvent.change(sides[4], { target: { value: "8" } });
    expect(last()?.radius).toEqual({ top: 8 });
    const shadow = document.querySelector<HTMLInputElement>("input.font-mono:not([value])");
    const shadowField = shadow ?? colorInputs().at(-1);
    if (!shadowField) throw new Error("test: brak pola cienia");
    fireEvent.change(shadowField, { target: { value: "0 2px 8px #000" } });
    expect(last()?.boxShadow).toBe("0 2px 8px #000");
    fireEvent.change(shadowField, { target: { value: "" } });
    expect(last()?.boxShadow).toBeUndefined();
  });
});

describe("OverlayEditor", () => {
  function renderOverlay(initial: OverlaySettings = {}) {
    const applied: OverlaySettings[] = [];
    render(
      <MutableHost<OverlaySettings> initial={initial} onApplied={(n) => applied.push(n)}>
        {(value, apply) => <OverlayEditor value={value} onChange={apply} />}
      </MutableHost>,
    );
    return { last: () => applied.at(-1) };
  }

  it("bez typu nakładki nie pokazuje krycia ani trybu mieszania", () => {
    renderOverlay();
    expect(screen.queryByText("builder.overlay.opacity")).toBeNull();
    expect(screen.queryByText("builder.overlay.blendMode")).toBeNull();
  });

  it.each([["none"], ["classic"]] as const)("typ %s decyduje o polach nakładki", (type) => {
    renderOverlay({ type });
    const visible = type !== "none";
    expect(screen.queryByText("builder.overlay.opacity") !== null).toBe(visible);
  });

  it("zapisuje krycie i tryb mieszania", () => {
    const { last } = renderOverlay({ type: "classic" });
    fireEvent.change(numberInput(0), { target: { value: "0.4" } });
    expect(last()?.opacity).toBe(0.4);
    fireEvent.change(selectWithOption("luminosity"), { target: { value: "multiply" } });
    expect(last()?.blendMode).toBe("multiply");
  });

  it("domyślny tryb mieszania to normal", () => {
    renderOverlay({ type: "classic" });
    expect(selectWithOption("luminosity").value).toBe("normal");
    expect(optionValues(selectWithOption("luminosity"))).toHaveLength(13);
  });
});

describe("ShapeEditor", () => {
  function renderShape(initial: ShapeDividerSettings = {}) {
    const applied: ShapeDividerSettings[] = [];
    render(
      <MutableHost<ShapeDividerSettings> initial={initial} onApplied={(n) => applied.push(n)}>
        {(value, apply) => <ShapeEditor value={value} onChange={apply} />}
      </MutableHost>,
    );
    return { last: () => applied.at(-1) };
  }

  it("bez kształtu nie pokazuje żadnych ustawień", () => {
    renderShape();
    expect(selectWithOption("waves").value).toBe("none");
    expect(screen.queryByText("builder.shape.height")).toBeNull();
    expect(optionValues(selectWithOption("waves"))).toHaveLength(13);
  });

  it("wybór kształtu odsłania kolor, wysokość, szerokość i przełączniki", () => {
    const { last } = renderShape();
    fireEvent.change(selectWithOption("waves"), { target: { value: "waves" } });
    expect(last()?.type).toBe("waves");
    expect(screen.getByText("builder.shape.height")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("zapisuje kolor, wysokość i szerokość", () => {
    const { last } = renderShape({ type: "waves" });
    fireEvent.change(colorInputs()[0], { target: { value: "#0a0a0a" } });
    expect(last()?.color).toBe("#0a0a0a");
    fireEvent.change(numberInput(0), { target: { value: "120" } });
    expect(last()?.height).toBe(120);
    fireEvent.change(numberInput(1), { target: { value: "150" } });
    expect(last()?.width).toBe(150);
  });

  it.each([
    ["odbicie w poziomie", 0, "flipH"],
    ["odwrócenie", 1, "flipV"],
    ["na wierzch", 2, "bringToFront"],
  ] as const)("przełącza %s", (_label, index, key) => {
    const { last } = renderShape({ type: "waves" });
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[index]);
    expect(last()?.[key]).toBe(true);
  });

  it("przełącznik wyłącza się z powrotem", () => {
    const { last } = renderShape({ type: "waves", flipH: true });
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(last()?.flipH).toBe(false);
  });
});

describe("TypographyEditor", () => {
  function renderTypo(initial: TypographySettings = {}, device: "desktop" | "mobile" = "desktop") {
    const applied: TypographySettings[] = [];
    render(
      <MutableHost<TypographySettings> initial={initial} onApplied={(n) => applied.push(n)}>
        {(value, apply) => <TypographyEditor value={value} device={device} onChange={apply} />}
      </MutableHost>,
    );
    return { last: () => applied.at(-1) };
  }

  it.each([
    ["nagłówek", 0, "headingColor"],
    ["tekst", 1, "textColor"],
    ["link", 2, "linkColor"],
    ["link pod kursorem", 3, "linkHoverColor"],
  ] as const)("zapisuje kolor: %s", (_label, index, key) => {
    const { last } = renderTypo();
    fireEvent.change(colorInputs()[index], { target: { value: "#abcdef" } });
    expect(last()?.[key]).toBe("#abcdef");
  });

  it("pierwsze wyrównanie zakłada obiekt zapisu", () => {
    const { last } = renderTypo();
    fireEvent.change(selectWithOption("center"), { target: { value: "center" } });
    // `x.align ?? {}` - dokument bez klucza `align` nie może wywalić zapisu.
    expect(last()?.align).toEqual({ desktop: "center" });
  });

  it("wyrównanie zapisuje się PER URZĄDZENIE", () => {
    const { last } = renderTypo({ align: { desktop: "center" } }, "mobile");
    fireEvent.change(selectWithOption("center"), { target: { value: "right" } });
    // Zapis mobilny NIE MOŻE zdeptać ustawienia desktopu - inaczej edycja
    // widoku telefonu przestawia stronę na komputerze.
    expect(last()?.align).toEqual({ desktop: "center", mobile: "right" });
  });

  it("domyślne wyrównanie to lewa, a etykieta niesie urządzenie", () => {
    renderTypo({}, "mobile");
    expect(selectWithOption("center").value).toBe("left");
    expect(screen.getByText("builder.typography.align(device=mobile)")).toBeInTheDocument();
  });

  it("czyta wyrównanie zapisane dla bieżącego urządzenia", () => {
    renderTypo({ align: { desktop: "right" } });
    expect(selectWithOption("center").value).toBe("right");
  });
});

describe("MotionControl", () => {
  function renderMotion(initial: AdvancedSettings = {}) {
    const applied: AdvancedSettings[] = [];
    render(
      <MutableHost<AdvancedSettings> initial={initial} onApplied={(n) => applied.push(n)}>
        {(value, apply) => <MotionControl value={value} onChange={apply} />}
      </MutableHost>,
    );
    return { last: () => applied.at(-1) };
  }

  it("oferuje dwadzieścia presetów i siedem krzywych", () => {
    renderMotion();
    expect(optionValues(selectWithOption("rubber"))).toHaveLength(20);
    expect(optionValues(selectWithOption("spring"))).toHaveLength(7);
  });

  it("domyślnie brak animacji i krzywa ease-out", () => {
    renderMotion();
    expect(selectWithOption("rubber").value).toBe("none");
    expect(selectWithOption("spring").value).toBe("ease-out");
    // Etykiety domyślnych opcji są tłumaczone, pozostałe zostają angielskie
    // (nazwy własne efektów) - to celowa asymetria katalogu presetów.
    expect(screen.getByText("builder.motion.presetNone")).toBeInTheDocument();
    expect(screen.getByText("builder.motion.easingEaseOutDefault")).toBeInTheDocument();
  });

  it("zapisuje preset i krzywą", () => {
    const { last } = renderMotion();
    fireEvent.change(selectWithOption("rubber"), { target: { value: "zoom" } });
    expect(last()?.animation).toBe("zoom");
    fireEvent.change(selectWithOption("spring"), { target: { value: "spring" } });
    expect(last()?.animationEasing).toBe("spring");
  });

  it.each([
    ["fade", false],
    ["slide-up", true],
    ["slide-down", true],
    ["slide-left", true],
    ["slide-right", true],
    ["bounce", true],
    ["reveal-up", true],
    ["reveal-down", true],
    ["zoom", false],
    ["none", false],
  ] as const)("pole dystansu dla presetu %s", (animation, visible) => {
    renderMotion({ animation });
    // Dystans ma sens tylko dla efektów, które CZYMŚ przesuwają element.
    expect(screen.queryByText("builder.motion.distance") !== null).toBe(visible);
  });

  it("zapisuje czas trwania, opóźnienie i dystans", () => {
    const { last } = renderMotion({ animation: "slide-up" });
    fireEvent.change(numberInput(0), { target: { value: "800" } });
    expect(last()?.animationDuration).toBe(800);
    fireEvent.change(numberInput(1), { target: { value: "150" } });
    expect(last()?.animationDelay).toBe(150);
    fireEvent.change(numberInput(2), { target: { value: "48" } });
    expect(last()?.animationDistance).toBe(48);
  });

  it.each([
    ["czas trwania", 0, "animationDuration"],
    ["opóźnienie", 1, "animationDelay"],
    ["dystans", 2, "animationDistance"],
  ] as const)("odrzuca wartość ujemną: %s", (_label, index, key) => {
    const { last } = renderMotion({ animation: "slide-up" });
    fireEvent.change(numberInput(index), { target: { value: "-1" } });
    expect(last()?.[key]).toBeUndefined();
  });

  it("wyczyszczenie pola czasu zapisuje zero - ten sam wzorzec co w HoverControl", () => {
    // Kontrola dodatnia do udokumentowanego błędu (`Number("") === 0`):
    // przypina stan faktyczny, więc naprawa w produkcji od razu tu zaświeci.
    const { last } = renderMotion({ animation: "fade", animationDuration: 600 });
    fireEvent.change(numberInput(0), { target: { value: "" } });
    expect(last()?.animationDuration).toBe(0);
  });

  it("odtwarzanie raz jest domyślnie włączone i daje się wyłączyć", () => {
    const { last } = renderMotion();
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    // `animationOnce !== false` - brak zapisu znaczy „raz”, nie „w kółko”.
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(last()?.animationOnce).toBe(false);
  });

  it("wyłączone odtwarzanie raz daje się włączyć", () => {
    const { last } = renderMotion({ animationOnce: false });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(last()?.animationOnce).toBe(true);
  });
});
