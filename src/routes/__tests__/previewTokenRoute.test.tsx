// Trasa `/preview/$token` ZAMONTOWANA - podgląd szkicu pod embargiem po tokenie
// (prasa, partnerzy, rada - bez konta).
//
// CZTERY REGUŁY, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. LINK NIEWAŻNY TO NIE AWARIA. Token spoza formatu nie trafia do serwera
//      wcale (walidator server fn rzucał -> 500 i pusty ekran), a token
//      wygasły/odwołany i odmowa serwera (limit prób) dają ten sam uczciwy
//      komunikat „wygasł lub jest nieprawidłowy".
//   2. PODGLĄD NIGDY NIE TRAFIA DO INDEKSU - `noindex, nofollow, noarchive`
//      w KAŻDYM stanie, także „nie znaleziono" (link wycieka razem z adresem).
//   3. GODZINA WYGAŚNIĘCIA W STREFIE SERWISU. `toLocaleString` bez strefy
//      drukował na SSR (Workers, UTC) inną godzinę niż w przeglądarce
//      redaktora - rozjazd hydratacji i, przy wpisach z okna 22:00-24:00 UTC,
//      inny DZIEŃ wygaśnięcia na banerze embarga.
//   4. TREŚĆ PRZECHODZI TĘ SAMĄ OBRÓBKĘ CO NA PRODUKCJI: sanitizacja HTML
//      i rozwinięcie `[fn]` z sekcją przypisów - inaczej redaktor akceptuje
//      w podglądzie coś innego, niż zobaczy czytelnik.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: walidacji tokenu po stronie serwera (najemca,
// wygaśnięcie, kosz, limit prób) - to `lib/content/__tests__/previewTokens.functions.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { PreviewPostPayload } from "@/lib/content/previewTokens.functions";
import { renderRoute } from "@/test/routeHarness";
import { freezeClock } from "@/test/time";

const h = vi.hoisted(() => ({
  lang: "pl",
  fetchPreviewPost: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/lib/content/previewTokens.functions", () => ({
  fetchPreviewPost: h.fetchPreviewPost,
}));
// Styl treści czyta globalne ustawienia układu z bazy - ma własne testy.
vi.mock("@/components/PostContentStyle", () => ({ PostContentStyle: () => null }));
// Atrapa-sonda: pokazuje, CO dostał silnik treści (HTML po obróbce trasy).
vi.mock("@/components/content/ContentRenderer", () => ({
  ContentRenderer: (props: {
    html: string;
    editor: string | null;
    lang: string;
    blocksDoc: { meta?: Record<string, unknown> } | null;
  }) => (
    <div
      data-testid="preview-body"
      data-editor={props.editor}
      data-lang={props.lang}
      data-blocks-doc={String(props.blocksDoc?.meta?.tag ?? "")}
    >
      {props.html}
    </div>
  ),
}));

import { Route as PreviewRoute } from "@/routes/preview.$token";

freezeClock();

const ORIGINAL_TZ = process.env.TZ;

/** 32 znaki base64url - kształt tokenu z `generateToken()` (24 bajty). */
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012-_9";

function payload(over: Partial<PreviewPostPayload> = {}): PreviewPostPayload {
  return {
    title_pl: "Szkic: rola UE na Bałkanach",
    title_en: "Draft: the EU in the Balkans",
    excerpt_pl: "Zajawka szkicu",
    excerpt_en: "Draft lead",
    editor: "richtext",
    content_pl: "<p>Treść szkicu</p>",
    content_en: "<p>Draft body</p>",
    builder_data: null,
    blocks_data: null,
    cover_image_url: null,
    status: "draft",
    updated_at: "2026-09-30T08:00:00Z",
    // 22:30 UTC = 00:30 NASTĘPNEGO dnia w Warszawie (CEST).
    expires_at: "2026-10-02T22:30:00Z",
    ...over,
  };
}

function mount(token: string = TOKEN) {
  return renderRoute({
    route: PreviewRoute,
    path: "/preview/$token",
    initialEntry: `/preview/${token}`,
  });
}

function robotsOf(meta: Record<string, unknown>[]): unknown {
  return meta.find((m) => m.name === "robots")?.content;
}

beforeEach(() => {
  h.lang = "pl";
  h.fetchPreviewPost.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("/preview/$token - link nieważny to nie awaria", () => {
  it.each([
    ["za krótki (15 znaków)", "AbCdEfGhIjKlMnO"],
    ["za długi (65 znaków)", "A".repeat(65)],
    ["ze znakiem spoza base64url", "AbCdEfGhIjKlMnOp.rStUvWx"],
  ])("token %s NIE trafia do serwera i daje komunikat o nieważnym linku", async (_label, token) => {
    await mount(encodeURIComponent(token));
    expect(h.fetchPreviewPost).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Link podglądu wygasł lub jest nieprawidłowy." }),
    ).toBeInTheDocument();
  });

  it("token na granicach formatu (16 i 64 znaki) IDZIE do serwera", async () => {
    h.fetchPreviewPost.mockResolvedValue(null);
    await mount("A".repeat(16));
    cleanup();
    await mount("B".repeat(64));
    expect(h.fetchPreviewPost.mock.calls).toEqual([
      [{ data: { token: "A".repeat(16) } }],
      [{ data: { token: "B".repeat(64) } }],
    ]);
  });

  it("token wygasły lub odwołany (serwer oddaje null) - komunikat z prośbą o nowy link", async () => {
    h.fetchPreviewPost.mockResolvedValue(null);
    await mount();
    expect(h.fetchPreviewPost).toHaveBeenCalledWith({ data: { token: TOKEN } });
    expect(screen.getByText("Poproś redakcję o nowy link.")).toBeInTheDocument();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("odmowa serwera (limit prób) NIE wywraca trasy - ten sam komunikat, bez treści", async () => {
    h.fetchPreviewPost.mockRejectedValue(new Error("Rate limit exceeded"));
    await mount();
    expect(
      screen.getByRole("heading", { name: "Link podglądu wygasł lub jest nieprawidłowy." }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("preview-body")).toBeNull();
  });

  it("wariant angielski komunikatu dla nieważnego linku", async () => {
    h.lang = "en";
    await mount("zly");
    expect(
      screen.getByRole("heading", { name: "This preview link has expired or is invalid." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ask the editorial team for a fresh link.")).toBeInTheDocument();
  });
});

describe("/preview/$token - nagłówek dokumentu", () => {
  it("podgląd z treścią ma pełny noindex", async () => {
    h.fetchPreviewPost.mockResolvedValue(payload());
    const view = await mount();
    expect(robotsOf(view.meta())).toBe("noindex, nofollow, noarchive");
    expect(view.meta()).toContainEqual({ title: "Preview" });
  });

  it("stan „nie znaleziono” TEŻ ma noindex - wyciekły link nie może trafić do indeksu", async () => {
    h.fetchPreviewPost.mockResolvedValue(null);
    const view = await mount();
    expect(robotsOf(view.meta())).toBe("noindex, nofollow, noarchive");
    expect(screen.getByText("Poproś redakcję o nowy link.")).toBeInTheDocument();
  });
});

describe("/preview/$token - widok czytelniczy szkicu", () => {
  // Maszyna celowo POZA Warszawą: w strefie serwisu formatowanie bez strefy
  // dawało ten sam dzień i godzinę, więc test nie odróżniał naprawy od błędu.
  beforeEach(() => {
    process.env.TZ = "America/New_York";
  });

  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it("baner embarga podaje godzinę wygaśnięcia w STREFIE SERWISU, nie maszyny", async () => {
    h.fetchPreviewPost.mockResolvedValue(payload());
    await mount();
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(
      "Podgląd roboczy pod embargiem - nie udostępniaj tego linku publicznie.",
    );
    // Kanarek: dla maszyny to jeszcze 2 października, w Warszawie już 3.
    expect(new Date(payload().expires_at).getDate()).toBe(2);
    expect(banner).toHaveTextContent(/Link wygasa: 3\.10\.2026, 00:30$/);
  });

  it("wariant angielski: angielski baner i europejski zapis daty wygaśnięcia", async () => {
    h.lang = "en";
    h.fetchPreviewPost.mockResolvedValue(payload());
    await mount();
    expect(screen.getByRole("status")).toHaveTextContent(
      /^Embargoed draft preview - do not share this link publicly\. · Link expires: 03\/10\/2026, 00:30$/,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Draft: the EU in the Balkans",
    );
  });

  it("renderuje tytuł, zajawkę i okładkę szkicu", async () => {
    h.fetchPreviewPost.mockResolvedValue(payload({ cover_image_url: "https://cdn.nes/c.jpg" }));
    const { container } = await mount();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Szkic: rola UE na Bałkanach",
    );
    expect(screen.getByText("Zajawka szkicu")).toBeInTheDocument();
    // Okładka jest dekoracyjna (tytuł stoi obok) - pusty alt, nie powtórzony tytuł.
    expect(container.querySelector("article img")).toHaveAttribute("src", "https://cdn.nes/c.jpg");
    expect(container.querySelector("article img")).toHaveAttribute("alt", "");
  });

  it("wariant angielski spada na polski tytuł, zajawkę i treść, gdy angielskich brak", async () => {
    h.lang = "en";
    h.fetchPreviewPost.mockResolvedValue(
      payload({ title_en: "", excerpt_en: null, content_en: null }),
    );
    await mount();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Szkic: rola UE na Bałkanach",
    );
    expect(screen.getByText("Zajawka szkicu")).toBeInTheDocument();
    expect(screen.getByTestId("preview-body")).toHaveTextContent("Treść szkicu");
  });

  it("HTML szkicu jest SANITYZOWANY przed renderem (skrypt nie dojeżdża do silnika)", async () => {
    // Tylko `<script>`: atrybuty zdarzeń zdejmuje DOMPurify, którego happy-dom
    // nie emuluje wiernie - tę ścieżkę dowodzi `lib/sanitize.test.ts` i e2e.
    h.fetchPreviewPost.mockResolvedValue(
      payload({ content_pl: '<p>Akapit</p><script>alert("x")</script>' }),
    );
    await mount();
    const body = screen.getByTestId("preview-body").textContent ?? "";
    expect(body).toContain("<p>Akapit</p>");
    expect(body).not.toContain("<script");
    expect(body).not.toContain("alert");
  });

  it("`[fn]` jest rozwijany jak na produkcji: odsyłacz w treści i sekcja przypisów", async () => {
    h.fetchPreviewPost.mockResolvedValue(
      payload({ content_pl: "<p>Teza[fn]Eurostat, 2026[/fn] i dalej.</p>" }),
    );
    await mount();
    const body = screen.getByTestId("preview-body").textContent ?? "";
    expect(body).not.toContain("[fn]");
    expect(body).toContain('href="#fn-1"');
    expect(screen.getByRole("heading", { name: "Przypisy źródłowe:" })).toBeInTheDocument();
    expect(screen.getByText("Eurostat, 2026")).toBeInTheDocument();
  });

  it("szkic bez przypisów nie dostaje pustej sekcji przypisów", async () => {
    h.fetchPreviewPost.mockResolvedValue(payload({ excerpt_pl: null, content_pl: null }));
    await mount();
    expect(screen.queryByRole("heading", { name: "Przypisy źródłowe:" })).toBeNull();
    expect(screen.getByTestId("preview-body")).toBeEmptyDOMElement();
    expect(screen.queryByText("Zajawka szkicu")).toBeNull();
  });

  it("szkic blokowy oddaje silnikowi dokument w języku strony, a bez niego - polski", async () => {
    h.lang = "en";
    const pl = { version: 1, blocks: [], meta: { tag: "pl" } };
    const en = { version: 1, blocks: [], meta: { tag: "en" } };
    h.fetchPreviewPost.mockResolvedValueOnce(
      payload({ editor: "blocks", blocks_data: { pl, en } }),
    );
    await mount();
    expect(screen.getByTestId("preview-body")).toHaveAttribute("data-blocks-doc", "en");
    expect(screen.getByTestId("preview-body")).toHaveAttribute("data-editor", "blocks");

    cleanup();
    h.fetchPreviewPost.mockResolvedValueOnce(payload({ editor: "blocks", blocks_data: { pl } }));
    await mount();
    expect(screen.getByTestId("preview-body")).toHaveAttribute("data-blocks-doc", "pl");
  });
});
