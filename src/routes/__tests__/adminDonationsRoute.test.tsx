// Trasa `/admin/donations` - CIENKIE OPAKOWANIE panelu darowizn PLUS jedyny
// w tym module jawny nagłówek SEO. Do dziś: 0 funkcji, 0 instrukcji.
//
// PO CO TEN PLIK. Test organizmu (`AdminDonations.test.tsx`) dowodzi
// wszystkiego o zawartości panelu, ale nie dotyka pliku trasy - a trasa niesie
// tu DWIE rzeczy, których nie ma nigdzie indziej:
//
//   1. BRAMKA INDEKSOWANIA. `head()` deklaruje `robots: noindex, nofollow`.
//      Pod tym adresem stoi REJESTR WPŁAT: kwoty, statusy i adresy e-mail
//      darczyńców. Strona z takim rejestrem w indeksie wyszukiwarki to wyciek
//      danych osobowych i mapa panelu podana obcym - a jedyne, co temu
//      zapobiega, to dwa wpisy `meta` w tym pliku. Nic w typach ani w
//      buildzie tego nie pilnuje; dlatego test sprawdza je JAWNIE i osobno,
//      zarówno z samej funkcji `head()`, jak i z dopasowania trasy w routerze.
//   2. TYTUŁ ZAKŁADKI. `Darowizny - Panel` nadpisuje ogólne `Admin` z layoutu
//      `/admin`. Utrata tytułu to nie kosmetyka: administrator z kilkunastoma
//      kartami panelu rozróżnia je wyłącznie tytułem.
//
// GRANICE vs SĄSIEDZI. `AdminDonations` i oba panele pod nim (podsumowanie
// i rejestr wpłat) biegną PRAWDZIWE - inaczej test nie dowiódłby, że pod tym
// adresem stoi panel darowizn, a nie sąsiedni panel modułu. Atrapowane są
// wyłącznie granice: funkcje serwerowe (statystyki, rejestr, synchronizacja),
// silnik ustawień (`useSettings` - odczyt/zapis `site_settings`), odczyt
// środowiska operatora płatności, i18n i toasty.
//
// ZERO SIECI, ZERO SEKRETÓW: klucz operatora nie jest tu w ogóle czytany.
// RODO: adresy darczyńców wyłącznie z domen zarezerwowanych do przykładów.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { DONATIONS_DEFAULTS, type DonationsConfig } from "@/lib/billing/donationsConfig";
import type { DonationsPublicStats } from "@/lib/billing/donations.functions";
import type { AdminDonationRow } from "@/lib/billing/donationsAdmin.server";

const h = vi.hoisted(() => ({
  ensureI18n: vi.fn(),
  stripeEnv: vi.fn(() => "sandbox"),
  getStats: vi.fn(),
  listRecords: vi.fn(),
  sync: vi.fn(),
  stored: null as Record<string, unknown> | null,
  saves: [] as Record<string, unknown>[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/i18n-donate", () => ({ ensureI18n: h.ensureI18n }));
vi.mock("@/lib/stripe", () => ({ getStripeEnvironmentSafe: h.stripeEnv }));
vi.mock("@/lib/billing/donations.functions", () => ({ getDonationsPublicStats: h.getStats }));
vi.mock("@/lib/billing/donationsAdmin.functions", () => ({
  listDonationRecords: h.listRecords,
  syncDonationsWithStripe: h.sync,
}));

// Atrapa SILNIKA ustawień - granica do `site_settings` (Supabase). `useDraft`
// z tego samego modułu zostaje PRAWDZIWY, bo to zwykły stan Reacta i to on
// odpowiada za przejście „wczytuję" -> „formularz".
vi.mock("@/lib/admin/useSettings", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/admin/useSettings")>("@/lib/admin/useSettings");
  return {
    ...actual,
    useSettings: (_key: string, defaults: Record<string, unknown>) => ({
      query: {
        data: h.stored === null ? undefined : { ...defaults, ...h.stored },
        isPending: h.stored === null,
      },
      save: {
        mutate: (next: Record<string, unknown>) => {
          h.saves.push(next);
        },
        isPending: false,
      },
    }),
  };
});

import { renderRoute, routeHead } from "@/test/routeHarness";
import { AdminDonations } from "@/components/admin/donations/organisms/AdminDonations";
import { Route as DonationsRoute } from "@/routes/admin.donations";

const PATH = "/admin/donations";

function statystyki(over: Partial<DonationsPublicStats> = {}): DonationsPublicStats {
  return {
    totalCents: 125_000,
    monthCents: 32_000,
    count: 42,
    monthCount: 9,
    currency: "PLN",
    recent: [],
    truncated: false,
    ...over,
  };
}

/** RODO: adres wyłącznie z domeny zarezerwowanej do przykładów. */
function wplata(over: Partial<AdminDonationRow> = {}): AdminDonationRow {
  return {
    id: "dddddddd-1111-4111-8111-dddddddddddd",
    amountCents: 15_000,
    currency: "PLN",
    status: "paid",
    recurring: false,
    donorEmail: "darczynca@example.com",
    message: null,
    provider: "stripe",
    providerSessionId: "cs_test_000",
    providerIntentId: null,
    createdAt: "2026-03-15T12:30:00.000Z",
    paidAt: "2026-03-15T12:31:00.000Z",
    ...over,
  };
}

function konfiguracja(over: Partial<DonationsConfig> = {}): DonationsConfig {
  return { ...DONATIONS_DEFAULTS, ...over };
}

async function zamontuj() {
  return renderRoute({ route: DonationsRoute, path: PATH, initialEntry: PATH });
}

beforeEach(() => {
  h.ensureI18n.mockClear();
  h.stripeEnv.mockClear();
  h.getStats.mockReset().mockResolvedValue(statystyki());
  h.listRecords.mockReset().mockResolvedValue([wplata()]);
  h.sync.mockReset();
  h.stored = konfiguracja();
  h.saves.length = 0;
});

describe("trasa /admin/donations - sklejenie adresu z panelem", () => {
  it("montuje się POD SWOIM ADRESEM i pokazuje panel darowizn", async () => {
    const view = await zamontuj();
    expect(view.currentPath()).toBe(PATH);
    expect(screen.getByRole("heading", { name: "Darowizny" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Silnik wpłat" })).toBeInTheDocument();
    cleanup();
  });

  it("wskazuje DOKŁADNIE organizm darowizn, a nie sąsiedni panel modułu", async () => {
    expect(DonationsRoute.options.component).toBe(AdminDonations);
    cleanup();
  });

  it("pod tym adresem stoi REJESTR WPŁAT - i to on uzasadnia bramkę SEO niżej", async () => {
    // Nie jest to powtórzenie testu organizmu: chodzi o dowód, że przez TĘ
    // trasę przechodzą dane wrażliwe (kwota, adres darczyńcy). Gdyby rejestr
    // przestał być częścią tej trasy, uzasadnienie `noindex` też by się
    // zmieniło - a tak zmiana zapala się tutaj.
    await zamontuj();
    await waitFor(() => expect(h.listRecords).toHaveBeenCalled());
    expect(await screen.findByText("darczynca@example.com")).toBeInTheDocument();
    cleanup();
  });
});

describe("trasa /admin/donations - bramka indeksowania", () => {
  it("`head()` zabrania indeksowania I podążania za linkami", () => {
    // Sam `noindex` nie wystarcza: `nofollow` zatrzymuje robota także na
    // linkach WYCHODZĄCYCH z rejestru (karty wpłat, adresy operatora).
    // Czytamy `head()` wprost - bez montowania - bo to czysta funkcja i to
    // ona jest przedmiotem dowodu.
    const head = routeHead(DonationsRoute);
    expect(head.meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    cleanup();
  });

  it("`head()` nadaje własny tytuł panelu darowizn", () => {
    const head = routeHead(DonationsRoute);
    expect(head.meta).toContainEqual({ title: "Darowizny - Panel" });
    cleanup();
  });

  it("nagłówek DOJEŻDŻA do dopasowania trasy w routerze, nie tylko do funkcji", async () => {
    // Różnica jest istotna: `head()` może istnieć i być poprawne, a mimo to
    // nie trafić do `<HeadContent/>`, jeśli sklejenie trasy jest zepsute.
    // `renderRoute` czyta `meta` z PRAWDZIWEGO dopasowania routera - czyli
    // dokładnie to, co pojechałoby do dokumentu.
    const view = await zamontuj();
    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    expect(view.meta()).toContainEqual({ title: "Darowizny - Panel" });
    cleanup();
  });
});
