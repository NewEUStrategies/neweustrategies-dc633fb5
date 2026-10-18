// Widgety dynamiczne: linki autora we wpisie i adres formularza wyszukiwania.
//
// Co udowadniamy i dlaczego:
//   * search-form: niebezpieczny `action` (javascript:) spada na "/search".
//     Wcześniej `safeUrl(x) || "/search"` nie działało, bo `safeUrl` bez drugiego
//     argumentu zwraca "#" (prawda logiczna) - formularz wysyłał zapytanie na
//     bieżącą stronę zamiast do wyszukiwarki (naprawione 2026-10-18).
//   * post-author-card: z linków autora odpadają niebezpieczne adresy (także
//     własne „customSocials"), własna ikona idzie przez safeImageUrl, a e-mail
//     nie otwiera nowej karty (mailto) - linki zewnętrzne tak, z noopener.
//     Gdy po filtrze nie zostaje nic, lista „Linki autora" nie powstaje wcale.
//
// Granice: prawdziwy CurrentPostProvider (kontekst wpisu) i QueryClient
// (post-meta dociąga odsłony); żadnych mocków - widgety czytają tylko kontekst.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { DynamicTagWidget } from "../DynamicTagWidgets";
import {
  CurrentPostProvider,
  type CurrentPostAuthor,
  type CurrentPostCtx,
} from "@/lib/content-model/postContext";
import type { WidgetNode, WidgetType } from "@/lib/builder/types";

function node(type: WidgetType, content: Record<string, unknown> = {}): WidgetNode {
  return { id: `${type}-x`, kind: "widget", type, content: content as WidgetNode["content"] };
}

function renderTag(ui: ReactElement, ctx: CurrentPostCtx) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CurrentPostProvider value={ctx}>{ui}</CurrentPostProvider>
    </QueryClientProvider>,
  );
}

function ctxWithAuthor(author: Partial<CurrentPostAuthor>): CurrentPostCtx {
  return {
    kind: "post",
    id: "p1",
    slug: "wpis",
    title_pl: "Tytuł",
    author: { name: "Anna Nowak", slug: "anna", ...author } as CurrentPostAuthor,
  };
}

afterEach(cleanup);

describe("search-form: adres wysyłki", () => {
  it("niebezpieczny action (javascript:) spada na /search, a nie na '#'", () => {
    const { container } = renderTag(
      <DynamicTagWidget node={node("search-form", { action: "javascript:alert(1)" })} lang="pl" />,
      { kind: "archive" },
    );
    expect(container.querySelector("form")?.getAttribute("action")).toBe("/search");
  });

  it("bezpieczny action zostaje; EN ma własne etykiety pola i przycisku", () => {
    renderTag(<DynamicTagWidget node={node("search-form", { action: "/szukaj" })} lang="en" />, {
      kind: "archive",
    });
    const form = screen.getByRole("search");
    expect(form.getAttribute("action")).toBe("/szukaj");
    expect(form.getAttribute("method")).toBe("get");
    const input = within(form).getByRole("searchbox", { name: "Search..." });
    expect(input.getAttribute("name")).toBe("q");
    expect(within(form).getByRole("button", { name: "Search" })).toBeTruthy();
  });
});

describe("post-author-card: linki autora", () => {
  it("odrzuca niebezpieczne adresy (także własne) i rozróżnia mailto od linków zewnętrznych", () => {
    renderTag(
      <DynamicTagWidget node={node("post-author-card", { showSocial: true })} lang="pl" />,
      ctxWithAuthor({
        contactEmail: "anna@example.org",
        linkedinUrl: "javascript:alert(1)",
        websiteUrl: "https://anna.example.org",
        customSocials: [
          { label: "Zła", url: "javascript:alert(2)" },
          { label: "Bluesky", url: "https://bsky.app/anna", iconUrl: "https://cdn.example/b.svg" },
          { label: "", url: "https://mastodon.example/@anna", iconUrl: "javascript:x" },
        ],
      }),
    );
    const list = screen.getByRole("list", { name: "Linki autora" });
    const links = within(list).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "mailto:anna@example.org",
      "https://anna.example.org",
      "https://bsky.app/anna",
      "https://mastodon.example/@anna",
    ]);
    const [mail, web, bsky, masto] = links;
    expect(mail.getAttribute("target")).toBeNull();
    expect(web.getAttribute("target")).toBe("_blank");
    expect(web.getAttribute("rel")).toContain("noopener");
    // Własna ikona z bezpiecznego adresu; niebezpieczna ikona -> ikona zastępcza.
    expect(bsky.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/b.svg");
    expect(masto.querySelector("img")).toBeNull();
    // Bez etykiety nazwą linku jest sam adres.
    expect(masto.getAttribute("aria-label")).toBe("https://mastodon.example/@anna");
  });

  it("same niebezpieczne linki -> brak listy 'Linki autora'", () => {
    renderTag(
      <DynamicTagWidget node={node("post-author-card", { showSocial: true })} lang="en" />,
      ctxWithAuthor({
        xUrl: "javascript:alert(1)",
        customSocials: [{ label: "Zła", url: "data:text/html,x" }],
      }),
    );
    expect(screen.getByText("Anna Nowak")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Author links" })).toBeNull();
  });
});
