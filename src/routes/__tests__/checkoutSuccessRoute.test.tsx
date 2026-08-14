// Trasa `/checkout/success` - sklejenie potwierdzenia zakupu.
//
// To jedyna strona, na którą operator płatności odsyła kupującego PO
// obciążeniu karty, więc żyją tu cztery inwarianty, których nie widzi żaden
// test pojedynczego komponentu:
//
//   1. WALIDACJA SEARCH - `order` i `mock` przychodzą z zewnątrz (adres powrotu
//      sesji Stripe). `mock` steruje finalizacją zamówienia po stronie klienta,
//      więc musi być kanonicznym `1`, a nie dowolną prawdziwą wartością.
//   2. FINALIZACJA I CACHE - w trybie mock (brak operatora) nie ma webhooka, więc
//      trasa domyka zamówienie sama; w OBU trybach musi zrzucić cache uprawnień,
//      inaczej kupujący widzi paywall na treści, za którą właśnie zapłacił.
//   3. ADRES POWROTU - `sessionStorage["checkout:returnTo"]` to powierzchnia pod
//      kontrolą przeglądarki. Protocol-relative `//host` wyprowadza kupującego
//      na obcą domenę tuż po płatności (open redirect / phishing) - tu jest
//      dowód, że sanityzacja `safeReturnPath` faktycznie stoi na tej ścieżce.
//   4. BUDŻET LOADERA - dokument redakcyjny `/checkout-success` jest opcjonalną
//      ozdobą; jego awaria ani zwis nie mogą opóźnić potwierdzenia zakupu.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { PageData } from "@/lib/queries/public";

const h = vi.hoisted(() => ({
  finalize: vi.fn(),
  /** Wynik zapytania o dokument redakcyjny `/checkout-success`. */
  doc: null as unknown,
  /** Zapytanie o dokument nigdy się nie rozstrzyga (test budżetu loadera). */
  docHangs: false,
  /** Zapytanie o dokument kończy się błędem (padł resolver treści). */
  docFails: false,
}));

// Server function jest wywoływana wyłącznie przez `useServerFn` - mock CZĘŚCIOWY,
// bo z tego samego modułu pochodzi runtime i18n i router startu.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: () => h.finalize };
});
vi.mock("@/lib/billing/checkout.functions", () => ({
  finalizeCheckout: vi.fn(),
}));
vi.mock("@/lib/queries/public", () => ({
  resolvedContentQueryOptions: (segments: string[]) => ({
    queryKey: ["public", "resolved", segments] as const,
    queryFn: async () => {
      if (h.docHangs) return new Promise(() => {});
      if (h.docFails) throw new Error("resolver down");
      return h.doc;
    },
  }),
}));
// Widok wbudowany i renderer treści mają własne, pełne zestawy testów - tutaj
// interesuje nas WYBÓR między nimi, więc obie strony są sondami.
vi.mock("@/components/admin/builder/ui/organisms/widget-view/PurchaseConfirmationView", () => ({
  PurchaseConfirmationView: ({ lang }: { lang: string }) => (
    <div data-testid="builtin-confirmation" data-lang={lang} />
  ),
}));
vi.mock("@/components/content/ContentRenderer", () => ({
  ContentRenderer: ({ lang }: { lang: string }) => (
    <div data-testid="cms-confirmation" data-lang={lang} />
  ),
}));

import i18n from "@/lib/i18n";
import { billingKeys } from "@/lib/billing/keys";
import { renderRoute } from "@/test/routeHarness";
import { Route as SuccessRoute } from "@/routes/checkout.success";

const PATH = "/checkout/success";
const RETURN_KEY = "checkout:returnTo";

function page(over: Partial<PageData> = {}): { kind: "page"; item: PageData } {
  const item = {
    id: "page-1",
    slug: "checkout-success",
    title_pl: "Dziękujemy",
    title_en: "Thank you",
    content_pl: "<p>Dziękujemy za zakup.</p>",
    content_en: "<p>Thank you.</p>",
    excerpt_pl: null,
    excerpt_en: null,
    editor: "richtext",
    builder_data: null,
    blocks_data: null,
    cover_image_url: null,
    published_at: "2026-01-01T00:00:00.000Z",
    updated_at: null,
    seo_title_pl: null,
    seo_title_en: null,
    seo_description_pl: null,
    seo_description_en: null,
    seo_canonical_url: null,
    seo_noindex: false,
    ...over,
  } as PageData;
  return { kind: "page", item };
}

async function mount(entry = PATH, queryClient?: QueryClient) {
  return renderRoute({ route: SuccessRoute, path: PATH, initialEntry: entry, queryClient });
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

beforeEach(() => {
  h.finalize.mockReset().mockResolvedValue({ ok: true });
  h.doc = null;
  h.docHangs = false;
  h.docFails = false;
  sessionStorage.clear();
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await i18n.changeLanguage("pl");
});

describe("trasa /checkout/success - sklejenie", () => {
  it("montuje się pod własną ścieżką i pokazuje wbudowane potwierdzenie", async () => {
    const view = await mount();

    expect(view.currentPath()).toBe(PATH);
    expect(screen.getByTestId("builtin-confirmation")).toHaveAttribute("data-lang", "pl");
    expect(screen.queryByTestId("cms-confirmation")).not.toBeInTheDocument();
  });

  it("trzyma potwierdzenie zakupu poza indeksem wyszukiwarek", async () => {
    const view = await mount(`${PATH}?order=ord_1`);

    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });
});

describe("trasa /checkout/success - walidacja search", () => {
  it("przepuszcza `order` jako string i normalizuje `mock` do 1", async () => {
    const numeric = await mount(`${PATH}?order=ord_1&mock=1`);
    expect(numeric.search()).toMatchObject({ order: "ord_1", mock: 1 });
    cleanup();

    // Ta sama trasa dostaje `mock` raz jako liczbę, raz jako string - kanonizacja
    // musi dać identyczny wynik, bo od niej zależy finalizacja zamówienia.
    const textual = await mount(`${PATH}?order=ord_1&mock=${encodeURIComponent('"1"')}`);
    expect(textual.search()).toMatchObject({ mock: 1 });
  });

  it("odrzuca `mock` w każdej innej postaci", async () => {
    for (const raw of ["mock=2", "mock=0", `mock=${encodeURIComponent("true")}`, "mock=yes"]) {
      const view = await mount(`${PATH}?order=ord_1&${raw}`);
      expect(view.search().mock, raw).toBeUndefined();
      cleanup();
    }
  });

  it("odrzuca `order`, który nie jest pojedynczym stringiem", async () => {
    const view = await mount(`${PATH}?order=a&order=b`);

    expect(view.search().order).toBeUndefined();
  });
});

describe("trasa /checkout/success - finalizacja i cache uprawnień", () => {
  const ENTITLEMENT_KEYS = [
    ["public", "resolved"],
    ["unlocked-body"],
    billingKeys.mySubscriptionAll(),
    billingKeys.myStripeSubscriptionAll(),
    billingKeys.myOrdersAll(),
    billingKeys.currentTierAll(),
  ];

  function spyOnInvalidation() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    return { queryClient, keys: () => invalidate.mock.calls.map(([args]) => args?.queryKey) };
  }

  it("domyka zamówienie w trybie mock i zrzuca cache uprawnień", async () => {
    const { queryClient, keys } = spyOnInvalidation();
    await mount(`${PATH}?order=ord_77&mock=1`, queryClient);

    await waitFor(() => expect(h.finalize).toHaveBeenCalledTimes(1));
    expect(h.finalize).toHaveBeenCalledWith({ data: { order_id: "ord_77" } });
    await waitFor(() => {
      for (const key of ENTITLEMENT_KEYS) expect(keys()).toContainEqual(key);
    });
  });

  it("bez `mock` nie dotyka zamówienia, ale i tak zrzuca cache uprawnień", async () => {
    // Tu zamówienie domyka webhook operatora - klient ma tylko przestać serwować
    // kupującemu treść sprzed zakupu.
    const { queryClient, keys } = spyOnInvalidation();
    await mount(`${PATH}?order=ord_77`, queryClient);

    await waitFor(() => {
      for (const key of ENTITLEMENT_KEYS) expect(keys()).toContainEqual(key);
    });
    expect(h.finalize).not.toHaveBeenCalled();
  });

  it("z `mock` bez `order` nie wywołuje finalizacji", async () => {
    await mount(`${PATH}?mock=1`);

    await waitFor(() => expect(screen.getByTestId("builtin-confirmation")).toBeInTheDocument());
    expect(h.finalize).not.toHaveBeenCalled();
  });

  it("awaria finalizacji nie psuje potwierdzenia ani nie blokuje inwalidacji", async () => {
    h.finalize.mockRejectedValue(new Error("order already closed"));
    const { queryClient, keys } = spyOnInvalidation();
    await mount(`${PATH}?order=ord_77&mock=1`, queryClient);

    await waitFor(() => expect(keys()).toContainEqual(billingKeys.currentTierAll()));
    expect(screen.getByTestId("builtin-confirmation")).toBeInTheDocument();
  });
});

describe("trasa /checkout/success - adres powrotu", () => {
  it("wraca do artykułu spod bezpiecznej ścieżki i czyści klucz", async () => {
    sessionStorage.setItem(RETURN_KEY, "/artykul/raport-2026?utm=post");
    await mount(`${PATH}?order=ord_1`);

    const cta = await screen.findByRole("link", { name: "Wróć do artykułu" });
    expect(cta).toHaveAttribute("href", "/artykul/raport-2026?utm=post");
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull();
  });

  it.each([
    ["protocol-relative", "//evil.test/pay"],
    ["protocol-relative z backslashem", "/\\evil.test"],
    ["adres bezwzględny", "https://evil.test/pay"],
    ["schemat javascript", "javascript:alert(1)"],
    ["schemat w ścieżce", "/javascript:alert(1)"],
    ["wstrzyknięcie CRLF", "/artykul\nSet-Cookie: a=b"],
  ])("odrzuca wrogi adres powrotu (%s) i wraca na stronę główną", async (_label, evil) => {
    sessionStorage.setItem(RETURN_KEY, evil);
    await mount(`${PATH}?order=ord_1`);

    const home = await screen.findByRole("link", { name: "Wróć na stronę główną" });
    expect(home).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "Wróć do artykułu" })).not.toBeInTheDocument();
    // Wroga wartość nie może przeciec do DOM w ŻADNEJ formie (href, tekst, atrybut).
    expect(document.body.innerHTML).not.toContain("evil.test");
    expect(document.body.innerHTML).not.toContain("javascript:");
    expect(sessionStorage.getItem(RETURN_KEY)).toBeNull();
  });

  it.each(["/checkout/plan-1", "/profile/orders"])("nie zapętla lejka na %s", async (internal) => {
    sessionStorage.setItem(RETURN_KEY, internal);
    await mount(`${PATH}?order=ord_1`);

    expect(await screen.findByRole("link", { name: "Wróć na stronę główną" })).toBeInTheDocument();
  });
});

describe("trasa /checkout/success - dokument redakcyjny", () => {
  it("oddaje układ dokumentowi CMS, gdy ten ma treść", async () => {
    h.doc = page();
    await mount();

    expect(await screen.findByTestId("cms-confirmation")).toBeInTheDocument();
    expect(screen.queryByTestId("builtin-confirmation")).not.toBeInTheDocument();
  });

  it("wraca do widoku wbudowanego, gdy dokument jest pusty", async () => {
    h.doc = page({ content_pl: "   ", content_en: null, builder_data: null, blocks_data: null });
    await mount();

    expect(await screen.findByTestId("builtin-confirmation")).toBeInTheDocument();
    expect(screen.queryByTestId("cms-confirmation")).not.toBeInTheDocument();
  });

  it("awaria resolvera treści nie blokuje potwierdzenia", async () => {
    h.docFails = true;
    await mount(`${PATH}?order=ord_1`);

    expect(await screen.findByTestId("builtin-confirmation")).toBeInTheDocument();
  });

  it("loader nie czeka na dokument dłużej niż jego budżet", async () => {
    // Zwis resolvera nie może wstrzymać SSR potwierdzenia zakupu: `withBudget`
    // ma zwolnić loader po 2 s, mimo że zapytanie nigdy nie odpowie.
    h.docHangs = true;
    vi.useFakeTimers();
    let settled = false;
    const pending = mount().then((view) => {
      settled = true;
      return view;
    });

    await vi.advanceTimersByTimeAsync(1_900);
    expect(settled, "loader zwolnił się przed upływem budżetu").toBe(false);

    await vi.advanceTimersByTimeAsync(300);
    await pending;
    expect(settled).toBe(true);
  });
});

describe("trasa /checkout/success - i18n", () => {
  it("renderuje potwierdzenie po angielsku", async () => {
    await i18n.changeLanguage("en");
    await mount(`${PATH}?order=ord_1`);

    expect(screen.getByTestId("builtin-confirmation")).toHaveAttribute("data-lang", "en");
    expect(screen.getByRole("link", { name: "Back to homepage" })).toHaveAttribute("href", "/");
  });

  it("po angielsku wraca do artykułu angielską etykietą", async () => {
    await i18n.changeLanguage("en");
    sessionStorage.setItem(RETURN_KEY, "/en/article/report-2026");
    await mount(`${PATH}?order=ord_1`);

    expect(await screen.findByRole("link", { name: "Back to the article" })).toHaveAttribute(
      "href",
      "/en/article/report-2026",
    );
  });
});
