// „PULPIT" WYDARZENIA - pierwszy ekran studia po wejsciu.
//
// PO CO TEN PLIK ISTNIEJE. Pulpit nie ma wlasnego zrodla prawdy: kazda liczba
// pochodzi z licznika, ktory stoi juz gdzies indziej (zapisy, program, grupy,
// partnerzy). Cala jego wartosc to WIERNOSC - i dokladnie ona psuje sie po
// cichu, bo bledna liczba wyglada tak samo wiarygodnie jak prawdziwa.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. KRESKA ZAMIENIONA W ZERO. `?? 0` zamiast `=== null` wyglada niewinnie
//      i wyglada TAK SAMO na ekranie w chwili, gdy dane juz przyszly. Roznica
//      wychodzi tylko wtedy, gdy danych NIE MA: „jeszcze nie policzone" staje
//      sie „nikt sie nie zapisal" - a to jest zdanie, po ktorym odwoluje sie
//      wydarzenie.
//   2. PIATY LICZNIK TYCH SAMYCH RZECZY. Ktos dokłada wlasne zliczanie zgloszen
//      „bo tak wygodniej" i pulpit pokazuje inna liczbe niz lista zgloszen obok.
//   3. CHECKLISTA ODKLIKIWANA ZAMIAST LICZONEJ. „Dodaj okladke" ma znikac, gdy
//      okladka JEST - warunkiem jest DANA, nie klikniecie. Checklista, ktora da
//      sie odhaczyc bez zrobienia rzeczy, jest gorsza niz jej brak.
//   4. KROK PROWADZI NIE TAM. Kazdy krok jest odnosnikiem do sekcji, w ktorej
//      da sie go wykonac; podmieniona sekcja wysyla po okladke do Grup.
//   5. TERMIN W STREFIE PRZEGLADARKI. Kafel daty czyta strefe WYDARZENIA -
//      organizator w innej strefie inaczej czyta „9:00" i planuje odprawe
//      o zlej porze.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Gotowosci do publikacji - ma wlasny plik
// (`EventReadinessPanel.test.tsx`); tutaj stoi atrapa, ktora zapisuje otrzymany
// wiersz, bo przedmiotem dowodu jest to, ze pulpit stawia ja NAD metrykami.
// (2) Parsera licznikow zapisow (`registrationCounts.test.ts`) - idzie tu
// prawdziwy, bo dowodzimy drogi „RPC -> parser -> kafel".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { axeViolations, summarize } from "@/test/axe";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import {
  adminEventDetailRow,
  adminEventSessionRow,
  STUDIO_EVENT_ID,
} from "@/test/events/adminEventStudioRows";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  /** Tryb „odpowiedz nigdy nie przychodzi" - do dowodu o kresce. */
  wiecznePending: false,
  /** Wiersze, ktore pulpit podal panelowi gotowosci. */
  gotowosc: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.wiecznePending) return new Promise(() => {});
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-agenda", () => ({ ensureAgendaI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-registration", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-sponsors", () => ({ ensureSponsorsI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-event-terms", () => ({ ensureTermsI18n: () => undefined }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

// Gotowosc do publikacji ma wlasny plik testowy i wlasne cztery zapytania.
// Tutaj liczy sie WYLACZNIE to, ze pulpit ja montuje i podaje jej ten sam wiersz.
vi.mock("@/components/admin/events/organisms/EventReadinessPanel", () => ({
  EventReadinessPanel: ({ row }: { row: AdminEventDetailRow }) => {
    h.gotowosc.push(row.id);
    return <div data-testid="gotowosc" />;
  },
}));

const { EventOverviewPanel } =
  await import("@/components/admin/events/organisms/EventOverviewPanel");

const O = "adminEvents.studio.overview.";

/** Kreska kafla bez danych - EM DASH z kodu produkcyjnego, nie zwykly dywiz. */
const KRESKA = "—";

/** Komplet zrodel pulpitu - i ANI JEDNEGO wiecej. */
const RPC_PULPITU = [
  "admin_event_groups_list",
  "admin_event_registrations_counts",
  "admin_event_sessions_list",
  "admin_event_sponsors_list",
];

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

function Provider({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function planuj(
  options: {
    zapisy?: Record<string, number | null>;
    sesje?: unknown[];
    grupy?: number;
    partnerzy?: number;
  } = {},
): void {
  const puste = (ile: number): Record<string, string>[] =>
    Array.from({ length: ile }, (_unused, index) => ({ id: `wiersz-${index}` }));
  stub().setData("admin_event_registrations_counts", {
    all: 21,
    approved: 14,
    pending: 3,
    waitlist: 4,
    attended: 0,
    cancelled: 0,
    rejected: 0,
    awaiting_notice: 0,
    capacity: 30,
    seats_left: 9,
    ...options.zapisy,
  });
  stub().setData("admin_event_sessions_list", options.sesje ?? []);
  stub().setData("admin_event_groups_list", puste(options.grupy ?? 0));
  stub().setData("admin_event_sponsors_list", puste(options.partnerzy ?? 0));
}

function panel(overrides: Partial<AdminEventDetailRow> = {}) {
  return render(
    <Provider>
      <EventOverviewPanel row={adminEventDetailRow(overrides)} />
    </Provider>,
  );
}

/** Wartosc kafla po KLUCZU etykiety - kafel to etykieta i liczba pod nia. */
function kafel(klucz: string): string {
  const label = screen.getByText(`${O}${klucz}`);
  const value = label.nextElementSibling;
  if (value === null) throw new Error(`test: kafel ${klucz} nie ma wiersza wartosci`);
  return value.textContent ?? "";
}

/** Wiersz kroku: odnosnik z etykieta kroku. */
function krok(klucz: string): HTMLElement {
  return screen.getByRole("link", { name: `${O}steps.${klucz}` });
}

/** Czy krok jest odhaczony - przekreslenie etykiety jest jego jedynym znakiem. */
function zrobiony(klucz: string): boolean {
  const label = screen.getByText(`${O}steps.${klucz}`);
  return label.className.includes("line-through");
}

async function poczekaj(): Promise<void> {
  await waitFor(() => expect(kafel("registrations")).not.toBe(KRESKA));
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.wiecznePending = false;
  h.gotowosc = [];
});

afterEach(cleanup);

describe("EventOverviewPanel - komplet zrodel", () => {
  it("sklada pulpit z CZTERECH zywych RPC i nie dokłada zadnego wlasnego licznika", async () => {
    planuj();
    panel();

    await poczekaj();
    expect([...new Set(stub().names())].sort()).toEqual(RPC_PULPITU);
    for (const nazwa of RPC_PULPITU) {
      expect(stub().lastCall(nazwa)?.arg("p_event_id")).toBe(STUDIO_EVENT_ID);
    }
  });

  it("gotowosc do publikacji stoi NAD metrykami i dostaje ten sam wiersz", async () => {
    planuj();
    panel();

    await poczekaj();
    expect(screen.getByTestId("gotowosc")).toBeInTheDocument();
    expect(h.gotowosc.at(-1)).toBe(STUDIO_EVENT_ID);
  });
});

describe("EventOverviewPanel - liczby albo kreska", () => {
  it("pokazuje liczby z bazy, kazda w swoim kaflu", async () => {
    planuj({ grupy: 4, partnerzy: 6, sesje: [adminEventSessionRow(), adminEventSessionRow()] });
    panel();

    await poczekaj();
    expect(kafel("registrations")).toBe("21");
    expect(kafel("seatsLeft")).toBe("9");
    expect(kafel("sessions")).toBe("2");
    expect(kafel("groups")).toBe("4");
    expect(kafel("sponsors")).toBe("6");
  });

  it("BRAK ODPOWIEDZI to KRESKA, nie zero - „nie wiem” i „zero” to rozne odpowiedzi", async () => {
    // Zero z palca na pulpicie uczy nie ufac zadnej liczbie na ekranie.
    h.wiecznePending = true;
    panel();

    await waitFor(() => expect(kafel("registrations")).toBe(KRESKA));
    expect(kafel("sessions")).toBe(KRESKA);
    expect(kafel("groups")).toBe(KRESKA);
    expect(kafel("sponsors")).toBe(KRESKA);
  });

  it("ZERO policzone to zero - druga polowa tej samej pary", async () => {
    planuj({ zapisy: { all: 0, seats_left: 30 } });
    panel();

    await waitFor(() => expect(kafel("registrations")).toBe("0"));
    expect(kafel("sessions")).toBe("0");
    expect(kafel("groups")).toBe("0");
  });

  it("wydarzenie BEZ LIMITU MIEJSC ma kreske, a nie „0 wolnych miejsc”", async () => {
    // `capacity = null` znaczy „nie ma limitu", wiec nie ma czego odejmowac.
    // Sklejone z zerem wygladaloby jak wyprzedane.
    planuj({ zapisy: { capacity: null, seats_left: null } });
    panel();

    await poczekaj();
    expect(kafel("seatsLeft")).toBe(KRESKA);
  });

  it("kafel terminu liczy sie w strefie WYDARZENIA", async () => {
    planuj();
    panel();

    await poczekaj();
    // 09:00 UTC to 11:00 w Warszawie.
    expect(kafel("startsAt")).toMatch(/11:00/);
  });

  it("wydarzenie bez terminu dostaje ZDANIE, a nie pusty kafel", async () => {
    planuj();
    panel({ starts_at: "" });

    await poczekaj();
    expect(kafel("startsAt")).toBe("adminEvents.list.row.noDate");
  });
});

describe("EventOverviewPanel - nastepne kroki licza sie ZE STANU", () => {
  it("krok znika z listy „do zrobienia”, gdy DANA jest na miejscu", async () => {
    planuj({ grupy: 2, sesje: [adminEventSessionRow()] });
    panel();

    await poczekaj();
    expect(zrobiony("cover")).toBe(true);
    expect(zrobiony("description")).toBe(true);
    expect(zrobiony("location")).toBe(true);
    expect(zrobiony("sessions")).toBe(true);
    expect(zrobiony("groups")).toBe(true);
    expect(zrobiony("publish")).toBe(true);
  });

  it("brak DANEJ zostawia krok otwarty - checklisty nie da sie odhaczyc klikniecem", async () => {
    // Druga polowa pary: ten sam ekran, odjete dane.
    planuj();
    panel({ cover_url: "", description_pl: "", city: "", status: "draft" });

    await poczekaj();
    expect(zrobiony("cover")).toBe(false);
    expect(zrobiony("description")).toBe(false);
    expect(zrobiony("location")).toBe(false);
    expect(zrobiony("sessions")).toBe(false);
    expect(zrobiony("groups")).toBe(false);
    expect(zrobiony("publish")).toBe(false);
  });

  it("wydarzenie ONLINE nie potrzebuje miasta - krok „miejsce” jest zrobiony bez adresu", async () => {
    planuj();
    panel({ city: "", format: "online" });

    await poczekaj();
    expect(zrobiony("location")).toBe(true);
  });

  it("kazdy krok prowadzi do sekcji, w ktorej da sie go wykonac", async () => {
    planuj();
    panel();

    await poczekaj();
    const adres = (ogon: string): string => `/admin/events/${STUDIO_EVENT_ID}/${ogon}`;
    expect(krok("cover")).toHaveAttribute("href", adres("general"));
    expect(krok("description")).toHaveAttribute("href", adres("general"));
    expect(krok("location")).toHaveAttribute("href", adres("general"));
    expect(krok("sessions")).toHaveAttribute("href", adres("content/tracks"));
    expect(krok("groups")).toHaveAttribute("href", adres("groups"));
    expect(krok("publish")).toHaveAttribute("href", adres("general"));
  });
});

describe("EventOverviewPanel - dostepnosc", () => {
  it("pulpit nie ma naruszen axe", async () => {
    planuj({ grupy: 1, partnerzy: 1, sesje: [adminEventSessionRow()] });
    const { container } = panel();
    await poczekaj();

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
