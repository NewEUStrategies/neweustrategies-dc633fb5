// Byline „tytuł minus 2 px”: zakres pomiaru, brak tytułu i wspólny harmonogram.
//
// CO TEN PLIK DOWODZI:
//  1. Tytuł jest szukany WYŁĄCZNIE w najbliższej karcie (`data-author-title-scope`)
//     albo ramce widgetu (`data-w-id`) - H1 wpisu, etykieta sekcji ani sąsiedni
//     widget nie przestawiają rozmiaru bylinu.
//  2. Brak tytułu w zakresie = rozmiar z panelu (atrybut trybu znika), a węzeł
//     `data-author-title-ignore` nigdy nie jest tytułem.
//  3. Pierwszy pomiar biegnie w efekcie layoutowym - wynik jest w DOM-ie zaraz
//     po `render`, bez czekania na klatkę.
//  4. ~40 bylinów dzieli JEDEN MutationObserver, JEDEN ResizeObserver i JEDEN
//     nasłuch `resize`; ostatni odpięty byline sprząta wszystko.
//  5. Arkusz Theme Design w `<body>` (i w `<head>`) przelicza byline.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { AuthorByline } from "../AuthorByline";
import {
  AUTHOR_TITLE_SELECTORS,
  findAuthorTitle,
  watchedAuthorTitleCount,
} from "../authorTitleScheduler";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const nameSize = (root: ParentNode, index = 0) =>
  root.querySelectorAll<HTMLElement>("[data-author-byline-name]")[index]?.style.fontSize;
const mode = (root: ParentNode, index = 0) =>
  root
    .querySelectorAll<HTMLElement>("[data-author-byline]")
    [index]?.getAttribute("data-author-title-relative");

/** Strona z obcymi nagłówkami dookoła widgetu - to je brał stary pomiar. */
function Page({ children }: { children: ReactNode }) {
  return (
    <main>
      <h1 className="cms-post-title" style={{ fontSize: 40 }}>
        Tytuł wpisu
      </h1>
      <section data-w-id="label">
        <span data-title-root style={{ fontSize: 30 }}>
          Etykieta sekcji
        </span>
      </section>
      {children}
    </main>
  );
}

describe("zakres pomiaru: karta albo widget, nigdy wyżej", () => {
  it("byline idzie za tytułem SWOJEJ karty, nie pierwszej karty widgetu", () => {
    const { container } = render(
      <Page>
        <div data-w-id="list">
          <article data-author-title-scope="">
            <h3 className="cms-post-title" style={{ fontSize: 26 }}>
              Pierwsza
            </h3>
            <AuthorByline name="Jan Kowalski" />
          </article>
          <article data-author-title-scope="">
            <h3 className="cms-post-title" style={{ fontSize: 18 }}>
              Druga
            </h3>
            <AuthorByline name="Anna Nowak" />
          </article>
        </div>
      </Page>,
    );
    // Bez `waitFor`: pierwszy pomiar biegnie w efekcie layoutowym.
    expect(nameSize(container, 0)).toBe("24px");
    expect(nameSize(container, 1)).toBe("16px");
    expect(mode(container, 1)).toBe("measured");
  });

  it("widget bez kart szuka tytułu tylko we własnej ramce", () => {
    const { container } = render(
      <Page>
        <div data-w-id="rated">
          <h3 className="cms-post-title" style={{ fontSize: 20 }}>
            Wiersz
          </h3>
          <AuthorByline name="Jan Kowalski" />
        </div>
      </Page>,
    );
    expect(nameSize(container)).toBe("18px");
  });

  it.each([
    ["cytat w widgecie bez tytułu", true],
    ["byline poza kartą i widgetem", false],
  ])("%s: rozmiar z panelu, a nie z H1 wpisu", (_label, inWidget) => {
    const byline = <AuthorByline name="Jan Kowalski" />;
    const { container } = render(
      <Page>{inWidget ? <figure data-w-id="quote">{byline}</figure> : byline}</Page>,
    );
    expect(mode(container)).toBeNull();
    expect(nameSize(container)).toBe("12px");
  });

  it("karta z ukrytym tytułem nie pożycza tytułu sąsiedniej karty", () => {
    const { container } = render(
      <div data-w-id="list">
        <article data-author-title-scope="">
          <h3 className="cms-post-title" style={{ fontSize: 26 }}>
            Sąsiad
          </h3>
        </article>
        <article data-author-title-scope="">
          <AuthorByline name="Jan Kowalski" />
        </article>
      </div>,
    );
    expect(mode(container)).toBeNull();
    expect(nameSize(container)).toBe("12px");
  });

  it("nazwisko w karcie autora (`data-author-title-ignore`) nie jest tytułem", () => {
    const { container } = render(
      <aside data-w-id="author-card">
        <div className="cms-post-title" style={{ fontSize: 22 }} data-author-title-ignore="">
          Jan Kowalski
        </div>
        <AuthorByline name="Jan Kowalski" />
      </aside>,
    );
    expect(mode(container)).toBeNull();
    expect(nameSize(container)).toBe("12px");
  });

  it("treść innego bylinu nie jest tytułem", () => {
    document.body.innerHTML = `
      <div data-w-id="x">
        <span data-author-byline><h3 id="inside">x</h3></span>
        <span id="b"></span>
      </div>`;
    expect(findAuthorTitle(document.getElementById("b")!)).toBeNull();
    document.body.innerHTML = "";
  });

  it("kolejność kandydatów: klasa tytułu wpisu przed nagłówkiem HTML", () => {
    expect(AUTHOR_TITLE_SELECTORS[0]).toBe(".cms-post-title");
    document.body.innerHTML = `
      <div data-author-title-scope>
        <h2 id="h">nagłówek</h2>
        <p class="cms-post-title" id="t">tytuł</p>
        <span id="b"></span>
      </div>`;
    expect(findAuthorTitle(document.getElementById("b")!)?.id).toBe("t");
    document.body.innerHTML = "";
  });
});

describe("zmiany po pierwszym pomiarze", () => {
  it("CMS zmienia rozmiar tytułu w karcie", async () => {
    const card = (px: number) => (
      <article data-w-id="c">
        <h2 className="cms-post-title" style={{ fontSize: px }}>
          Tytuł
        </h2>
        <AuthorByline name="Jan Kowalski" />
      </article>
    );
    const { container, rerender } = render(card(18));
    expect(nameSize(container)).toBe("16px");
    rerender(card(26));
    await waitFor(() => expect(nameSize(container)).toBe("24px"));
  });

  it.each(["head", "body"] as const)(
    "arkusz Theme Design w <%s> przelicza byline",
    async (where) => {
      const { container } = render(
        <article data-w-id="theme-test">
          <h2 className="cms-post-title">Tytuł</h2>
          <AuthorByline name="Jan Kowalski" />
        </article>,
      );
      const style = document.createElement("style");
      style.textContent = '[data-w-id="theme-test"] .cms-post-title { font-size: 22px; }';
      document[where].appendChild(style);
      try {
        await waitFor(() => expect(nameSize(container)).toBe("20px"));
        // Podmiana treści arkusza (tak przepisuje go `StyleSink`).
        style.textContent = '[data-w-id="theme-test"] .cms-post-title { font-size: 18px; }';
        await waitFor(() => expect(nameSize(container)).toBe("16px"));
      } finally {
        style.remove();
      }
    },
  );

  it("tytuł pojawia się w karcie po pierwszym pomiarze", async () => {
    const card = (withTitle: boolean) => (
      <article data-w-id="late">
        {withTitle ? (
          <h3 className="cms-post-title" style={{ fontSize: 20 }}>
            Tytuł
          </h3>
        ) : null}
        <AuthorByline name="Jan Kowalski" />
      </article>
    );
    const { container, rerender } = render(card(false));
    expect(mode(container)).toBeNull();
    rerender(card(true));
    await waitFor(() => expect(nameSize(container)).toBe("18px"));
    expect(mode(container)).toBe("measured");
  });
});

describe("jeden harmonogram dla wszystkich bylinów", () => {
  it("40 bylinów = jeden MutationObserver, jeden ResizeObserver, jeden nasłuch resize", () => {
    const mutationObservers = vi.fn();
    const resizeObservers = vi.fn();
    const RealMutationObserver = globalThis.MutationObserver;
    const RealResizeObserver = globalThis.ResizeObserver;
    vi.stubGlobal(
      "MutationObserver",
      class extends RealMutationObserver {
        constructor(callback: MutationCallback) {
          super(callback);
          mutationObservers();
        }
      },
    );
    vi.stubGlobal(
      "ResizeObserver",
      class extends RealResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          super(callback);
          resizeObservers();
        }
      },
    );
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");
    try {
      const { unmount } = render(
        <div data-w-id="many">
          {Array.from({ length: 40 }, (_, i) => (
            <article key={i} data-author-title-scope="">
              <h3 className="cms-post-title" style={{ fontSize: 18 }}>
                Tytuł {i}
              </h3>
              <AuthorByline name={`Autor ${i}`} />
            </article>
          ))}
        </div>,
      );
      expect(watchedAuthorTitleCount()).toBe(40);
      expect(mutationObservers).toHaveBeenCalledTimes(1);
      expect(resizeObservers).toHaveBeenCalledTimes(1);
      expect(addListener.mock.calls.filter(([type]) => type === "resize")).toHaveLength(1);

      unmount();
      expect(watchedAuthorTitleCount()).toBe(0);
      expect(removeListener.mock.calls.filter(([type]) => type === "resize")).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("tryb stały (bez „tytuł minus 2 px”) i sam awatar niczego nie podpinają", () => {
    render(
      <div data-w-id="fixed">
        <h3 className="cms-post-title">Tytuł</h3>
        <AuthorByline
          name="Jan Kowalski"
          display={{
            visible: true,
            showName: true,
            showAvatar: true,
            nameSizePx: 14,
            relativeToTitle: false,
            avatarSizePx: 20,
            avatarRadiusPx: 6,
            labelPrefix: "",
            mode: "avatar",
          }}
        />
        <AuthorByline
          name="Anna Nowak"
          display={{
            visible: true,
            showName: false,
            showAvatar: true,
            nameSizePx: 12,
            avatarSizePx: 20,
            avatarRadiusPx: 6,
            labelPrefix: "",
            mode: "avatar",
          }}
        />
      </div>,
    );
    expect(watchedAuthorTitleCount()).toBe(0);
  });
});
