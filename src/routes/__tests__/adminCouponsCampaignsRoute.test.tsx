// TRASA `/admin/coupons/campaigns` - jedyny ekran, z którego generuje się
// MASOWO kody rabatowe i z którego wychodzi masowa wysyłka newslettera.
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
// `adminRouteAuthority.gate.test.ts` argumentuje wprost, że render-testowanie
// tras panelu DLA POKRYCIA jest farmą: ryzyko dostępu jest egzekwowane w trzech
// innych miejscach. Tutaj ryzyko jest inne i renderu wymaga: ta trasa
// URUCHAMIA NIEODWRACALNE ZDARZENIA. Wygenerowanych kodów nie da się cofnąć,
// a wysłanego newslettera tym bardziej. Przedmiotem dowodu jest więc:
//
//   1. ŁADUNEK KAŻDEJ MUTACJI: nazwa i argument RPC generatora, ładunek
//      archiwizacji, ładunek insertu do `newsletter_campaigns` (w tym ZASIĘG -
//      pusty filtr znaczy „do wszystkich").
//   2. CICHA AWARIA po wysyłce: nieudany zapis statusu kampanii nadal melduje
//      SUKCES, więc przycisk „Wyślij" zostaje na ekranie i zaprasza do DRUGIEJ
//      wysyłki tych samych kodów. Zgłoszone przez `it.fails`.
//   3. STAN BŁĘDU vs STAN PUSTY - dziś nierozróżnialne. Zgłoszone przez `it.fails`.
//   4. EKSPORT CSV: zapytanie po kampanii, treść pliku i jego nazwa.
//   5. Kontrakt odczytu listy: kolumny, sortowanie i limit.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - Reguł formularza i ładunku insertu kampanii - `couponCampaignForm.test.ts`
//   i `CampaignCreateDialog.test.tsx`.
// - Treści arkusza CSV - `couponCsv.test.ts` (tu sprawdzam, że trasa go używa
//   i jak nazywa plik).
// - Szkicu newslettera - `couponNewsletterDraft.test.ts`.
// - Reguły „która akcja dla którego statusu" - `CampaignRowActions.test.tsx`.
// - AUTORYTETU: zapis do `b2b_coupon_campaigns` pilnuje RLS i bramka
//   `check:authz-snapshot`. Render niczego o tym nie dowodzi.
//
// Żaden test nie wychodzi do sieci i nie zawiera prawdziwego sekretu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type {
  RecordedChain,
  SupabaseFromStub,
  SupabaseResult,
  SupabaseRpcStub,
} from "@/test/supabase";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  rpc: null as SupabaseRpcStub | null,
  /** Tabele, których odczyt NIGDY się nie rozwiązuje (stan „wczytywanie"). */
  pendingTables: new Set<string>(),
  i18nRegistrations: 0,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
// Słownik `adminCoupons.*` rejestruje się side-effectem importu i ciągnie CAŁY
// i18next aplikacji - atrapa musi wystawić `ensureI18n` (trasa importuje go pod
// aliasem `ensureAdminCouponsI18n`).
vi.mock("@/lib/i18n-admin-coupons", () => ({
  ensureI18n: () => {
    h.i18nRegistrations += 1;
  },
}));
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
  Toaster: () => null,
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, supabaseRpcStub } = await import("@/test/supabase");
  const db = supabaseFromStub();
  const rpc = supabaseRpcStub();
  h.db = db;
  h.rpc = rpc;
  /** Łańcuch, który nigdy się nie rozwiązuje - jedyny deterministyczny
   *  sposób na utrzymanie stanu „wczytywanie". */
  const neverSettling = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "insert", "update", "delete", "eq", "order", "limit"]) {
      builder[m] = () => builder;
    }
    for (const m of ["single", "maybeSingle"]) builder[m] = () => new Promise(() => undefined);
    builder.then = () => new Promise(() => undefined);
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => (h.pendingTables.has(table) ? neverSettling() : db.from(table)),
      rpc: rpc.rpc,
    },
  };
});
// Radix Dialog: `Root` zawsze renderuje dzieci, `Content` istnieje tylko przy
// otwartym oknie (portal nie jest montowany), a `Trigger` z `asChild` przekazuje
// kliknięcie do `onOpenChange`. Atrapa odwzorowuje wszystkie trzy zachowania -
// inaczej „okno jest zamknięte" byłoby dowodem na atrapę, a nie na trasę.
vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false, onOpenChange: undefined as ((open: boolean) => void) | undefined };
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange?: (open: boolean) => void;
      children?: ReactNode;
    }) => {
      stan.open = open;
      stan.onOpenChange = onOpenChange;
      return <div data-testid="dialog">{children}</div>;
    },
    DialogTrigger: ({ children }: { children?: ReactNode }) => (
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <div onClick={() => stan.onOpenChange?.(true)}>{children}</div>
    ),
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? <div data-testid="dialog-content">{children}</div> : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  };
});
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children?: ReactNode;
  }) => (
    <select value={value} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("@/components/admin/coupons/DatePickerField", () => ({
  DatePickerField: ({ label }: { label: string }) => <label>{label}</label>,
}));

import { renderRoute, routeMeta } from "@/test/routeHarness";
import { Route as CampaignsRoute } from "@/routes/admin.coupons.campaigns";
import { fail, ok } from "@/test/supabase";

const PATH = "/admin/coupons/campaigns";
const CAMPAIGNS = "b2b_coupon_campaigns";
const TIERS = "membership_tiers";
const COUPONS = "b2b_coupons";
const NEWSLETTERS = "newsletter_campaigns";
const RPC_GENERATE = "bulk_generate_coupons_for_campaign";

function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa klienta Supabase nie została zainicjowana");
  return h.db;
}
function rpc(): SupabaseRpcStub {
  if (!h.rpc) throw new Error("test: atrapa RPC nie została zainicjowana");
  return h.rpc;
}

interface CampaignFixture {
  id: string;
  name: string;
  prefix: string;
  code_count: number;
  generated_count: number;
  discount_kind: "percent" | "fixed";
  discount_percent: number | null;
  discount_cents: number | null;
  currency: string | null;
  valid_until: string | null;
  grants_tier_key: string | null;
  grants_duration_days: number | null;
  newsletter_segment: string | null;
  newsletter_campaign_id: string | null;
  status: "draft" | "generated" | "sent" | "archived";
  created_at: string;
}

function campaign(overrides: Partial<CampaignFixture> = {}): CampaignFixture {
  return {
    id: "camp-1",
    name: "Q1 2026 VIP",
    prefix: "NES-",
    code_count: 100,
    generated_count: 0,
    discount_kind: "percent",
    discount_percent: 20,
    discount_cents: null,
    currency: null,
    valid_until: "2026-03-31T23:59:59.000Z",
    grants_tier_key: null,
    grants_duration_days: null,
    newsletter_segment: "vip",
    newsletter_campaign_id: null,
    status: "draft",
    created_at: "2026-01-02T09:00:00.000Z",
    ...overrides,
  };
}

/** Plan odpowiedzi: odczyt listy i zapis rozdzielone na tej samej tabeli. */
interface Plan {
  list: SupabaseResult;
  write: SupabaseResult;
  coupons: SupabaseResult;
  newsletter: SupabaseResult;
}
let plan: Plan;

beforeEach(() => {
  db().reset();
  rpc().reset();
  h.pendingTables.clear();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.i18nRegistrations = 0;
  plan = {
    list: ok([campaign()]),
    write: ok(null),
    coupons: ok([]),
    newsletter: ok({ id: "nl-1" }),
  };
  db().setResponse(CAMPAIGNS, (chain: RecordedChain) =>
    chain.has("update") ? plan.write : plan.list,
  );
  db().setResponse(TIERS, ok([{ key: "gold", name_pl: "Złoty", name_en: "Gold" }]));
  db().setResponse(COUPONS, () => plan.coupons);
  db().setResponse(NEWSLETTERS, () => plan.newsletter);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderPanel(): Promise<void> {
  await renderRoute({
    route: CampaignsRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
  });
}

/** Panel po rozwiązaniu odczytu listy - punkt wyjścia większości asercji. */
async function renderReady(): Promise<void> {
  await renderPanel();
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
}

/** Łańcuchy ODCZYTU listy (bez mutacji) - do liczenia unieważnień cache. */
function odczytyListy(): RecordedChain[] {
  return db()
    .chainsFor(CAMPAIGNS)
    .filter((c) => !c.has("update") && !c.has("insert"));
}

describe("odczyt listy kampanii", () => {
  it("słownik panelu jest rejestrowany przy montowaniu - inaczej ekran byłby bez napisów", async () => {
    await renderReady();
    expect(h.i18nRegistrations).toBeGreaterThan(0);
  });

  it("kontrakt zapytania: komplet kolumn, sortowanie malejąco po dacie, limit 200", async () => {
    await renderReady();
    const chain = odczytyListy().at(0);
    const kolumny = String(chain?.argsOf("select")?.[0] ?? "");
    for (const kolumna of [
      "id",
      "name",
      "prefix",
      "code_count",
      "generated_count",
      "discount_kind",
      "discount_percent",
      "discount_cents",
      "currency",
      "valid_until",
      "grants_tier_key",
      "grants_duration_days",
      "newsletter_segment",
      "newsletter_campaign_id",
      "status",
      "created_at",
    ]) {
      expect(kolumny).toContain(kolumna);
    }
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([200]);
  });

  it("lista warstw jest zawężona do AKTYWNYCH i posortowana rangą", async () => {
    await renderReady();
    const chain = db().lastChain(TIERS);
    expect(chain?.argsOf("eq")).toEqual(["active", true]);
    expect(chain?.argsOf("order")).toEqual(["rank", { ascending: true }]);
  });

  it("nierozwiązany odczyt pokazuje stan WCZYTYWANIA, a nie pustą listę", async () => {
    h.pendingTables.add(CAMPAIGNS);
    await renderPanel();
    await waitFor(() => expect(screen.getByText("adminCoupons.loading")).toBeInTheDocument());
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("adminCoupons.campaignsYet")).not.toBeInTheDocument();
  });

  it("pusta lista mówi WPROST, że kampanii jeszcze nie ma", async () => {
    plan.list = ok([]);
    await renderPanel();
    await waitFor(() => expect(screen.getByText("adminCoupons.campaignsYet")).toBeInTheDocument());
  });

  it("odpowiedź BEZ wierszy (data null) też daje pustą listę, a nie wyjątek w komponencie", async () => {
    plan.list = ok(null);
    await renderPanel();
    await waitFor(() => expect(screen.getByText("adminCoupons.campaignsYet")).toBeInTheDocument());
  });
});

describe("DEFEKT: odmowa odczytu wygląda dokładnie jak brak kampanii", () => {
  // Para `it.fails` + `it()`. Po naprawie (gałąź `isError` z własnym
  // komunikatem) usuwa się OBA RAZEM.
  it.fails(
    "odmowa RLS POWINNA być powiedziana operatorowi, a nie zamieniona w 'brak kampanii'",
    async () => {
      plan.list = fail("permission denied for table b2b_coupon_campaigns");
      await renderPanel();
      await waitFor(() =>
        expect(screen.getByText("adminCoupons.campaignsYet")).toBeInTheDocument(),
      );
      expect(screen.queryByText("adminCoupons.campaignsYet")).not.toBeInTheDocument();
    },
  );

  it("STAN FAKTYCZNY: po odmowie ekran pokazuje 'brak kampanii' i ani śladu awarii", async () => {
    plan.list = fail("permission denied for table b2b_coupon_campaigns");
    await renderPanel();
    await waitFor(() => expect(screen.getByText("adminCoupons.campaignsYet")).toBeInTheDocument());
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
    expect(h.toastError).not.toHaveBeenCalled();
  });
});

describe("generowanie kodów", () => {
  it("woła RPC generatora z identyfikatorem kampanii - i NIC nie wstawia do tabeli kuponów", async () => {
    rpc().setData(RPC_GENERATE, 100);
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "adminCoupons.generate" }));
    await waitFor(() => expect(rpc().callsFor(RPC_GENERATE)).toHaveLength(1));
    expect(rpc().lastCall(RPC_GENERATE)?.keys()).toEqual(["_campaign_id"]);
    expect(rpc().lastCall(RPC_GENERATE)?.arg("_campaign_id")).toBe("camp-1");
    expect(db().chainsFor(COUPONS)).toHaveLength(0);
  });

  it("wynik idzie przez LICZEBNIK i18n z parametrem count", async () => {
    rpc().setData(RPC_GENERATE, 1);
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "adminCoupons.generate" }));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.codesGenerated(count=1)"),
    );
  });

  it("odpowiedź NULL nadal melduje SUKCES - komunikat mówi o kodach, których nie ma", async () => {
    rpc().setData(RPC_GENERATE, null);
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "adminCoupons.generate" }));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.codesGenerated(count=null)"),
    );
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("odmowa RPC pokazuje SUROWY komunikat serwera i NIE unieważnia listy", async () => {
    rpc().setError(RPC_GENERATE, "campaign_already_generated");
    await renderReady();
    const przedOdczytami = odczytyListy().length;
    fireEvent.click(screen.getByRole("button", { name: "adminCoupons.generate" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("campaign_already_generated"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(odczytyListy().length).toBe(przedOdczytami);
  });

  it("sukces unieważnia listę kampanii - operator widzi nowy licznik kodów", async () => {
    rpc().setData(RPC_GENERATE, 100);
    await renderReady();
    const przed = odczytyListy().length;
    fireEvent.click(screen.getByRole("button", { name: "adminCoupons.generate" }));
    await waitFor(() => expect(odczytyListy().length).toBeGreaterThan(przed));
  });
});

describe("archiwizacja", () => {
  it("wysyła DOKŁADNIE zmianę statusu, zawężoną do jednej kampanii - i nie pyta o potwierdzenie", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "archive" }));
    await waitFor(() =>
      expect(
        db()
          .chainsFor(CAMPAIGNS)
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    const zapis = db()
      .chainsFor(CAMPAIGNS)
      .find((c) => c.has("update"));
    expect(zapis?.argsOf("update")).toEqual([{ status: "archived" }]);
    expect(zapis?.argsOf("eq")).toEqual(["id", "camp-1"]);
  });

  it("odmowa archiwizacji pokazuje komunikat bazy, a wiersz zostaje na liście", async () => {
    plan.write = fail("permission denied for table b2b_coupon_campaigns");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "archive" }));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("permission denied for table b2b_coupon_campaigns"),
    );
    expect(screen.getByText("Q1 2026 VIP")).toBeInTheDocument();
  });
});

describe("wysyłka newslettera z kampanii", () => {
  beforeEach(() => {
    plan.list = ok([campaign({ status: "generated" })]);
  });

  it("insert do newslettera niesie ZASIĘG z segmentu kampanii i pyta o identyfikator", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons.send/ }));
    await waitFor(() => expect(db().chainsFor(NEWSLETTERS)).toHaveLength(1));
    const chain = db().lastChain(NEWSLETTERS);
    const payload = chain?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(payload.audience_filter).toEqual({ segment: "vip" });
    expect(String(payload.html_pl)).toContain("{{coupon_code}}");
    expect(chain?.argsOf("select")).toEqual(["id"]);
    expect(chain?.has("single")).toBe(true);
  });

  it("kampania BEZ segmentu wysyła do WSZYSTKICH - pusty filtr, nie brak wysyłki", async () => {
    plan.list = ok([campaign({ status: "generated", newsletter_segment: null })]);
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons.send/ }));
    await waitFor(() => expect(db().chainsFor(NEWSLETTERS)).toHaveLength(1));
    const payload = db().lastChain(NEWSLETTERS)?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(payload.audience_filter).toEqual({});
  });

  it("po utworzeniu newslettera kampania dostaje jego identyfikator i status 'sent'", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons.send/ }));
    await waitFor(() =>
      expect(
        db()
          .chainsFor(CAMPAIGNS)
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    const zapis = db()
      .chainsFor(CAMPAIGNS)
      .find((c) => c.has("update"));
    expect(zapis?.argsOf("update")).toEqual([{ newsletter_campaign_id: "nl-1", status: "sent" }]);
    expect(zapis?.argsOf("eq")).toEqual(["id", "camp-1"]);
  });

  it("brak wiersza z insertu daje komunikat po ANGIELSKU, spoza słownika", async () => {
    plan.newsletter = ok(null);
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons.send/ }));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("Newsletter campaign not created"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odmowa insertu newslettera NIE dotyka statusu kampanii", async () => {
    plan.newsletter = fail("permission denied for table newsletter_campaigns");
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons.send/ }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(
      db()
        .chainsFor(CAMPAIGNS)
        .some((c) => c.has("update")),
    ).toBe(false);
  });
});

describe("DEFEKT: nieudany zapis statusu po wysyłce nadal melduje sukces", () => {
  beforeEach(() => {
    plan.list = ok([campaign({ status: "generated" })]);
    // Newsletter powstaje, ale zapis statusu kampanii jest odrzucony.
    plan.write = fail("permission denied for table b2b_coupon_campaigns");
  });

  // Para `it.fails` + `it()`. Po naprawie (odczyt `error` z aktualizacji
  // statusu) usuwa się OBA RAZEM.
  it.fails(
    "nieudane oznaczenie kampanii jako wysłanej POWINNO zgłosić błąd, nie sukces",
    async () => {
      await renderReady();
      fireEvent.click(screen.getByRole("button", { name: /adminCoupons.send/ }));
      await waitFor(() =>
        expect(
          db()
            .chainsFor(CAMPAIGNS)
            .some((c) => c.has("update")),
        ).toBe(true),
      );
      await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    },
  );

  it("STAN FAKTYCZNY: sukces jest meldowany, a przycisk 'Wyślij' zaprasza do DRUGIEJ wysyłki", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons.send/ }));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.newsletterCampaignCreated"),
    );
    expect(h.toastError).not.toHaveBeenCalled();
    // Kampania nadal ma status „generated", więc przycisk wysyłki zostaje.
    expect(screen.getByRole("button", { name: /adminCoupons.send/ })).toBeInTheDocument();
  });
});

describe("eksport kodów do CSV", () => {
  beforeEach(() => {
    plan.list = ok([campaign({ status: "generated", name: "Q1 2026 VIP" })]);
  });

  /** Podmienia API pobierania pliku i oddaje zapisane kotwice oraz Bloby. */
  function przechwycPobranie() {
    const createUrl = vi.fn().mockReturnValue("blob:csv");
    const revokeUrl = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    const kotwice: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") {
        kotwice.push(el as HTMLAnchorElement);
        (el as HTMLAnchorElement).click = vi.fn();
      }
      return el;
    });
    return { createUrl, revokeUrl, kotwice };
  }

  it("pyta o kody TEJ kampanii, w kolejności powstania, z limitem 10 000", async () => {
    przechwycPobranie();
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    await waitFor(() => expect(db().chainsFor(COUPONS)).toHaveLength(1));
    const chain = db().lastChain(COUPONS);
    expect(chain?.argsOf("eq")).toEqual(["campaign_id", "camp-1"]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: true }]);
    expect(chain?.argsOf("limit")).toEqual([10000]);
  });

  it("zapisuje plik z nagłówkiem i wierszem kuponu, a nazwa pliku bierze się z nazwy kampanii", async () => {
    plan.coupons = ok([
      {
        code: "NES-A1B2",
        name: null,
        active: true,
        valid_until: null,
        max_redemptions: null,
        redemptions_count: 3,
      },
    ]);
    const { createUrl, revokeUrl, kotwice } = przechwycPobranie();
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    await waitFor(() => expect(createUrl).toHaveBeenCalledTimes(1));
    const blob = createUrl.mock.calls[0][0] as Blob;
    expect(await blob.text()).toBe(
      "code;name;active;valid_until;max_redemptions;redemptions_count\nNES-A1B2;;true;;;3",
    );
    expect(kotwice[0]?.download).toBe("coupons-Q1_2026_VIP.csv");
    expect(revokeUrl).toHaveBeenCalledWith("blob:csv");
    expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.csvExported");
  });

  it("PUSTA kampania też produkuje plik i melduje SUKCES - operator nie wie, że pobrał nic", async () => {
    plan.coupons = ok([]);
    const { createUrl } = przechwycPobranie();
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    await waitFor(() => expect(createUrl).toHaveBeenCalledTimes(1));
    const blob = createUrl.mock.calls[0][0] as Blob;
    expect(await blob.text()).toBe(
      "code;name;active;valid_until;max_redemptions;redemptions_count\n",
    );
    expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.csvExported");
  });

  it("odpowiedź BEZ wierszy (data null) produkuje plik z samym nagłówkiem", async () => {
    plan.coupons = ok(null);
    const { createUrl } = przechwycPobranie();
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    await waitFor(() => expect(createUrl).toHaveBeenCalledTimes(1));
    const blob = createUrl.mock.calls[0][0] as Blob;
    expect(await blob.text()).toBe(
      "code;name;active;valid_until;max_redemptions;redemptions_count\n",
    );
  });

  it("odmowa odczytu kodów NIE tworzy pliku i pokazuje komunikat bazy", async () => {
    plan.coupons = fail("permission denied for table b2b_coupons");
    const { createUrl } = przechwycPobranie();
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("permission denied for table b2b_coupons"),
    );
    expect(createUrl).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("okno tworzenia kampanii", () => {
  it("jest ZAMKNIĘTE po wejściu na trasę - nie zasłania listy", async () => {
    await renderReady();
    expect(screen.queryByTestId("dialog-content")).not.toBeInTheDocument();
  });

  it("otwiera się przyciskiem i dostaje warstwy z osobnego odczytu", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons.newCampaign/ }));
    await waitFor(() => expect(screen.getByTestId("dialog-content")).toBeInTheDocument());
    const okno = within(screen.getByTestId("dialog-content"));
    expect(okno.getByRole("option", { name: "Złoty" })).toBeInTheDocument();
  });

  it("zapis nowej kampanii ZAMYKA okno i odświeża listę - operator widzi nowy wiersz", async () => {
    await renderReady();
    const przed = odczytyListy().length;
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons.newCampaign/ }));
    await waitFor(() => expect(screen.getByTestId("dialog-content")).toBeInTheDocument());
    const okno = within(screen.getByTestId("dialog-content"));
    fireEvent.change(okno.getByLabelText("adminCoupons.name"), {
      target: { value: "Kampania z trasy" },
    });
    fireEvent.click(okno.getByRole("button", { name: "adminCoupons.createCampaign" }));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminCoupons.campaignCreatedDraft"),
    );
    await waitFor(() => expect(screen.queryByTestId("dialog-content")).not.toBeInTheDocument());
    expect(odczytyListy().length).toBeGreaterThan(przed);
  });

  it("PUSTA odpowiedź (data null) jest traktowana jak brak warstw, a nie jako wyjątek", async () => {
    db().setResponse(TIERS, ok(null));
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons.newCampaign/ }));
    await waitFor(() => expect(screen.getByTestId("dialog-content")).toBeInTheDocument());
    const okno = within(screen.getByTestId("dialog-content"));
    expect(okno.getAllByRole("option", { name: "adminCoupons.none" })).toHaveLength(1);
  });

  it("awaria odczytu warstw zostawia listę z samą pozycją 'brak' - bez śladu awarii", async () => {
    db().setResponse(TIERS, fail("permission denied for table membership_tiers"));
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: /adminCoupons.newCampaign/ }));
    await waitFor(() => expect(screen.getByTestId("dialog-content")).toBeInTheDocument());
    const okno = within(screen.getByTestId("dialog-content"));
    expect(okno.queryByRole("option", { name: "Złoty" })).not.toBeInTheDocument();
    expect(okno.getAllByRole("option", { name: "adminCoupons.none" })).toHaveLength(1);
  });
});

describe("nagłówek trasy", () => {
  it("trasa NIE deklaruje własnego head() - w karcie przeglądarki nie ma nazwy zakładki", async () => {
    // `noindex` panelu pochodzi z layoutu `/admin` i scala się w dół po całym
    // dopasowanym łańcuchu tras - tego tu NIE dublujemy. Przedmiotem asercji
    // jest wyłącznie to, co deklaruje SAMA ta trasa: nic.
    expect(await routeMeta(CampaignsRoute)).toEqual([]);
  });
});
