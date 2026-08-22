// Hub członkostwa (`/profile/membership`) - 490 linii na okrągłym zerze.
//
// CO TEN PLIK DOWODZI. Ta trasa jest jedynym miejscem, w którym użytkownik
// widzi swoje członkostwo jako PAKIET PRAW: skąd wynika jego poziom, co mu
// daje, czy organizacja go jeszcze obejmuje i co z niego skorzystał. Każdy
// z tych bloków ma dwa stany, które łatwo zlać w jeden - i każde zlanie
// kończy się konkretną szkodą:
//
//   1. MIEJSCA ORGANIZACJI TO PIENIĄDZE I DOSTĘP. Panel zaproszeń widzi
//      WYŁĄCZNIE właściciel; członek nie może zapraszać ani usuwać nikogo
//      z organizacji, którą tylko współdzieli. Osobno: miejsce właściciela
//      nie ma przycisku usuwania - inaczej jedno kliknięcie odbiera
//      właścicielowi jego własną organizację.
//   2. ADRES ZAPROSZENIA JEST NORMALIZOWANY PRZED WYSŁANIEM. Bez `trim` i
//      `toLowerCase` zaproszenie na „ Osoba@Example.ORG " nie zejdzie się
//      z kontem założonym na „osoba@example.org" - miejsce zostaje zajęte,
//      a zaproszony nigdy go nie odbierze.
//   3. TRZY RÓŻNE BŁĘDY ZAPROSZENIA MAJĄ TRZY RÓŻNE KOMUNIKATY: wyczerpany
//      limit miejsc, adres już zaproszony i awaria. Jeden wspólny komunikat
//      („nie udało się") kazałby właścicielowi kupować miejsca, których już
//      ma dość, albo dopisywać kogoś, kto już jest na liście.
//   4. STATUS ORGANIZACJI („wstrzymana") MUSI BYĆ WIDOCZNY. Zlanie go ze
//      stanem aktywnym pokazuje pakiet praw, którego użytkownik nie ma.
//   5. ODBIÓR ZAPROSZONYCH MIEJSC DZIEJE SIĘ PRZY WEJŚCIU. Bez tego wywołania
//      osoba zaproszona e-mailem nigdy nie dostaje swojego miejsca - widzi
//      panel bez organizacji i wnioskuje, że zaproszenie przepadło.
//   6. HISTORIA UCZESTNICTWA ROZRÓŻNIA PRZESZŁOŚĆ OD PRZYSZŁOŚCI i trzy stany
//      RSVP. „Wybieram się" na wydarzenie, które już było, to bezużyteczna
//      informacja; „odwołane" pokazane jako „wybieram się" jest szkodliwe.
//   7. KAŻDA NAZWA MA FALLBACK JĘZYKOWY. Wydarzenie bez tytułu angielskiego
//      musi pokazać polski, a nie pusty odnośnik, w który nie da się kliknąć
//      świadomie.
//
// DETERMINIZM DAT. Nie ruszamy zegara systemowego: wydarzenia „przeszłe" i
// „przyszłe" mają daty odległe o lata od dowolnego dnia uruchomienia testu,
// więc asercja jest prawdziwa niezależnie od tego, kiedy test biegnie.
//
// CZEGO NIE DA SIĘ TU POKRYĆ I DLACZEGO. `onAdd` ma na wejściu strażnika
// `if (!value) return;` (profile.membership.tsx:327), którego NIE DA SIĘ
// osiągnąć przez interfejs: przycisk zaproszenia jest wyłączony, dopóki pole
// jest puste albo zawiera same spacje, więc pusty adres nigdy nie dochodzi do
// tej funkcji. Zostaje jako obrona przed wywołaniem z kodu i jedyną
// nieodwiedzoną instrukcją w tym pliku - wywołanie handlera wprost, obok
// interfejsu, dowodziłoby tylko tego, że test umie ominąć przycisk.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - BRAMKI SESJI: mieszka w layoucie `/profile` i ma asercje w
//   `src/routes/__tests__/profileShellRoutes.test.tsx`. Ta trasa jest jego
//   dzieckiem i sama sesji nie sprawdza.
// - REGUŁ KATALOGU WARSTW: `parseTierBenefits`, `tierName` i reszta
//   `lib/billing/tiers` mają własne testy; tutaj są PRAWDZIWE i dowodzimy,
//   że trasa czyta ich wynik.
// - ORGANIZMÓW ROZLICZEŃ I CEN: `SubscriptionManagerSection` oraz
//   `PricingComparisonMatrix` mają testy w `components/billing` i
//   `components/pricing`; tu są markerami zapisującymi propsy.
// - WARSTWY DANYCH `lib/billing/membership`: to jej testy odpowiadają za
//   zapytania i RPC. Tutaj są atrapami sterowanymi ze stanu.
// - PANELU SAMOOBSŁUGI ORGANIZACJI (`/profile/organization`): osobna trasa,
//   osobny plik testowy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  language: "pl",
  /** Bieżąca warstwa członkostwa (`null` = brak dopasowania). */
  tier: null as Record<string, unknown> | null,
  /** Katalog warstw tenanta. */
  tiers: [] as Record<string, unknown>[] | undefined,
  grants: [] as Record<string, unknown>[] | undefined,
  donations: [] as Record<string, unknown>[] | undefined,
  organization: null as Record<string, unknown> | null,
  seats: [] as Record<string, unknown>[] | undefined,
  participation: [] as Record<string, unknown>[] | undefined,
  downloads: [] as Record<string, unknown>[] | undefined,
  /** Ile razy trasa zawołała idempotentny odbiór zaproszonych miejsc. */
  claimCalls: 0,
  /** Zaproszenia przekazane do mutacji - dowód na normalizację adresu. */
  addedSeats: [] as { orgId: string; email: string }[],
  /** Komunikat błędu mutacji zaproszenia (`null` = sukces). */
  addSeatError: null as string | null,
  /**
   * Czy mutacja ma odrzucić czymś, co NIE JEST wyjątkiem. Warstwa sieci
   * i PostgREST potrafią oddać goły łańcuch albo obiekt bez `message`.
   */
  addSeatNonError: false,
  addSeatPending: false,
  removedSeats: [] as string[],
  removeSeatPending: false,
  /** Toasty - rozróżnialne po wariancie, nie tylko po treści. */
  toasts: [] as { variant: "success" | "error"; message: string }[],
  /** Propsy zapisane przez atrapy organizmów. */
  organism: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("@/lib/i18n-profile", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-membership", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-pricing", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => h.toasts.push({ variant: "success", message }),
    error: (message: string) => h.toasts.push({ variant: "error", message }),
  },
}));
// Katalog warstw zostaje PRAWDZIWY (`parseTierBenefits`, `tierName`) - atrapy
// dotyczą wyłącznie odczytów, bo one są wejściem, a nie przedmiotem dowodu.
vi.mock("@/lib/billing/tiers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/tiers")>()),
  useCurrentTier: () => ({ data: h.tier }),
  useMembershipTiers: () => ({ data: h.tiers }),
}));
vi.mock("@/lib/billing/membership", () => ({
  useMyGrants: () => ({ data: h.grants }),
  useMyDonations: () => ({ data: h.donations }),
  useMyOrganization: () => ({ data: h.organization }),
  useOrgSeats: () => ({ data: h.seats }),
  useMyEventParticipation: () => ({ data: h.participation }),
  useMyResourceDownloads: () => ({ data: h.downloads }),
  useClaimOrgSeats: () => {
    h.claimCalls += 1;
  },
  useAddSeat: (orgId: string) => ({
    isPending: h.addSeatPending,
    mutate: (
      email: string,
      options?: { onSuccess?: () => void; onError?: (error: unknown) => void },
    ) => {
      h.addedSeats.push({ orgId, email });
      if (h.addSeatNonError) options?.onError?.("awaria sieci");
      else if (h.addSeatError === null) options?.onSuccess?.();
      else options?.onError?.(new Error(h.addSeatError));
    },
  }),
  useRemoveSeat: () => ({
    isPending: h.removeSeatPending,
    mutate: (seatId: string) => h.removedSeats.push(seatId),
  }),
}));

/** Atrapa organizmu: marker w DOM + zapis propsów. */
function organismStub(name: string) {
  return (props: Record<string, unknown>) => {
    h.organism[name] = props;
    return <div data-testid={name} />;
  };
}

vi.mock("@/components/pricing/organisms/PricingComparisonMatrix", () => ({
  PricingComparisonMatrix: organismStub("PricingComparisonMatrix"),
}));
vi.mock("@/components/billing/organisms/SubscriptionManagerSection", () => ({
  SubscriptionManagerSection: organismStub("SubscriptionManagerSection"),
}));

import { renderRoute } from "@/test/routeHarness";
import { Route as MembershipRoute } from "@/routes/profile.membership";

const PATH = "/profile/membership";

/** Warstwa katalogu w kształcie, jakiego dotyka trasa. */
function tierRow(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: "member",
    rank: 10,
    sort_order: 1,
    audience_key: "individual",
    name_pl: "Członek",
    name_en: "Member",
    benefits: [],
    ...patch,
  };
}

/** Organizacja członkowska - domyślnie aktywna, oglądana przez właściciela. */
function organization(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    org_id: "org-1",
    name: "Instytut Przykładowy",
    my_role: "owner",
    seats_used: 2,
    seats_limit: 5,
    status: "active",
    expires_at: null,
    ...patch,
  };
}

async function mount() {
  return renderRoute({ route: MembershipRoute, path: PATH, initialEntry: PATH });
}

/** Zawartość elementu o danym `data-testid`, bez zgadywania układu. */
function pageText(): string {
  return document.body.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  h.language = "pl";
  h.tier = { key: "member", rank: 10, name_pl: "Członek", name_en: "Member", features: {} };
  h.tiers = [];
  h.grants = [];
  h.donations = [];
  h.organization = null;
  h.seats = [];
  h.participation = [];
  h.downloads = [];
  h.claimCalls = 0;
  h.addedSeats = [];
  h.addSeatError = null;
  h.addSeatNonError = false;
  h.addSeatPending = false;
  h.removedSeats = [];
  h.removeSeatPending = false;
  h.toasts = [];
  h.organism = {};
});

afterEach(() => cleanup());

describe("poziom członkostwa i benefity", () => {
  it("pokazuje nazwę warstwy i jej rangę", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText("membership.title")).toBeTruthy());
    expect(screen.getByText("Członek")).toBeTruthy();
    expect(pageText()).toContain("membership.rank");
  });

  it("po angielsku bierze angielską nazwę warstwy", async () => {
    h.language = "en";
    await mount();
    await waitFor(() => expect(screen.getByText("Member")).toBeTruthy());
  });

  it("BRAK WARSTWY nie pokazuje odznaki i nie wywala panelu", async () => {
    // Konto bez dopasowanej warstwy istnieje (nowa rejestracja, wygasłe
    // nadanie). Panel musi się otworzyć i pokazać drogę w górę.
    h.tier = null;
    await mount();
    await waitFor(() => expect(screen.getByText("membership.title")).toBeTruthy());
    expect(screen.queryByText("Członek")).toBeNull();
    expect(screen.getByText("membership.seePlans")).toBeTruthy();
  });

  it("benefity warstwy idą w JĘZYKU WIDOKU", async () => {
    h.tiers = [
      tierRow({
        benefits: [
          { pl: "Dostęp do biblioteki", en: "Library access" },
          { pl: "Zaproszenia na wydarzenia", en: "Event invitations" },
        ],
      }),
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("membership.benefitsHeading")).toBeTruthy());
    expect(screen.getByText("Dostęp do biblioteki")).toBeTruthy();
    expect(screen.queryByText("Library access")).toBeNull();
  });

  it("te same benefity po angielsku", async () => {
    h.language = "en";
    h.tiers = [tierRow({ benefits: [{ pl: "Dostęp do biblioteki", en: "Library access" }] })];
    await mount();
    await waitFor(() => expect(screen.getByText("Library access")).toBeTruthy());
    expect(screen.queryByText("Dostęp do biblioteki")).toBeNull();
  });

  it("WARSTWA BEZ BENEFITÓW nie pokazuje pustego nagłówka listy", async () => {
    // Nagłówek „Co daje ten poziom" nad pustką czyta się jak awaria.
    h.tiers = [tierRow({ benefits: [] })];
    await mount();
    await waitFor(() => expect(screen.getByText("membership.title")).toBeTruthy());
    expect(screen.queryByText("membership.benefitsHeading")).toBeNull();
  });

  it("benefity bierze z warstwy O TYM SAMYM KLUCZU, nie z pierwszej z katalogu", async () => {
    // Katalog jest wspólny dla wszystkich poziomów. Pomyłka pokazywałaby
    // użytkownikowi uprawnienia planu, którego nie ma.
    h.tiers = [
      tierRow({ key: "supporter", benefits: [{ pl: "Nie ten poziom", en: "Wrong tier" }] }),
      tierRow({ key: "member", benefits: [{ pl: "Ten poziom", en: "Right tier" }] }),
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("Ten poziom")).toBeTruthy());
    expect(screen.queryByText("Nie ten poziom")).toBeNull();
  });
});

describe("matryca porównania planów", () => {
  it("dostaje wyłącznie warstwy z SEGMENTU bieżącej warstwy", async () => {
    // Członek indywidualny nie ma się porównywać z cennikiem korporacyjnym -
    // to ta sama publiczność co na /pricing.
    h.tiers = [
      tierRow({ key: "member", audience_key: "individual" }),
      tierRow({ key: "premium", audience_key: "individual", rank: 20, sort_order: 2 }),
      tierRow({ key: "corporate", audience_key: "organization", rank: 30, sort_order: 3 }),
    ];
    await mount();
    await waitFor(() => expect(screen.getByTestId("PricingComparisonMatrix")).toBeTruthy());
    const passed = h.organism.PricingComparisonMatrix?.tiers;
    expect(Array.isArray(passed) ? passed.map((t) => (t as { key: string }).key) : []).toEqual([
      "member",
      "premium",
    ]);
  });

  it("WARSTWA WSPIERAJĄCEGO wypada z porównania", async () => {
    // „Wspierający" nie jest szczeblem drabiny - w kolumnach porównania
    // sugerowałby, że darowizna zastępuje plan.
    h.tiers = [tierRow({ key: "member" }), tierRow({ key: "supporter", rank: 5, sort_order: 0 })];
    await mount();
    await waitFor(() => expect(screen.getByTestId("PricingComparisonMatrix")).toBeTruthy());
    const passed = h.organism.PricingComparisonMatrix?.tiers;
    expect(Array.isArray(passed) ? passed.map((t) => (t as { key: string }).key) : []).toEqual([
      "member",
    ]);
  });

  it("kolejność kolumn idzie po randze, a przy równej randze po sort_order", async () => {
    h.tiers = [
      tierRow({ key: "trzeci", rank: 20, sort_order: 2 }),
      tierRow({ key: "drugi", rank: 10, sort_order: 9 }),
      tierRow({ key: "member", rank: 10, sort_order: 1 }),
    ];
    await mount();
    await waitFor(() => expect(screen.getByTestId("PricingComparisonMatrix")).toBeTruthy());
    const passed = h.organism.PricingComparisonMatrix?.tiers;
    expect(Array.isArray(passed) ? passed.map((t) => (t as { key: string }).key) : []).toEqual([
      "member",
      "drugi",
      "trzeci",
    ]);
  });

  it("BEZ dopasowanej warstwy segment schodzi na indywidualny", async () => {
    // Inaczej konto bez warstwy nie zobaczyłoby ŻADNEJ kolumny i nie miałoby
    // skąd wejść na plan.
    h.tier = null;
    h.tiers = [
      tierRow({ key: "member", audience_key: "individual" }),
      tierRow({ key: "corporate", audience_key: "organization" }),
    ];
    await mount();
    await waitFor(() => expect(screen.getByTestId("PricingComparisonMatrix")).toBeTruthy());
    const passed = h.organism.PricingComparisonMatrix?.tiers;
    expect(Array.isArray(passed) ? passed.map((t) => (t as { key: string }).key) : []).toEqual([
      "member",
    ]);
    expect(h.organism.PricingComparisonMatrix?.currentTierKey).toBeNull();
  });

  it("warstwa BEZ segmentu liczy się jako indywidualna", async () => {
    // Kolumna bez `audience_key` (stary wiersz w bazie) nie może wypaść
    // z porównania - użytkownik zobaczyłby dziurę w cenniku.
    h.tiers = [tierRow({ key: "member", audience_key: null })];
    await mount();
    await waitFor(() => expect(screen.getByTestId("PricingComparisonMatrix")).toBeTruthy());
    const passed = h.organism.PricingComparisonMatrix?.tiers;
    expect(Array.isArray(passed) ? passed.length : 0).toBe(1);
  });

  it("matryca wie, KTÓRA kolumna jest planem użytkownika", async () => {
    h.tiers = [tierRow({ key: "member" })];
    await mount();
    await waitFor(() => expect(screen.getByTestId("PricingComparisonMatrix")).toBeTruthy());
    expect(h.organism.PricingComparisonMatrix?.currentTierKey).toBe("member");
    expect(h.organism.PricingComparisonMatrix?.lang).toBe("pl");
  });
});

describe("źródła poziomu (nadania)", () => {
  it("BEZ NADAŃ sekcja w ogóle nie istnieje", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText("membership.title")).toBeTruthy());
    expect(screen.queryByText("membership.sources.heading")).toBeNull();
  });

  it("nadanie Z DATĄ WYGAŚNIĘCIA pokazuje tę datę", async () => {
    // To jest jedyne miejsce, w którym użytkownik dowiaduje się, że jego
    // poziom kiedyś zniknie.
    h.grants = [{ id: "g1", source: "manual", expires_at: "2027-03-01T00:00:00.000Z" }];
    await mount();
    await waitFor(() => expect(screen.getByText("membership.sources.heading")).toBeTruthy());
    expect(pageText()).toContain("membership.sources.expires(date=");
    expect(pageText()).toContain("2027");
  });

  it("nadanie BEZ DATY mówi wprost, że nie wygasa", async () => {
    h.grants = [{ id: "g1", source: "manual", expires_at: null }];
    await mount();
    await waitFor(() => expect(screen.getByText("membership.sources.noExpiry")).toBeTruthy());
    expect(pageText()).not.toContain("membership.sources.expires(date=");
  });

  it("ŹRÓDŁO nadania jedzie w kluczu - każdy typ ma własną etykietę", async () => {
    // Nowy typ nadania nie może pokazać pustki: klucz jest budowany ze
    // źródła, a brakujące tłumaczenie łapie bramka parytetu i18n.
    h.grants = [
      { id: "g1", source: "manual", expires_at: null },
      { id: "g2", source: "organization", expires_at: null },
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("membership.sources.grant_manual")).toBeTruthy());
    expect(screen.getByText("membership.sources.grant_organization")).toBeTruthy();
  });
});

describe("wsparcie i darowizny", () => {
  it("BEZ DAROWIZN pokazuje zaproszenie do wsparcia, nie pustą listę", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText("membership.support.none")).toBeTruthy());
    expect(screen.getByText("membership.support.cta")).toBeTruthy();
  });

  it("kwota jest w WALUCIE WPISU, nie w domyślnej", async () => {
    // Darowizna w euro pokazana w złotych to zmiana kwoty w oczach
    // użytkownika - i podstawa reklamacji.
    h.donations = [
      {
        id: "d1",
        amount_cents: 15000,
        currency: "EUR",
        created_at: "2025-06-01T10:00:00.000Z",
        status: "succeeded",
      },
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("membership.support.heading")).toBeTruthy());
    expect(pageText()).toMatch(/150/);
    expect(pageText()).toMatch(/€|EUR/);
    expect(pageText()).toContain("2025");
  });

  it("ZWROT jest oznaczony - inaczej wygląda jak wsparcie, którego już nie ma", async () => {
    h.donations = [
      {
        id: "d1",
        amount_cents: 5000,
        currency: "PLN",
        created_at: "2025-06-01T10:00:00.000Z",
        status: "refunded",
      },
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("membership.support.heading")).toBeTruthy());
    expect(pageText()).toContain("membership.support.refunded");
  });

  it("darowizna rozliczona NIE dostaje adnotacji o zwrocie", async () => {
    h.donations = [
      {
        id: "d1",
        amount_cents: 5000,
        currency: "PLN",
        created_at: "2025-06-01T10:00:00.000Z",
        status: "succeeded",
      },
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("membership.support.heading")).toBeTruthy());
    expect(pageText()).not.toContain("membership.support.refunded");
  });
});

describe("organizacja członkowska", () => {
  it("odbiór zaproszonych miejsc dzieje się PRZY WEJŚCIU na panel", async () => {
    // Bez tego wywołania osoba zaproszona e-mailem nigdy nie dostaje miejsca.
    await mount();
    await waitFor(() => expect(screen.getByText("membership.title")).toBeTruthy());
    expect(h.claimCalls).toBeGreaterThan(0);
  });

  it("BEZ ORGANIZACJI mówi wprost, że jej nie ma - i nie pokazuje miejsc", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText("membership.organization.none")).toBeTruthy());
    expect(screen.queryByText("membership.organization.seatsHeading")).toBeNull();
  });

  it("pokazuje nazwę organizacji, rolę, miejsca i status", async () => {
    h.organization = organization();
    await mount();
    await waitFor(() => expect(screen.getByText("Instytut Przykładowy")).toBeTruthy());
    expect(screen.getByText("membership.organization.roleOwner")).toBeTruthy();
    expect(pageText()).toContain("membership.organization.seatsUsage(limit=5,used=2)");
    expect(screen.getByText("membership.organization.statusActive")).toBeTruthy();
  });

  it("ORGANIZACJA WSTRZYMANA jest oznaczona, nie zlana ze aktywną", async () => {
    // Zlanie tych stanów pokazuje pakiet praw, którego użytkownik nie ma.
    h.organization = organization({ status: "suspended" });
    await mount();
    await waitFor(() =>
      expect(screen.getByText("membership.organization.statusSuspended")).toBeTruthy(),
    );
    expect(screen.queryByText("membership.organization.statusActive")).toBeNull();
  });

  it("data wygaśnięcia organizacji jest pokazana, gdy istnieje", async () => {
    h.organization = organization({ expires_at: "2027-01-31T00:00:00.000Z" });
    await mount();
    await waitFor(() => expect(screen.getByText("Instytut Przykładowy")).toBeTruthy());
    expect(pageText()).toContain("membership.sources.expires(date=");
    expect(pageText()).toContain("2027");
  });

  it("bez daty wygaśnięcia nie ma linii o wygaśnięciu", async () => {
    h.organization = organization({ expires_at: null });
    await mount();
    await waitFor(() => expect(screen.getByText("Instytut Przykładowy")).toBeTruthy());
    expect(pageText()).not.toContain("membership.sources.expires(date=");
  });

  it("CZŁONEK widzi swoją rolę, ale NIE zarządza miejscami", async () => {
    // To jest bramka uprawnień, nie kosmetyka: członek nie może zapraszać ani
    // usuwać nikogo z organizacji, którą tylko współdzieli.
    h.organization = organization({ my_role: "member" });
    h.seats = [{ id: "s1", invited_email: "osoba@example.org", claimed_at: null, role: "member" }];
    await mount();
    await waitFor(() =>
      expect(screen.getByText("membership.organization.roleMember")).toBeTruthy(),
    );
    expect(screen.queryByText("membership.organization.seatsHeading")).toBeNull();
    expect(screen.queryByText("membership.organization.invite")).toBeNull();
  });

  it("WŁAŚCICIEL dostaje panel miejsc", async () => {
    h.organization = organization({ my_role: "owner" });
    await mount();
    await waitFor(() =>
      expect(screen.getByText("membership.organization.seatsHeading")).toBeTruthy(),
    );
  });

  it("panel samoobsługi organizacji jest osiągalny z huba", async () => {
    h.organization = organization();
    await mount();
    await waitFor(() => expect(screen.getByText("membership.organization.openPanel")).toBeTruthy());
  });
});

describe("zarządzanie miejscami organizacji", () => {
  beforeEach(() => {
    h.organization = organization({ my_role: "owner" });
  });

  it("miejsce ODEBRANE i NIEODEBRANE mają różne oznaczenia", async () => {
    // Właściciel musi wiedzieć, na kogo jeszcze czeka - inaczej wysyła
    // zaproszenie drugi raz i zajmuje kolejne miejsce.
    h.seats = [
      {
        id: "s1",
        invited_email: "odebrane@example.org",
        claimed_at: "2026-01-01T00:00:00.000Z",
        role: "member",
      },
      { id: "s2", invited_email: "czeka@example.org", claimed_at: null, role: "member" },
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("odebrane@example.org")).toBeTruthy());
    expect(screen.getByText("membership.organization.claimed")).toBeTruthy();
    expect(screen.getByText("membership.organization.pending")).toBeTruthy();
  });

  it("MIEJSCE WŁAŚCICIELA nie ma przycisku usuwania", async () => {
    // Inaczej jedno kliknięcie odbiera właścicielowi jego własną organizację.
    h.seats = [
      { id: "s1", invited_email: "wlasciciel@example.org", claimed_at: null, role: "owner" },
      { id: "s2", invited_email: "czlonek@example.org", claimed_at: null, role: "member" },
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("wlasciciel@example.org")).toBeTruthy());
    const removeButtons = screen.getAllByLabelText("membership.organization.remove");
    expect(removeButtons).toHaveLength(1);
  });

  it("usunięcie miejsca woła mutację z JEGO identyfikatorem", async () => {
    h.seats = [
      { id: "s1", invited_email: "pierwszy@example.org", claimed_at: null, role: "member" },
      { id: "s2", invited_email: "drugi@example.org", claimed_at: null, role: "member" },
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("drugi@example.org")).toBeTruthy());
    fireEvent.click(screen.getAllByLabelText("membership.organization.remove")[1]);
    expect(h.removedSeats).toEqual(["s2"]);
  });

  it("trwające usuwanie blokuje przycisk - bez podwójnego odebrania miejsca", async () => {
    h.removeSeatPending = true;
    h.seats = [{ id: "s1", invited_email: "osoba@example.org", claimed_at: null, role: "member" }];
    await mount();
    await waitFor(() => expect(screen.getByText("osoba@example.org")).toBeTruthy());
    const button = screen.getByLabelText("membership.organization.remove");
    expect(button).toBeDisabled();
  });

  it("PUSTY ADRES nie da się zaprosić - przycisk jest wyłączony", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText("membership.organization.invite")).toBeTruthy());
    expect(screen.getByText("membership.organization.invite").closest("button")).toBeDisabled();
    expect(h.addedSeats).toEqual([]);
  });

  it("ADRES JEST NORMALIZOWANY przed wysłaniem zaproszenia", async () => {
    // Bez `trim` i `toLowerCase` zaproszenie nie zejdzie się z kontem
    // założonym na małych literach - miejsce zostaje zajęte, a zaproszony
    // nigdy go nie odbiera.
    await mount();
    await waitFor(() => expect(screen.getByText("membership.organization.invite")).toBeTruthy());
    const input = screen.getByPlaceholderText("membership.organization.invitePlaceholder");
    fireEvent.change(input, { target: { value: "  Osoba@Example.ORG  " } });
    fireEvent.click(screen.getByText("membership.organization.invite"));
    expect(h.addedSeats).toEqual([{ orgId: "org-1", email: "osoba@example.org" }]);
  });

  it("po udanym zaproszeniu pole się CZYŚCI i leci potwierdzenie", async () => {
    // Niewyczyszczone pole zaprasza do drugiego kliknięcia tego samego adresu.
    await mount();
    await waitFor(() => expect(screen.getByText("membership.organization.invite")).toBeTruthy());
    const input = screen.getByPlaceholderText("membership.organization.invitePlaceholder");
    fireEvent.change(input, { target: { value: "nowa@example.org" } });
    fireEvent.click(screen.getByText("membership.organization.invite"));
    await waitFor(() =>
      expect(h.toasts).toEqual([
        { variant: "success", message: "membership.organization.inviteSuccess" },
      ]),
    );
    await waitFor(() =>
      expect(screen.getByPlaceholderText("membership.organization.invitePlaceholder")).toHaveValue(
        "",
      ),
    );
  });

  it("WYCZERPANY LIMIT MIEJSC ma własny komunikat", async () => {
    // Wspólne „nie udało się" kazałoby właścicielowi kupować miejsca, których
    // już ma dość.
    h.addSeatError = "seat limit reached";
    await mount();
    await waitFor(() => expect(screen.getByText("membership.organization.invite")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("membership.organization.invitePlaceholder"), {
      target: { value: "nowa@example.org" },
    });
    fireEvent.click(screen.getByText("membership.organization.invite"));
    await waitFor(() =>
      expect(h.toasts).toEqual([
        { variant: "error", message: "membership.organization.seatLimitReached" },
      ]),
    );
  });

  it("ADRES JUŻ ZAPROSZONY ma własny komunikat", async () => {
    h.addSeatError = "seat already exists";
    await mount();
    await waitFor(() => expect(screen.getByText("membership.organization.invite")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("membership.organization.invitePlaceholder"), {
      target: { value: "juz@example.org" },
    });
    fireEvent.click(screen.getByText("membership.organization.invite"));
    await waitFor(() =>
      expect(h.toasts).toEqual([
        { variant: "error", message: "membership.organization.seatExists" },
      ]),
    );
  });

  it("KAŻDY INNY BŁĄD dostaje komunikat ogólny, ale NIE cichy sukces", async () => {
    h.addSeatError = "network down";
    await mount();
    await waitFor(() => expect(screen.getByText("membership.organization.invite")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("membership.organization.invitePlaceholder"), {
      target: { value: "nowa@example.org" },
    });
    fireEvent.click(screen.getByText("membership.organization.invite"));
    await waitFor(() =>
      expect(h.toasts).toEqual([
        { variant: "error", message: "membership.organization.inviteError" },
      ]),
    );
  });

  it("trwające zaproszenie blokuje przycisk", async () => {
    h.addSeatPending = true;
    await mount();
    await waitFor(() => expect(screen.getByText("membership.organization.invite")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("membership.organization.invitePlaceholder"), {
      target: { value: "nowa@example.org" },
    });
    expect(screen.getByText("membership.organization.invite").closest("button")).toBeDisabled();
  });
});

describe("historia uczestnictwa", () => {
  // Daty są odległe o lata od dowolnego dnia uruchomienia testu, więc podział
  // „przeszłe / przyszłe" jest deterministyczny bez ruszania zegara.
  const PAST = "2020-01-15T18:00:00.000Z";
  const FUTURE = "2099-01-15T18:00:00.000Z";

  it("BEZ UCZESTNICTWA mówi wprost, że historia jest pusta", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText("membership.events.none")).toBeTruthy());
  });

  it("rozróżnia wydarzenie MINIONE od nadchodzącego", async () => {
    h.participation = [
      {
        event_id: "e1",
        slug: "konferencja-2020",
        title_pl: "Konferencja 2020",
        title_en: "Conference 2020",
        starts_at: PAST,
        rsvp_status: "going",
      },
      {
        event_id: "e2",
        slug: "konferencja-2099",
        title_pl: "Konferencja 2099",
        title_en: "Conference 2099",
        starts_at: FUTURE,
        rsvp_status: "going",
      },
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("Konferencja 2020")).toBeTruthy());
    expect(screen.getByText("membership.events.past")).toBeTruthy();
    expect(screen.getByText("membership.events.upcoming")).toBeTruthy();
  });

  it("trzy stany RSVP mają trzy różne etykiety", async () => {
    // „Odwołane" pokazane jako „wybieram się" wysyła użytkownika na
    // wydarzenie, którego nie ma.
    h.participation = [
      {
        event_id: "e1",
        slug: "a",
        title_pl: "Idę",
        title_en: "Going",
        starts_at: FUTURE,
        rsvp_status: "going",
      },
      {
        event_id: "e2",
        slug: "b",
        title_pl: "Może",
        title_en: "Maybe",
        starts_at: FUTURE,
        rsvp_status: "interested",
      },
      {
        event_id: "e3",
        slug: "c",
        title_pl: "Odwołane",
        title_en: "Cancelled",
        starts_at: FUTURE,
        rsvp_status: "cancelled",
      },
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("Idę")).toBeTruthy());
    expect(screen.getByText("membership.events.statusGoing")).toBeTruthy();
    expect(screen.getByText("membership.events.statusInterested")).toBeTruthy();
    expect(screen.getByText("membership.events.statusCancelled")).toBeTruthy();
  });

  it("odnośnik prowadzi do KONKRETNEGO wydarzenia, nie do szablonu adresu", async () => {
    h.participation = [
      {
        event_id: "e1",
        slug: "szczyt-energetyczny",
        title_pl: "Szczyt energetyczny",
        title_en: "Energy summit",
        starts_at: FUTURE,
        rsvp_status: "going",
      },
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("Szczyt energetyczny")).toBeTruthy());
    const link = screen.getByText("Szczyt energetyczny").closest("a");
    expect(link?.getAttribute("href")).toBe("/events/szczyt-energetyczny");
  });

  it("EN bez tytułu angielskiego pokazuje POLSKI, nie pusty odnośnik", async () => {
    // Pusty odnośnik jest nieklikalny świadomie - użytkownik nie wie, gdzie
    // prowadzi.
    h.language = "en";
    h.participation = [
      {
        event_id: "e1",
        slug: "spotkanie",
        title_pl: "Spotkanie regionalne",
        title_en: "",
        starts_at: FUTURE,
        rsvp_status: "going",
      },
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("Spotkanie regionalne")).toBeTruthy());
  });

  it("PL bez tytułu polskiego pokazuje ANGIELSKI - symetrycznie", async () => {
    h.participation = [
      {
        event_id: "e1",
        slug: "meeting",
        title_pl: "",
        title_en: "Regional meeting",
        starts_at: FUTURE,
        rsvp_status: "going",
      },
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("Regional meeting")).toBeTruthy());
  });
});

describe("pobrania z biblioteki", () => {
  it("BEZ POBRAŃ pokazuje wejście do biblioteki, nie pustą listę", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText("membership.downloads.none")).toBeTruthy());
    expect(screen.getByText("membership.downloads.openLibrary")).toBeTruthy();
  });

  it("pokazuje tytuł i datę pobrania", async () => {
    h.downloads = [
      {
        resource_id: "r1",
        title_pl: "Raport roczny",
        title_en: "Annual report",
        downloaded_at: "2025-11-20T09:00:00.000Z",
      },
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("Raport roczny")).toBeTruthy());
    expect(pageText()).toContain("2025");
    expect(screen.queryByText("membership.downloads.none")).toBeNull();
  });

  it("EN bez tytułu angielskiego pokazuje POLSKI", async () => {
    h.language = "en";
    h.downloads = [
      {
        resource_id: "r1",
        title_pl: "Raport roczny",
        title_en: "",
        downloaded_at: "2025-11-20T09:00:00.000Z",
      },
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("Raport roczny")).toBeTruthy());
  });

  it("PL bez tytułu polskiego pokazuje ANGIELSKI", async () => {
    h.downloads = [
      {
        resource_id: "r1",
        title_pl: "",
        title_en: "Annual report",
        downloaded_at: "2025-11-20T09:00:00.000Z",
      },
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("Annual report")).toBeTruthy());
  });
});

describe("zarządzanie subskrypcją w hubie", () => {
  it("hub montuje ten sam panel subskrypcji, co /profile/subscription", async () => {
    // Dwa różne panele rozjechałyby się przy pierwszej zmianie reguł
    // rozliczeń - a to są pieniądze użytkownika.
    await mount();
    await waitFor(() => expect(screen.getByTestId("SubscriptionManagerSection")).toBeTruthy());
  });
});

describe("odczyty, które jeszcze nie wróciły", () => {
  it("PANEL RYSUJE SIĘ, gdy ŻADEN odczyt nie ma jeszcze danych", async () => {
    // To jest pierwszy render po wejściu na trasę: sześć niezależnych
    // zapytań i żadne nie odpowiedziało. Panel, który się wtedy wywala,
    // pokazuje pusty ekran zamiast szkieletu - a to jedyne miejsce, gdzie
    // użytkownik ogląda swoje uprawnienia.
    h.tiers = undefined;
    h.grants = undefined;
    h.donations = undefined;
    h.seats = undefined;
    h.participation = undefined;
    h.downloads = undefined;
    h.organization = organization({ my_role: "owner" });
    await mount();
    await waitFor(() => expect(screen.getByText("membership.title")).toBeTruthy());
    // Sekcje z listami schodzą do stanu pustego, a nie do wyjątku.
    expect(screen.getByText("membership.support.none")).toBeTruthy();
    expect(screen.getByText("membership.events.none")).toBeTruthy();
    expect(screen.getByText("membership.downloads.none")).toBeTruthy();
    // Nadania bez danych nie pokazują nagłówka sekcji.
    expect(screen.queryByText("membership.sources.heading")).toBeNull();
    // Panel miejsc istnieje (właściciel), tylko lista jest pusta.
    expect(screen.getByText("membership.organization.seatsHeading")).toBeTruthy();
    // Porównanie planów dostaje pustą listę, nie `undefined`.
    expect(h.organism.PricingComparisonMatrix?.tiers).toEqual([]);
  });
});

describe("formatowanie daty i błędy nietypowe", () => {
  it("data darowizny jest w formacie ANGIELSKIM przy angielskim widoku", async () => {
    // „01/06/2025" kontra „01.06.2025" to nie kosmetyka: przy dwuznacznym
    // dniu i miesiącu użytkownik czyta inną datę, niż jest w wyciągu.
    h.language = "en";
    h.donations = [
      {
        id: "d1",
        amount_cents: 5000,
        currency: "PLN",
        created_at: "2025-06-01T10:00:00.000Z",
        status: "succeeded",
      },
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("membership.support.heading")).toBeTruthy());
    expect(pageText()).toContain("01/06/2025");
  });

  it("ta sama data po polsku ma format polski", async () => {
    h.donations = [
      {
        id: "d1",
        amount_cents: 5000,
        currency: "PLN",
        created_at: "2025-06-01T10:00:00.000Z",
        status: "succeeded",
      },
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("membership.support.heading")).toBeTruthy());
    expect(pageText()).toContain("1.06.2025");
    expect(pageText()).not.toContain("01/06/2025");
  });

  it("WPIS BEZ DATY nie wypisuje błędu przeglądarki w miejscu daty", async () => {
    // Dryf danych (import, stary wiersz) nie może zamienić kwoty wsparcia
    // w komunikat o błędzie przeglądarki.
    h.donations = [
      {
        id: "d1",
        amount_cents: 5000,
        currency: "PLN",
        created_at: null,
        status: "succeeded",
      },
    ];
    await mount();
    await waitFor(() => expect(screen.getByText("membership.support.heading")).toBeTruthy());
    expect(pageText()).toMatch(/50/);
    expect(pageText()).not.toContain("Invalid Date");
    expect(pageText()).not.toContain("NaN");
  });

  it("ODRZUCENIE, KTÓRE NIE JEST WYJĄTKIEM, też daje komunikat", async () => {
    // Warstwa sieci i PostgREST potrafią oddać goły łańcuch. Bez gałęzi
    // `instanceof Error` właściciel zobaczyłby ciszę i wnioskował, że
    // zaproszenie poszło.
    h.organization = organization({ my_role: "owner" });
    h.addSeatNonError = true;
    await mount();
    await waitFor(() => expect(screen.getByText("membership.organization.invite")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("membership.organization.invitePlaceholder"), {
      target: { value: "nowa@example.org" },
    });
    fireEvent.click(screen.getByText("membership.organization.invite"));
    await waitFor(() =>
      expect(h.toasts).toEqual([
        { variant: "error", message: "membership.organization.inviteError" },
      ]),
    );
  });
});
