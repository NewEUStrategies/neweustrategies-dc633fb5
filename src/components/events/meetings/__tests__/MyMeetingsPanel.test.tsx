// „MOJE SPOTKANIA" uczestnika - trzy kolejki i decyzje, których nie da się cofnąć.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. STAN SPOTKANIA DECYDUJE, GDZIE WIERSZ SIEDZI I CO WOLNO Z NIM ZROBIĆ.
//     Zaproszenie czekające na moją odpowiedź, moje wysłane zaproszenie
//     i zamknięta sprawa wymagają trzech różnych działań. Wymieszane - giną
//     jedno w drugim, a wygasłe zaproszenie z czynnym „Przyjmij" kończy się
//     odmową bazy (`invitation_expired`) po kliknięciu.
//
//  2. PRZYCISK, KTÓREGO BAZA NIE OBSŁUŻY, JEST GORSZY OD JEGO BRAKU.
//     `event_meeting_respond` przyjmuje odpowiedź WYŁĄCZNIE od zaproszonej
//     strony, wyłącznie dla stanu `invited` i przed wygaśnięciem - a to jest
//     jedyne miejsce, w którym da się sprawdzić, że ekran tej reguły UŻYWA.
//
//  3. DECYZJA JEDZIE Z WŁAŚCIWYM IDENTYFIKATOREM I WŁAŚCIWYM ŁADUNKIEM.
//     Asercje idą po ARGUMENTACH warstwy sieciowej, nie po wyglądzie: „Odrzuć"
//     bez powodu i „Odwołaj" z pustym powodem to dwa różne kontrakty RPC
//     (`decline_reason` wymagany vs `reason` nieobecny).
//
//  4. NIEUDANA DECYZJA NIE ZAMYKA OKNA I NIE POKAZUJE SUROWEGO WYJĄTKU.
//     Zamknięte okno po błędzie = uczestnik nie wie, czy odwołał spotkanie;
//     surowy tekst wyjątku = angielskie zdanie o ograniczeniu bazy w polskim
//     panelu.
//
//  5. TRWAJĄCA ODPOWIEDŹ ODCINA PRZYCISK. Drugie kliknięcie „Przyjmij" to
//     drugie wywołanie RPC dla tego samego spotkania.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Tabel `canRespond`/`canCancel`/`bucketMeetings`
// i składania podpisu rozmówcy - mają własny plik
// `src/lib/events/__tests__/myMeetingRows.test.ts`. Tutaj dowodzimy, że ekran
// tych reguł używa i co robi z ich wynikiem.
//
// Asercje idą po KLUCZACH i18n (parytetu PL/EN pilnują osobne bramki
// słownikowe), a Radixowy Dialog jest podmieniony na natywny odpowiednik -
// happy-dom nie ma pełnego pointer API, którego wymaga portal Radixa.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { MyMeetingRow } from "@/lib/events/meetingsApi";

const h = vi.hoisted(() => ({
  respond: vi.fn(),
  cancel: vi.fn(),
  reschedule: vi.fn(),
  freeSlots: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));

vi.mock("@/components/ui/dialog", () => {
  // Radix zamyka okno klawiszem Escape i kliknięciem w tło - happy-dom nie ma
  // pełnego pointer API, więc atrapa wystawia jawny przycisk zamknięcia.
  // Bez niego gałąź `onOpenChange(false)` byłaby z testu nieosiągalna, a to
  // właśnie ona sprząta wybrany termin i wpisany powód.
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

// Warstwa sieciowa jest JEDYNĄ atrapą logiki - hooki `useMyMeetings` zostają
// prawdziwe, żeby test przechodził przez ten sam `useMutation`, co produkcja
// (stan `isPending`, kolejność `onSuccess`/`onError`).
vi.mock("@/lib/events/meetingsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/meetingsApi")>()),
  respondToMeeting: (input: unknown) => h.respond(input),
  cancelMeeting: (input: unknown) => h.cancel(input),
  rescheduleMeeting: (input: unknown) => h.reschedule(input),
  fetchMyFreeSlots: (input: unknown) => h.freeSlots(input),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve({ data: null, error: null }) },
}));

const { MyMeetingsPanel } = await import("@/components/events/meetings/MyMeetingsPanel");

const SLUG = "kongres-2026";
const TZ = "Europe/Warsaw";
const BAZA = "eventMeetings.participant.meetings";

/**
 * Nadpisania wiersza DOPUSZCZAJĄ `null`, choć wygenerowany typ `Returns` go nie
 * przewiduje. To nie obejście typów, tylko odwzorowanie bazy: `event_meetings_mine`
 * naprawdę oddaje NULL w `table_label`, `table_seat`, `expires_at` i `topic`
 * (stolik przydzielany dopiero przy `accept`, zaproszenie bez terminu ważności),
 * a sam komponent to wie - stąd jego `typeof row.topic === "string"`. Bez tej
 * mapy najciekawsze przypadki tego pliku byłyby nie do zapisania.
 */
type NadpisanieWiersza = { [K in keyof MyMeetingRow]?: MyMeetingRow[K] | null };

/** Wiersz `event_meetings_mine`; kolumny nullowalne w bazie stawiamy jawnie. */
function row(over: NadpisanieWiersza = {}): MyMeetingRow {
  return {
    id: "m-1",
    event_id: "e-1",
    side: "invitee",
    status: "invited",
    is_expired: false,
    starts_at: "2026-09-10T08:00:00.000Z",
    ends_at: "2026-09-10T08:20:00.000Z",
    expires_at: "2026-09-09T08:00:00.000Z",
    created_at: "2026-09-01T08:00:00.000Z",
    responded_at: null,
    counterpart_registration_id: "reg-2",
    counterpart_first_name: "Anna",
    counterpart_last_name: "Kowalska",
    counterpart_job_title: "Dyrektorka",
    counterpart_company: "ACME",
    invitation_message: null,
    decline_reason: null,
    cancel_reason: null,
    cancelled_side: null,
    sponsor_id: null,
    sponsor_name: null,
    table_label: "Stolik 4",
    table_zone: "Sala A",
    table_seat: 2,
    topic: "Energia",
    ...over,
  } as unknown as MyMeetingRow;
}

function renderPanel(rows: MyMeetingRow[], timezone: string | null = TZ) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MyMeetingsPanel slug={SLUG} rows={rows} timezone={timezone} />
    </QueryClientProvider>,
  );
}

const przyjmij = () => screen.getByRole("button", { name: "eventMeetings.actions.accept" });
const odrzuc = () => screen.getByRole("button", { name: "eventMeetings.actions.decline" });
const odwolaj = () => screen.getByRole("button", { name: "eventMeetings.actions.cancel" });
const przeloz = () => screen.getByRole("button", { name: "eventMeetings.actions.reschedule" });
const potwierdz = () =>
  screen.getByRole("button", { name: "eventMeetings.participant.form.confirm" });
const powod = () => screen.getByLabelText(/eventMeetings\.fields\.(decline|cancel)Reason/);
// Przycisk „Przełóż" istnieje DWA razy: w wierszu (otwiera okno) i w stopce
// okna (wysyła wybrany termin) - zapytania o ten drugi muszą być zawężone.
const wyslijNowyTermin = () =>
  within(screen.getByRole("dialog")).getByRole("button", {
    name: "eventMeetings.actions.reschedule",
  });

/** Obietnica, która nigdy się nie rozstrzyga - zamraża stan `isPending`. */
function nigdy(): Promise<never> {
  return new Promise<never>(() => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  h.respond.mockResolvedValue({});
  h.cancel.mockResolvedValue({});
  h.reschedule.mockResolvedValue({});
  h.freeSlots.mockResolvedValue([]);
});

describe("MyMeetingsPanel - trzy kolejki zamiast jednej listy", () => {
  it("PUSTA LISTA mówi o tym zdaniem, a nie trzema pustymi kartami", () => {
    // Bez wczesnego wyjścia `list.length === 0` ekran rysowałby trzy nagłówki
    // sekcji bez ani jednego wiersza - uczestnik czytałby „Do Ciebie" i szukał,
    // co się pod tym schowało.
    renderPanel([]);
    expect(screen.getByText("eventMeetings.empty.meetings")).toBeInTheDocument();
    expect(screen.queryByText(`${BAZA}.incoming`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${BAZA}.outgoing`)).not.toBeInTheDocument();
    expect(screen.queryByText("eventMeetings.status.all")).not.toBeInTheDocument();
  });

  it("zaproszenie DO mnie i moje WYSŁANE trafiają do dwóch różnych kolejek", () => {
    // Zlanie kierunków w jedną listę chronologiczną gubi jedyną informację,
    // która mówi, czy trzeba coś zrobić, czy tylko czekać.
    renderPanel([row({ id: "m-in", side: "invitee" }), row({ id: "m-out", side: "requester" })]);
    expect(screen.getByText(`${BAZA}.incoming`)).toBeInTheDocument();
    expect(screen.getByText(`${BAZA}.outgoing`)).toBeInTheDocument();
    expect(screen.queryByText("eventMeetings.status.all")).not.toBeInTheDocument();
    expect(screen.queryByText("eventMeetings.empty.meetings")).not.toBeInTheDocument();
  });

  it("spotkanie PRZYJĘTE zostaje w kolejce, a nie idzie do archiwum", () => {
    // `accepted` to stan żywy - dla uczestnika liczy się nadchodzący termin,
    // nie to, kto kogo zaprosił.
    renderPanel([row({ status: "accepted", side: "invitee" })]);
    expect(screen.getByText(`${BAZA}.incoming`)).toBeInTheDocument();
    expect(screen.getByText("eventMeetings.status.accepted")).toBeInTheDocument();
    expect(screen.queryByText("eventMeetings.status.all")).not.toBeInTheDocument();
  });

  it.each([
    ["declined", "eventMeetings.status.declined"],
    ["cancelled", "eventMeetings.status.cancelled"],
    ["rescheduled", "eventMeetings.status.rescheduled"],
    ["held", "eventMeetings.status.held"],
    ["no_show", "eventMeetings.status.no_show"],
  ])("stan zamknięty %s ląduje w ARCHIWUM z własnym podpisem", (status, klucz) => {
    // Każdy z tych stanów ma inne zdanie w słowniku; wspólny napis „zakończone"
    // kasowałby różnicę między odmową rozmówcy a odwołaniem przez organizatora.
    renderPanel([row({ status })]);
    expect(screen.getByText("eventMeetings.status.all")).toBeInTheDocument();
    expect(screen.getByText(klucz)).toBeInTheDocument();
    expect(screen.queryByText(`${BAZA}.incoming`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${BAZA}.outgoing`)).not.toBeInTheDocument();
  });

  it("WYGASŁE zaproszenie ma własny status i idzie do archiwum bez przycisków", () => {
    // Wygasły wiersz na górze listy z czynnym „Przyjmij" to obietnica, której
    // baza nie dotrzyma: `event_meeting_respond` odmawia `invitation_expired`.
    renderPanel([row({ status: "invited", is_expired: true })]);
    expect(screen.getByText("eventMeetings.status.expired")).toBeInTheDocument();
    expect(screen.getByText("eventMeetings.status.all")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "eventMeetings.actions.accept" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "eventMeetings.actions.cancel" }),
    ).not.toBeInTheDocument();
  });
});

describe("MyMeetingsPanel - co niesie pojedynczy wiersz", () => {
  it("BRAK STOLIKA podpisujemy ZDANIEM o braku przydziału, a nie kreską", () => {
    // Baza przydziela miejsce dopiero przy `accept`, więc puste pole
    // w zaproszeniu jest stanem POPRAWNYM. Kreska kazałaby uczestnikowi szukać
    // stolika, którego jeszcze nie ma.
    renderPanel([row({ table_label: null, table_zone: null, table_seat: null })]);
    expect(screen.getByText(`${BAZA}.tableUnassigned`)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(`${BAZA}\\.seat`))).not.toBeInTheDocument();
  });

  it("przydzielony stolik pokazuje etykietę, strefę i NUMER MIEJSCA", () => {
    renderPanel([row({ status: "accepted", table_label: "Stolik 4", table_zone: "Sala A" })]);
    expect(screen.getByText(/Stolik 4 · Sala A/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${BAZA}\\.seat.*count=2`))).toBeInTheDocument();
  });

  it("stolik BEZ numeru miejsca nie dokleja pustego dopisku", () => {
    // `table_seat` bywa `null` (stolik bez numeracji miejsc); dopisek „miejsce
    // null" jest gorszy niż jego brak.
    renderPanel([row({ status: "accepted", table_seat: null })]);
    expect(screen.getByText(/Stolik 4 · Sala A/)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(`${BAZA}\\.seat`))).not.toBeInTheDocument();
  });

  it("TEMAT rozmowy pokazujemy tylko wtedy, gdy naprawdę coś zawiera", () => {
    // Same spacje w `topic` narysowałyby pusty wiersz tekstu rozpychający kartę.
    renderPanel([row({ topic: "   " })]);
    expect(screen.queryByText("Energia")).not.toBeInTheDocument();
    expect(screen.getByText("Anna Kowalska")).toBeInTheDocument();
  });

  it("ROLA rozmówcy znika, gdy nie ma z czego jej złożyć", () => {
    // Bez tego warunku karta miałaby pusty wiersz w miejscu „stanowisko · firma".
    renderPanel([row({ counterpart_job_title: null, counterpart_company: null })]);
    expect(screen.queryByText(/Dyrektorka/)).not.toBeInTheDocument();
    expect(screen.getByText("Anna Kowalska")).toBeInTheDocument();
  });

  it("TERMIN WAŻNOŚCI widać wyłącznie przy zaproszeniu, na które da się odpowiedzieć", () => {
    // Data wygaśnięcia przy spotkaniu już potwierdzonym sugerowałaby, że
    // potwierdzenie samo się cofnie.
    const { unmount } = renderPanel([row({ status: "invited", side: "invitee" })]);
    expect(screen.getByText(new RegExp(`${BAZA}\\.expiresAt`))).toBeInTheDocument();
    unmount();

    renderPanel([row({ status: "accepted", side: "invitee" })]);
    expect(screen.queryByText(new RegExp(`${BAZA}\\.expiresAt`))).not.toBeInTheDocument();
  });

  it("zaproszenie BEZ daty wygaśnięcia nie rysuje pustego zdania o terminie", () => {
    renderPanel([row({ expires_at: null })]);
    expect(screen.queryByText(new RegExp(`${BAZA}\\.expiresAt`))).not.toBeInTheDocument();
    expect(przyjmij()).toBeInTheDocument();
  });

  it("bez strefy wydarzenia godzina nadal się liczy (strefa domyślna serwisu)", () => {
    // `timezone === null` to zwykły stan bazy (kolumna bez NOT NULL); pusty
    // wiersz z godziną byłby regresją widoczną dopiero u uczestnika.
    renderPanel([row({ status: "accepted" })], null);
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });
});

describe("MyMeetingsPanel - przyciski wynikają ze stanu, nie z układu", () => {
  it("ZAPROSZENIE DO MNIE daje przyjęcie, odmowę, przełożenie i odwołanie", () => {
    renderPanel([row({ side: "invitee", status: "invited" })]);
    expect(przyjmij()).toBeInTheDocument();
    expect(odrzuc()).toBeInTheDocument();
    expect(przeloz()).toBeInTheDocument();
    expect(odwolaj()).toBeInTheDocument();
  });

  it("MOJE WYSŁANE zaproszenie NIE daje przyjęcia ani odmowy", () => {
    // RPC przyjmuje odpowiedź wyłącznie od zaproszonej strony - własne
    // zaproszenie można tylko odwołać albo przełożyć.
    renderPanel([row({ side: "requester", status: "invited" })]);
    expect(
      screen.queryByRole("button", { name: "eventMeetings.actions.accept" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "eventMeetings.actions.decline" }),
    ).not.toBeInTheDocument();
    expect(przeloz()).toBeInTheDocument();
    expect(odwolaj()).toBeInTheDocument();
  });

  it("spotkanie PRZYJĘTE nie daje już odpowiedzi, ale wolno je przełożyć i odwołać", () => {
    renderPanel([row({ side: "invitee", status: "accepted" })]);
    expect(
      screen.queryByRole("button", { name: "eventMeetings.actions.accept" }),
    ).not.toBeInTheDocument();
    expect(przeloz()).toBeInTheDocument();
    expect(odwolaj()).toBeInTheDocument();
  });

  it("wiersz ARCHIWALNY nie ma żadnego przycisku decyzji", () => {
    // Każdy przycisk na zamkniętej sprawie kończy się `meeting_not_active`.
    renderPanel([row({ status: "declined" })]);
    expect(
      screen.queryByRole("button", { name: /eventMeetings\.actions\./ }),
    ).not.toBeInTheDocument();
  });
});

describe("MyMeetingsPanel - decyzje jadą do bazy z właściwym ładunkiem", () => {
  it("PRZYJMIJ wysyła decyzję `accept` dla TEGO spotkania i potwierdza zdaniem", async () => {
    renderPanel([row({ id: "m-77" }), row({ id: "m-88", side: "requester" })]);
    fireEvent.click(przyjmij());

    await waitFor(() => expect(h.respond).toHaveBeenCalledTimes(1));
    expect(h.respond).toHaveBeenCalledWith({ meetingId: "m-77", decision: "accept" });
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("eventMeetings.toasts.accepted"));
  });

  it("BŁĄD przyjęcia pokazuje klucz z kontraktu bazy, nie surowy wyjątek", async () => {
    // Baza podnosi `klucz: zdanie po angielsku`. Pokazanie `error.message`
    // wprost dałoby uczestnikowi angielskie zdanie o ograniczeniu tabeli.
    h.respond.mockRejectedValue(new Error("rate_limited: too many invitations"));
    renderPanel([row()]);
    fireEvent.click(przyjmij());

    await waitFor(() => expect(h.error).toHaveBeenCalledWith("eventMeetings.errors.rate_limited"));
    expect(h.success).not.toHaveBeenCalled();
  });

  it("nieznany błąd degraduje do komunikatu ogólnego zamiast pustego ekranu", async () => {
    h.respond.mockRejectedValue(new Error("ERROR: coś poszło nie tak"));
    renderPanel([row()]);
    fireEvent.click(przyjmij());

    await waitFor(() => expect(h.error).toHaveBeenCalledWith("eventMeetings.errors.unknown"));
  });

  it("TRWAJĄCA odpowiedź odcina przycisk przyjęcia - drugie kliknięcie to druga decyzja", async () => {
    h.respond.mockImplementation(() => nigdy());
    renderPanel([row()]);
    fireEvent.click(przyjmij());

    await waitFor(() => expect(przyjmij()).toBeDisabled());
    fireEvent.click(przyjmij());
    expect(h.respond).toHaveBeenCalledTimes(1);
  });

  it("ODRZUĆ bez powodu jest zablokowane, a wpisany powód jedzie w ładunku RPC", async () => {
    // `event_meeting_respond` odmawia `decline_reason_required`; brak blokady
    // w oknie znaczy, że jedyną informacją zwrotną byłby komunikat o awarii.
    renderPanel([row({ id: "m-9" })]);
    fireEvent.click(odrzuc());

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(potwierdz()).toBeDisabled();

    fireEvent.change(powod(), { target: { value: "  kolizja z sesją  " } });
    expect(potwierdz()).toBeEnabled();
    fireEvent.click(potwierdz());

    await waitFor(() => expect(h.respond).toHaveBeenCalledTimes(1));
    expect(h.respond).toHaveBeenCalledWith({
      meetingId: "m-9",
      decision: "decline",
      declineReason: "kolizja z sesją",
    });
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("eventMeetings.toasts.declined"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("SAME SPACJE to nadal brak powodu odmowy", () => {
    // Bez obcięcia białych znaków „ " przechodzi walidację i ląduje w historii
    // spotkania jako uzasadnienie, którego nikt nie napisał.
    renderPanel([row()]);
    fireEvent.click(odrzuc());
    fireEvent.change(powod(), { target: { value: "    " } });

    expect(potwierdz()).toBeDisabled();
    expect(h.respond).not.toHaveBeenCalled();
  });

  it("ODWOŁANIE bez powodu wysyła BRAK pola, a nie pusty napis", async () => {
    // RPC rozróżnia „pole nieobecne" od jawnej wartości; pusty napis wyglądałby
    // w historii jak powód, który ktoś napisał i skasował.
    renderPanel([row({ id: "m-5" })]);
    fireEvent.click(odwolaj());
    expect(potwierdz()).toBeEnabled();
    fireEvent.click(potwierdz());

    await waitFor(() => expect(h.cancel).toHaveBeenCalledTimes(1));
    expect(h.cancel).toHaveBeenCalledWith({ meetingId: "m-5", reason: undefined });
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("eventMeetings.toasts.cancelled"));
  });

  it("ODWOŁANIE z powodem przekazuje powód po obcięciu białych znaków", async () => {
    renderPanel([row({ id: "m-6" })]);
    fireEvent.click(odwolaj());
    fireEvent.change(powod(), { target: { value: "  wyjazd  " } });
    fireEvent.click(potwierdz());

    await waitFor(() =>
      expect(h.cancel).toHaveBeenCalledWith({ meetingId: "m-6", reason: "wyjazd" }),
    );
  });

  it("NIEUDANE odwołanie ZOSTAWIA okno otwarte i mówi, co się stało", async () => {
    // Zamknięte okno po błędzie znaczy „chyba się udało" - uczestnik nie wie,
    // czy rozmówca dostał odwołanie, i klika drugi raz.
    h.cancel.mockRejectedValue(new Error("meeting_not_active: closed"));
    renderPanel([row()]);
    fireEvent.click(odwolaj());
    fireEvent.click(potwierdz());

    await waitFor(() =>
      expect(h.error).toHaveBeenCalledWith("eventMeetings.errors.meeting_not_active"),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(h.success).not.toHaveBeenCalled();
  });

  it("ZAMKNIĘCIE okna bez decyzji nie woła bazy", () => {
    renderPanel([row()]);
    fireEvent.click(odrzuc());
    fireEvent.click(screen.getByRole("button", { name: "eventMeetings.participant.form.dismiss" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.respond).not.toHaveBeenCalled();
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("okno POWODU zmienia tryb: odwołanie nie wymaga powodu, odmowa wymaga", () => {
    // Ten sam komponent obsługuje dwie różne reguły - pomylony tryb albo
    // wymusza powód przy odwołaniu, albo przepuszcza odmowę bez powodu.
    renderPanel([row()]);
    fireEvent.click(odwolaj());
    expect(screen.getByText(`${BAZA}.cancelTitle`)).toBeInTheDocument();
    expect(potwierdz()).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "eventMeetings.participant.form.dismiss" }));
    fireEvent.click(odrzuc());
    expect(screen.getByText(`${BAZA}.declineTitle`)).toBeInTheDocument();
    expect(potwierdz()).toBeDisabled();
  });
});

describe("MyMeetingsPanel - przełożenie terminu", () => {
  it("BRAK wspólnych terminów mówi wprost, że ich nie ma - i nie da się potwierdzić", async () => {
    // Pusta lista to „nie ma wspólnego terminu", a nie awaria; czynny przycisk
    // wysłałby `slot_not_in_grid`.
    renderPanel([row()]);
    fireEvent.click(przeloz());

    await waitFor(() => expect(screen.getByText(`${BAZA}.noSlots`)).toBeInTheDocument());
    expect(wyslijNowyTermin()).toBeDisabled();
  });

  it("wybrany termin z listy BAZY jedzie do RPC razem z obciętą wiadomością", async () => {
    h.freeSlots.mockResolvedValue([
      {
        starts_at: "2026-09-11T09:00:00.000Z",
        ends_at: "2026-09-11T09:20:00.000Z",
        table_id: "t-1",
        table_label: "Stolik 1",
        table_zone: "Sala B",
        table_seat: 1,
      },
    ]);
    renderPanel([row({ id: "m-42", counterpart_registration_id: "reg-99" })]);
    fireEvent.click(przeloz());

    const slot = await screen.findByRole("button", { name: /Stolik 1/ });
    // Zapytanie o wolne terminy startuje DOPIERO z otwartym oknem i dotyczy
    // konkretnego rozmówcy - inaczej lista spotkań generowałaby kilkanaście
    // zapytań po nic.
    expect(h.freeSlots).toHaveBeenCalledWith({
      eventSlug: SLUG,
      counterpartRegistrationId: "reg-99",
    });

    fireEvent.click(slot);
    fireEvent.change(screen.getByLabelText("eventMeetings.fields.message"), {
      target: { value: "  wolę rano  " },
    });
    fireEvent.click(wyslijNowyTermin());

    await waitFor(() => expect(h.reschedule).toHaveBeenCalledTimes(1));
    expect(h.reschedule).toHaveBeenCalledWith({
      meetingId: "m-42",
      startsAt: "2026-09-11T09:00:00.000Z",
      message: "wolę rano",
    });
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("eventMeetings.toasts.rescheduled"));
  });

  it("przełożenie BEZ wiadomości wysyła brak pola, nie pusty napis", async () => {
    h.freeSlots.mockResolvedValue([
      {
        starts_at: "2026-09-11T09:00:00.000Z",
        ends_at: "2026-09-11T09:20:00.000Z",
        table_id: "t-1",
        table_label: "Stolik 1",
        table_zone: null,
        table_seat: 1,
      },
    ]);
    renderPanel([row({ id: "m-43" })]);
    fireEvent.click(przeloz());
    fireEvent.click(await screen.findByRole("button", { name: /Stolik 1/ }));
    fireEvent.click(wyslijNowyTermin());

    await waitFor(() =>
      expect(h.reschedule).toHaveBeenCalledWith({
        meetingId: "m-43",
        startsAt: "2026-09-11T09:00:00.000Z",
        message: undefined,
      }),
    );
  });

  it("NIEUDANE przełożenie zostawia okno otwarte z komunikatem z bazy", async () => {
    h.freeSlots.mockResolvedValue([
      {
        starts_at: "2026-09-11T09:00:00.000Z",
        ends_at: "2026-09-11T09:20:00.000Z",
        table_id: "t-1",
        table_label: "Stolik 1",
        table_zone: null,
        table_seat: 1,
      },
    ]);
    h.reschedule.mockRejectedValue(new Error("same_slot: identical"));
    renderPanel([row()]);
    fireEvent.click(przeloz());
    fireEvent.click(await screen.findByRole("button", { name: /Stolik 1/ }));
    fireEvent.click(wyslijNowyTermin());

    await waitFor(() => expect(h.error).toHaveBeenCalledWith("eventMeetings.errors.same_slot"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("ZAMKNIĘCIE okna przełożenia porzuca wybrany termin i nie woła bazy", async () => {
    // Okno trzyma wybrany termin we własnym stanie; brak sprzątania przy
    // zamknięciu znaczy, że następne otwarcie startuje z terminem wybranym dla
    // INNEGO spotkania - i wysyła go jednym kliknięciem.
    h.freeSlots.mockResolvedValue([
      {
        starts_at: "2026-09-11T09:00:00.000Z",
        ends_at: "2026-09-11T09:20:00.000Z",
        table_id: "t-1",
        table_label: "Stolik 1",
        table_zone: null,
        table_seat: 1,
      },
    ]);
    renderPanel([row()]);
    fireEvent.click(przeloz());
    fireEvent.click(await screen.findByRole("button", { name: /Stolik 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "atrapa-zamknij-okno" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.reschedule).not.toHaveBeenCalled();

    fireEvent.click(przeloz());
    await screen.findByRole("button", { name: /Stolik 1/ });
    expect(wyslijNowyTermin()).toBeDisabled();
  });

  it("TRWAJĄCE odwołanie odcina potwierdzenie w oknie powodu", async () => {
    // To ten sam przycisk co przy odmowie: obie mutacje muszą go blokować,
    // inaczej drugie kliknięcie wysyła drugą decyzję w tej samej sprawie.
    h.cancel.mockImplementation(() => nigdy());
    renderPanel([row()]);
    fireEvent.click(odwolaj());
    fireEvent.click(potwierdz());

    await waitFor(() => expect(potwierdz()).toBeDisabled());
    fireEvent.click(potwierdz());
    expect(h.cancel).toHaveBeenCalledTimes(1);
  });
});
