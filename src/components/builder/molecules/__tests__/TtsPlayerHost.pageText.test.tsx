// WIDGET „ODSŁUCHAJ ARTYKUŁ" - `TtsPlayerHost` WYBIERA TEKST DO SYNTEZY.
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// Host decyduje, CO odtwarzacz przeczyta - a każdy znak tego tekstu to koszt
// syntezy mowy i czas słuchacza. Dowodzimy:
// * źródło „custom" czyta wyłącznie tekst z panelu (bez skanowania strony),
// * źródło domyślne czyta treść NAJBLIŻSZEGO artykułu (potem `[data-post-body]`,
//   `main`, a na końcu pierwszy `article`/`main` dokumentu), z pominięciem
//   samego widgetu (jego etykieta nie może trafić do lektora) i chrome'u:
//   skryptów, stylów, nawigacji, nagłówka, stopki, przycisków i ramek,
// * białe znaki są zwijane - inaczej wcięcia HTML-a stawały się pauzami,
// * granica bloku jest granicą słowa: DOM Reacta nie ma białych znaków między
//   elementami, więc `textContent` zlepiał „Tytuł" i „Pierwszy" w jedno słowo
//   (NAPRAWIONE 2026-10-18 - defekt wykryty przy pisaniu tego pliku),
// * drugi odczyt po 250 ms łapie treść dorenderowaną po montażu (leniwe bloki
//   artykułu), a odmontowanie przed tym czasem nie zostawia licznika,
// * strona bez artykułu i bez `main` daje pusty tekst, a nie treść menu.
//
// ── GRANICE ────────────────────────────────────────────────────────────────
// `TtsPlayer` to granica sieciowa (synteza przez funkcję serwerową), więc
// podmieniamy go atrapą, która wystawia otrzymane propsy w DOM - asercje
// mierzą DOKŁADNIE to, co host oddaje odtwarzaczowi. Zegar jest sztuczny
// (`vi.useFakeTimers`), bo drugi odczyt jest odroczony o 250 ms.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { TtsPlayerHost } from "../TtsPlayerHost";

vi.mock("@/components/TtsPlayer", () => ({
  TtsPlayer: (p: { text: string; voiceId: string; model: string; label: string }) => (
    <output data-testid="lektor" data-voice={p.voiceId} data-model={p.model} data-label={p.label}>
      {p.text}
    </output>
  ),
}));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const tekstLektora = () => screen.getByTestId("lektor").textContent;

function host(props: Partial<Parameters<typeof TtsPlayerHost>[0]> = {}) {
  return (
    <TtsPlayerHost
      source="post"
      customText=""
      label="Odsłuchaj artykuł"
      voiceId="glos-1"
      model="model-1"
      nodeId="tts-1"
      {...props}
    />
  );
}

describe("TtsPlayerHost - źródło „custom”", () => {
  it("odtwarzacz dostaje wyłącznie tekst z panelu i konfigurację głosu", () => {
    render(
      <article>
        <p>Treść artykułu, której lektor NIE czyta.</p>
        {host({ source: "custom", customText: "Tekst z panelu" })}
      </article>,
    );
    expect(tekstLektora()).toBe("Tekst z panelu");
    const lektor = screen.getByTestId("lektor");
    expect(lektor.dataset.voice).toBe("glos-1");
    expect(lektor.dataset.model).toBe("model-1");
    expect(lektor.dataset.label).toBe("Odsłuchaj artykuł");
  });

  it("zmiana tekstu w panelu trafia do odtwarzacza bez przeładowania", () => {
    const { rerender } = render(host({ source: "custom", customText: "Pierwszy" }));
    rerender(host({ source: "custom", customText: "Drugi" }));
    expect(tekstLektora()).toBe("Drugi");
  });
});

describe("TtsPlayerHost - tekst strony", () => {
  it("czyta najbliższy artykuł bez samego widgetu i bez chrome'u, ze zwiniętymi spacjami", () => {
    render(
      <article>
        <header>Nagłówek serwisu</header>
        <h1>Tytuł</h1>
        <p>
          Pierwszy akapit
          {"\n\n      "}
          ciągnie się dalej.
        </p>
        <nav>Menu</nav>
        <button type="button">Udostępnij</button>
        <script>{"window.x = 1"}</script>
        <style>{".a{color:red}"}</style>
        <iframe title="osadzone" />
        <div data-w-id="tts-1">{host()}</div>
        <footer>Stopka</footer>
      </article>,
    );
    expect(tekstLektora()).toBe("Tytuł Pierwszy akapit ciągnie się dalej.");
  });

  it("ODMOWA: element liniowy w środku słowa nie dostaje separatora", () => {
    // Separator należy się BLOKOM - `<strong>` w środku wyrazu nie może go
    // rozbić na dwa słowa.
    render(
      <article>
        <p>
          Nie<strong>zwykły</strong> tekst
        </p>
        <div data-w-id="tts-1">{host()}</div>
      </article>,
    );
    expect(tekstLektora()).toBe("Niezwykły tekst");
  });

  it("odczyt nie modyfikuje strony - chrome zostaje w DOM-ie czytelnika", () => {
    render(
      <article>
        <nav>Menu</nav>
        <p>Akapit</p>
        <div data-w-id="tts-1">{host()}</div>
      </article>,
    );
    expect(document.querySelector("nav")?.textContent).toBe("Menu");
    // Separatory bloków powstają WYŁĄCZNIE na klonie.
    expect(document.querySelector("article")?.innerHTML).not.toMatch(/<\/p> /);
    expect(document.querySelector('[data-w-id="tts-1"]')).not.toBeNull();
  });

  it("bez artykułu czyta treść wpisu (`data-post-body`), a nie całego `main`", () => {
    render(
      <main>
        <aside>Polecane</aside>
        <div data-post-body>
          <p>Treść wpisu</p>
          <div data-w-id="tts-1">{host()}</div>
        </div>
      </main>,
    );
    expect(tekstLektora()).toBe("Treść wpisu");
  });

  it("widget poza artykułem (np. w pasku bocznym) czyta pierwszy artykuł dokumentu", () => {
    render(
      <div>
        <article>
          <p>Artykuł obok</p>
        </article>
        <aside>{host()}</aside>
      </div>,
    );
    expect(tekstLektora()).toBe("Artykuł obok");
  });

  it("strona bez artykułu i bez `main` daje pusty tekst, a nie treść menu", () => {
    render(
      <div>
        <nav>Menu</nav>
        {host()}
      </div>,
    );
    expect(tekstLektora()).toBe("");
  });

  it("drugi odczyt po 250 ms łapie treść dorenderowaną po montażu", () => {
    render(
      <article>
        <p id="akapit">Wstęp</p>
        <div data-w-id="tts-1">{host()}</div>
      </article>,
    );
    expect(tekstLektora()).toBe("Wstęp");
    document.getElementById("akapit")!.textContent = "Wstęp i rozwinięcie";
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(tekstLektora()).toBe("Wstęp");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(tekstLektora()).toBe("Wstęp i rozwinięcie");
  });

  it("odmontowanie przed drugim odczytem nie zostawia licznika", () => {
    const { unmount } = render(<article>{host()}</article>);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("przełączenie na „custom” porzuca tekst strony", () => {
    const { rerender } = render(
      <article>
        <p>Treść strony</p>
        <div data-w-id="tts-1">{host()}</div>
      </article>,
    );
    expect(tekstLektora()).toBe("Treść strony");
    rerender(
      <article>
        <p>Treść strony</p>
        <div data-w-id="tts-1">{host({ source: "custom", customText: "Własny" })}</div>
      </article>,
    );
    expect(tekstLektora()).toBe("Własny");
  });
});
