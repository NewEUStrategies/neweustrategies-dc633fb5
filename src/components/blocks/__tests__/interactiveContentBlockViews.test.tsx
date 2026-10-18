// Interaktywne widoki bloków treści: suwak przed/po (CompareSlider), blok kodu
// z kopiowaniem (CodeBlockView) i FAQ z danymi strukturalnymi (FaqBlockView).
//
// Co dowodzimy i dlaczego:
//   * suwak jest prawdziwym `role="slider"`: klawiatura i wskaźnik przesuwają
//     go w granicach 0-100, a przeciąganie działa tylko między down i up/cancel;
//     element bez szerokości nie ogłasza „NaN" (naprawione);
//   * kod renderuje się jako tekst (bez innerHTML), etykieta języka jest
//     znormalizowana, a kopiowanie pisze DOKŁADNIE kod do schowka i wraca do
//     etykiety po 2 s - ponowne kopiowanie odnawia odliczanie (naprawione);
//   * FAQ: tylko kompletne pary pytanie/odpowiedź, jedna otwarta naraz, a JSON-LD
//     FAQPage niesie tekst bez znaczników i nie da się z niego wyjść ze `<script>`.
//
// Granice: `navigator.clipboard` (API przeglądarki) i geometria
// `getBoundingClientRect` (happy-dom nie liczy layoutu) - nic więcej. Timery
// sztuczne tylko tam, gdzie mierzymy odliczanie. Integracja z rendererem idzie
// przez publiczny `BlocksRenderer` (prawdziwe i18n).
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { CompareSlider } from "../CompareSlider";
import { CodeBlockView } from "../CodeBlockView";
import { FaqBlockView } from "../FaqBlockView";
import { BlocksRenderer } from "../BlocksRenderer";

const doc = (blocks: Block[]): BlocksDoc => ({ version: 1, blocks });

describe("CompareSlider", () => {
  const IMG_A = "https://cdn.example.com/przed.jpg";
  const IMG_B = "https://cdn.example.com/po.jpg";

  function slider(rect = { left: 100, width: 200 }) {
    const view = render(
      <CompareSlider before={IMG_A} after={IMG_B} labelBefore="2020" labelAfter="2025" />,
    );
    const el = view.getByRole("slider", { name: "2020 / 2025" });
    el.getBoundingClientRect = () =>
      ({ left: rect.left, width: rect.width, top: 0, height: 100 }) as DOMRect;
    return { ...view, el };
  }

  it("startuje w połowie, a obrazy mają etykiety jako tekst alternatywny", () => {
    const { el, getByAltText } = slider();
    expect(el.getAttribute("aria-valuenow")).toBe("50");
    expect(el.getAttribute("aria-valuemin")).toBe("0");
    expect(el.getAttribute("aria-valuemax")).toBe("100");
    expect(getByAltText("2020").getAttribute("src")).toBe(IMG_A);
    expect(getByAltText("2025").getAttribute("src")).toBe(IMG_B);
  });

  it("strzałki przesuwają o 2 punkty i zatrzymują się na krańcach 0 i 100", () => {
    const { el } = slider();
    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(el.getAttribute("aria-valuenow")).toBe("52");
    for (let i = 0; i < 40; i++) fireEvent.keyDown(el, { key: "ArrowLeft" });
    expect(el.getAttribute("aria-valuenow")).toBe("0");
    for (let i = 0; i < 60; i++) fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(el.getAttribute("aria-valuenow")).toBe("100");
    fireEvent.keyDown(el, { key: "Enter" });
    expect(el.getAttribute("aria-valuenow")).toBe("100");
  });

  it("wskaźnik ustawia pozycję od lewej krawędzi i przeciąga tylko między down a up", () => {
    const { el, getByAltText } = slider();
    fireEvent.pointerDown(el, { clientX: 150, pointerId: 1 });
    expect(el.getAttribute("aria-valuenow")).toBe("25");
    // Warstwa „przed" jest przycięta do pozycji suwaka.
    expect((getByAltText("2020").parentElement as HTMLElement).style.width).toBe("25%");
    fireEvent.pointerMove(el, { clientX: 400 });
    expect(el.getAttribute("aria-valuenow")).toBe("100");
    fireEvent.pointerUp(el);
    fireEvent.pointerMove(el, { clientX: 120 });
    expect(el.getAttribute("aria-valuenow")).toBe("100");
  });

  it("anulowanie wskaźnika kończy przeciąganie, a ruch bez wciśnięcia nic nie zmienia", () => {
    const { el } = slider();
    fireEvent.pointerMove(el, { clientX: 290 });
    expect(el.getAttribute("aria-valuenow")).toBe("50");
    fireEvent.pointerDown(el, { clientX: 50 });
    expect(el.getAttribute("aria-valuenow")).toBe("0");
    fireEvent.pointerCancel(el);
    fireEvent.pointerMove(el, { clientX: 250 });
    expect(el.getAttribute("aria-valuenow")).toBe("0");
  });

  it("NAPRAWIONE 2026-10-18: element bez szerokości nie zamienia pozycji w NaN", () => {
    // WEJŚCIE: kontener ukryty (szerokość 0) dostaje pointerdown. Przed
    // poprawką 0/0 dawało `aria-valuenow="NaN"` i szerokość warstwy „NaN%".
    const { el, getByAltText } = slider({ left: 0, width: 0 });
    fireEvent.pointerDown(el, { clientX: 10 });
    expect(el.getAttribute("aria-valuenow")).toBe("50");
    expect((getByAltText("2020").parentElement as HTMLElement).style.width).toBe("50%");
  });

  it("w rendererze: etykiety domyślne z i18n, a niebezpieczny adres obrazu ukrywa blok", () => {
    const { getByRole, queryAllByRole } = render(
      <BlocksRenderer
        doc={doc([
          { id: "a", type: "compare", data: { before: IMG_A, after: IMG_B } },
          { id: "b", type: "compare", data: { before: "javascript:alert(1)", after: IMG_B } },
          { id: "c", type: "compare", data: { before: IMG_A } },
        ])}
      />,
    );
    expect(getByRole("slider", { name: "Przed / Po" })).toBeTruthy();
    // NAPRAWIONE 2026-10-18: `before`/`after` szły surowo do <img src>.
    expect(queryAllByRole("slider")).toHaveLength(1);
  });
});

describe("CodeBlockView", () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else Reflect.deleteProperty(navigator, "clipboard");
  });

  it("pokazuje kod jako tekst (znaczniki nie stają się elementami)", () => {
    const code = 'const tag = "<b>gruby</b>";\n// koniec';
    const { container } = render(<CodeBlockView code={code} lang="ts" />);
    const el = container.querySelector("code");
    expect(el?.textContent).toBe(code);
    expect(el?.querySelector("b")).toBeNull();
    expect(el?.getAttribute("data-lang")).toBe("ts");
  });

  it("normalizuje etykietę języka: znany -> małe litery, nieznany bez zmian, brak -> text", () => {
    const label = (lang: string) =>
      render(<CodeBlockView code="x" lang={lang} />).container.querySelector(".code-block-lang")
        ?.textContent;
    expect(label(" TS ")).toBe("ts");
    expect(label("COBOL")).toBe("COBOL");
    expect(label("")).toBe("text");
  });

  it("kopiuje dokładnie kod i po 2 s wraca do etykiety przycisku (pl/en)", async () => {
    vi.useFakeTimers();
    const { getByRole } = render(<CodeBlockView code={"SELECT 1;"} lang="sql" uiLang="en" />);
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Copy code" }));
    });
    expect(writeText).toHaveBeenCalledWith("SELECT 1;");
    expect(getByRole("button", { name: "Copied" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(getByRole("button", { name: "Copy code" })).toBeTruthy();
  });

  it("NAPRAWIONE 2026-10-18: ponowne kopiowanie odnawia 2 s, a odmontowanie sprząta timer", async () => {
    // Przed poprawką timer pierwszego kliknięcia gasił „Skopiowano" 500 ms po
    // drugim kliknięciu, a zaległy timer przeżywał odmontowanie bloku.
    vi.useFakeTimers();
    const { getByRole, unmount } = render(<CodeBlockView code="a" lang="ts" />);
    const btn = getByRole("button");
    await act(async () => {
      fireEvent.click(btn);
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    await act(async () => {
      fireEvent.click(btn);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(btn.textContent).toBe("Skopiowano");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(btn.textContent).toBe("Kopiuj kod");

    await act(async () => {
      fireEvent.click(btn);
    });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("odmowa schowka zostawia etykietę bez zmian i nie rzuca", async () => {
    writeText.mockRejectedValue(new Error("brak zgody"));
    const { getByRole } = render(<CodeBlockView code="x" lang="ts" />);
    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Kopiuj kod" }));
    });
    expect(getByRole("button", { name: "Kopiuj kod" })).toBeTruthy();
  });

  it("w rendererze etykieta kopiowania idzie za językiem strony, nie za DOM", () => {
    const { getByRole } = render(
      <BlocksRenderer
        doc={doc([{ id: "c", type: "code", data: { code: "x", lang: "js" } }])}
        lang="en"
      />,
    );
    expect(getByRole("button", { name: "Copy code" })).toBeTruthy();
  });
});

describe("FaqBlockView", () => {
  const ITEMS = [
    { q: "Czym jest <b>NES</b>?", a: "Think-tankiem." },
    { q: "  ", a: "Bez pytania" },
    { q: "Gdzie?", a: "W Warszawie & Brukseli </script><script>alert(1)</script>" },
    { q: "Bez odpowiedzi", a: "" },
  ];

  it("bez kompletnych par nie renderuje niczego", () => {
    const { container } = render(<FaqBlockView items={[{ q: "Q", a: " " }]} />);
    expect(container.innerHTML).toBe("");
  });

  it("pokazuje tylko kompletne pary i otwiera pierwszą; tytuł zastępczy zależy od języka", () => {
    const { getAllByRole, getByRole, getByText, rerender } = render(<FaqBlockView items={ITEMS} />);
    expect(getByRole("heading", { name: "Najczęstsze pytania" })).toBeTruthy();
    const buttons = getAllByRole("button");
    expect(buttons.map((b) => [b.textContent, b.getAttribute("aria-expanded")])).toEqual([
      ["Czym jest <b>NES</b>?", "true"],
      ["Gdzie?", "false"],
    ]);
    expect(getByText("Think-tankiem.")).toBeTruthy();
    rerender(<FaqBlockView items={ITEMS} lang="en" />);
    expect(getByRole("heading", { name: "Frequently Asked Questions" })).toBeTruthy();
    rerender(<FaqBlockView items={ITEMS} lang="en" title="O nas" />);
    expect(getByRole("heading", { name: "O nas" })).toBeTruthy();
  });

  it("otwiera jedną odpowiedź naraz, a kliknięcie otwartej ją zwija", () => {
    const { getAllByRole, queryByText } = render(<FaqBlockView items={ITEMS} />);
    const [first, second] = getAllByRole("button");
    fireEvent.click(second);
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(second.getAttribute("aria-expanded")).toBe("true");
    expect(queryByText("Think-tankiem.")).toBeNull();
    fireEvent.click(second);
    expect(second.getAttribute("aria-expanded")).toBe("false");
    expect(queryByText(/Warszawie/)).toBeNull();
  });

  it("JSON-LD FAQPage niesie tekst bez znaczników i nie zamyka elementu <script>", () => {
    const { container } = render(<FaqBlockView items={ITEMS} />);
    const scripts = container.querySelectorAll("script");
    expect(scripts).toHaveLength(1);
    const raw = scripts[0].textContent ?? "";
    expect(raw).not.toMatch(/<\/script/i);
    const ld = JSON.parse(raw);
    expect(ld["@type"]).toBe("FAQPage");
    expect(ld.mainEntity).toEqual([
      {
        "@type": "Question",
        name: "Czym jest NES?",
        acceptedAnswer: { "@type": "Answer", text: "Think-tankiem." },
      },
      {
        "@type": "Question",
        name: "Gdzie?",
        acceptedAnswer: { "@type": "Answer", text: "W Warszawie & Brukseli alert(1)" },
      },
    ]);
  });

  it("w rendererze mapuje pozycje bloku (nie-obiekty pomija) i przekazuje tytuł", () => {
    const { getByRole, getAllByRole } = render(
      <BlocksRenderer
        doc={doc([
          {
            id: "f",
            type: "faq",
            data: {
              title: "Pytania",
              items: [{ q: "A?", a: "Tak." }, "zły", { q: "B?", a: "Nie." }],
            },
          },
        ])}
      />,
    );
    expect(getByRole("heading", { name: "Pytania" })).toBeTruthy();
    expect(getAllByRole("button").map((b) => b.textContent)).toEqual(["A?", "B?"]);
  });
});
