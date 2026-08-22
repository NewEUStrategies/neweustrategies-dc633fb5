// Panel samoobsługi organizacji B2B (`/profile/organization`). Stał na zerze.
//
// CO TEN PLIK DOWODZI - I CO SIĘ PSUJE, GDY TO PRZESTANIE DZIAŁAĆ.
//
// To jedyne miejsce w produkcie, w którym KLIENT INSTYTUCJONALNY sam rozdaje
// opłacone miejsca. Każda pomyłka tutaj kosztuje albo dostęp opłaconej osoby,
// albo cudzy dostęp odebrany omyłkowo - i za każdym razem kończy się zgłoszeniem
// do redakcji, czyli dokładnie tym, co ten panel miał wyeliminować.
//
//   1. DOSTĘP MA CZTERY STANY, NIE DWA. Gość, zalogowany bez organizacji,
//      członek organizacji i administrator organizacji widzą CZTERY różne
//      ekrany. Zlanie „członka" z „administratorem" oddałoby zwykłemu
//      pracownikowi przycisk usuwania miejsc kolegów; zlanie „gościa"
//      z „bez organizacji" pokazałoby niezalogowanemu zaproszenie do zakupu
//      zamiast drogi do logowania.
//   2. ODCZYT W TOKU NIE JEST BRAKIEM ORGANIZACJI. To najtańszy sposób
//      powiedzieć płacącej instytucji „nie masz nic": wystarczy pokazać kartę
//      „Brak organizacji" na czas pierwszego zapytania. Stąd trzy ROZŁĄCZNE
//      stany odczytu: oczekiwanie / jest wiersz / nie ma wiersza.
//   3. WALIDACJA I NORMALIZACJA IDĄ PRZED ZAPISEM. Adres jest obcinany
//      i sprowadzany do małych liter, bo „ Jan@Example.COM " wklejone z maila
//      utworzyłoby drugie miejsce dla tej samej osoby - a limit miejsc jest
//      opłacony. Tu też siedzi DEFEKT zgłoszony jako `it.fails`: literówka
//      w adresie NIE jest łapana przed round-tripem, a komunikat nie mówi,
//      co poprawić.
//   4. BŁĄD BAZY MA TRAFIĆ W SWÓJ KOMUNIKAT. Panel mapuje komunikaty definera
//      (`orgs: seats limit reached`, `orgs: seat exists`) na osobne zdania.
//      Test używa DOKŁADNIE tych napisów, które podnosi migracja - gdyby baza
//      zmieniła treść wyjątku, mapowanie po fragmencie przestałoby trafiać
//      i właściciel dostałby „nie udało się" tam, gdzie chodzi o wyczerpany
//      limit, czyli o pieniądze.
//   5. PODWÓJNE KLIKNIĘCIE NIE WYSYŁA DWÓCH MAILI. Zaproszenie i ponowienie
//      mają własne blokady w trakcie lotu; bez nich zaproszony dostaje dwa
//      identyczne maile, a licznik miejsc rusza dwa razy.
//   6. JĘZYK PANELU JEDZIE DO SERWERA. `lang` z interfejsu decyduje, w jakim
//      języku przyjdzie mail z zaproszeniem, a data w panelu ma format
//      lokalny - polski z kropkami, brytyjski z ukośnikami.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - WARSTWY DANYCH CZŁONKOSTWA: `useMyOrganization`, `useOrgSeats`,
//   `useRemoveSeat`, `useClaimOrgSeats` mają testy w
//   `src/lib/billing/__tests__/membershipHooks.test.tsx` i `membership.test.ts`.
//   Tutaj są atrapami, bo przedmiotem dowodu jest ZACHOWANIE PANELU wobec ich
//   wyniku, nie sposób odczytu.
// - FUNKCJI SERWEROWYCH `inviteOrgSeat` / `resendOrgSeatInvite`: mają
//   `src/lib/organizations/__tests__/organizationsFunctions.test.ts`, a treść
//   maila `inviteEmail.test.ts`.
// - AUTORYTETU (kto MOŻE dodać/usunąć miejsce): egzekwuje go baza -
//   `org_add_seat` / `org_touch_seat_invite` (SECURITY DEFINER) i RLS na
//   `organization_seats`. To warstwa pgTAP, nie vitest (§8 zadania). Tutaj
//   dowodzimy wyłącznie, że INTERFEJS nie pokazuje narzędzi komuś, kto ich
//   nie ma, i że odmowę bazy tłumaczy na zdanie po ludzku.
// - POWŁOKI `/profile` (bramka sesji layoutu, szuflada nawigacji):
//   `src/routes/__tests__/profileShellRoutes.test.tsx`. Ta trasa ma WŁASNY
//   `AuthGate` i to jego trzy stany są tu przedmiotem dowodu.
// - KATALOGU WARSTW: `lib/billing/tiers` ma własne testy; `tierName` biegnie
//   tu prawdziwy, bo dowodzimy, że panel nazywa warstwę zgodnie z językiem.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

/** Organizacja w kształcie, jaki oddaje RPC `my_organization`. */
interface AtrapaOrganizacji {
  org_id: string;
  name: string;
  tier_key: string;
  my_role: string;
  status: string;
  seats_limit: number;
  seats_used: number;
  starts_at: string;
  expires_at: string | null;
}

/** Wiersz miejsca w kształcie tabeli `organization_seats`. */
interface AtrapaMiejsca {
  id: string;
  invited_email: string;
  role: string;
  claimed_at: string | null;
  created_at: string;
  last_invited_at: string | null;
}

/** Wiersz katalogu warstw w części, której dotyka panel. */
interface AtrapaWarstwy {
  key: string;
  name_pl: string;
  name_en: string;
}

/** Odpowiedź funkcji serwerowej zaproszenia - obie gałęzie kontraktu. */
type WynikZaproszenia =
  | { ok: true; seatId: string; emailSent: boolean }
  // `error: null` opisuje ładunek, z którego zginęła treść błędu - panel ma
  // wtedy pokazać komunikat ogólny, a nie pusty toast.
  | { ok: false; error: string | null };

/** Odpowiedź funkcji serwerowej ponowienia zaproszenia. */
type WynikPonowienia = { ok: true; emailSent: boolean } | { ok: false; error: string };

const h = vi.hoisted(() => ({
  /** Sesja: `null` = gość (AuthGate pokazuje odmowę 401). */
  session: {} as unknown,
  authLoading: false,
  user: { id: "user-1" } as { id: string } | null,
  language: "pl",
  /** Czy odczyt organizacji jest w toku (stan rozłączny z dwoma poniżej). */
  orgLoading: false,
  /** Wiersz organizacji albo `null` = wołający nie ma miejsca w żadnej. */
  org: null as AtrapaOrganizacji | null,
  /** `undefined` = odczyt miejsc jeszcze nie wrócił. */
  seats: undefined as AtrapaMiejsca[] | undefined,
  /** Katalog warstw; `undefined` = odczyt jeszcze nie wrócił. */
  tiers: undefined as AtrapaWarstwy[] | undefined,
  /** Ile razy panel zawołał idempotentny odbiór zaproszonych miejsc. */
  claimCalls: 0,
  /** Dla jakich identyfikatorów organizacji panel poprosił o miejsca. */
  seatsQueriedFor: [] as (string | null | undefined)[],
  /** Ładunki, z jakimi poleciało zaproszenie (dowód normalizacji adresu). */
  inviteCalls: [] as Record<string, unknown>[],
  inviteResult: { ok: true, seatId: "seat-new", emailSent: true } as WynikZaproszenia,
  /** Czy zaproszenie ma paść awarią transportu (zamiast odmowy z treścią). */
  inviteThrows: false,
  /** Zasuwa wstrzymująca odpowiedź serwera - do dowodów o stanie „w locie". */
  inviteGate: null as Promise<void> | null,
  resendCalls: [] as Record<string, unknown>[],
  resendResult: { ok: true, emailSent: true } as WynikPonowienia,
  resendThrows: false,
  resendGate: null as Promise<void> | null,
  /** Identyfikatory miejsc, dla których poleciało usunięcie. */
  removeCalls: [] as string[],
  /** Czy usunięcie ma paść (odmowa RLS). */
  removeFails: false,
  removeGate: null as Promise<void> | null,
  toastSuccess: [] as string[],
  toastError: [] as string[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("@/lib/i18n-profile", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-membership", () => ({ ensureI18n: () => undefined }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: h.session, loading: h.authLoading, user: h.user }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => h.toastSuccess.push(message),
    error: (message: string) => h.toastError.push(message),
  },
}));
vi.mock("@/components/error/FriendlyErrorPage", () => ({
  FriendlyErrorPage: (props: { error: { status: number } }) => (
    <div data-testid="friendly-error" data-status={String(props.error.status)} />
  ),
}));
// Warstwa danych członkostwa ma własne testy - tutaj atrapa oddaje sterowalne
// stany. `useRemoveSeat` biegnie na PRAWDZIWEJ mutacji React Query, bo dowód
// o zablokowanym koszu w trakcie usuwania dotyczy realnego `isPending`,
// a nie flagi wpisanej z palca.
vi.mock("@/lib/billing/membership", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    useMyOrganization: () => ({ isLoading: h.orgLoading, data: h.org }),
    useOrgSeats: (orgId: string | null | undefined) => {
      h.seatsQueriedFor.push(orgId);
      return { data: h.seats };
    },
    useRemoveSeat: () =>
      useMutation({
        mutationFn: async (seatId: string) => {
          h.removeCalls.push(seatId);
          if (h.removeGate) await h.removeGate;
          if (h.removeFails) throw new Error("odmowa RLS");
        },
      }),
    useClaimOrgSeats: () => {
      h.claimCalls += 1;
    },
  };
});
vi.mock("@/lib/billing/tiers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/tiers")>()),
  useMembershipTiers: () => ({ data: h.tiers }),
}));
vi.mock("@/lib/organizations/selfservice.functions", () => ({
  inviteOrgSeat: async (args: { data: Record<string, unknown> }) => {
    h.inviteCalls.push(args.data);
    if (h.inviteGate) await h.inviteGate;
    if (h.inviteThrows) throw new Error("transport padł");
    return h.inviteResult;
  },
  resendOrgSeatInvite: async (args: { data: Record<string, unknown> }) => {
    h.resendCalls.push(args.data);
    if (h.resendGate) await h.resendGate;
    if (h.resendThrows) throw new Error("transport padł");
    return h.resendResult;
  },
}));
// Mock CZĘŚCIOWY: `useServerFn` staje się tożsamością, ale reszta modułu musi
// zostać - `@/lib/i18n` ciągnie stąd `createIsomorphicFn`.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

import { QueryClient } from "@tanstack/react-query";
import { renderRoute } from "@/test/routeHarness";
import { Route as OrganizationRoute } from "@/routes/profile.organization";
import { billingKeys } from "@/lib/billing/keys";
import {
  subscribeAppDialog,
  type ConfirmDialogRequest,
  type PendingDialog,
} from "@/lib/appDialogs";

const PATH = "/profile/organization";
const ORG_ID = "11111111-1111-4111-8111-111111111111";
/** Napisy podnoszone przez definer `org_add_seat` (migracja 20260713174428). */
const BLAD_LIMITU = "orgs: seats limit reached";
const BLAD_DUPLIKATU = "orgs: seat exists";
const BLAD_INNY = "orgs: not allowed";

/** Wiersz organizacji z sensownymi wartościami domyślnymi. */
function organizacja(patch: Partial<AtrapaOrganizacji> = {}): AtrapaOrganizacji {
  return {
    org_id: ORG_ID,
    name: "Fundacja Przykładowa",
    tier_key: "corporate",
    my_role: "owner",
    status: "active",
    seats_limit: 10,
    seats_used: 3,
    starts_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2026-12-31T00:00:00.000Z",
    ...patch,
  };
}

/** Wiersz miejsca - domyślnie zaproszenie oczekujące na odbiór. */
function miejsce(patch: Partial<AtrapaMiejsca> = {}): AtrapaMiejsca {
  return {
    id: "seat-1",
    invited_email: "zespol@example.com",
    role: "member",
    claimed_at: null,
    created_at: "2026-02-01T00:00:00.000Z",
    last_invited_at: "2026-02-01T00:00:00.000Z",
    ...patch,
  };
}

/** Zasuwa: obietnica, którą test otwiera w wybranym momencie. */
interface Zasuwa {
  obietnica: Promise<void>;
  otworz: () => void;
}

function zasuwa(): Zasuwa {
  let otworz: () => void = () => undefined;
  const obietnica = new Promise<void>((resolve) => {
    otworz = () => resolve();
  });
  return { obietnica, otworz };
}

/** Ostatni dialog zgłoszony przez PRAWDZIWY `confirmDialog` (bez atrapy). */
let oczekujacyDialog: PendingDialog | null = null;
let odsubskrybuj: (() => void) | null = null;

interface OtwartePotwierdzenie {
  request: ConfirmDialogRequest;
  potwierdz: () => void;
  anuluj: () => void;
}

/**
 * Otwarte potwierdzenie w kształcie, którego dotyczy dowód. STRAŻNIK, nie
 * rzutowanie: `kind !== "confirm"` sprawdza w runtime, że to potwierdzenie
 * (a nie okno z polem tekstowym), i dopiero to zawęża typ żądania.
 */
function otwartePotwierdzenie(): OtwartePotwierdzenie {
  const pending = oczekujacyDialog;
  if (pending === null) throw new Error("test: panel nie zapytał o potwierdzenie");
  const request = pending.request;
  if (request.kind !== "confirm") {
    throw new Error("test: otwarty dialog nie jest potwierdzeniem");
  }
  return {
    request,
    potwierdz: () => pending.resolve(true),
    anuluj: () => pending.resolve(false),
  };
}

let queryClient: QueryClient;

async function zamontuj() {
  return renderRoute({
    route: OrganizationRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient,
  });
}

/** Pole adresu zaproszenia - jedyne pole tekstowe panelu. */
function poleAdresu(): HTMLInputElement {
  const node = screen.getByPlaceholderText("membership.orgPanel.invitePlaceholder");
  if (!(node instanceof HTMLInputElement)) throw new Error("test: to nie jest pole tekstowe");
  return node;
}

function przyciskWyslij(): HTMLElement {
  return screen.getByRole("button", { name: "membership.orgPanel.inviteButton" });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.session = {};
  h.authLoading = false;
  h.user = { id: "user-1" };
  h.language = "pl";
  h.orgLoading = false;
  h.org = organizacja();
  h.seats = [];
  h.tiers = undefined;
  h.claimCalls = 0;
  h.seatsQueriedFor = [];
  h.inviteCalls = [];
  h.inviteResult = { ok: true, seatId: "seat-new", emailSent: true };
  h.inviteThrows = false;
  h.inviteGate = null;
  h.resendCalls = [];
  h.resendResult = { ok: true, emailSent: true };
  h.resendThrows = false;
  h.resendGate = null;
  h.removeCalls = [];
  h.removeFails = false;
  h.removeGate = null;
  h.toastSuccess = [];
  h.toastError = [];
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  oczekujacyDialog = null;
  odsubskrybuj = subscribeAppDialog((pending) => {
    oczekujacyDialog = pending;
  });
});

afterEach(() => {
  // Niedomknięty dialog przeciekłby do następnego testu (stan modułu).
  oczekujacyDialog?.resolve(false);
  odsubskrybuj?.();
  odsubskrybuj = null;
  cleanup();
});

describe("dostęp - cztery różne ekrany", () => {
  it("OCZEKIWANIE na sesję pokazuje wskaźnik, nie odmowę i nie panel", async () => {
    // Odmowa mrugnięta w trakcie ładowania sesji wygląda jak wylogowanie.
    h.authLoading = true;
    h.session = null;
    await zamontuj();
    expect(screen.getByLabelText("loading")).toBeTruthy();
    expect(screen.queryByTestId("friendly-error")).toBeNull();
    expect(screen.queryByText("membership.orgPanel.title")).toBeNull();
  });

  it("GOŚĆ dostaje odmowę 401 NA MIEJSCU, bez przekierowania", async () => {
    // Trasa zostaje publiczna (SSR, udostępnianie odnośnika, „wstecz"),
    // a treść jest zamknięta - to decyzja opisana w `AuthGate`.
    h.session = null;
    const view = await zamontuj();
    expect(screen.getByTestId("friendly-error").getAttribute("data-status")).toBe("401");
    expect(view.currentPath()).toBe(PATH);
    expect(screen.queryByText("membership.orgPanel.membersHeading")).toBeNull();
  });

  it("ZALOGOWANY BEZ ORGANIZACJI dostaje drogę do członkostwa instytucjonalnego", async () => {
    h.org = null;
    await zamontuj();
    expect(screen.getByText("membership.orgPanel.noOrgTitle")).toBeTruthy();
    expect(screen.getByText("membership.orgPanel.noOrgBody")).toBeTruthy();
    expect(
      screen.getByText("membership.orgPanel.contactCta").closest("a")?.getAttribute("href"),
    ).toBe("/pricing");
  });

  it("ODCZYT W TOKU to NIE „brak organizacji” - i to jest sedno tego testu", async () => {
    // Karta „Brak organizacji" pokazana na czas pierwszego zapytania mówi
    // płacącej instytucji, że nie ma nic - najtańszy sposób na zgłoszenie
    // do redakcji.
    h.orgLoading = true;
    h.org = null;
    await zamontuj();
    expect(screen.getByText("membership.loading")).toBeTruthy();
    expect(screen.queryByText("membership.orgPanel.noOrgTitle")).toBeNull();
  });

  it("CZŁONEK organizacji widzi wariant informacyjny, BEZ narzędzi administratora", async () => {
    // Zwykły pracownik z przyciskiem „usuń miejsce" mógłby odebrać dostęp
    // koledze - autorytet zamyka baza, ale interfejs nie ma tego kusić.
    h.org = organizacja({ my_role: "member" });
    await zamontuj();
    expect(screen.getByText("membership.orgPanel.memberViewNote")).toBeTruthy();
    expect(screen.getByText("membership.organization.roleMember")).toBeTruthy();
    expect(screen.queryByText("membership.orgPanel.inviteHeading")).toBeNull();
    expect(screen.queryByText("membership.orgPanel.membersHeading")).toBeNull();
  });

  it("ADMINISTRATOR organizacji dostaje formularz zaproszeń i tabelę miejsc", async () => {
    await zamontuj();
    expect(screen.getByText("membership.organization.roleOwner")).toBeTruthy();
    expect(screen.getByText("membership.orgPanel.inviteHeading")).toBeTruthy();
    expect(screen.getByText("membership.orgPanel.membersHeading")).toBeTruthy();
    expect(screen.queryByText("membership.orgPanel.memberViewNote")).toBeNull();
  });

  it("panel ODBIERA zaproszone miejsca przy wejściu", async () => {
    // Bez tego osoba, która właśnie kliknęła zaproszenie z maila i się
    // zalogowała, widziałaby „brak organizacji" mimo opłaconego miejsca.
    await zamontuj();
    expect(h.claimCalls).toBeGreaterThan(0);
  });

  it("miejsca są czytane dla identyfikatora TEJ organizacji", async () => {
    // Pomyłka w identyfikatorze pokazałaby właścicielowi cudzą listę adresów.
    await zamontuj();
    expect(h.seatsQueriedFor).toContain(ORG_ID);
  });

  it("gość nie pyta o miejsca żadnej organizacji", async () => {
    h.session = null;
    await zamontuj();
    expect(h.seatsQueriedFor).toHaveLength(0);
  });
});

describe("karta organizacji - status, limity i termin", () => {
  it("aktywna organizacja: status aktywny i BEZ noty o zawieszeniu", async () => {
    await zamontuj();
    expect(screen.getByText("membership.organization.statusActive")).toBeTruthy();
    expect(screen.queryByText("membership.orgPanel.suspendedNote")).toBeNull();
    expect(screen.getByText("Fundacja Przykładowa")).toBeTruthy();
  });

  it("ZAWIESZONA organizacja mówi to wprost i BLOKUJE zapraszanie", async () => {
    // Zaproszenie do zawieszonej organizacji i tak odbije się od definera
    // (`orgs: organization inactive`) - właściciel ma to wiedzieć przed
    // wpisaniem adresu, nie po.
    h.org = organizacja({ status: "suspended" });
    await zamontuj();
    expect(screen.getByText("membership.organization.statusSuspended")).toBeTruthy();
    expect(screen.getByText("membership.orgPanel.suspendedNote")).toBeTruthy();
    expect(poleAdresu().disabled).toBe(true);
    expect(przyciskWyslij()).toBeDisabled();
  });

  it("pasek wykorzystania miejsc pokazuje realny procent", async () => {
    h.org = organizacja({ seats_used: 3, seats_limit: 10 });
    await zamontuj();
    expect(document.querySelector<HTMLElement>("div[style*='width']")?.style.width).toBe("30%");
    expect(screen.getByText("membership.organization.seatsUsage(limit=10,used=3)")).toBeTruthy();
  });

  it("limit ZERO nie daje szerokości „NaN%”", async () => {
    // Dzielenie przez zero w stylu inline wypisuje `width: NaN%`, co
    // przeglądarka ignoruje - pasek zostaje pełny i kłamie o wykorzystaniu.
    h.org = organizacja({ seats_used: 0, seats_limit: 0 });
    await zamontuj();
    expect(document.querySelector<HTMLElement>("div[style*='width']")?.style.width).toBe("0%");
  });

  it("PRZEKROCZONY limit ucina pasek na 100%, nie wylewa go poza kontener", async () => {
    // Limit da się obniżyć po fakcie (zmiana umowy), więc 12/10 jest realne.
    h.org = organizacja({ seats_used: 12, seats_limit: 10 });
    await zamontuj();
    expect(document.querySelector<HTMLElement>("div[style*='width']")?.style.width).toBe("100%");
  });

  it("termin członkostwa pokazuje DATĘ, gdy organizacja ma termin", async () => {
    await zamontuj();
    expect(screen.queryByText("membership.orgPanel.noExpiry")).toBeNull();
    expect(document.body.textContent?.includes("membership.orgPanel.expiresAt(date=")).toBe(true);
  });

  it("organizacja bez terminu mówi „bezterminowo”, nie pokazuje pustej daty", async () => {
    h.org = organizacja({ expires_at: null });
    await zamontuj();
    expect(screen.getByText("membership.orgPanel.noExpiry")).toBeTruthy();
  });

  it("warstwa Z KATALOGU jest nazwana w zdaniu o uprawnieniach", async () => {
    h.tiers = [{ key: "corporate", name_pl: "Instytucjonalna", name_en: "Corporate" }];
    await zamontuj();
    expect(screen.getByText("membership.orgPanel.benefitsNote(tier=Instytucjonalna)")).toBeTruthy();
  });

  it("warstwa spoza katalogu NIE pokazuje zdania z pustą nazwą", async () => {
    // Zdanie „Miejsce nadaje warstwę ." jest gorsze niż brak zdania.
    h.tiers = [{ key: "inna", name_pl: "Inna", name_en: "Other" }];
    await zamontuj();
    expect(document.body.textContent).not.toContain("membership.orgPanel.benefitsNote");
  });

  it("katalog warstw jeszcze nieodczytany też nie pokazuje zdania z dziurą", async () => {
    h.tiers = undefined;
    await zamontuj();
    expect(document.body.textContent).not.toContain("membership.orgPanel.benefitsNote");
  });
});

describe("język panelu - formaty i ładunek maila", () => {
  it("PL formatuje datę po polsku (kropki)", async () => {
    h.language = "pl";
    await zamontuj();
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/membership\.orgPanel\.expiresAt\(date=\d{1,2}\.\d{1,2}\.\d{4}\)/);
  });

  it("EN formatuje datę po brytyjsku (ukośniki) - to INNY napis niż polski", async () => {
    // Gdyby panel zawsze brał `pl-PL`, brytyjski klient czytałby 12.08 jako
    // 12 sierpnia tam, gdzie chodzi o 8 grudnia.
    h.language = "en";
    await zamontuj();
    const tekst = document.body.textContent ?? "";
    expect(tekst).toMatch(/membership\.orgPanel\.expiresAt\(date=\d{1,2}\/\d{1,2}\/\d{4}\)/);
    expect(tekst).not.toMatch(/expiresAt\(date=\d{1,2}\.\d{1,2}\.\d{4}\)/);
  });

  it("JĘZYK PANELU jedzie z zaproszeniem na serwer", async () => {
    // Od tego zależy język maila, który dostanie zaproszona osoba.
    h.language = "en";
    await zamontuj();
    fireEvent.change(poleAdresu(), { target: { value: "team@example.org" } });
    fireEvent.click(przyciskWyslij());
    await waitFor(() => expect(h.inviteCalls).toHaveLength(1));
    expect(h.inviteCalls[0]).toEqual({
      org_id: ORG_ID,
      email: "team@example.org",
      lang: "en",
    });
  });
});

describe("zaproszenie - co panel robi PRZED zapisem", () => {
  it("puste pole trzyma przycisk zablokowany", async () => {
    await zamontuj();
    expect(przyciskWyslij()).toBeDisabled();
  });

  it("SAME SPACJE nie lecą na serwer, nawet przez Enter", async () => {
    // Przycisk jest wtedy zablokowany, ale Enter w polu go omija - bez
    // strażnika w `onInvite` poleciałoby zapytanie z pustym adresem.
    await zamontuj();
    fireEvent.change(poleAdresu(), { target: { value: "   " } });
    fireEvent.keyDown(poleAdresu(), { key: "Enter" });
    await waitFor(() => expect(przyciskWyslij()).toBeDisabled());
    expect(h.inviteCalls).toHaveLength(0);
  });

  it("ENTER w polu wysyła zaproszenie - nie trzeba szukać przycisku", async () => {
    await zamontuj();
    fireEvent.change(poleAdresu(), { target: { value: "zespol@example.com" } });
    fireEvent.keyDown(poleAdresu(), { key: "Enter" });
    await waitFor(() => expect(h.inviteCalls).toHaveLength(1));
  });

  it("INNY KLAWISZ niż Enter nie wysyła zaproszenia", async () => {
    // Bez tego strzału każde wpisanie litery byłoby zapytaniem do serwera.
    await zamontuj();
    fireEvent.change(poleAdresu(), { target: { value: "zespol@example.com" } });
    fireEvent.keyDown(poleAdresu(), { key: "a" });
    expect(h.inviteCalls).toHaveLength(0);
  });

  it("adres jest NORMALIZOWANY przed zapisem (spacje i wielkie litery)", async () => {
    // „ Zespol@Example.COM " wklejone z maila utworzyłoby DRUGIE miejsce dla
    // tej samej osoby, a limit miejsc jest opłacony.
    await zamontuj();
    fireEvent.change(poleAdresu(), { target: { value: "  Zespol@Example.COM  " } });
    fireEvent.click(przyciskWyslij());
    await waitFor(() => expect(h.inviteCalls).toHaveLength(1));
    expect(h.inviteCalls[0]?.email).toBe("zespol@example.com");
  });

  it("PODWÓJNY Enter w trakcie wysyłki nie wysyła dwóch zaproszeń", async () => {
    // Pole NIE jest blokowane na czas lotu (blokuje je tylko status
    // organizacji i limit), więc jedyną ochroną jest strażnik `inviting`.
    // Bez niego zaproszony dostaje dwa identyczne maile.
    const brama = zasuwa();
    h.inviteGate = brama.obietnica;
    await zamontuj();
    fireEvent.change(poleAdresu(), { target: { value: "zespol@example.com" } });
    fireEvent.keyDown(poleAdresu(), { key: "Enter" });
    await waitFor(() => expect(h.inviteCalls).toHaveLength(1));
    fireEvent.keyDown(poleAdresu(), { key: "Enter" });
    expect(h.inviteCalls).toHaveLength(1);
    await act(async () => {
      brama.otworz();
      await brama.obietnica;
    });
  });

  it("w trakcie wysyłki przycisk jest zablokowany, a po niej znów działa", async () => {
    const brama = zasuwa();
    h.inviteGate = brama.obietnica;
    await zamontuj();
    fireEvent.change(poleAdresu(), { target: { value: "zespol@example.com" } });
    fireEvent.click(przyciskWyslij());
    await waitFor(() => expect(przyciskWyslij()).toBeDisabled());
    await act(async () => {
      brama.otworz();
      await brama.obietnica;
    });
    await waitFor(() => expect(h.toastSuccess).toHaveLength(1));
  });

  it.fails("DEFEKT: błędny adres leci na serwer, a komunikat nie mówi, co poprawić", async () => {
    // CO: `onInvite` (src/routes/profile.organization.tsx:194-219) sprawdza
    // wyłącznie, czy pole nie jest puste. Format adresu weryfikuje dopiero
    // walidator funkcji serwerowej (`z.string().email()` w
    // src/lib/organizations/selfservice.functions.ts:18), który RZUCA -
    // więc panel wpada w `catch` i pokazuje ten sam ogólny komunikat
    // `membership.organization.inviteError`, co przy awarii sieci.
    // Pole `type="email"` nie ratuje: `Input` nie stoi w `<form>`, więc
    // walidacja przeglądarki nigdy się nie odpala.
    // KONSEKWENCJA: właściciel z literówką („jan.kowalski@") widzi
    // „Nie udało się dodać miejsca." i nie wie, czy to jego pomyłka, czy
    // awaria serwisu. Próbuje ponownie tego samego, potem pisze do redakcji -
    // czyli dokładnie to, co panel samoobsługi miał wyeliminować.
    // CZEGO CHCEMY: adres bez „@" albo bez domeny zostaje zatrzymany
    // w przeglądarce, z komunikatem wskazującym POLE ADRESU.
    h.inviteThrows = true;
    await zamontuj();
    fireEvent.change(poleAdresu(), { target: { value: "jan.kowalski@" } });
    fireEvent.click(przyciskWyslij());
    await waitFor(() => expect(h.toastError).toHaveLength(1));
    expect(h.inviteCalls).toHaveLength(0);
  });
});

describe("zaproszenie - odpowiedź serwera", () => {
  async function zapros(email = "zespol@example.com") {
    fireEvent.change(poleAdresu(), { target: { value: email } });
    fireEvent.click(przyciskWyslij());
  }

  it("sukces Z MAILEM: potwierdzenie wysyłki i wyczyszczone pole", async () => {
    await zamontuj();
    await zapros();
    await waitFor(() => expect(h.toastSuccess).toEqual(["membership.orgPanel.inviteSentEmail"]));
    // Niewyczyszczone pole zachęca do drugiego kliknięcia na ten sam adres.
    expect(poleAdresu().value).toBe("");
  });

  it("sukces BEZ MAILA mówi wprost, że zaproszenie trzeba przekazać samemu", async () => {
    // Miejsce POWSTAŁO, tylko bramka mailowa milczy. Komunikat „wysłane"
    // sprawiłby, że właściciel czeka na reakcję osoby, która nic nie dostała.
    h.inviteResult = { ok: true, seatId: "seat-new", emailSent: false };
    await zamontuj();
    await zapros();
    await waitFor(() => expect(h.toastSuccess).toEqual(["membership.orgPanel.inviteSentNoEmail"]));
  });

  it("po udanym zaproszeniu lista miejsc I organizacja są unieważnione w cache", async () => {
    // Bez tego nowe miejsce nie pojawia się na liście, a licznik „3 z 10"
    // zostaje na starej wartości do przeładowania strony.
    queryClient.setQueryData(billingKeys.orgSeats(ORG_ID), []);
    queryClient.setQueryData(billingKeys.myOrganization("user-1"), organizacja());
    await zamontuj();
    await zapros();
    await waitFor(() => expect(h.toastSuccess).toHaveLength(1));
    expect(queryClient.getQueryState(billingKeys.orgSeats(ORG_ID))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(billingKeys.myOrganization("user-1"))?.isInvalidated).toBe(
      true,
    );
  });

  it("WYCZERPANY LIMIT z definera dostaje komunikat o limicie, nie ogólny", async () => {
    // To pytanie o PIENIĄDZE („dokupić miejsca"), więc nie wolno go zlać
    // z „coś nie zadziałało". Napis pochodzi wprost z migracji.
    h.inviteResult = { ok: false, error: BLAD_LIMITU };
    await zamontuj();
    await zapros();
    await waitFor(() => expect(h.toastError).toEqual(["membership.organization.seatLimitReached"]));
  });

  it("DUPLIKAT miejsca z definera dostaje komunikat o istniejącym miejscu", async () => {
    h.inviteResult = { ok: false, error: BLAD_DUPLIKATU };
    await zamontuj();
    await zapros();
    await waitFor(() => expect(h.toastError).toEqual(["membership.organization.seatExists"]));
  });

  it("INNA odmowa definera dostaje komunikat ogólny", async () => {
    h.inviteResult = { ok: false, error: BLAD_INNY };
    await zamontuj();
    await zapros();
    await waitFor(() => expect(h.toastError).toEqual(["membership.organization.inviteError"]));
  });

  it("odmowa BEZ TREŚCI też daje komunikat, nie pusty toast", async () => {
    // Ładunek bez pola `error` (obcięta serializacja) nie ma prawa dać
    // toasta bez zdania.
    h.inviteResult = { ok: false, error: null };
    await zamontuj();
    await zapros();
    await waitFor(() => expect(h.toastError).toEqual(["membership.organization.inviteError"]));
  });

  it("AWARIA TRANSPORTU nie gubi wpisanego adresu", async () => {
    // Po padniętym zapytaniu użytkownik ma kliknąć ponownie, a nie wpisywać
    // adres od nowa.
    h.inviteThrows = true;
    await zamontuj();
    await zapros("zespol@example.com");
    await waitFor(() => expect(h.toastError).toEqual(["membership.organization.inviteError"]));
    expect(poleAdresu().value).toBe("zespol@example.com");
    expect(przyciskWyslij()).not.toBeDisabled();
  });

  it("odmowa serwera NIE unieważnia cache - lista nie ma po co migotać", async () => {
    queryClient.setQueryData(billingKeys.orgSeats(ORG_ID), []);
    h.inviteResult = { ok: false, error: BLAD_LIMITU };
    await zamontuj();
    await zapros();
    await waitFor(() => expect(h.toastError).toHaveLength(1));
    expect(queryClient.getQueryState(billingKeys.orgSeats(ORG_ID))?.isInvalidated).toBe(false);
  });
});

describe("lista miejsc - co widzi administrator", () => {
  it("OCZEKUJĄCE miejsce: status oczekiwania, data wysyłki i kreska w kolumnie dołączenia", async () => {
    h.seats = [miejsce()];
    await zamontuj();
    expect(screen.getByText("membership.orgPanel.statusPending")).toBeTruthy();
    expect(document.body.textContent).toContain("membership.orgPanel.lastInvited(date=");
    expect(screen.getByText("-")).toBeTruthy();
    expect(screen.getByText("zespol@example.com")).toBeTruthy();
  });

  it("ODEBRANE miejsce: status aktywny, data dołączenia i BRAK przycisku ponowienia", async () => {
    // Ponowienie zaproszenia dla osoby, która już weszła, to mail bez sensu -
    // definer i tak by go odrzucił.
    h.seats = [miejsce({ claimed_at: "2026-03-01T00:00:00.000Z" })];
    await zamontuj();
    expect(screen.getByText("membership.orgPanel.statusClaimed")).toBeTruthy();
    expect(screen.queryByLabelText("membership.orgPanel.resend")).toBeNull();
    expect(document.body.textContent).not.toContain("membership.orgPanel.lastInvited");
  });

  it("oczekujące miejsce BEZ daty wysyłki nie pokazuje pustego „wysłano”", async () => {
    h.seats = [miejsce({ last_invited_at: null })];
    await zamontuj();
    expect(screen.getByText("membership.orgPanel.statusPending")).toBeTruthy();
    expect(document.body.textContent).not.toContain("membership.orgPanel.lastInvited");
  });

  it("role w wierszach: administrator i członek są ROZRÓŻNIONE", async () => {
    h.seats = [
      miejsce({ id: "seat-owner", role: "owner", invited_email: "szef@example.com" }),
      miejsce({ id: "seat-member", role: "member", invited_email: "zespol@example.com" }),
    ];
    await zamontuj();
    // Rola właściciela pada w nagłówku karty ORAZ w wierszu tabeli.
    expect(screen.getAllByText("membership.organization.roleOwner")).toHaveLength(2);
    expect(screen.getAllByText("membership.organization.roleMember")).toHaveLength(1);
  });

  it("miejsce WŁAŚCICIELA nie ma przycisku usunięcia - członka ma", async () => {
    // Usunięcie własnego miejsca właściciela odcięłoby organizację od
    // administratora, a definer i tak by tego nie wpuścił.
    h.seats = [
      miejsce({ id: "seat-owner", role: "owner", invited_email: "szef@example.com" }),
      miejsce({ id: "seat-member", role: "member", invited_email: "zespol@example.com" }),
    ];
    await zamontuj();
    expect(screen.getAllByLabelText("membership.organization.remove")).toHaveLength(1);
  });

  it("PUSTA lista miejsc pokazuje nagłówki tabeli, bez wiersza-widma", async () => {
    h.seats = [];
    await zamontuj();
    expect(screen.getByText("membership.orgPanel.colEmail")).toBeTruthy();
    expect(document.querySelectorAll("tbody tr")).toHaveLength(0);
  });

  it("ODCZYT MIEJSC W TOKU liczy pozostałe miejsca z licznika RPC", async () => {
    // Gdyby `undefined` liczyło się jako zero miejsc, przycisk zaproszenia
    // mrugałby jako zablokowany („limit") u każdego przy wejściu na stronę.
    h.seats = undefined;
    h.org = organizacja({ seats_used: 3, seats_limit: 10 });
    await zamontuj();
    expect(screen.queryByText("membership.organization.seatLimitReached")).toBeNull();
    expect(poleAdresu().disabled).toBe(false);
  });

  it("WYCZERPANY limit blokuje pole i mówi o limicie PRZED wpisaniem adresu", async () => {
    h.org = organizacja({ seats_limit: 2, seats_used: 2 });
    h.seats = [
      miejsce({ id: "seat-1", invited_email: "a@example.com" }),
      miejsce({ id: "seat-2", invited_email: "b@example.com" }),
    ];
    await zamontuj();
    expect(screen.getByText("membership.organization.seatLimitReached")).toBeTruthy();
    expect(poleAdresu().disabled).toBe(true);
    expect(przyciskWyslij()).toBeDisabled();
  });

  it("lista DŁUŻSZA niż limit nie daje ujemnej liczby wolnych miejsc", async () => {
    // `Math.max(0, ...)` - bez niego „-1 wolnych miejsc" odblokowałoby
    // formularz przy przepełnionej organizacji.
    h.org = organizacja({ seats_limit: 1, seats_used: 1 });
    h.seats = [
      miejsce({ id: "seat-1", invited_email: "a@example.com" }),
      miejsce({ id: "seat-2", invited_email: "b@example.com" }),
      miejsce({ id: "seat-3", invited_email: "c@example.com" }),
    ];
    await zamontuj();
    expect(screen.getByText("membership.organization.seatLimitReached")).toBeTruthy();
    expect(poleAdresu().disabled).toBe(true);
  });
});

describe("ponowienie zaproszenia", () => {
  function przyciskiPonowienia(): HTMLElement[] {
    return screen.getAllByLabelText("membership.orgPanel.resend");
  }

  beforeEach(() => {
    h.seats = [miejsce()];
  });

  it("sukces Z MAILEM potwierdza ponowienie i unieważnia listę miejsc", async () => {
    queryClient.setQueryData(billingKeys.orgSeats(ORG_ID), []);
    await zamontuj();
    fireEvent.click(przyciskiPonowienia()[0]);
    await waitFor(() => expect(h.toastSuccess).toEqual(["membership.orgPanel.resendOk"]));
    expect(h.resendCalls[0]).toEqual({ seat_id: "seat-1", lang: "pl" });
    expect(queryClient.getQueryState(billingKeys.orgSeats(ORG_ID))?.isInvalidated).toBe(true);
  });

  it("sukces BEZ MAILA mówi, że mail nie poszedł - nie udaje wysyłki", async () => {
    h.resendResult = { ok: true, emailSent: false };
    await zamontuj();
    fireEvent.click(przyciskiPonowienia()[0]);
    await waitFor(() => expect(h.toastSuccess).toEqual(["membership.orgPanel.resendNoEmail"]));
  });

  it("ODMOWA serwera daje komunikat o nieudanym ponowieniu", async () => {
    h.resendResult = { ok: false, error: "orgs: not found" };
    await zamontuj();
    fireEvent.click(przyciskiPonowienia()[0]);
    await waitFor(() => expect(h.toastError).toEqual(["membership.orgPanel.resendError"]));
  });

  it("AWARIA TRANSPORTU daje ten sam komunikat, nie biały ekran", async () => {
    h.resendThrows = true;
    await zamontuj();
    fireEvent.click(przyciskiPonowienia()[0]);
    await waitFor(() => expect(h.toastError).toEqual(["membership.orgPanel.resendError"]));
  });

  it("w trakcie ponowienia przycisk TEGO miejsca jest zablokowany i kręci kółkiem", async () => {
    const brama = zasuwa();
    h.resendGate = brama.obietnica;
    await zamontuj();
    fireEvent.click(przyciskiPonowienia()[0]);
    await waitFor(() => expect(przyciskiPonowienia()[0]).toBeDisabled());
    // Kręcące się kółko jest jedyną informacją, że coś się dzieje.
    expect(przyciskiPonowienia()[0].querySelector("svg")?.getAttribute("class")).toContain(
      "animate-spin",
    );
    await act(async () => {
      brama.otworz();
      await brama.obietnica;
    });
    await waitFor(() => expect(przyciskiPonowienia()[0]).not.toBeDisabled());
  });

  it("ponowienie dla INNEGO miejsca w trakcie trwającego NIE leci", async () => {
    // Przycisk drugiego wiersza nie jest zablokowany (blokada jest per
    // miejsce), więc bez strażnika `resendingId` dwa maile poszłyby równolegle,
    // a stan „które ponawiam" rozjechałby się z rzeczywistością.
    h.seats = [
      miejsce({ id: "seat-1", invited_email: "a@example.com" }),
      miejsce({ id: "seat-2", invited_email: "b@example.com" }),
    ];
    const brama = zasuwa();
    h.resendGate = brama.obietnica;
    await zamontuj();
    fireEvent.click(przyciskiPonowienia()[0]);
    await waitFor(() => expect(h.resendCalls).toHaveLength(1));
    fireEvent.click(przyciskiPonowienia()[1]);
    expect(h.resendCalls).toHaveLength(1);
    await act(async () => {
      brama.otworz();
      await brama.obietnica;
    });
  });

  it("ZAWIESZONA organizacja blokuje ponowienie zaproszeń", async () => {
    h.org = organizacja({ status: "suspended" });
    await zamontuj();
    expect(przyciskiPonowienia()[0]).toBeDisabled();
  });

  it("kółko NIE kręci się, dopóki nikt nie kliknął", async () => {
    await zamontuj();
    expect(przyciskiPonowienia()[0].querySelector("svg")?.getAttribute("class")).not.toContain(
      "animate-spin",
    );
  });
});

describe("zwolnienie miejsca", () => {
  beforeEach(() => {
    h.seats = [miejsce({ id: "seat-1", invited_email: "zespol@example.com" })];
  });

  function przyciskKosza(): HTMLElement {
    return screen.getByLabelText("membership.organization.remove");
  }

  it("usunięcie PYTA o potwierdzenie z adresem osoby i jest oznaczone jako niszczące", async () => {
    // Bez adresu w pytaniu właściciel z pięcioma wierszami nie wie, KOGO
    // właśnie odcina; bez oznaczenia niszczącego przycisk wygląda jak „OK".
    await zamontuj();
    fireEvent.click(przyciskKosza());
    await waitFor(() => expect(oczekujacyDialog).not.toBeNull());
    const dialog = otwartePotwierdzenie();
    expect(dialog.request.title).toBe(
      "membership.orgPanel.removeConfirmTitle(email=zespol@example.com)",
    );
    expect(dialog.request.destructive).toBe(true);
    expect(dialog.request.confirmLabel).toBe("membership.organization.remove");
    await act(async () => {
      dialog.anuluj();
    });
  });

  it("ANULOWANIE potwierdzenia nie usuwa niczego", async () => {
    await zamontuj();
    fireEvent.click(przyciskKosza());
    await waitFor(() => expect(oczekujacyDialog).not.toBeNull());
    await act(async () => {
      otwartePotwierdzenie().anuluj();
    });
    expect(h.removeCalls).toHaveLength(0);
    expect(h.toastSuccess).toHaveLength(0);
    expect(h.toastError).toHaveLength(0);
  });

  it("POTWIERDZENIE usuwa dokładnie to miejsce i potwierdza komunikatem", async () => {
    await zamontuj();
    fireEvent.click(przyciskKosza());
    await waitFor(() => expect(oczekujacyDialog).not.toBeNull());
    await act(async () => {
      otwartePotwierdzenie().potwierdz();
    });
    await waitFor(() => expect(h.removeCalls).toEqual(["seat-1"]));
    await waitFor(() => expect(h.toastSuccess).toEqual(["membership.orgPanel.removeOk"]));
  });

  it("ODMOWA BAZY daje komunikat o nieudanym usunięciu, nie ciszę", async () => {
    // RLS może odmówić (np. cudza organizacja) - cisza po kliknięciu każe
    // klikać dalej.
    h.removeFails = true;
    await zamontuj();
    fireEvent.click(przyciskKosza());
    await waitFor(() => expect(oczekujacyDialog).not.toBeNull());
    await act(async () => {
      otwartePotwierdzenie().potwierdz();
    });
    await waitFor(() => expect(h.toastError).toEqual(["membership.orgPanel.removeError"]));
    expect(h.toastSuccess).toHaveLength(0);
  });

  it("W TRAKCIE usuwania kosz jest zablokowany - jedno kliknięcie, jedno DELETE", async () => {
    const brama = zasuwa();
    h.removeGate = brama.obietnica;
    await zamontuj();
    fireEvent.click(przyciskKosza());
    await waitFor(() => expect(oczekujacyDialog).not.toBeNull());
    await act(async () => {
      otwartePotwierdzenie().potwierdz();
    });
    await waitFor(() => expect(przyciskKosza()).toBeDisabled());
    await act(async () => {
      brama.otworz();
      await brama.obietnica;
    });
    await waitFor(() => expect(h.toastSuccess).toEqual(["membership.orgPanel.removeOk"]));
    expect(h.removeCalls).toEqual(["seat-1"]);
  });

  it.fails(
    "DEFEKT: przyciski akcji w tabeli mają IDENTYCZNE etykiety w każdym wierszu",
    async () => {
      // CO: `aria-label` przycisku kosza to stałe
      // `t("membership.organization.remove")`
      // (src/routes/profile.organization.tsx:371), a przycisku ponowienia -
      // stałe `t("membership.orgPanel.resend")` (tamże:353). Adres osoby jest
      // w innej komórce wiersza i nie wchodzi do nazwy dostępnej przycisku.
      // KONSEKWENCJA: czytnik ekranu ogłasza „Usuń, przycisk" pięć razy pod
      // rząd. Osoba korzystająca z czytnika albo z nawigacji klawiaturą nie ma
      // z czego rozpoznać, KTÓRE miejsce zwalnia - a operacja odcina koledze
      // opłacony dostęp i nie da się jej cofnąć z panelu.
      // CZEGO CHCEMY: etykieta niesie adres zaproszonego, więc każdy przycisk
      // w tabeli ma unikalną nazwę dostępną.
      h.seats = [
        miejsce({ id: "seat-1", invited_email: "a@example.com" }),
        miejsce({ id: "seat-2", invited_email: "b@example.com" }),
      ];
      await zamontuj();
      const etykiety = screen
        .getAllByLabelText("membership.organization.remove")
        .map((node) => node.getAttribute("aria-label") ?? "");
      expect(new Set(etykiety).size).toBe(etykiety.length);
    },
  );
});
