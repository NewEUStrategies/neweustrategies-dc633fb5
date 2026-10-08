// Listwa linków prawnych - z PRAWDZIWYM routerem i historią pamięciową.
//
// PO CO PRAWDZIWY ROUTER. Listwa nie skleja adresów sama: oddaje ścieżkę
// kanoniczną z rejestru (`/regulamin`) routerowi, a prefiks języka dokłada
// przepisanie wyjścia (`rewrite.output`, ta sama reguła `addLangPrefix`, co
// w `src/router.tsx`). Atrapa `Link` (zwykłe <a href={to}>) przepuściłaby
// listwę z surowym `<a href="/regulamin">`, czyli czytelnik EN lądowałby na
// polskiej wersji dokumentu - tę różnicę widać wyłącznie tutaj.
//
// CO JEST PRZEDMIOTEM DOWODU: zestaw dokumentów wymaganych przez operatora
// płatności (regulamin, polityka prywatności, zwroty i reklamacje, cookies,
// RODO) z poprawnymi adresami w PL i EN, nazwa nawigacji ze słownika w języku
// strony i strukturalna dostępność (landmark, lista, nazwy linków - axe).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { addLangPrefix, stripLangPrefix } from "@/lib/i18n/localePath";
import { FOOTER_LINKS } from "@/lib/seo/footerNavigation";
import { LegalLinks } from "../LegalLinks";

type Lang = "pl" | "en";

/** Dokumenty, których brak na produkcji zgłosił audyt (2026-10-08). */
const REQUIRED = [
  "/regulamin",
  "/polityka-prywatnosci",
  "/zwroty-i-reklamacje",
  "/cookies",
  "/rodo",
] as const;

/**
 * Montuje listwę w korzeniu routera, którego przepisanie adresów działa jak
 * w aplikacji: wejście zdejmuje prefiks języka, wyjście go dokłada.
 */
async function mountLegalLinks(lang: Lang): Promise<HTMLElement> {
  const rootRoute = createRootRoute({
    component: () => <LegalLinks links={FOOTER_LINKS} lang={lang} />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [lang === "en" ? "/en" : "/"] }),
    rewrite: {
      input: ({ url }) => {
        url.pathname = stripLangPrefix(url.pathname).pathname;
        return url;
      },
      output: ({ url }) => {
        url.pathname = addLangPrefix(url.pathname, lang);
        return url;
      },
    },
  });
  render(<RouterProvider router={router} />);
  return screen.findByRole("navigation", { name: realT(lang)("footer.legal_nav") });
}

function hrefs(nav: HTMLElement): string[] {
  return within(nav)
    .getAllByRole("link")
    .map((link) => link.getAttribute("href") ?? "");
}

afterEach(() => {
  cleanup();
});

describe("LegalLinks - adresy dokumentów prawnych", () => {
  it("PL: każdy wymagany dokument jest linkiem pod ścieżką bez prefiksu", async () => {
    const nav = await mountLegalLinks("pl");
    expect(hrefs(nav)).toEqual(expect.arrayContaining([...REQUIRED]));
    expect(within(nav).getByRole("link", { name: "Zwroty i reklamacje" })).toHaveAttribute(
      "href",
      "/zwroty-i-reklamacje",
    );
  });

  it("EN: te same dokumenty prowadzą do wersji angielskich (/en/...)", async () => {
    const nav = await mountLegalLinks("en");
    expect(hrefs(nav)).toEqual(expect.arrayContaining(REQUIRED.map((path) => `/en${path}`)));
    expect(hrefs(nav).every((href) => href.startsWith("/en/"))).toBe(true);
    expect(within(nav).getByRole("link", { name: "Refund policy" })).toHaveAttribute(
      "href",
      "/en/zwroty-i-reklamacje",
    );
  });

  it("listwa niesie dokładnie grupę prawną rejestru, w jego kolejności", async () => {
    const nav = await mountLegalLinks("pl");
    const legal = FOOTER_LINKS.filter((link) => link.group === "legal");
    expect(hrefs(nav)).toEqual(legal.map((link) => link.href));
    // Linki redakcyjne stopki (np. /analizy) nie przeciekają do listwy prawnej.
    expect(hrefs(nav)).not.toContain("/analizy");
  });
});

describe("LegalLinks - dostępność", () => {
  it("nazwa nawigacji i etykiety linków idą za językiem strony", async () => {
    const pl = await mountLegalLinks("pl");
    expect(within(pl).getByRole("link", { name: "Polityka cookies" })).toBeInTheDocument();
    cleanup();

    const en = await mountLegalLinks("en");
    expect(within(en).getByRole("link", { name: "Cookie policy" })).toBeInTheDocument();
    expect(within(en).getByRole("link", { name: "GDPR" })).toBeInTheDocument();
    expect(realT("en")("footer.legal_nav")).not.toBe(realT("pl")("footer.legal_nav"));
  });

  it("linki są listą wewnątrz landmarku nawigacji, osiągalną klawiaturą", async () => {
    const nav = await mountLegalLinks("pl");
    const items = within(within(nav).getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(within(nav).getAllByRole("link").length);

    const first = within(nav).getAllByRole("link")[0];
    first.focus();
    expect(first).toHaveFocus();
  });

  it("listwa jest wolna od naruszeń axe", async () => {
    const nav = await mountLegalLinks("en");
    const violations = await axeViolations(nav);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
