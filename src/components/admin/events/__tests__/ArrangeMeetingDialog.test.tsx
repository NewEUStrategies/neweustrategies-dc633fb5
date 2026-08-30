// Dialog „UMÓW SPOTKANIE" - organizator zakłada spotkanie za obie strony.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. NIE DA SIĘ UMÓWIĆ KOGOŚ Z SAMYM SOBĄ. Baza odrzuca taką parę
//     (`event_meetings_no_self`), ale odmowa PO kliknięciu jest gorsza niż brak
//     opcji - organizator nie zrozumie, dlaczego widzi kogoś, z kim nic nie da
//     się zrobić. Osoba wybrana po jednej stronie znika z listy drugiej.
//
//  2. OSOBY SPOZA WYDARZENIA NIE MA NA LIŚCIE. Wyszukiwarka pyta bazę, a baza
//     oddaje wyłącznie zgłoszenia `approved`/`attended`. Pusty wynik mówi
//     „nikogo takiego tu nie ma" i NIE odblokowuje zapisu.
//
//  3. TERMIN WYBIERA SIĘ Z LISTY, KTÓRĄ LICZY BAZA DLA PARY. Zapytanie o wolne
//     terminy nie ma prawa ruszyć, zanim obie strony są wybrane - dla jednej
//     osoby nie ma czego przecinać.
//
//  4. STOLIK ZAJĘTY DO KOŃCA ZNACZY BRAK TERMINÓW, A NIE PUSTĄ LISTĘ BEZ
//     KOMENTARZA. Gdy wszystkie miejsca są zajęte, ekran mówi to zdaniem,
//     a przycisk „Umów" zostaje wyłączony.
//
//  5. TEN SAM TERMIN PRZY DWÓCH RÓŻNYCH MIEJSCACH TO DWA RÓŻNE WYBORY.
//     Klucz slotu obejmuje stolik I numer miejsca; klucz zbudowany z samej
//     godziny zaznaczałby oba wiersze naraz, a do bazy jechałby ten, który
//     akurat był pierwszy.
//
//  6. KOLIZJA PRZY ZAPISIE MÓWI, CO SIĘ STAŁO, I NIE ZAMYKA OKNA.
//     `table_busy` i `participant_busy` to dwie różne decyzje organizatora
//     (przesiądź się / zmień termin), a zamknięte okno kasuje cały wybór.
//
//  7. ZAPIS JEST JEDNORAZOWY. Trwające umawianie odcina przycisk, więc drugie
//     kliknięcie nie zakłada DRUGIEGO spotkania tej samej pary.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Wyszukiwarki uczestników
// (`meetingParticipants.test.ts` - w tym bramka statusów zgłoszeń). (2) Bramek
// hooka wolnych terminów (`useMeetings.test.tsx`). (3) Mapowania odmów bazy
// (`adminMeetingErrors.test.ts`). Hooki są tu PRAWDZIWE - atrapą jest dopiero
// warstwa sieciowa.
//
// RODO: wszystkie nazwiska i firmy są zmyślone.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { axeViolations, summarize } from "@/test/axe";
import type { MeetingParticipantOption } from "@/lib/events/meetingParticipants";
import type { MeetingFreeSlot } from "@/lib/events/meetingsApi";

const h = vi.hoisted(() => ({
  participants: vi.fn(),
  freeSlots: vi.fn(),
  arrange: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));

vi.mock("@/lib/events/adminMeetingErrors", () => ({
  adminMeetingFailure: (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return { key: `adminEventMeetings.errors.${message.split(":")[0]}`, params: {} };
  },
}));

vi.mock("@/components/ui/dialog", async () => {
  const react = await import("react");
  // Radix zamyka okno klawiszem Escape i kliknięciem w tło - happy-dom nie ma
  // pełnego pointer API. Atrapa zostawia z Radiksa KONTRAKT: przy `open ===
  // false` z wnętrza okna nie ma w drzewie NICZEGO (na tym stoi dowód
  // czyszczenia wyboru), a otwarte okno jest OPISANE swoim tytułem.
  const TYTUL = "atrapa-okno-tytul";
  const stan = { open: false };
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => {
      stan.open = open;
      return <div>{children}</div>;
    },
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? (
        <div role="dialog" aria-labelledby={TYTUL}>
          {children}
        </div>
      ) : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) =>
      react.createElement("h2", { id: TYTUL }, children),
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

vi.mock("@/lib/events/meetingsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/meetingsApi")>()),
  fetchAdminFreeSlots: (input: unknown) => h.freeSlots(input),
  arrangeMeeting: (input: unknown) => h.arrange(input),
}));

vi.mock("@/lib/events/meetingParticipants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/meetingParticipants")>()),
  searchMeetingParticipants: (input: unknown) => h.participants(input),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve({ data: null, error: null }) },
}));

const { ArrangeMeetingDialog } =
  await import("@/components/admin/events/organisms/ArrangeMeetingDialog");

const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const STOLIK_A = "22222222-2222-4222-8222-222222222222";
const STOLIK_B = "33333333-3333-4333-8333-333333333333";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T = "adminEventMeetings.arrange";

function osoba(over: Partial<MeetingParticipantOption> = {}): MeetingParticipantOption {
  return {
    registrationId: A,
    firstName: "Jan",
    lastName: "Nowak",
    company: "Firma Alfa",
    jobTitle: "Dyrektor",
    groupId: null,
    label: "Jan Nowak - Firma Alfa - Dyrektor",
    ...over,
  };
}

const PIERWSZY = osoba();
const DRUGI = osoba({
  registrationId: B,
  firstName: "Anna",
  lastName: "Kowalska",
  company: "Instytut Analiz",
  jobTitle: "Analityczka",
  label: "Anna Kowalska - Instytut Analiz - Analityczka",
});

/**
 * Wolny termin z `admin_event_meeting_free_slots`.
 *
 * `table_id`, `table_label` i `table_seat` DOPUSZCZAJĄ tu `null`, choć
 * wygenerowany typ `Returns` obiecuje wartości: RPC oddaje NULL dla siatki bez
 * ani jednego stolika, a sam dialog to wie (`slot.table_id ?? "none"`,
 * `row.table_label !== null`). Bez tej mapy nie dałoby się zapisać przypadku
 * giełdy bez stolików.
 */
type NadpisanieSlotu = { [K in keyof MeetingFreeSlot]?: MeetingFreeSlot[K] | null };

function slot(over: NadpisanieSlotu = {}): MeetingFreeSlot {
  return {
    starts_at: "2026-09-10T08:00:00.000Z",
    ends_at: "2026-09-10T08:20:00.000Z",
    table_id: STOLIK_A,
    table_label: "Stolik 4",
    table_seat: 1,
    table_zone: "Sala A",
    ...over,
  } as unknown as MeetingFreeSlot;
}

function dialog(open = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const zmiana = vi.fn();
  const wynik = render(
    <QueryClientProvider client={client}>
      <ArrangeMeetingDialog eventId={WYDARZENIE} open={open} onOpenChange={zmiana} />
    </QueryClientProvider>,
  );
  return { ...wynik, zmiana, client };
}

const zapisz = (): HTMLElement => screen.getByRole("button", { name: `${T}.submitAction` });

/** Wybiera osobę w pierwszym wolnym polu (obie listy pokazują ten sam wiersz). */
function wybierz(etykieta: string): void {
  const przyciski = screen.getAllByRole("button", { name: etykieta });
  const cel = przyciski[0];
  if (cel === undefined) throw new Error(`brak osoby ${etykieta} na liście`);
  fireEvent.click(cel);
}

/** Obietnica, która nigdy się nie rozstrzyga - zamraża stan zapisu. */
function nigdy(): Promise<never> {
  return new Promise<never>(() => {});
}

async function wybierzObieStrony(): Promise<void> {
  await screen.findAllByRole("button", { name: PIERWSZY.label });
  wybierz(PIERWSZY.label);
  await waitFor(() => expect(screen.getAllByRole("button", { name: DRUGI.label })).toHaveLength(1));
  wybierz(DRUGI.label);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.participants.mockResolvedValue([PIERWSZY, DRUGI]);
  h.freeSlots.mockResolvedValue([slot()]);
  h.arrange.mockResolvedValue({});
});

describe("okno zamknięte nie istnieje", () => {
  it("zamknięty dialog nie pyta bazy o uczestników ani o terminy", async () => {
    dialog(false);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.participants).not.toHaveBeenCalled();
    expect(h.freeSlots).not.toHaveBeenCalled();
  });

  it("przycisk „Anuluj” zamyka okno, nie wysyłając niczego", async () => {
    const { zmiana } = dialog();
    await screen.findAllByRole("button", { name: PIERWSZY.label });
    fireEvent.click(screen.getByRole("button", { name: `${T}.cancelAction` }));
    expect(zmiana).toHaveBeenCalledWith(false);
    expect(h.arrange).not.toHaveBeenCalled();
  });
});

describe("KOLIZJA: zaproszenie do samego siebie", () => {
  it("osoba wybrana po jednej stronie ZNIKA z listy drugiej", async () => {
    // Baza odrzuciłaby taką parę (`event_meetings_no_self`), ale odmowa po
    // kliknięciu „Umów" jest dla organizatora nieczytelna - lista ma tej opcji
    // po prostu nie oferować.
    dialog();
    await screen.findAllByRole("button", { name: PIERWSZY.label });
    expect(screen.getAllByRole("button", { name: PIERWSZY.label })).toHaveLength(2);

    wybierz(PIERWSZY.label);
    await waitFor(() =>
      expect(screen.queryAllByRole("button", { name: PIERWSZY.label })).toHaveLength(0),
    );
    expect(screen.getAllByRole("button", { name: DRUGI.label })).toHaveLength(1);
  });

  it("gdy JEDYNY uczestnik jest już wybrany, druga strona nie ma kogo zaproponować", async () => {
    h.participants.mockResolvedValue([PIERWSZY]);
    dialog();
    await screen.findAllByRole("button", { name: PIERWSZY.label });

    wybierz(PIERWSZY.label);
    await waitFor(() => expect(screen.getByText(`${T}.personsEmpty`)).toBeInTheDocument());
    expect(zapisz()).toBeDisabled();
    expect(h.freeSlots).not.toHaveBeenCalled();
  });

  it("cofnięcie wyboru przywraca osobę na obu listach", async () => {
    dialog();
    await screen.findAllByRole("button", { name: PIERWSZY.label });
    wybierz(PIERWSZY.label);
    await waitFor(() =>
      expect(screen.queryAllByRole("button", { name: PIERWSZY.label })).toHaveLength(0),
    );

    // Klucz `arrange.cancelAction` nazywa DWA przyciski: „zdejmij wybraną
    // osobę" w polu i „Anuluj" w stopce okna. Pierwszy w drzewie jest ten
    // w polu - i o niego tu chodzi.
    const zdejmij = screen.getAllByRole("button", { name: `${T}.cancelAction` })[0];
    if (zdejmij === undefined) throw new Error("brak przycisku zdejmującego wybór");
    fireEvent.click(zdejmij);
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: PIERWSZY.label })).toHaveLength(2),
    );
  });
});

describe("KOLIZJA: osoba spoza wydarzenia", () => {
  it("pusty wynik wyszukiwania mówi „nikogo takiego nie ma” i nie odblokowuje zapisu", async () => {
    // Filtr statusów zgłoszenia stoi w bazie, nie tutaj: kto nie jest zapisany
    // (albo jest z listy rezerwowej), tego na tej liście nie ma w ogóle.
    h.participants.mockResolvedValue([]);
    dialog();
    await waitFor(() => expect(screen.getAllByText(`${T}.personsEmpty`)).toHaveLength(2));
    expect(zapisz()).toBeDisabled();
    expect(h.freeSlots).not.toHaveBeenCalled();
  });

  it("wpisana fraza jedzie do BAZY, a nie filtruje listy w przeglądarce", async () => {
    dialog();
    await screen.findAllByRole("button", { name: PIERWSZY.label });
    const pola = screen.getAllByPlaceholderText(`${T}.personPlaceholder`);
    const pierwsze = pola[0];
    if (pierwsze === undefined) throw new Error("brak pola wyszukiwania osoby");

    fireEvent.change(pierwsze, { target: { value: "spoza-wydarzenia" } });
    await waitFor(() =>
      expect(h.participants).toHaveBeenCalledWith({
        eventId: WYDARZENIE,
        query: "spoza-wydarzenia",
      }),
    );
  });
});

describe("termin wybiera się z listy, którą liczy baza dla PARY", () => {
  it("przed wyborem obu stron nie ma zapytania o wolne terminy", async () => {
    dialog();
    await screen.findAllByRole("button", { name: PIERWSZY.label });
    expect(screen.getByText(`${T}.slotPlaceholder`)).toBeInTheDocument();
    expect(h.freeSlots).not.toHaveBeenCalled();

    wybierz(PIERWSZY.label);
    await waitFor(() => expect(screen.getByText(`${T}.slotPlaceholder`)).toBeInTheDocument());
    expect(h.freeSlots).not.toHaveBeenCalled();
  });

  it("po wyborze OBU stron pyta bazę o wspólne terminy tej pary", async () => {
    dialog();
    await wybierzObieStrony();
    await waitFor(() =>
      expect(h.freeSlots).toHaveBeenCalledWith({
        eventId: WYDARZENIE,
        aRegistrationId: A,
        bRegistrationId: B,
      }),
    );
  });

  it("KOLIZJA: stolik zajęty do końca - zero wolnych terminów ma własne zdanie", async () => {
    // Wszystkie miejsca w siatce są wzięte, więc dla tej pary nie ma ani jednego
    // terminu. To nie jest awaria i nie jest „wybierz coś" - to informacja,
    // że trzeba dołożyć stolik albo poszerzyć dzień.
    h.freeSlots.mockResolvedValue([]);
    dialog();
    await wybierzObieStrony();
    await waitFor(() => expect(screen.getByText(`${T}.noSlots`)).toBeInTheDocument());
    expect(zapisz()).toBeDisabled();
  });

  it("wczytywanie terminów nie udaje ich braku", async () => {
    h.freeSlots.mockReturnValue(nigdy());
    dialog();
    await wybierzObieStrony();
    await waitFor(() =>
      expect(screen.getByText("adminEventMeetings.slots.loading")).toBeInTheDocument(),
    );
    expect(screen.queryByText(`${T}.noSlots`)).not.toBeInTheDocument();
  });

  it("termin bez stolika jest opisany wprost, a nie pustym miejscem", async () => {
    h.freeSlots.mockResolvedValue([slot({ table_id: null, table_label: null, table_seat: null })]);
    dialog();
    await wybierzObieStrony();
    await waitFor(() =>
      expect(screen.getByText("adminEventMeetings.slots.tableNone")).toBeInTheDocument(),
    );
  });
});

describe("KOLIZJA: dwa spotkania przy stolikach w TYM SAMYM oknie", () => {
  it("ten sam termin przy DWÓCH MIEJSCACH tego samego stolika to dwa osobne wybory", async () => {
    // Stolik o pojemności 2 daje w tym samym oknie dwa wolne miejsca. Klucz
    // slotu zbudowany z samej godziny sklejałby je w jedno: kliknięcie
    // zaznaczałoby OBA wiersze, a do bazy jechałoby to miejsce, które akurat
    // było pierwsze na liście.
    h.freeSlots.mockResolvedValue([slot({ table_seat: 1 }), slot({ table_seat: 2 })]);
    dialog();
    await wybierzObieStrony();
    await waitFor(() =>
      expect(screen.getAllByText(new RegExp("adminEventMeetings\\.list\\.seatLabel"))).toHaveLength(
        2,
      ),
    );

    const wiersze = (): HTMLButtonElement[] =>
      screen.getAllByText(/adminEventMeetings\.list\.seatLabel/).map((node) => {
        const przycisk = node.closest("button");
        if (!(przycisk instanceof HTMLButtonElement)) throw new Error("wiersz bez przycisku");
        return przycisk;
      });

    const drugi = wiersze()[1];
    if (drugi === undefined) throw new Error("brak drugiego wiersza terminu");
    fireEvent.click(drugi);

    // Zaznaczenie idzie po `key === slot`, a klucz obejmuje stolik i miejsce -
    // po kliknięciu podświetlony jest DOKŁADNIE jeden z dwóch wierszy.
    const zaznaczone = wiersze().filter((node) => node.className.includes("font-medium"));
    expect(zaznaczone).toEqual([drugi]);
  });

  it("ten sam termin przy DWÓCH RÓŻNYCH stolikach wysyła stolik, który wybrano", async () => {
    h.freeSlots.mockResolvedValue([
      slot({ table_id: STOLIK_A, table_label: "Stolik 4" }),
      slot({ table_id: STOLIK_B, table_label: "Stolik 9" }),
    ]);
    dialog();
    await wybierzObieStrony();
    await screen.findByText(/Stolik 9/);

    const drugi = screen.getByText(/Stolik 9/).closest("button");
    if (!(drugi instanceof HTMLButtonElement)) throw new Error("brak wiersza „Stolik 9”");
    fireEvent.click(drugi);
    fireEvent.click(zapisz());

    await waitFor(() =>
      expect(h.arrange).toHaveBeenCalledWith(
        expect.objectContaining({ tableId: STOLIK_B, startsAt: "2026-09-10T08:00:00.000Z" }),
      ),
    );
  });
});

describe("ładunek jest tym, co zobaczy baza", () => {
  it("umówienie wysyła obie strony, termin i stolik z wybranego slotu", async () => {
    const { zmiana } = dialog();
    await wybierzObieStrony();
    await waitFor(() => expect(h.freeSlots).toHaveBeenCalled());

    fireEvent.click(await screen.findByText(/Stolik 4/));
    fireEvent.change(screen.getByLabelText(`${T}.topicLabel`), {
      target: { value: "Energia i sieci" },
    });
    fireEvent.change(screen.getByLabelText(`${T}.messageLabel`), {
      target: { value: "Zobowiązanie z pakietu partnerskiego" },
    });
    fireEvent.click(zapisz());

    await waitFor(() =>
      expect(h.arrange).toHaveBeenCalledWith({
        eventId: WYDARZENIE,
        requesterRegistrationId: A,
        inviteeRegistrationId: B,
        startsAt: "2026-09-10T08:00:00.000Z",
        tableId: STOLIK_A,
        topic: "Energia i sieci",
        message: "Zobowiązanie z pakietu partnerskiego",
      }),
    );
    await waitFor(() => expect(zmiana).toHaveBeenCalledWith(false));
    expect(h.success).toHaveBeenCalledWith("adminEventMeetings.toasts.meetingArranged");
  });

  it("puste pola opcjonalne jadą jako `null`, a nie jako pusty napis", async () => {
    dialog();
    await wybierzObieStrony();
    fireEvent.click(await screen.findByText(/Stolik 4/));
    fireEvent.click(zapisz());

    await waitFor(() =>
      expect(h.arrange).toHaveBeenCalledWith(
        expect.objectContaining({ topic: null, message: null }),
      ),
    );
  });

  it("bez wybranego terminu przycisk jest wyłączony, a kliknięcie nic nie wysyła", async () => {
    dialog();
    await wybierzObieStrony();
    await waitFor(() => expect(h.freeSlots).toHaveBeenCalled());
    expect(zapisz()).toBeDisabled();

    fireEvent.click(zapisz());
    expect(h.arrange).not.toHaveBeenCalled();
  });
});

describe("kolizja przy zapisie i podwójne kliknięcie", () => {
  it.each([
    ["table_busy", "adminEventMeetings.errors.table_busy"],
    ["participant_busy", "adminEventMeetings.errors.participant_busy"],
    ["duplicate_meeting", "adminEventMeetings.errors.duplicate_meeting"],
  ])("odmowa %s zostaje na ekranie ZDANIEM i nie zamyka okna", async (kod, klucz) => {
    // Miejsce przy stoliku bywa zajęte MIĘDZY policzeniem listy terminów
    // a kliknięciem „Umów" - baza weryfikuje je jeszcze raz, pod blokadą.
    h.arrange.mockRejectedValue(new Error(`${kod}: taken`));
    const { zmiana } = dialog();
    await wybierzObieStrony();
    fireEvent.click(await screen.findByText(/Stolik 4/));
    fireEvent.click(zapisz());

    await waitFor(() => expect(h.error).toHaveBeenCalledWith(klucz));
    expect(zmiana).not.toHaveBeenCalledWith(false);
    expect(h.success).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("trwające umawianie ODCINA przycisk - drugie kliknięcie nie zakłada drugiego spotkania", async () => {
    h.arrange.mockReturnValue(nigdy());
    dialog();
    await wybierzObieStrony();
    fireEvent.click(await screen.findByText(/Stolik 4/));

    fireEvent.click(zapisz());
    await waitFor(() => expect(zapisz()).toBeDisabled());
    fireEvent.click(zapisz());

    expect(h.arrange).toHaveBeenCalledTimes(1);
  });
});

describe("dostępność", () => {
  it("otwarty dialog przed wyborem stron nie ma naruszeń dostępności", async () => {
    const { container } = dialog();
    await screen.findAllByRole("button", { name: PIERWSZY.label });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("dialog z wybraną parą i listą terminów też nie ma naruszeń dostępności", async () => {
    const { container } = dialog();
    await wybierzObieStrony();
    await screen.findByText(/Stolik 4/);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
