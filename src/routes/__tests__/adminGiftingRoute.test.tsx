// Trasa `/admin/gifting` - CIENKIE OPAKOWANIE panelu prezentów. Do dziś: 0.
//
// CZEGO NIE DOWODZI TEST ORGANIZMU. `GiftingAdmin.test.tsx` renderuje
// komponent wprost i wyczerpująco opisuje zakładki, statystyki i lokalizację
// dat. Plik trasy zostaje przy tym NIETKNIĘTY - a to w nim mieszka sklejenie:
//
//     createFileRoute("/admin/gifting")({ component: GiftingAdmin })
//
// Panel prezentów rozdaje DOSTĘP DO PŁATNYCH TREŚCI (linki podarunkowe,
// limity miesięczne, unieważnianie). Dwie awarie sklejenia są dla niego
// nierozróżnialne od poprawnego stanu w testach komponentów:
//   1. panel wisi pod innym adresem, niż wskazuje nawigacja panelu, więc
//      administrator dostaje 404 tam, gdzie menu obiecuje zarządzanie linkami;
//   2. pod adresem prezentów montuje się organizm SĄSIEDNI (reklamy, kupony,
//      darowizny) - cztery trasy tego modułu różnią się jednym importem.
//
// GRANICE vs SĄSIEDZI. `GiftingAdmin` i cztery panele pod nim biegną
// PRAWDZIWE. Atrapowane są wyłącznie granice: funkcje serwerowe panelu
// (`gifting-admin.functions`), most `useServerFn` z TanStack Start, i18n
// i toasty. ZERO SIECI - żadna funkcja serwerowa nie biegnie naprawdę.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import type { GiftAdminSettingsRow } from "@/lib/gifting-admin.functions";

const h = vi.hoisted(() => ({
  ensureI18n: vi.fn(),
  getSettings: vi.fn(),
  getStats: vi.fn(),
  listLinks: vi.fn(),
  listEvents: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-gifting-admin", () => ({ ensureI18n: () => h.ensureI18n() }));
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});
vi.mock("@/lib/gifting-admin.functions", () => ({
  getGiftAdminSettings: (...args: unknown[]) => h.getSettings(...args),
  updateGiftAdminSettings: vi.fn(),
  getGiftAdminStats: (...args: unknown[]) => h.getStats(...args),
  listGiftLinksAdmin: (...args: unknown[]) => h.listLinks(...args),
  revokeGiftLinkAdmin: vi.fn(),
  listGiftEventsAdmin: (...args: unknown[]) => h.listEvents(...args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { renderRoute } from "@/test/routeHarness";
import { GiftingAdmin } from "@/components/admin/gifting/organisms/GiftingAdmin";
import { Route as GiftingRoute } from "@/routes/admin.gifting";

const PATH = "/admin/gifting";

const USTAWIENIA: GiftAdminSettingsRow = {
  enabled: true,
  monthly_limit: 10,
  link_ttl_days: 30,
  max_redemptions_per_link: 5,
  eligibility: "registered",
  updated_at: null,
  updated_by: null,
  persisted: true,
};

async function zamontuj() {
  return renderRoute({ route: GiftingRoute, path: PATH, initialEntry: PATH });
}

beforeEach(() => {
  h.ensureI18n.mockReset();
  h.getSettings.mockReset().mockResolvedValue(USTAWIENIA);
  h.getStats.mockReset().mockResolvedValue({
    active_links: 1,
    revoked_links: 0,
    expired_links: 0,
    exhausted_links: 0,
    total_created: 1,
    total_redeemed: 0,
    created_this_month: 1,
    redeemed_this_month: 0,
    unique_gifters: 1,
    unique_recipients: 0,
  });
  h.listLinks.mockReset().mockResolvedValue({ rows: [], total: 0 });
  h.listEvents.mockReset().mockResolvedValue({ rows: [], total: 0 });
});

describe("trasa /admin/gifting - sklejenie adresu z panelem", () => {
  it("montuje się POD SWOIM ADRESEM i pokazuje panel prezentów", async () => {
    const view = await zamontuj();
    expect(view.currentPath()).toBe(PATH);
    expect(screen.getByRole("heading", { name: /giftingAdmin\.title/ })).toBeInTheDocument();
    // Dowód, że montaż przeszedł CAŁY organizm: panel statystyk zdążył
    // wywołać swoją funkcję serwerową.
    await waitFor(() => expect(h.getStats).toHaveBeenCalled());
    cleanup();
  });

  it("wskazuje DOKŁADNIE organizm prezentów, a nie sąsiedni panel modułu", async () => {
    expect(GiftingRoute.options.component).toBe(GiftingAdmin);
    cleanup();
  });

  it("rejestruje słownik prezentów PRZY MONTOWANIU TRASY, nie w punkcie wejścia", async () => {
    // `ensureI18n()` jest wołane w komponencie właśnie po to, żeby słownik
    // jechał w chunku TRASY. Skoro trasa to jedyna droga do tego komponentu
    // w produkcji, dowód rejestracji należy też do testu trasy: jego brak
    // widać dopiero po wdrożeniu z podziałem kodu, jako gołe klucze.
    await zamontuj();
    expect(h.ensureI18n).toHaveBeenCalled();
    cleanup();
  });

  it("nie wnosi WŁASNEGO `head()` - bramka `noindex` jest dziedziczona z `/admin`", async () => {
    // Ta trasa jest w produkcji dzieckiem `/admin`, które ustawia
    // `robots: noindex, nofollow` dla całego panelu. Zamontowana samodzielnie
    // nie wnosi żadnego `meta` - i tak ma być, dopóki żyje pod `/admin`.
    // Wzorzec jawnego nagłówka stoi w `src/routes/admin.donations.tsx`.
    const view = await zamontuj();
    expect(GiftingRoute.options.head).toBeUndefined();
    expect(view.meta()).toEqual([]);
    cleanup();
  });
});
