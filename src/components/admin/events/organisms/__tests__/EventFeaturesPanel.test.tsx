// „FUNKCJE DODATKOWE" - siedem przelacznikow, ktore CHOWAJA polowe studia.
//
// PO CO TEN PLIK ISTNIEJE. To jedyny ekran w module wydarzen, ktorego zapis
// zmienia NAWIGACJE innych ekranow: rama studia czyta te sama kolumne
// (`events.features`) i wylicza z niej zbior sekcji, ktorych sidebar nie
// narysuje. Blad w tym formularzu nie konczy sie brzydkim polem - konczy sie
// modulem, ktorego nie da sie wlaczyc z powrotem.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. PAYLOAD Z SAMYCH WYLACZEN. Kolumna trzyma tylko `false`, wiec „wyslijmy
//      tylko to, co wylaczone" wyglada na oszczednosc. Skutek: klucz POMINIETY
//      w payloadzie zachowuje dzisiejszy stan, wiec ponowne wlaczenie modulu
//      wysyla `{}` i baza nie zmienia niczego - przelacznik wraca na
//      „wylaczony" przy pierwszym odswiezeniu. Przelacznik, ktorego nie da sie
//      WLACZYC, klamie tak samo jak ten, ktory nie wylacza. Dowodem jest
//      KOMPLET SIEDMIU KLUCZY w ladunku.
//   2. ZAPIS OD RAZU PRZY KLIKNIECIU. Bez paska zapisu przypadkowy klik chowa
//      polowe sidebara i nie ma kroku „odrzuc zmiany".
//   3. PASEK ZAPISU ZOSTAJE PO ZAPISIE. Szkic musi wrocic do stanu z bazy,
//      inaczej nad zapisanymi danymi wisi zaproszenie do zapisania ich jeszcze
//      raz.
//   4. ZNIKA ZDANIE O ADRESACH. „Wylaczenie chowa sekcje, ale jej adres nadal
//      dziala" to odpowiedz na pytanie „czy zepsuje linki, ktore juz
//      wyslalem" - bez niej redaktor nie kliknie przelacznika w ogole.
//   5. ZNIKA ZDANIE O WIDOCZNOSCI PUBLICZNEJ. Bez niego przelacznik czyta sie
//      jak wylacznik sekcji NA STRONIE WYDARZENIA, a ta ma osobne zrodlo prawdy.
//
// CZEGO SWIADOMIE NIE DUBLUJE. Czystych funkcji `eventFeatures` (payload,
// odczyt JSON, mapa „funkcja -> sekcje") - maja wlasny plik testowy; tutaj ida
// PRAWDZIWE, bo przedmiotem dowodu jest droga „klik -> ladunek RPC".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { axeViolations, summarize } from "@/test/axe";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { adminEventDetailRow, STUDIO_EVENT_ID } from "@/test/events/adminEventStudioRows";
import { EVENT_FEATURE_KEYS } from "@/lib/events/eventFeatures";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

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
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/events/adminEventStudioErrors", () => ({
  adminEventStudioErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));

const { EventFeaturesPanel } =
  await import("@/components/admin/events/organisms/EventFeaturesPanel");

const F = "adminEvents.studio.features.";

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

function Provider({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function panel(overrides: Partial<AdminEventDetailRow> = {}) {
  return render(
    <Provider>
      <EventFeaturesPanel row={adminEventDetailRow(overrides)} />
    </Provider>,
  );
}

/** Przelacznik modulu po jego ETYKIECIE - tak, jak znajduje go redaktor. */
function przelacznik(klucz: string): HTMLElement {
  return screen.getByRole("switch", { name: `${F}labels.${klucz}` });
}

function pasekZapisu(): HTMLElement | null {
  return screen.queryByRole("button", { name: "adminEvents.studio.actions.save" });
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

afterEach(cleanup);

describe("EventFeaturesPanel - siedem przelacznikow", () => {
  it("rysuje KOMPLET modulow, kazdy ze zdaniem „co zniknie”", () => {
    // Sama etykieta („Spotkania") nie mowi, czy wylaczenie zabiera stoliki,
    // wnioski o rozmowe, czy jedno i drugie - a to jest dokladnie ta
    // informacja, ktorej redaktor szuka przed klikiem.
    panel();

    expect(screen.getAllByRole("switch")).toHaveLength(EVENT_FEATURE_KEYS.length);
    for (const klucz of EVENT_FEATURE_KEYS) {
      expect(przelacznik(klucz)).toBeInTheDocument();
      expect(screen.getByText(`${F}hints.${klucz}`)).toBeInTheDocument();
    }
  });

  it("KLUCZ NIEOBECNY = MODUL WLACZONY - pusta kolumna nie chowa niczego", () => {
    panel({ features: {} });

    for (const klucz of EVENT_FEATURE_KEYS) {
      expect(przelacznik(klucz)).toHaveAttribute("aria-checked", "true");
    }
  });

  it("doslowne `false` w kolumnie wylacza modul, a sasiednie zostaja wlaczone", () => {
    panel({ features: { meetings: false } });

    expect(przelacznik("meetings")).toHaveAttribute("aria-checked", "false");
    expect(przelacznik("onsite")).toHaveAttribute("aria-checked", "true");
  });

  it("dwa zdania, bez ktorych przelacznik jest mylacy: adresy zyja, to nie widocznosc publiczna", () => {
    panel();

    expect(screen.getByText(`${F}routesStayAlive`)).toBeInTheDocument();
    expect(screen.getByText(`${F}notPublicVisibility`)).toBeInTheDocument();
  });
});

describe("EventFeaturesPanel - zapis jest JAWNY", () => {
  it("bez zmiany nie ma paska zapisu - ekran nie zaprasza do zapisania niczego", () => {
    panel();

    expect(pasekZapisu()).toBeNull();
  });

  it("klik w przelacznik NIE zapisuje - pokazuje pasek z krokiem „odrzuc”", () => {
    panel();

    fireEvent.click(przelacznik("meetings"));

    expect(przelacznik("meetings")).toHaveAttribute("aria-checked", "false");
    expect(pasekZapisu()).not.toBeNull();
    expect(stub().names()).toEqual([]);
  });

  it("„Odrzuc zmiany” przywraca stan z bazy i chowa pasek", () => {
    panel();
    fireEvent.click(przelacznik("meetings"));

    fireEvent.click(screen.getByRole("button", { name: "adminEvents.studio.actions.discard" }));

    expect(przelacznik("meetings")).toHaveAttribute("aria-checked", "true");
    expect(pasekZapisu()).toBeNull();
  });
});

describe("EventFeaturesPanel - ladunek zapisu", () => {
  it("wysyla KOMPLET SIEDMIU KLUCZY, a nie same wylaczenia", async () => {
    // To jest cala roznica miedzy przelacznikiem, ktory da sie wlaczyc,
    // a takim, ktory umie tylko wylaczac: klucz pominiety w ladunku zachowuje
    // dzisiejszy stan po stronie bazy.
    stub().setData("admin_event_features_save", null);
    panel({ features: { meetings: false } });

    fireEvent.click(przelacznik("meetings"));
    fireEvent.click(screen.getByRole("button", { name: "adminEvents.studio.actions.save" }));

    await waitFor(() => expect(stub().lastCall("admin_event_features_save")).toBeDefined());
    const ladunek = stub().lastCall("admin_event_features_save")?.arg("p_features");
    expect(ladunek).toEqual({
      pages: true,
      registration: true,
      tickets: true,
      sessions: true,
      meetings: true,
      onsite: true,
      sponsors: true,
    });
    expect(stub().lastCall("admin_event_features_save")?.arg("p_event_id")).toBe(STUDIO_EVENT_ID);
  });

  it("wylaczenie jedzie jako `false` przy nietknietych pozostalych", async () => {
    stub().setData("admin_event_features_save", null);
    panel();

    fireEvent.click(przelacznik("onsite"));
    fireEvent.click(screen.getByRole("button", { name: "adminEvents.studio.actions.save" }));

    await waitFor(() => expect(stub().lastCall("admin_event_features_save")).toBeDefined());
    expect(stub().lastCall("admin_event_features_save")?.arg("p_features")).toEqual({
      pages: true,
      registration: true,
      tickets: true,
      sessions: true,
      meetings: true,
      onsite: false,
      sponsors: true,
    });
  });

  it("udany zapis melduje sie WLASNYM kluczem, nie ogolnym „zapisano”", async () => {
    stub().setData("admin_event_features_save", null);
    panel();

    fireEvent.click(przelacznik("sponsors"));
    fireEvent.click(screen.getByRole("button", { name: "adminEvents.studio.actions.save" }));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEvents.studio.toasts.featuresSaved");
  });

  it("odmowa bazy idzie przez mapowanie odmow i NIE chowa paska zapisu", async () => {
    // Pasek musi zostac: szkic nie zostal zapisany, wiec redaktor ma jeszcze
    // co zapisac i co odrzucic.
    stub().setError("admin_event_features_save", "forbidden: not an event admin", "42501");
    panel();

    fireEvent.click(przelacznik("tickets"));
    fireEvent.click(screen.getByRole("button", { name: "adminEvents.studio.actions.save" }));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastError.mock.calls[0][0]).toContain("odmowa:forbidden");
    expect(pasekZapisu()).not.toBeNull();
    expect(przelacznik("tickets")).toHaveAttribute("aria-checked", "false");
  });
});

describe("EventFeaturesPanel - szkic wraca do stanu z bazy", () => {
  it("nowy wiersz (inne wydarzenie) przestawia przelaczniki i chowa pasek", () => {
    // Po zapisie i po przelaczeniu wydarzenia szkic wraca do stanu z bazy -
    // inaczej pasek zapisu zostawalby otwarty nad danymi, ktore sa juz zapisane.
    const { rerender } = panel({ features: {} });
    fireEvent.click(przelacznik("pages"));
    expect(pasekZapisu()).not.toBeNull();

    rerender(
      <Provider>
        <EventFeaturesPanel row={adminEventDetailRow({ features: { pages: false } })} />
      </Provider>,
    );

    expect(przelacznik("pages")).toHaveAttribute("aria-checked", "false");
    expect(pasekZapisu()).toBeNull();
  });
});

describe("EventFeaturesPanel - dostepnosc", () => {
  it("ekran nie ma naruszen axe - takze z otwartym paskiem zapisu", async () => {
    const { container } = panel();
    fireEvent.click(przelacznik("meetings"));

    const naruszenia = await axeViolations(container);
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });
});
