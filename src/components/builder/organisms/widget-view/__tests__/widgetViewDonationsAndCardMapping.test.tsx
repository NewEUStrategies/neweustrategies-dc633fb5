// DYSPOZYTOR `WidgetView` - MAPOWANIE TREŚCI CMS NA PROPSY (darowizny, karta).
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// `DonationsWidgetView.test.tsx` dowodzi samego widgetu darowizn przy POPRAWNYCH
// propsach. Ten plik dowodzi tłumaczenia, które robi dyspozytor - treść widgetu
// to kolumna jsonb, w której flagi bywają napisami („false"), liczbami (0/1)
// albo śmieciami, a tryb akcji bywa wartością spoza unii. Pomyłka w tym
// miejscu nie rzuca wyjątku: „false" jako napis jest prawdziwy w JS, więc
// wyłączona w panelu sekcja wpłat po cichu wracała na stronę.
// * wartości domyślne dla pustej treści (wariant, adres akcji, flagi),
// * język: tytuł/podtytuł/CTA z języka strony, pusty napis = brak propsa
//   (widget pokazuje wtedy swój tekst ze słownika, nie pusty nagłówek),
// * flagi: prawda/fałsz w każdej postaci z bazy, śmieci -> wartość domyślna,
// * tryb akcji tylko z unii (`quick` | `form` | `link`),
// * karta `dark-featured-card`: własne kolory etykiety z panelu trafiają na
//   etykietę (tło i obramowanie razem, tekst osobno), a ich brak nie zostawia
//   pustych deklaracji.
//
// ── GRANICE ────────────────────────────────────────────────────────────────
// `DonationsWidgetView` (granica danych - statystyki zbiórki z bazy) jest
// atrapą zapisującą propsy: asercje mierzą DOKŁADNIE to, co dyspozytor oddaje
// widgetowi. Reszta rejestru leniwego -> lustro eager.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";
import { WidgetView } from "@/components/builder/organisms/WidgetView";

const h = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));

vi.mock("@/components/builder/organisms/widget-view/lazyWidgets", async () => ({
  ...(await import("@/test/eagerWidgetChunks")),
  DonationsWidgetView: (p: Record<string, unknown>) => {
    h.props.push(p);
    return <div data-testid="darowizny" />;
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

afterEach(() => {
  cleanup();
  h.props = [];
});

function renderWidget(type: WidgetNode["type"], content: WidgetContent, lang: "pl" | "en" = "pl") {
  const node = { id: `m-${type}`, kind: "widget", type, content } as WidgetNode;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <WidgetView node={node} lang={lang} device="desktop" />
    </QueryClientProvider>,
  );
}

const propsDarowizn = (content: WidgetContent, lang: "pl" | "en" = "pl") => {
  renderWidget("donations", content, lang);
  expect(h.props).toHaveLength(1);
  return h.props[0];
};

describe("donations - tłumaczenie treści CMS na propsy widgetu", () => {
  it("pusta treść daje wartości domyślne, a nie puste napisy", () => {
    expect(propsDarowizn({})).toEqual({
      variant: "hero",
      title: undefined,
      subtitle: undefined,
      cta: undefined,
      href: "/support",
      goalCents: 0,
      currency: undefined,
      showMonth: true,
      showCount: true,
      showRecent: false,
      accent: undefined,
      quickDonate: false,
      mode: undefined,
      lang: "pl",
    });
  });

  it("teksty z języka strony: EN bierze pola _en, a nie polskie", () => {
    const p = propsDarowizn(
      {
        title_pl: "Wesprzyj nas",
        title_en: "Support us",
        subtitle_pl: "Podtytuł",
        subtitle_en: "Subtitle",
        cta_pl: "Wpłać",
        cta_en: "Donate",
        variant: "progress",
        href: "/wesprzyj",
        goalCents: 500000,
        currency: "EUR",
        accent: "#c00",
      },
      "en",
    );
    expect(p).toMatchObject({
      title: "Support us",
      subtitle: "Subtitle",
      cta: "Donate",
      variant: "progress",
      href: "/wesprzyj",
      goalCents: 500000,
      currency: "EUR",
      accent: "#c00",
      lang: "en",
    });
  });

  it.each([
    ["napis „false”", "false"],
    ["zero", 0],
    ["napis „0”", "0"],
    ["fałsz", false],
  ])("flaga wyłączona w bazie jako %s jest fałszem", (_opis, wartosc) => {
    const p = propsDarowizn({ showMonth: wartosc, showCount: wartosc } as WidgetContent);
    expect(p.showMonth).toBe(false);
    expect(p.showCount).toBe(false);
  });

  it.each([
    ["napis „true”", "true"],
    ["jeden", 1],
    ["napis „1”", "1"],
    ["prawda", true],
  ])("flaga włączona w bazie jako %s jest prawdą", (_opis, wartosc) => {
    const p = propsDarowizn({ showRecent: wartosc, quickDonate: wartosc } as WidgetContent);
    expect(p.showRecent).toBe(true);
    expect(p.quickDonate).toBe(true);
  });

  it("śmieć w fladze (np. „tak”) nie przełącza jej - zostaje wartość domyślna", () => {
    const p = propsDarowizn({ showMonth: "tak", showRecent: "tak" });
    expect(p.showMonth).toBe(true);
    expect(p.showRecent).toBe(false);
  });

  it.each([
    ["quick", "quick"],
    ["form", "form"],
    ["link", "link"],
    ["wartość spoza unii", undefined],
  ])("tryb akcji %s", (wejscie, oczekiwany) => {
    const tryb = wejscie === "wartość spoza unii" ? "modal" : wejscie;
    expect(propsDarowizn({ mode: tryb }).mode).toBe(oczekiwany);
  });
});

describe("dark-featured-card - kolory etykiety z panelu", () => {
  it("własne tło etykiety barwi też jej obramowanie, a kolor tekstu idzie osobno", () => {
    renderWidget("dark-featured-card", {
      title_pl: "Raport",
      badge_pl: "Pilne",
      badge: "Pilne",
      badgeBg: "rgb(200, 10, 10)",
      badgeText: "rgb(250, 250, 250)",
    });
    const etykieta = screen.getByText("Pilne");
    expect(etykieta.style.background).toBe("rgb(200, 10, 10)");
    expect(etykieta.style.borderColor).toBe("rgb(200, 10, 10)");
    expect(etykieta.style.color).toBe("rgb(250, 250, 250)");
  });

  it("bez kolorów z panelu etykieta nie dostaje inline deklaracji kolorów", () => {
    renderWidget("dark-featured-card", { title_pl: "Raport", badge_pl: "Pilne", badge: "Pilne" });
    const etykieta = screen.getByText("Pilne");
    expect(etykieta.style.background).toBe("");
    expect(etykieta.style.color).toBe("");
  });
});
