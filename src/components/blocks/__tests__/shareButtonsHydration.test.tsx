// Przyciski udostępniania i licznik wyświetleń (PostUtilityViews) - na
// granicy SSR/hydratacji.
//
// Strona wpisu jest renderowana na serwerze, gdzie NIE MA `window` - adres
// strony jest tam nieznany. Przyciski udostępniania budują z niego adresy
// kanałów (`sharer.php?u=...`). React 19 przy hydratacji NIE łata różnic
// w atrybutach, więc jeśli klient policzy w pierwszym renderze inny `href`
// niż serwer, w DOM-ie zostaje serwerowy - czyli udostępnienie PUSTEGO adresu.
// Kontrakt: pierwszy render klienta = HTML serwera, a adres strony wchodzi
// zaraz po hydratacji (i bez ostrzeżenia o rozjeździe).
//
// Granice: biblioteka ikon (`listIcons` -> Supabase) zwraca pustą listę,
// router przez wspólną atrapę Link. React Query i kontekst wpisu są prawdziwe.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/content-model/postContext";

vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { Link: RouterLinkStub, useRouter: () => ({ navigate: () => undefined }) };
});
vi.mock("@/lib/iconLibrary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/iconLibrary")>()),
  listIcons: async () => [],
}));

import { ShareButtonsView, PostViewsView } from "../PostUtilityViews";

const CTX: CurrentPostCtx = {
  kind: "post",
  id: "post-1",
  slug: "wpis",
  title_pl: "Tytuł & co",
  title_en: "Title",
  viewCount: 12345,
};

function Wrap({ ctx = CTX, children }: { ctx?: CurrentPostCtx | null; children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <CurrentPostProvider value={ctx}>{children}</CurrentPostProvider>
    </QueryClientProvider>
  );
}

/** HTML „z serwera": render bez `window`, jak na workerze. */
function serverHtml(ui: ReactNode): string {
  vi.stubGlobal("window", undefined);
  try {
    return renderToString(ui);
  } finally {
    vi.unstubAllGlobals();
  }
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.history.replaceState(null, "", "/post/wpis?utm=x");
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("ShareButtonsView - SSR i hydratacja", () => {
  // NAPRAWIONE 2026-10-18: adres strony był czytany z `window` w ciele renderu.
  // Serwer renderował `sharer.php?u=` (pusto), klient w pierwszym renderze
  // liczył pełny adres - React zgłaszał rozjazd atrybutów i ZOSTAWIAŁ serwerowy
  // `href`, więc udostępnienie z wyrenderowanej na serwerze strony szło bez
  // adresu. Teraz adres pochodzi z `useSyncExternalStore` (serwer: pusto,
  // hydratacja: pusto, zaraz potem adres przeglądarki).
  it("po hydratacji linki kanałów niosą adres bieżącej strony, bez rozjazdu hydratacji", async () => {
    const ui = (
      <Wrap>
        <ShareButtonsView networks={["facebook", "x"]} lang="pl" />
      </Wrap>
    );
    const host = document.createElement("div");
    host.innerHTML = serverHtml(ui);
    document.body.append(host);
    expect(host.querySelector("a")?.getAttribute("href")).toBe(
      "https://www.facebook.com/sharer/sharer.php?u=",
    );

    await act(async () => {
      hydrateRoot(host, ui);
    });

    const page = encodeURIComponent(window.location.href);
    const hrefs = Array.from(host.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      `https://www.facebook.com/sharer/sharer.php?u=${page}`,
      `https://twitter.com/intent/tweet?url=${page}&text=${encodeURIComponent("Tytuł & co")}`,
    ]);
    const hydrationErrors = consoleError.mock.calls.filter((args: unknown[]) =>
      String(args[0]).toLowerCase().includes("hydrat"),
    );
    expect(hydrationErrors).toEqual([]);
  });

  it("render kliencki (bez SSR) od razu linkuje bieżący adres, a „kopiuj” kopiuje ten sam", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(
      <Wrap>
        <ShareButtonsView networks={["linkedin", "copy"]} lang="en" />
      </Wrap>,
    );
    expect(screen.getByRole("link", { name: "Share LinkedIn" })).toHaveAttribute(
      "href",
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(window.location.href)}`,
    );
    await act(async () => {
      screen.getByRole("button", { name: "Copy link" }).click();
    });
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(screen.getByRole("button", { name: "Copied!" })).toBeTruthy();
  });

  it("grupa ma nazwę dostępną, a nieznane kanały są pomijane (domyślny zestaw przy pustej liście)", () => {
    render(
      <Wrap>
        <ShareButtonsView networks={[]} lang="pl" />
      </Wrap>,
    );
    expect(screen.getByRole("group", { name: "Udostępnij" })).toBeTruthy();
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("aria-label"))).toEqual([
      "Udostępnij Facebook",
      "Udostępnij X",
      "Udostępnij LinkedIn",
    ]);
    expect(screen.getByRole("button", { name: "Kopiuj link" })).toBeTruthy();
  });
});

describe("PostViewsView", () => {
  it.each([
    ["pl", /^12\s345wyświetleń$/],
    ["en", /^12,345views$/],
  ] as const)("licznik jest formatowany w locale %s z domyślnym sufiksem", (lang, text) => {
    const { container } = render(
      <Wrap>
        <PostViewsView lang={lang} />
      </Wrap>,
    );
    expect(container.textContent).toMatch(text);
  });

  it("własny sufiks wygrywa, a sufiks z samych spacji wraca do domyślnego", () => {
    const own = render(
      <Wrap>
        <PostViewsView suffix="odsłon" lang="pl" />
      </Wrap>,
    );
    expect(own.container.textContent).toMatch(/odsłon$/);
    cleanup();
    const blank = render(
      <Wrap>
        <PostViewsView suffix="   " lang="en" />
      </Wrap>,
    );
    expect(blank.container.textContent).toMatch(/views$/);
  });

  it("BEZ licznika w kontekście pokazuje 0, nie NaN ani undefined", () => {
    const { container } = render(
      <Wrap ctx={{ kind: "post" }}>
        <PostViewsView lang="pl" />
      </Wrap>,
    );
    expect(container.textContent).toBe("0wyświetleń");
  });
});
