// KATALOG UCZESTNIKÓW giełdy - jedyne miejsce, z którego da się zaprosić na
// rozmowę kogoś, kogo się jeszcze nie zna.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. TRZY POWODY BRAKU LISTY MAJĄ TRZY RÓŻNE ZDANIA. „Jeszcze się nie wczytało",
//     „baza odmówiła" i „giełda jest dla ciebie zamknięta" to trzy różne
//     następne kroki uczestnika. Wspólny komunikat „brak dostępu" kasuje tę
//     różnicę i zamienia ekran w ślepy zaułek.
//
//  2. BLOKADY SĄ STOPNIOWANE, NIE BINARNE. Każdy powód z `_event_meeting_*`
//     ma własny klucz: „giełda wyłączona" znaczy czekaj, „nie jesteś zapisany"
//     znaczy zapisz się, „twoja grupa nie widzi listy" znaczy napisz do
//     organizatora.
//
//  3. WŁASNA WIDOCZNOŚĆ WYSYŁA STAN DOCELOWY, NIE „PRZEŁĄCZ".
//     `event_meeting_directory_visibility_set` przyjmuje `listed`; wysłanie
//     negacji przy rozjechanym stanie wypisałoby z katalogu kogoś, kto właśnie
//     chciał się w nim pokazać.
//
//  4. STAN ROZMOWY ZMIENIA PRZYCISK. Kto ma z nami żywe zaproszenie albo
//     przyjęte spotkanie, dostaje odnośnik do terminarza, a nie drugie
//     zaproszenie - baza odrzuciłaby je jako `duplicate_invitation`.
//
//  5. PUSTA LISTA MA DWA ZNACZENIA. „Nikogo tu nie ma" i „nikt nie pasuje do
//     filtra" prowadzą do dwóch różnych działań; jedno zdanie na oba każe
//     uczestnikowi uznać giełdę za martwą.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Parsowania odpowiedzi RPC i składania podpisów
// (`meetingDirectory.ts`) - ma własny plik
// `src/lib/events/__tests__/meetingDirectory.test.ts`. Tutaj liczy się to, co
// ekran robi z gotowym modelem.
//
// Asercje idą po KLUCZACH i18n (parytetu PL/EN pilnują osobne bramki
// słownikowe). Radixowy Dialog jest podmieniony na natywny odpowiednik.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  EMPTY_DIRECTORY,
  type DirectoryEntry,
  type MeetingDirectory,
} from "@/lib/events/meetingDirectory";

const h = vi.hoisted(() => ({
  directory: vi.fn(),
  visibility: vi.fn(),
  invite: vi.fn(),
  freeSlots: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@/lib/i18n-event-meetings", () => ({ ensureI18n: () => {} }));

vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));

vi.mock("@/components/ui/dialog", () => {
  // Radix zamyka okno klawiszem Escape i kliknięciem w tło - happy-dom nie ma
  // pełnego pointer API, więc atrapa wystawia jawny przycisk zamknięcia.
  // Bez niego gałąź `onOpenChange(false)` byłaby z testu nieosiągalna, a to
  // właśnie ona sprząta wybór rozmówcy.
  const stan = { open: false, zamknij: (_next: boolean) => {} };
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange?: (next: boolean) => void;
      children?: ReactNode;
    }) => {
      stan.open = open;
      stan.zamknij = onOpenChange ?? (() => {});
      return <div>{children}</div>;
    },
    DialogContent: ({ children }: { children?: ReactNode }) => {
      const zamknij = stan.zamknij;
      return stan.open ? (
        <div role="dialog">
          <button type="button" onClick={() => zamknij(false)}>
            atrapa-zamknij-okno
          </button>
          {children}
        </div>
      ) : null;
    },
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

// Sieć kontaktów i czat to CUDZE powierzchnie z własnymi testami; tutaj liczy
// się wyłącznie to, KOMU katalog te przyciski w ogóle pokazuje.
vi.mock("@/components/network/ConnectButton", () => ({
  ConnectButton: ({ userId }: { userId: string }) => (
    <button type="button">connect:{userId}</button>
  ),
}));
vi.mock("@/components/network/DirectMessageButton", () => ({
  DirectMessageButton: ({ userId }: { userId: string }) => (
    <button type="button">dm:{userId}</button>
  ),
}));

vi.mock("@/lib/events/meetingsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/meetingsApi")>()),
  fetchMeetingDirectory: (input: unknown) => h.directory(input),
  setMeetingDirectoryVisibility: (input: unknown) => h.visibility(input),
  inviteToMeeting: (input: unknown) => h.invite(input),
  fetchMyFreeSlots: (input: unknown) => h.freeSlots(input),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve({ data: null, error: null }) },
}));

const { ParticipantDirectoryPanel } =
  await import("@/components/events/meetings/ParticipantDirectoryPanel");

const SLUG = "kongres-2026";
const TZ = "Europe/Warsaw";
const KAT = "eventMeetings.participant.directory";

function entry(over: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    registrationId: "reg-1",
    firstName: "Anna",
    lastName: "Kowalska",
    jobTitle: "Dyrektorka",
    company: "ACME",
    companyLogoUrl: null,
    userId: null,
    photoUrl: null,
    industry: "Energia",
    specialization: "Regulacje",
    groups: [],
    hasAvailability: true,
    meetingStatus: null,
    ...over,
  };
}

function directory(over: Partial<MeetingDirectory> = {}): MeetingDirectory {
  return {
    ...EMPTY_DIRECTORY,
    scope: "registered",
    myRegistrationId: "reg-me",
    totalCount: 1,
    rows: [entry()],
    ...over,
  };
}

function nigdy(): Promise<never> {
  return new Promise<never>(() => {});
}

function renderPanel() {
  const onOpenMeetings = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ParticipantDirectoryPanel slug={SLUG} timezone={TZ} onOpenMeetings={onOpenMeetings} />
    </QueryClientProvider>,
  );
  return { ...view, onOpenMeetings };
}

/** Czeka, aż lista wyjdzie ze stanu wczytywania (nagłówek katalogu na ekranie). */
async function poczekajNaListe() {
  return screen.findByText(`${KAT}.heading`);
}

const przelacznik = () => screen.getByRole("switch");
const szukajka = () => screen.getByLabelText("eventMeetings.fields.search");

beforeEach(() => {
  vi.clearAllMocks();
  h.directory.mockResolvedValue(directory());
  h.visibility.mockResolvedValue(true);
  h.invite.mockResolvedValue({});
  h.freeSlots.mockResolvedValue([]);
});

describe("ParticipantDirectoryPanel - zanim lista w ogóle powstanie", () => {
  it("WCZYTYWANIE pokazuje szkielet oznaczony jako zajęty, a nie pustą stronę", () => {
    // Pusty ekran w trakcie najdroższego zapytania giełdy wygląda jak „nikogo
    // tu nie ma" - i uczestnik wychodzi, zanim lista dojedzie.
    h.directory.mockImplementation(() => nigdy());
    const { container } = renderPanel();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(`${KAT}.heading`)).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("BŁĄD zapytania mówi kluczem z kontraktu bazy, nie surowym wyjątkiem", async () => {
    h.directory.mockRejectedValue(new Error("not_registered: sign up first"));
    renderPanel();

    expect(await screen.findByText("eventMeetings.errors.not_registered")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it.each([
    ["meetings_disabled", "meetingsDisabled"],
    ["exchange_rule_closed", "exchangeRuleClosed"],
    ["requester_not_participating", "requesterNotParticipating"],
    ["directory_hidden", "directoryHidden"],
  ])("BLOKADA %s ma WŁASNE zdanie, nie wspólny brak dostępu", async (block, klucz) => {
    // Każdy powód prowadzi do innego następnego kroku; wspólny komunikat
    // zamieniłby ekran w ślepy zaułek.
    h.directory.mockResolvedValue(
      directory({ blocked: block as MeetingDirectory["blocked"], rows: [], totalCount: 0 }),
    );
    renderPanel();

    expect(await screen.findByText(`${KAT}.blocks.${klucz}`)).toBeInTheDocument();
    expect(screen.queryByLabelText("eventMeetings.fields.search")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});

describe("ParticipantDirectoryPanel - własna obecność w katalogu", () => {
  it("uczestnik WIDOCZNY ma przełącznik włączony i plakietkę potwierdzającą obecność", async () => {
    h.directory.mockResolvedValue(directory({ optedOut: false }));
    renderPanel();
    await poczekajNaListe();

    expect(przelacznik()).toBeChecked();
    expect(screen.getByText(`${KAT}.listedOn`)).toBeInTheDocument();
    expect(screen.queryByText(`${KAT}.listedOff`)).not.toBeInTheDocument();
  });

  it("uczestnik WYPISANY ma przełącznik wyłączony i drugą plakietkę", async () => {
    // To jego własna decyzja, nie organizatora - musi ją widzieć wprost.
    h.directory.mockResolvedValue(directory({ optedOut: true }));
    renderPanel();
    await poczekajNaListe();

    expect(przelacznik()).not.toBeChecked();
    expect(screen.getByText(`${KAT}.listedOff`)).toBeInTheDocument();
  });

  it("przełącznik wysyła STAN DOCELOWY `false`, gdy wypisuję się z katalogu", async () => {
    h.directory.mockResolvedValue(directory({ optedOut: false }));
    renderPanel();
    await poczekajNaListe();
    fireEvent.click(przelacznik());

    await waitFor(() => expect(h.visibility).toHaveBeenCalledTimes(1));
    expect(h.visibility).toHaveBeenCalledWith({ eventSlug: SLUG, listed: false });
  });

  it("przełącznik wysyła STAN DOCELOWY `true`, gdy wracam na listę", async () => {
    // Wysyłanie „przełącz" zamiast wartości docelowej przy rozjechanym stanie
    // wypisałoby z katalogu kogoś, kto właśnie chciał się w nim pokazać.
    h.directory.mockResolvedValue(directory({ optedOut: true }));
    renderPanel();
    await poczekajNaListe();
    fireEvent.click(przelacznik());

    await waitFor(() =>
      expect(h.visibility).toHaveBeenCalledWith({ eventSlug: SLUG, listed: true }),
    );
  });

  it("BŁĄD zmiany widoczności mówi kluczem bazy zamiast milczeć", async () => {
    // Cicha porażka zostawia uczestnika w przekonaniu, że jest niewidoczny -
    // a jego dane dalej są w katalogu.
    h.visibility.mockRejectedValue(new Error("auth_required: sign in"));
    renderPanel();
    await poczekajNaListe();
    fireEvent.click(przelacznik());

    await waitFor(() => expect(h.error).toHaveBeenCalledWith("eventMeetings.errors.auth_required"));
  });

  it("TRWAJĄCA zmiana odcina przełącznik - podwójny klik to dwie sprzeczne decyzje", async () => {
    h.visibility.mockImplementation(() => nigdy());
    renderPanel();
    await poczekajNaListe();
    fireEvent.click(przelacznik());

    await waitFor(() => expect(przelacznik()).toBeDisabled());
    fireEvent.click(przelacznik());
    expect(h.visibility).toHaveBeenCalledTimes(1);
  });

  it("po udanej zmianie widoczności lista odświeża się z widocznym stanem pracy", async () => {
    // Unieważnienie gałęzi wydarzenia oznacza ponowne zapytanie o katalog;
    // bez podpisu odświeżania ekran przez chwilę pokazuje nieaktualne wiersze
    // bez żadnego sygnału, że coś się dzieje.
    h.directory.mockResolvedValueOnce(directory()).mockImplementation(() => nigdy());
    renderPanel();
    await poczekajNaListe();
    fireEvent.click(przelacznik());

    expect(await screen.findByText(`${KAT}.loading`)).toBeInTheDocument();
  });
});

describe("ParticipantDirectoryPanel - pusta lista ma dwa znaczenia", () => {
  it("BEZ filtrów pusta lista znaczy: nikogo tu jeszcze nie ma", async () => {
    h.directory.mockResolvedValue(directory({ rows: [], totalCount: 0 }));
    renderPanel();

    expect(await screen.findByText(`${KAT}.empty`)).toBeInTheDocument();
    expect(screen.queryByText(`${KAT}.emptyFiltered`)).not.toBeInTheDocument();
  });

  it("PO WYSZUKANIU pusta lista znaczy: nikt nie pasuje do frazy", async () => {
    // To dwa różne następne kroki: czekać albo zmienić frazę.
    h.directory.mockResolvedValue(directory({ rows: [], totalCount: 0 }));
    renderPanel();
    await screen.findByText(`${KAT}.empty`);

    fireEvent.change(szukajka(), { target: { value: "kowalski" } });
    expect(await screen.findByText(`${KAT}.emptyFiltered`)).toBeInTheDocument();
  });

  it("fraza wyszukiwania jedzie do bazy DOPIERO po pauzie w pisaniu", async () => {
    // Katalog liczy w bazie przecięcie grup i reguł zaproszenia dla każdego
    // wiersza - zapytanie na każdy znak to najdroższy możliwy sposób pisania.
    renderPanel();
    await poczekajNaListe();
    h.directory.mockClear();

    fireEvent.change(szukajka(), { target: { value: "k" } });
    fireEvent.change(szukajka(), { target: { value: "ko" } });
    fireEvent.change(szukajka(), { target: { value: "kow" } });
    expect(h.directory).not.toHaveBeenCalled();

    await waitFor(() => expect(h.directory).toHaveBeenCalledTimes(1));
    expect(h.directory).toHaveBeenCalledWith(
      expect.objectContaining({ eventSlug: SLUG, q: "kow", offset: 0 }),
    );
  });

  it("PO WYBRANIU GRUPY pusta lista też mówi o filtrze, nie o pustym katalogu", async () => {
    h.directory.mockResolvedValue(
      directory({
        rows: [],
        totalCount: 0,
        groups: [
          { id: "g-1", namePl: "Wystawcy", nameEn: "Exhibitors", color: null },
          { id: "g-2", namePl: "Kupujący", nameEn: "Buyers", color: "#ff0000" },
        ],
      }),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Wystawcy" }));

    expect(await screen.findByText(`${KAT}.emptyFiltered`)).toBeInTheDocument();
  });
});

describe("ParticipantDirectoryPanel - filtr grup", () => {
  it("JEDNA grupa nie rysuje filtra - nie ma między czym wybierać", async () => {
    h.directory.mockResolvedValue(
      directory({ groups: [{ id: "g-1", namePl: "Wystawcy", nameEn: "Exhibitors", color: null }] }),
    );
    renderPanel();
    await poczekajNaListe();

    expect(screen.queryByRole("button", { name: `${KAT}.allGroups` })).not.toBeInTheDocument();
  });

  it("DWIE grupy dają filtr, a wybór grupy jedzie do zapytania i zeruje stronę", async () => {
    h.directory.mockResolvedValue(
      directory({
        groups: [
          { id: "g-1", namePl: "Wystawcy", nameEn: "Exhibitors", color: null },
          { id: "g-2", namePl: "Kupujący", nameEn: "Buyers", color: "#ff0000" },
        ],
      }),
    );
    renderPanel();
    await poczekajNaListe();
    expect(screen.getByRole("button", { name: `${KAT}.allGroups` })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Kupujący" }));
    await waitFor(() =>
      expect(h.directory).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: "g-2", offset: 0 }),
      ),
    );
  });

  it("powrót do „wszystkich grup” kasuje filtr w zapytaniu", async () => {
    h.directory.mockResolvedValue(
      directory({
        groups: [
          { id: "g-1", namePl: "Wystawcy", nameEn: "Exhibitors", color: null },
          { id: "g-2", namePl: "Kupujący", nameEn: "Buyers", color: null },
        ],
      }),
    );
    renderPanel();
    await poczekajNaListe();
    fireEvent.click(screen.getByRole("button", { name: "Kupujący" }));
    await waitFor(() =>
      expect(h.directory).toHaveBeenCalledWith(expect.objectContaining({ groupId: "g-2" })),
    );
    // Zmiana filtra to NOWY klucz zapytania, więc panel wraca na chwilę do
    // szkieletu razem z samym filtrem - czekamy, aż wróci.
    await poczekajNaListe();

    fireEvent.click(screen.getByRole("button", { name: `${KAT}.allGroups` }));
    await waitFor(() =>
      expect(h.directory).toHaveBeenCalledWith(expect.objectContaining({ groupId: null })),
    );
  });
});

describe("ParticipantDirectoryPanel - karta uczestnika", () => {
  it("osoba BEZ zdjęcia dostaje inicjał, a nie pękniętego obrazka", async () => {
    renderPanel();
    await poczekajNaListe();

    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("Anna Kowalska")).toBeInTheDocument();
    expect(screen.getByText("Dyrektorka · ACME")).toBeInTheDocument();
  });

  it("osoba BEZ imienia i nazwiska dostaje znak zapytania, a nie pusty kwadrat", async () => {
    // Kartoteka bez nazwiska jest osiągalna (import, zgłoszenie grupowe);
    // pusty kwadrat wygląda jak błąd renderowania.
    h.directory.mockResolvedValue(directory({ rows: [entry({ firstName: "", lastName: "" })] }));
    renderPanel();
    await poczekajNaListe();

    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("osoba ZE zdjęciem nie pokazuje inicjału", async () => {
    h.directory.mockResolvedValue(
      directory({ rows: [entry({ photoUrl: "https://cdn.example/anna.jpg" })] }),
    );
    const { container } = renderPanel();
    await poczekajNaListe();

    expect(screen.queryByText("A")).not.toBeInTheDocument();
    expect(container.querySelector('img[src="https://cdn.example/anna.jpg"]')).not.toBeNull();
  });

  it("logotyp firmy pojawia się przy podpisie tylko wtedy, gdy CRM go zna", async () => {
    h.directory.mockResolvedValue(
      directory({ rows: [entry({ companyLogoUrl: "https://cdn.example/acme.png" })] }),
    );
    const { container } = renderPanel();
    await poczekajNaListe();

    expect(container.querySelector('img[src="https://cdn.example/acme.png"]')).not.toBeNull();
  });

  it("osoba BEZ konta na platformie nie dostaje przycisków sieci ani czatu", async () => {
    // `ConnectButton` i czat wymagają `user_id`; pokazane bez konta prowadzą
    // do akcji, której baza nie ma jak wykonać.
    renderPanel();
    await poczekajNaListe();

    expect(screen.queryByText(/^connect:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^dm:/)).not.toBeInTheDocument();
  });

  it("osoba Z kontem dostaje oba przyciski z własnym identyfikatorem", async () => {
    h.directory.mockResolvedValue(directory({ rows: [entry({ userId: "u-77" })] }));
    renderPanel();
    await poczekajNaListe();

    expect(screen.getByText("connect:u-77")).toBeInTheDocument();
    expect(screen.getByText("dm:u-77")).toBeInTheDocument();
  });

  it("puste branża i specjalizacja nie rysują pustych plakietek", async () => {
    h.directory.mockResolvedValue(
      directory({ rows: [entry({ industry: null, specialization: "   " })] }),
    );
    renderPanel();
    await poczekajNaListe();

    expect(screen.queryByText("Energia")).not.toBeInTheDocument();
    expect(screen.queryByText("Regulacje")).not.toBeInTheDocument();
    expect(screen.getByText(`${KAT}.hasAvailability`)).toBeInTheDocument();
  });

  it("DOSTĘPNOŚĆ ma dwa różne podpisy - jest kiedy się umówić albo nie ma", async () => {
    // Bez tego rozróżnienia uczestnik wysyła zaproszenie do kogoś, kto nie
    // zgłosił ani jednego okna, i dostaje z bazy `invitee_unavailable`.
    const { unmount } = renderPanel();
    await poczekajNaListe();
    expect(screen.getByText(`${KAT}.hasAvailability`)).toBeInTheDocument();
    unmount();

    h.directory.mockResolvedValue(directory({ rows: [entry({ hasAvailability: false })] }));
    renderPanel();
    await poczekajNaListe();
    expect(screen.getByText(`${KAT}.noAvailability`)).toBeInTheDocument();
  });

  it("grupa Z KOLOREM maluje obramowanie plakietki, grupa bez koloru nie", async () => {
    h.directory.mockResolvedValue(
      directory({
        rows: [
          entry({
            groups: [
              { id: "g-1", namePl: "Wystawcy", nameEn: "Exhibitors", color: "#ff0000" },
              { id: "g-2", namePl: "Kupujący", nameEn: "Buyers", color: null },
            ],
          }),
        ],
      }),
    );
    renderPanel();
    await poczekajNaListe();

    expect(screen.getByText("Wystawcy").getAttribute("style")).toContain("border-color");
    expect(screen.getByText("Kupujący").getAttribute("style") ?? "").not.toContain("border-color");
  });

  it("nazwy grup idą w JĘZYKU INTERFEJSU, nie w jednym na sztywno", async () => {
    h.directory.mockResolvedValue(
      directory({
        rows: [
          entry({ groups: [{ id: "g-1", namePl: "Wystawcy", nameEn: "Exhibitors", color: null }] }),
        ],
      }),
    );
    renderPanel();
    await poczekajNaListe();

    expect(screen.getByText("Wystawcy")).toBeInTheDocument();
    expect(screen.queryByText("Exhibitors")).not.toBeInTheDocument();
  });
});

describe("ParticipantDirectoryPanel - stan rozmowy zmienia przycisk", () => {
  it("osoba, z którą NIC nas nie łączy, dostaje zaproszenie", async () => {
    renderPanel();
    await poczekajNaListe();

    expect(screen.getByRole("button", { name: `${KAT}.invite` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `${KAT}.alreadyInvited` })).not.toBeInTheDocument();
  });

  it("osoba z ŻYWYM zaproszeniem dostaje odnośnik do terminarza, nie drugie zaproszenie", async () => {
    // Drugie zaproszenie do tej samej osoby baza odrzuca jako
    // `duplicate_invitation` - uczestnik dostałby odmowę zamiast informacji.
    h.directory.mockResolvedValue(directory({ rows: [entry({ meetingStatus: "invited" })] }));
    const { onOpenMeetings } = renderPanel();
    await poczekajNaListe();

    expect(screen.queryByRole("button", { name: `${KAT}.invite` })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `${KAT}.alreadyInvited` }));
    expect(onOpenMeetings).toHaveBeenCalledTimes(1);
  });

  it("osoba z PRZYJĘTYM spotkaniem dostaje INNE zdanie niż zaproszona", async () => {
    h.directory.mockResolvedValue(directory({ rows: [entry({ meetingStatus: "accepted" })] }));
    const { onOpenMeetings } = renderPanel();
    await poczekajNaListe();

    fireEvent.click(screen.getByRole("button", { name: `${KAT}.alreadyMeeting` }));
    expect(onOpenMeetings).toHaveBeenCalledTimes(1);
  });
});

describe("ParticipantDirectoryPanel - stronicowanie", () => {
  const strona = (offset: number, total: number) =>
    directory({
      totalCount: total,
      rows: Array.from({ length: Math.min(24, total - offset) }, (_, i) =>
        entry({ registrationId: `reg-${offset + i}`, firstName: `Osoba${offset + i}` }),
      ),
    });

  it("wyniki mieszczące się na JEDNEJ stronie nie rysują stronicowania", async () => {
    h.directory.mockResolvedValue(directory({ totalCount: 24, rows: [entry()] }));
    renderPanel();
    await poczekajNaListe();

    expect(screen.queryByRole("button", { name: `${KAT}.nextPage` })).not.toBeInTheDocument();
  });

  it("na PIERWSZEJ stronie „poprzednia” jest wyłączona, a zakres liczony od jedynki", async () => {
    h.directory.mockResolvedValue(strona(0, 50));
    renderPanel();
    await poczekajNaListe();

    expect(screen.getByRole("button", { name: `${KAT}.prevPage` })).toBeDisabled();
    expect(screen.getByRole("button", { name: `${KAT}.nextPage` })).toBeEnabled();
    expect(screen.getByText("1-24 / 50")).toBeInTheDocument();
  });

  it("NASTĘPNA strona przesuwa wycinek w zapytaniu i przelicza zakres", async () => {
    h.directory.mockImplementation((input: { offset: number }) =>
      Promise.resolve(strona(input.offset, 50)),
    );
    renderPanel();
    await poczekajNaListe();
    fireEvent.click(screen.getByRole("button", { name: `${KAT}.nextPage` }));

    await waitFor(() =>
      expect(h.directory).toHaveBeenCalledWith(expect.objectContaining({ offset: 24, limit: 24 })),
    );
    expect(await screen.findByText("25-48 / 50")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${KAT}.prevPage` })).toBeEnabled();
  });

  it("na OSTATNIEJ stronie „następna” jest wyłączona, a zakres nie przekracza sumy", async () => {
    // `Math.min` pilnuje, żeby ostatnia strona nie mówiła „49-72 / 50".
    h.directory.mockImplementation((input: { offset: number }) =>
      Promise.resolve(strona(input.offset, 50)),
    );
    renderPanel();
    await poczekajNaListe();
    fireEvent.click(screen.getByRole("button", { name: `${KAT}.nextPage` }));
    await screen.findByText("25-48 / 50");
    fireEvent.click(screen.getByRole("button", { name: `${KAT}.nextPage` }));

    expect(await screen.findByText("49-50 / 50")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${KAT}.nextPage` })).toBeDisabled();
  });

  it("POWRÓT na poprzednią stronę wraca do wycinka od zera", async () => {
    h.directory.mockImplementation((input: { offset: number }) =>
      Promise.resolve(strona(input.offset, 50)),
    );
    renderPanel();
    await poczekajNaListe();
    fireEvent.click(screen.getByRole("button", { name: `${KAT}.nextPage` }));
    await screen.findByText("25-48 / 50");

    fireEvent.click(screen.getByRole("button", { name: `${KAT}.prevPage` }));
    expect(await screen.findByText("1-24 / 50")).toBeInTheDocument();
  });

  it("liczba wyników pochodzi z SUMY w bazie, nie z długości widocznej strony", async () => {
    h.directory.mockResolvedValue(strona(0, 50));
    renderPanel();
    await poczekajNaListe();

    expect(screen.getByText(`${KAT}.count(count=50)`)).toBeInTheDocument();
  });
});

describe("ParticipantDirectoryPanel - wysłanie zaproszenia", () => {
  const slot = {
    starts_at: "2026-09-10T08:00:00.000Z",
    ends_at: "2026-09-10T08:20:00.000Z",
    table_id: "t-1",
    table_label: "Stolik 4",
    table_zone: "Sala A",
    table_seat: 1,
  };

  async function otworzZaproszenie() {
    renderPanel();
    await poczekajNaListe();
    fireEvent.click(screen.getByRole("button", { name: `${KAT}.invite` }));
    return screen.findByRole("dialog");
  }

  it("okno zaproszenia pyta o wolne terminy WŁAŚNIE TEJ osoby", async () => {
    // Zapytanie startuje dopiero z otwartym oknem - odpytywanie każdego wiersza
    // z góry to kilkadziesiąt wywołań po nic.
    h.freeSlots.mockResolvedValue([slot]);
    await otworzZaproszenie();

    await waitFor(() =>
      expect(h.freeSlots).toHaveBeenCalledWith({
        eventSlug: SLUG,
        counterpartRegistrationId: "reg-1",
      }),
    );
    // Nazwisko rozmówcy jest w oknie, a nie tylko na karcie na liście pod nim.
    expect(within(screen.getByRole("dialog")).getByText("Anna Kowalska")).toBeInTheDocument();
  });

  it("BRAK wspólnych terminów blokuje wysyłkę i mówi, że ich nie ma", async () => {
    // Pusta lista znaczy „nie ma wspólnego terminu", a nie awaria; czynny
    // przycisk wysłałby `slot_not_in_grid`.
    const okno = await otworzZaproszenie();

    expect(await within(okno).findByText("eventMeetings.hints.noSlots")).toBeInTheDocument();
    expect(within(okno).getByRole("button", { name: `${KAT}.inviteSend` })).toBeDisabled();
  });

  it("ZAPROSZENIE jedzie z identyfikatorem zgłoszenia, terminem i obciętymi tekstami", async () => {
    h.freeSlots.mockResolvedValue([slot]);
    const okno = await otworzZaproszenie();
    fireEvent.click(await within(okno).findByRole("button", { name: /Stolik 4/ }));
    fireEvent.change(within(okno).getByLabelText("eventMeetings.fields.topic"), {
      target: { value: "  Współpraca  " },
    });
    fireEvent.change(within(okno).getByLabelText("eventMeetings.fields.message"), {
      target: { value: "  Do zobaczenia  " },
    });
    fireEvent.click(within(okno).getByRole("button", { name: `${KAT}.inviteSend` }));

    await waitFor(() => expect(h.invite).toHaveBeenCalledTimes(1));
    expect(h.invite).toHaveBeenCalledWith({
      eventSlug: SLUG,
      counterpartRegistrationId: "reg-1",
      startsAt: slot.starts_at,
      topic: "Współpraca",
      message: "Do zobaczenia",
    });
    await waitFor(() => expect(h.success).toHaveBeenCalledWith(`${KAT}.inviteSent`));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("PUSTY temat i wiadomość jadą jako brak, a nie jako pusty napis", async () => {
    // RPC rozróżnia „pole nieobecne" od jawnej wartości; pusty temat
    // w zaproszeniu wygląda jak temat, który ktoś skasował.
    h.freeSlots.mockResolvedValue([slot]);
    const okno = await otworzZaproszenie();
    fireEvent.click(await within(okno).findByRole("button", { name: /Stolik 4/ }));
    fireEvent.change(within(okno).getByLabelText("eventMeetings.fields.topic"), {
      target: { value: "   " },
    });
    fireEvent.click(within(okno).getByRole("button", { name: `${KAT}.inviteSend` }));

    await waitFor(() =>
      expect(h.invite).toHaveBeenCalledWith(
        expect.objectContaining({ topic: null, message: null }),
      ),
    );
  });

  it("BŁĄD zaproszenia zostawia okno otwarte i mówi kluczem bazy", async () => {
    h.freeSlots.mockResolvedValue([slot]);
    h.invite.mockRejectedValue(new Error("invite_limit_reached: no more"));
    const okno = await otworzZaproszenie();
    fireEvent.click(await within(okno).findByRole("button", { name: /Stolik 4/ }));
    fireEvent.click(within(okno).getByRole("button", { name: `${KAT}.inviteSend` }));

    await waitFor(() =>
      expect(h.error).toHaveBeenCalledWith("eventMeetings.errors.invite_limit_reached"),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(h.success).not.toHaveBeenCalled();
  });

  it("TRWAJĄCA wysyłka odcina przycisk - drugie kliknięcie to drugie zaproszenie", async () => {
    h.freeSlots.mockResolvedValue([slot]);
    h.invite.mockImplementation(() => nigdy());
    const okno = await otworzZaproszenie();
    fireEvent.click(await within(okno).findByRole("button", { name: /Stolik 4/ }));
    fireEvent.click(within(okno).getByRole("button", { name: `${KAT}.inviteSend` }));

    await waitFor(() =>
      expect(within(okno).getByRole("button", { name: `${KAT}.inviteSending` })).toBeDisabled(),
    );
    expect(h.invite).toHaveBeenCalledTimes(1);
  });

  it("ZAMKNIĘCIE okna porzuca wybór rozmówcy i nie wysyła zaproszenia", async () => {
    // Bez wyzerowania `invitee` następne otwarcie startowałoby z poprzednią
    // osobą i wybranym dla niej terminem - zaproszenie poszłoby do kogoś innego,
    // niż uczestnik właśnie kliknął.
    h.freeSlots.mockResolvedValue([slot]);
    const okno = await otworzZaproszenie();
    fireEvent.click(await within(okno).findByRole("button", { name: /Stolik 4/ }));
    fireEvent.click(within(okno).getByRole("button", { name: "atrapa-zamknij-okno" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.invite).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: `${KAT}.invite` }));
    const ponownie = await screen.findByRole("dialog");
    await within(ponownie).findByRole("button", { name: /Stolik 4/ });
    expect(within(ponownie).getByRole("button", { name: `${KAT}.inviteSend` })).toBeDisabled();
  });
});
