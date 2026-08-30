// GOTOWOSC DO PUBLIKACJI - jedna odpowiedz na jedno pytanie „czy moge kliknac
// Opublikuj".
//
// PO CO TEN PLIK ISTNIEJE. Bez tego panelu organizator odpowiada sobie na to
// pytanie, klikajac po kolei w siedem ekranow studia. Panel sklada odpowiedz
// z CZTERECH zywych zapytan i dzieli braki na dwa stopnie - i wlasnie ten
// podzial jest tu jedyna trescia, ktora da sie zepsuc po cichu.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. BLOKADA ZAMIENIONA W OSTRZEZENIE. `severity` jest jednym slowem
//      w tablicy; przestawione, daje ekran „mozesz publikowac" przy wydarzeniu
//      bez okladki albo z kolizjami w programie. Nic sie nie pali - po prostu
//      strona wydarzenia idzie do uczestnikow niekompletna.
//   2. SKROT PROWADZI NIE TAM. Kazda pozycja jest odnosnikiem do sekcji, w
//      ktorej da sie brak naprawic. Zla sekcja znaczy „napraw okladke
//      w Kolizjach" - a redaktor wraca po nia do wsparcia.
//   3. LISTA POKAZUJE TAKZE ZROBIONE. Panel wymienia WYLACZNIE braki; dolozone
//      pozycje spelnione zamieniaja odpowiedz na pytanie w liste kontrolna do
//      przewijania.
//   4. „WSZYSTKO GOTOWE" ZAMIENIA SIE W PUSTKE. Pusta ramka pod naglowkiem jest
//      nieodrozniallna od zapytania, ktore nie doszlo.
//   5. LICZNIK POSTEPU KLAMIE. `passed/total` idzie parametrami do tlumaczenia;
//      policzony z samej listy braków pokazywalby postep wzgledem czegos
//      innego niz komplet warunkow.
//
// CZEGO SWIADOMIE NIE DUBLUJE. Tabeli warunkow - `publishReadiness.test.ts` ma
// ja w calosci i idzie tu PRAWDZIWA. Przedmiotem dowodu jest droga „cztery RPC
// -> raport -> wiersz ze skrotem", a nie sam rachunek.
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

const h = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-events", () => ({ ensureI18n: () => undefined }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

const { EventReadinessPanel } =
  await import("@/components/admin/events/organisms/EventReadinessPanel");

const R = "adminEvents.studio.readiness.";

/** Komplet zrodel gotowosci - i ANI JEDNEGO wiecej. */
const RPC_GOTOWOSCI = [
  "admin_event_agenda_conflicts",
  "admin_event_rooms_list",
  "admin_event_sessions_list",
  "admin_event_tickets_list",
];

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

function Provider({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Trzy z czterech list panel czyta WYLACZNIE po dlugosci (sale, kolizje,
 * wejsciowki), wiec atrapa oddaje tyle wierszy, ile trzeba - pelny ksztalt
 * kolumn nie wnosi tu nic poza szumem. Sesje ida pelnym budownikiem, bo
 * checklista czyta z nich cztery pola.
 */
function planuj(
  options: {
    sesje?: unknown[];
    sale?: number;
    kolizje?: number;
    wejsciowki?: number;
  } = {},
): void {
  const puste = (ile: number): Record<string, string>[] =>
    Array.from({ length: ile }, (_unused, index) => ({ id: `wiersz-${index}` }));
  stub().setData("admin_event_sessions_list", options.sesje ?? []);
  stub().setData("admin_event_rooms_list", puste(options.sale ?? 0));
  stub().setData("admin_event_agenda_conflicts", puste(options.kolizje ?? 0));
  stub().setData("admin_event_tickets_list", puste(options.wejsciowki ?? 0));
}

function panel(overrides: Partial<AdminEventDetailRow> = {}) {
  return render(
    <Provider>
      <EventReadinessPanel row={adminEventDetailRow(overrides)} />
    </Provider>,
  );
}

/** Adres skrotu przy pozycji o podanym kluczu i liczniku. */
function skrot(klucz: string, count: number): string | null {
  const link = screen.queryByRole("link", {
    name: new RegExp(`${R}checks\\.${klucz}\\(count=${count}\\)`),
  });
  return link === null ? null : link.getAttribute("href");
}

/** Czeka, az wszystkie cztery zapytania dojada - inaczej raport liczy sie z pustki. */
async function poczekaj(): Promise<void> {
  await waitFor(() => expect(stub().names().length).toBeGreaterThanOrEqual(4));
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

afterEach(cleanup);

describe("EventReadinessPanel - komplet zrodel", () => {
  it("sklada raport z CZTERECH zywych RPC, kazde po TO wydarzenie", async () => {
    planuj();
    panel();

    await poczekaj();
    expect([...new Set(stub().names())].sort()).toEqual(RPC_GOTOWOSCI);
    for (const nazwa of RPC_GOTOWOSCI) {
      expect(stub().lastCall(nazwa)?.arg("p_event_id")).toBe(STUDIO_EVENT_ID);
    }
  });

  it("program bierze WSZYSTKIE sesje, takze szkice - inaczej „szkice w programie” nie mialoby czego liczyc", async () => {
    planuj();
    panel();

    await poczekaj();
    expect(stub().lastCall("admin_event_sessions_list")?.has("p_status")).toBe(false);
  });
});

describe("EventReadinessPanel - dwa stopnie braku", () => {
  it("BLOKADA wstrzymuje publikacje i nazywa sie blokada", async () => {
    // Wydarzenie bez okladki: strona wydarzenia bylaby niekompletna, wiec to
    // jest blokada, a nie „bedzie brzydko".
    planuj();
    panel({ cover_url: "" });

    expect(await screen.findByText(`${R}blocked(count=1)`)).toBeInTheDocument();
    expect(screen.getByText(`${R}checks.cover(count=0)`)).toBeInTheDocument();
    // Skrot prowadzi tam, gdzie okladke da sie wgrac - nie w Kolizje.
    expect(skrot("cover", 0)).toBe(`/admin/events/${STUDIO_EVENT_ID}/branding`);
    expect(screen.getAllByText(`${R}severity.blocker`).length).toBeGreaterThan(0);
  });

  it("OSTRZEZENIE nie wstrzymuje publikacji - to druga polowa tej samej pary", async () => {
    // Ten sam ekran, inny stopien: brak sesji i brak sal to ostrzezenia, wiec
    // wydarzenie NADAL da sie opublikowac.
    planuj();
    panel();

    expect(await screen.findByText(`${R}publishedOk`)).toBeInTheDocument();
    expect(screen.queryByText(/blocked/)).not.toBeInTheDocument();
    expect(screen.getByText(`${R}checks.sessions(count=0)`)).toBeInTheDocument();
    expect(screen.getAllByText(`${R}severity.warning`).length).toBe(2);
  });

  it("KOLIZJE W PROGRAMIE sa blokada i nios liczbe do tlumaczenia", async () => {
    planuj({ kolizje: 3 });
    panel();

    expect(await screen.findByText(`${R}blocked(count=1)`)).toBeInTheDocument();
    // Liczba jedzie PARAMETREM klucza, a nie w kluczu - inaczej PL i EN nie
    // odmienilyby „3 kolizje" / „3 conflicts" bez mnozenia kluczy.
    expect(skrot("conflicts", 3)).toBe(`/admin/events/${STUDIO_EVENT_ID}/content/conflicts`);
  });

  it("wydarzenie ONLINE bez adresu spotkania dostaje ostrzezenie, a nie zadanie adresu sali", async () => {
    planuj();
    panel({ format: "online", join_url: "", city: "", street_address: "" });

    expect(await screen.findByText(`${R}checks.onlineUrl(count=0)`)).toBeInTheDocument();
    // Brak miasta NIE jest brakiem w wydarzeniu online.
    expect(screen.queryByText(/checks\.venue/)).not.toBeInTheDocument();
  });
});

describe("EventReadinessPanel - naglowek i postep", () => {
  it("SZKIC gotowy do publikacji dostaje zaproszenie, opublikowany - potwierdzenie", async () => {
    planuj();
    const szkic = panel({ status: "draft" });
    expect(await screen.findByText(`${R}readyToPublish`)).toBeInTheDocument();
    szkic.unmount();
    cleanup();

    panel({ status: "published" });
    expect(await screen.findByText(`${R}publishedOk`)).toBeInTheDocument();
  });

  it("licznik postepu liczy sie z KOMPLETU warunkow, nie z listy brakow", async () => {
    planuj();
    panel();

    // Dwa braki (sesje, sale) z czternastu warunkow - liczby ida parametrami.
    expect(await screen.findByText(`${R}progress(passed=12,total=14)`)).toBeInTheDocument();
  });

  it("komplet spelniony konczy sie ZDANIEM, a nie pusta ramka", async () => {
    // Pusta ramka pod naglowkiem jest nieodrozniallna od zapytania, ktore nie
    // doszlo - a to jest dokladnie ta roznica, ktora panel ma zdejmowac.
    planuj({ sesje: [adminEventSessionRow()], sale: 1 });
    panel();

    expect(await screen.findByText(`${R}allDone`)).toBeInTheDocument();
    expect(screen.getByText(`${R}progress(passed=14,total=14)`)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("sesja bez prelegenta i bez sali daje DWA osobne ostrzezenia z wlasnymi skrotami", async () => {
    planuj({ sesje: [adminEventSessionRow({ speakers_count: 0, room_id: "" })], sale: 1 });
    panel();

    await screen.findByText(`${R}checks.sessionSpeakers(count=1)`);
    expect(skrot("sessionSpeakers", 1)).toBe(`/admin/events/${STUDIO_EVENT_ID}/content/speakers`);
    expect(skrot("sessionRooms", 1)).toBe(`/admin/events/${STUDIO_EVENT_ID}/content/rooms`);
  });
});

describe("EventReadinessPanel - dostepnosc", () => {
  it("panel nie ma naruszen axe - i z lista brakow, i bez niej", async () => {
    planuj();
    const zBrakami = panel({ cover_url: "" });
    await screen.findByText(`${R}checks.cover(count=0)`);
    const pierwsze = await axeViolations(zBrakami.container);
    expect(pierwsze, summarize(pierwsze)).toEqual([]);
    zBrakami.unmount();
    cleanup();

    planuj({ sesje: [adminEventSessionRow()], sale: 1 });
    const gotowe = panel();
    await screen.findByText(`${R}allDone`);
    const drugie = await axeViolations(gotowe.container);
    expect(drugie, summarize(drugie)).toEqual([]);
  });
});
