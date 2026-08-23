// Layout `/admin/coupons` - cztery zakładki i reguła, która z nich jest bieżąca.
//
// CO TEN PLIK DOWODZI.
//   1. ADRES LISTY JEST PREFIKSEM POZOSTAŁYCH TRZECH, więc dopasowanie
//      prefiksowe zapaliłoby DWIE zakładki naraz na każdej podstronie. Dokładne
//      dopasowanie dla listy i prefiksowe dla reszty to nie kosmetyka, tylko
//      jedyny układ, w którym operator wie, gdzie jest. Tabela przypadków
//      obejmuje też adres GŁĘBSZY (`/admin/coupons/campaigns/xyz`), na którym
//      dopasowanie dokładne przestałoby działać.
//   2. ZAKŁADKA BIEŻĄCA JEST OZNACZONA `aria-selected` - to jedyny sygnał dla
//      czytnika ekranu; obramowanie jest tylko jego wizualnym odpowiednikiem.
//   3. ZAKŁADKI PROWADZĄ DOKŁADNIE POD CZTERY ADRESY panelu kuponów. Literówka
//      w adresie daje link donikąd, którego tsc nie widzi.
//   4. TA TRASA NIE DEKLARUJE WŁASNEGO `head()`. Wykluczenie z indeksowania
//      pochodzi z layoutu `/admin` i scala się w dół po dopasowanym łańcuchu
//      tras, więc powtarzanie go tutaj byłoby dowodem na cudzy plik. Skutkiem
//      ubocznym jest brak własnego TYTUŁU: cztery zakładki mają w karcie
//      przeglądarki tę samą nazwę.
//   5. NAPISY LAYOUTU SĄ DWUJĘZYCZNE PRZEZ LOKALNY HELPER `L(pl, en)`, a nie
//      przez słownik - i dlatego nie widzi ich żadna bramka parytetu i18n.
//      Test pokazuje OBA języki, żeby ten dług był policzalny.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Zawartości zakładek - każda podstrona ma
// własny plik testowy. (2) Autoryzacji `/admin` - `adminRouteAuthority.gate`.
// (3) Nagłówka `robots` - deklaruje go `src/routes/admin.tsx`, jeden raz dla
// wszystkich tras panelu.
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ language: "pl" }));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);

import { renderRoute, routeHead, routeMeta } from "@/test/routeHarness";
import { Route as CouponsLayoutRoute } from "@/routes/admin.coupons";
import { COUPON_TAB_TARGETS, isCouponTabActive } from "@/lib/admin/couponTabs";

const PATH = "/admin/coupons";

async function zamontuj(initialEntry: string) {
  return renderRoute({ route: CouponsLayoutRoute, path: PATH, initialEntry });
}

/** Etykieta zakładki oznaczonej jako bieżąca (albo `null`, gdy żadnej nie ma). */
function biezaca(): string | null {
  const wybrana = screen
    .getAllByRole("tab")
    .find((tab) => tab.getAttribute("aria-selected") === "true");
  return wybrana?.textContent ?? null;
}

describe("reguła podświetlenia zakładki", () => {
  it.each([
    ["/admin/coupons", ["/admin/coupons"]],
    ["/admin/coupons/campaigns", ["/admin/coupons/campaigns"]],
    ["/admin/coupons/redemptions", ["/admin/coupons/redemptions"]],
    ["/admin/coupons/analytics", ["/admin/coupons/analytics"]],
    // Podstrona kampanii nadal podświetla kampanie - i TYLKO kampanie.
    ["/admin/coupons/campaigns/xyz", ["/admin/coupons/campaigns"]],
  ])("adres %s zapala dokładnie %j", (pathname, oczekiwane) => {
    const zapalone = COUPON_TAB_TARGETS.filter((tab) => isCouponTabActive(tab, pathname)).map(
      (tab) => tab.to,
    );
    expect(zapalone).toEqual(oczekiwane);
  });

  it("adres listy NIE zapala żadnej innej zakładki (jest prefiksem pozostałych)", () => {
    const zapalone = COUPON_TAB_TARGETS.filter((tab) => isCouponTabActive(tab, "/admin/coupons"));
    expect(zapalone).toHaveLength(1);
  });

  it("gdyby lista straciła dopasowanie DOKŁADNE, podstrony zapalałyby dwie zakładki", () => {
    // Kontrprzykład stoi w teście po to, żeby nikt nie „uprościł” reguły do
    // jednego `startsWith` - skutek jest niewidoczny w tsc.
    const bezExact = { to: "/admin/coupons" };
    expect(isCouponTabActive(bezExact, "/admin/coupons/analytics")).toBe(true);
    expect(
      isCouponTabActive({ to: "/admin/coupons", exact: true }, "/admin/coupons/analytics"),
    ).toBe(false);
  });
});

describe("pasek zakładek w zamontowanej trasie", () => {
  it("na liście kuponów bieżąca jest zakładka „Kupony”", async () => {
    await zamontuj("/admin/coupons");
    expect(biezaca()).toBe("Kupony");
  });

  it("cztery zakładki prowadzą pod cztery adresy panelu kuponów", async () => {
    await zamontuj("/admin/coupons");
    const adresy = screen.getAllByRole("tab").map((tab) => tab.getAttribute("href"));
    expect(adresy).toEqual([
      "/admin/coupons",
      "/admin/coupons/campaigns",
      "/admin/coupons/redemptions",
      "/admin/coupons/analytics",
    ]);
  });

  it("pasek jest listą zakładek z nazwą dostępnościową, nie zwykłym rzędem linków", async () => {
    await zamontuj("/admin/coupons");
    expect(screen.getByRole("tablist")).toHaveAccessibleName("Zakładki kuponów");
  });

  it("DOKŁADNIE JEDNA zakładka jest oznaczona jako bieżąca", async () => {
    await zamontuj("/admin/coupons");
    const zapalone = screen
      .getAllByRole("tab")
      .filter((tab) => tab.getAttribute("aria-selected") === "true");
    expect(zapalone).toHaveLength(1);
  });
});

describe("dwujęzyczność layoutu żyje w kodzie, nie w słowniku", () => {
  it("w interfejsie polskim nagłówek i zakładki są po polsku", async () => {
    h.language = "pl";
    await zamontuj("/admin/coupons");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Kupony B2B");
    expect(screen.getByText("Kampanie")).toBeInTheDocument();
  });

  it("w interfejsie angielskim te same napisy są po angielsku - z lokalnego helpera", async () => {
    // Napisy pochodzą z `const L = (pl, en) => ...` w pliku trasy, a nie
    // z `i18n-admin-coupons`. Żadna bramka parytetu ich nie sprawdza; to dług
    // zapisany, nie naprawiany tym testem.
    h.language = "en";
    await zamontuj("/admin/coupons");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("B2B coupons");
    expect(screen.getByText("Campaigns")).toBeInTheDocument();
    expect(screen.getByRole("tablist")).toHaveAccessibleName("Coupon tabs");
    h.language = "pl";
  });
});

describe("nagłówek strony", () => {
  it("trasa NIE deklaruje własnego head() - wykluczenie z indeksowania dziedziczy z /admin", () => {
    expect(() => routeHead(CouponsLayoutRoute)).toThrow(/head\(\)/);
  });

  it("skutek uboczny: zakładki kuponów nie mają WŁASNEGO tytułu w karcie przeglądarki", async () => {
    await expect(routeMeta(CouponsLayoutRoute)).resolves.toEqual([]);
  });
});
