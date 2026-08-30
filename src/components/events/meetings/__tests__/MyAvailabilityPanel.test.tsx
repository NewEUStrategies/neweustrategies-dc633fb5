// „MOJE OKNA DOSTĘPNOŚCI" - lista przedziałów, w których uczestnik przyjmuje
// zaproszenia, i jedyny ekran, z którego da się je założyć, zmienić i skasować.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. OKNO ZAMKNIĘTE TO OSOBNY STAN, A NIE BRAK OKNA. „Jestem na miejscu
//     14:00-16:00, ale prowadzę wtedy panel" i „nie ma mnie" mają ten sam
//     skutek dla zaproszeń i ZUPEŁNIE inny dla grafiku - baza trzyma to
//     w `is_open`, a lista musi to pokazać, bo bez odznaki dwa wiersze
//     wyglądają identycznie.
//
//  2. KOLIZJA NAKŁADAJĄCYCH SIĘ OKIEN JEST ODMOWĄ BAZY, NIE BŁĘDEM
//     FORMULARZA. `event_meeting_availability_no_overlap` jest ograniczeniem
//     BEZWARUNKOWYM - okno zamknięte koliduje z otwartym tak samo jak dwa
//     otwarte (harness `60_meetings.sql`, sekcja 2). Klient nie ma szans tego
//     przewidzieć, więc jedyne, co może zrobić dobrze, to donieść odmowę
//     `availability_overlap` JAKO TĘ ODMOWĘ i NIE zamknąć okna z wpisanymi
//     godzinami.
//
//  3. OKNO POZA GODZINAMI WYDARZENIA PRZECHODZI PRZEZ ZAPIS I ODBIJA SIĘ
//     PÓŹNIEJ. Baza przyjmuje dowolny przedział; koszt widać dopiero przy
//     zaproszeniu (`slot_not_in_grid`, `requester_unavailable`). Panel ma
//     donieść oba te klucze osobno, bo prowadzą do dwóch różnych poprawek:
//     „zmień godzinę na siatkę" i „dodaj okno na ten termin".
//
//  4. USUNIĘCIE OKNA PYTA, ZAPIS NIE. Skasowane okno znika razem z informacją,
//     kiedy uczestnik był dostępny; a `availability_has_meetings` mówi, że
//     w środku SIEDZI umówione spotkanie - odmowa, której nie wolno zamienić
//     w ciche „nie udało się".
//
//  5. EKRAN DZIAŁA TAKŻE PRZY ZAMKNIĘTYCH ZAPISACH. `canEdit === false`
//     wycisza przyciski, ale NIE listę: uczestnik ma prawo zobaczyć swój
//     terminarz również wtedy, gdy nie może go już zmieniać.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Formularza okna - ma własny plik
// `AvailabilityWindowDialog.test.tsx`; tutaj jest atrapą, bo przedmiotem
// dowodu jest to, Z CZYM panel go otwiera i co robi z jego wynikiem.
// (2) Mapowania odmów bazy (`meetingsErrors.test.ts`) - hook `meetingErrorI18nKey`
// jest tu PRAWDZIWY, żeby asercja czytała klucz, który naprawdę wyjdzie
// z modułu. (3) Konwersji szkicu (`meetingWindowDraft.test.ts`).
//
// Hooki `useSaveMyAvailability`/`useDeleteMyAvailability` są PRAWDZIWE - atrapą
// jest wyłącznie warstwa sieciowa, więc test przechodzi przez ten sam
// `useMutation`, co produkcja (stan `isPending`, kolejność `onSuccess`/`onError`).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import { axeViolations, summarize } from "@/test/axe";
import {
  isoToLocalInput,
  type WindowDraft,
  type WindowPayload,
} from "@/lib/events/meetingWindowDraft";
import type { MyAvailabilityWindow } from "@/lib/events/meetingExchange";

const h = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  confirm: vi.fn(),
  /** Ostatnie propsy, z jakimi panel zamontował formularz okna. */
  dialog: { open: false, draft: null as WindowDraft | null, isSaving: false },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));

/**
 * Formularz okna ma własny plik testowy. Atrapa wystawia to, co panel do niego
 * wysyła (`open`, `draft`, `isSaving`), i jeden przycisk odsyłający gotowy
 * ładunek - dzięki temu asercje idą po KONTRAKCIE między nimi, a nie po
 * wyglądzie cudzego formularza.
 */
const LADUNEK: WindowPayload = {
  id: null,
  startsAt: "2026-09-14T07:30:00.000Z",
  endsAt: "2026-09-14T11:00:00.000Z",
  isOpen: true,
  note: "Stoisko B12",
};

vi.mock("@/components/events/meetings/AvailabilityWindowDialog", () => ({
  AvailabilityWindowDialog: ({
    open,
    draft,
    isSaving,
    onSubmit,
    onOpenChange,
  }: {
    open: boolean;
    draft: WindowDraft | null;
    isSaving: boolean;
    onSubmit: (payload: WindowPayload) => void;
    onOpenChange: (next: boolean) => void;
  }) => {
    h.dialog.open = open;
    h.dialog.draft = draft;
    h.dialog.isSaving = isSaving;
    return open ? (
      <div role="dialog" aria-label="atrapa-formularz-okna">
        <button type="button" onClick={() => onSubmit({ ...LADUNEK, id: draft?.id ?? null })}>
          atrapa-zapisz-okno
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          atrapa-zamknij-okno
        </button>
      </div>
    ) : null;
  },
}));

// Warstwa sieciowa jest JEDYNĄ atrapą logiki.
vi.mock("@/lib/events/meetingsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/meetingsApi")>()),
  saveMyAvailability: (input: unknown) => h.save(input),
  deleteMyAvailability: (id: string) => h.remove(id),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve({ data: null, error: null }) },
}));

const { MyAvailabilityPanel } = await import("@/components/events/meetings/MyAvailabilityPanel");

const SLUG = "kongres-2026";
const TZ = "Europe/Warsaw";
const BAZA = "eventMeetings.participant.availability";

function okno(over: Partial<MyAvailabilityWindow> = {}): MyAvailabilityWindow {
  return {
    id: "w-1",
    startsAt: "2026-09-14T07:30:00.000Z",
    endsAt: "2026-09-14T11:00:00.000Z",
    isOpen: true,
    note: null,
    ...over,
  };
}

function renderPanel(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
    queryClient,
  };
}

function panel(over: Partial<Parameters<typeof MyAvailabilityPanel>[0]> = {}) {
  return renderPanel(
    <MyAvailabilityPanel slug={SLUG} windows={[okno()]} timezone={TZ} canEdit {...over} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.save.mockResolvedValue("w-1");
  h.remove.mockResolvedValue(true);
  h.dialog.open = false;
  h.dialog.draft = null;
  h.dialog.isSaving = false;
  vi.stubGlobal("confirm", h.confirm);
  h.confirm.mockReturnValue(true);
});

describe("MyAvailabilityPanel - trzy stany listy", () => {
  it("„PUSTO” ma własne zdanie i nie udaje awarii", () => {
    // Uczestnik bez okna nie ma błędu do naprawienia - ma zadanie do zrobienia.
    panel({ windows: [] });
    expect(screen.getByText("eventMeetings.empty.availability")).toBeTruthy();
    expect(screen.queryByText(/eventMeetings\.errors\./)).toBeNull();
  });

  it("okno OTWARTE i okno ZAMKNIĘTE mają dwie różne odznaki", () => {
    // Bez odznaki oba wiersze wyglądają identycznie, a różnią się skutkiem:
    // na jeden przychodzą zaproszenia, na drugi nie.
    panel({
      windows: [okno({ id: "w-1", isOpen: true }), okno({ id: "w-2", isOpen: false })],
    });
    expect(screen.getByText(`${BAZA}.open`)).toBeTruthy();
    expect(screen.getByText(`${BAZA}.closed`)).toBeTruthy();
  });

  it("godziny są wypisane w strefie WYDARZENIA, nie w strefie przeglądarki", () => {
    // 07:30-11:00 UTC to 09:30-13:00 w Warszawie. Uczestnik czyta grafik
    // kongresu, a nie zegarek własnego laptopa.
    panel({ windows: [okno()] });
    const wiersz = screen.getByText(/09:30/);
    expect(wiersz.textContent).toContain("13:00");
  });

  it("notatka jest pokazana, gdy jest, i nie zostawia pustej linii, gdy jej nie ma", () => {
    const zNotatka = panel({ windows: [okno({ note: "Stoisko B12" })] });
    expect(screen.getByText("Stoisko B12")).toBeTruthy();
    zNotatka.unmount();

    panel({ windows: [okno({ note: null })] });
    expect(screen.queryByText("Stoisko B12")).toBeNull();
  });
});

describe("MyAvailabilityPanel - zamknięte zapisy wyciszają przyciski, nie ekran", () => {
  it("BEZ prawa edycji lista jest widoczna, a przycisków nie ma", () => {
    panel({ canEdit: false, windows: [okno({ note: "Stoisko B12" })] });
    expect(screen.getByText("Stoisko B12")).toBeTruthy();
    expect(screen.getByText(`${BAZA}.open`)).toBeTruthy();
    expect(screen.queryByText("eventMeetings.actions.addAvailability")).toBeNull();
    expect(screen.queryByLabelText(`${BAZA}.dialogEdit`)).toBeNull();
    expect(screen.queryByLabelText("eventMeetings.actions.removeAvailability")).toBeNull();
  });

  it("BEZ prawa edycji i BEZ okien ekran nadal mówi, co się dzieje", () => {
    panel({ canEdit: false, windows: [] });
    expect(screen.getByText("eventMeetings.empty.availability")).toBeTruthy();
    expect(screen.getByText(`${BAZA}.title`)).toBeTruthy();
  });
});

describe("MyAvailabilityPanel - z czym otwiera się formularz", () => {
  it("„Dodaj” otwiera PUSTY formularz, a nie ostatnio edytowany wiersz", () => {
    panel();
    fireEvent.click(screen.getByText("eventMeetings.actions.addAvailability"));
    expect(h.dialog.open).toBe(true);
    expect(h.dialog.draft).toBeNull();
  });

  it("ołówek otwiera formularz TEGO wiersza, w czasie lokalnym przeglądarki", () => {
    panel({ windows: [okno({ id: "w-7", note: "Stoisko B12", isOpen: false })] });
    fireEvent.click(screen.getByLabelText(`${BAZA}.dialogEdit`));

    expect(h.dialog.open).toBe(true);
    expect(h.dialog.draft).toEqual({
      id: "w-7",
      startsAtLocal: isoToLocalInput("2026-09-14T07:30:00.000Z"),
      endsAtLocal: isoToLocalInput("2026-09-14T11:00:00.000Z"),
      isOpen: false,
      note: "Stoisko B12",
    });
  });

  it("po edycji jednego wiersza „Dodaj” znów daje PUSTY formularz", () => {
    panel({ windows: [okno({ id: "w-7" })] });
    fireEvent.click(screen.getByLabelText(`${BAZA}.dialogEdit`));
    expect(h.dialog.draft?.id).toBe("w-7");

    fireEvent.click(screen.getByText("eventMeetings.actions.addAvailability"));
    expect(h.dialog.draft).toBeNull();
  });

  it("zamknięcie formularza z jego wnętrza dochodzi do panelu", () => {
    panel();
    fireEvent.click(screen.getByText("eventMeetings.actions.addAvailability"));
    fireEvent.click(screen.getByText("atrapa-zamknij-okno"));
    expect(h.dialog.open).toBe(false);
  });
});

describe("MyAvailabilityPanel - zapis okna", () => {
  it("udany zapis dokleja `eventSlug`, zamyka formularz i mówi o tym", async () => {
    // Bez `eventSlug` RPC nie wie, na którym wydarzeniu zakładać okno -
    // uczestnik wchodzi z adresu, więc slug jest jedynym identyfikatorem,
    // jaki ta powierzchnia zna.
    panel();
    fireEvent.click(screen.getByText("eventMeetings.actions.addAvailability"));
    fireEvent.click(screen.getByText("atrapa-zapisz-okno"));

    await waitFor(() => expect(h.success).toHaveBeenCalled());
    expect(h.save).toHaveBeenCalledWith({ ...LADUNEK, eventSlug: SLUG });
    expect(h.success).toHaveBeenCalledWith("eventMeetings.toasts.availabilitySaved");
    expect(h.dialog.open).toBe(false);
  });

  it("zapis edytowanego okna niesie JEGO identyfikator", async () => {
    panel({ windows: [okno({ id: "w-7" })] });
    fireEvent.click(screen.getByLabelText(`${BAZA}.dialogEdit`));
    fireEvent.click(screen.getByText("atrapa-zapisz-okno"));

    await waitFor(() => expect(h.save).toHaveBeenCalled());
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ id: "w-7", eventSlug: SLUG }));
  });

  it("KOLIZJA: NAKŁADAJĄCE SIĘ okna kończą się swoją odmową i NIE zamykają formularza", async () => {
    // `event_meeting_availability_no_overlap` jest bezwarunkowe - drugie okno
    // tej samej osoby w tym samym czasie odbija się nawet wtedy, gdy jest
    // ZAMKNIĘTE. Zamknięty formularz po odmowie = wpisane godziny przepadają,
    // a uczestnik nie wie, czy okno powstało.
    h.save.mockRejectedValue(
      new Error("availability_overlap: this window overlaps another window you already declared"),
    );
    panel();
    fireEvent.click(screen.getByText("eventMeetings.actions.addAvailability"));
    fireEvent.click(screen.getByText("atrapa-zapisz-okno"));

    await waitFor(() => expect(h.error).toHaveBeenCalled());
    expect(h.error).toHaveBeenCalledWith("eventMeetings.errors.availability_overlap");
    expect(h.dialog.open).toBe(true);
    expect(h.success).not.toHaveBeenCalled();
    // Angielskie zdanie o ograniczeniu bazy nie ma prawa trafić na ekran.
    expect(screen.queryByText(/overlaps another window/)).toBeNull();
  });

  it.each([
    // Okno poza godzinami wydarzenia baza przyjmie; koszt wraca DOPIERO przy
    // umawianiu i ma dwie różne postacie - a każda prowadzi do innej poprawki.
    ["termin poza SIATKĄ slotów", "slot_not_in_grid: the slot does not belong to the meeting grid"],
    [
      "brak OTWARTEGO okna na ten slot",
      "requester_unavailable: the requester has no open availability window for this slot",
    ],
    [
      "okno krótsze/dłuższe niż CHECK bazy",
      "invalid_window: the window must last between 15 minutes and 16 hours",
    ],
  ])(
    "KOLIZJA „okno poza godzinami wydarzenia”: %s dojeżdża jako SWÓJ klucz",
    async (_opis, komunikat) => {
      h.save.mockRejectedValue(new Error(komunikat));
      panel();
      fireEvent.click(screen.getByText("eventMeetings.actions.addAvailability"));
      fireEvent.click(screen.getByText("atrapa-zapisz-okno"));

      await waitFor(() => expect(h.error).toHaveBeenCalled());
      expect(h.error).toHaveBeenCalledWith(`eventMeetings.errors.${komunikat.split(":")[0]}`);
      expect(h.dialog.open).toBe(true);
    },
  );

  it("odmowa, której słownik NIE ZNA, degraduje do zdania ogólnego, nie do surowego tekstu", async () => {
    h.save.mockRejectedValue(new Error("Failed to fetch"));
    panel();
    fireEvent.click(screen.getByText("eventMeetings.actions.addAvailability"));
    fireEvent.click(screen.getByText("atrapa-zapisz-okno"));

    await waitFor(() => expect(h.error).toHaveBeenCalled());
    expect(h.error).toHaveBeenCalledWith("eventMeetings.errors.unknown");
  });

  it("TRWAJĄCY zapis dojeżdża do formularza - to on odcina drugie kliknięcie", async () => {
    let zwolnij: (id: string) => void = () => undefined;
    h.save.mockReturnValue(
      new Promise<string>((resolve) => {
        zwolnij = resolve;
      }),
    );
    panel();
    fireEvent.click(screen.getByText("eventMeetings.actions.addAvailability"));
    fireEvent.click(screen.getByText("atrapa-zapisz-okno"));

    await waitFor(() => expect(h.dialog.isSaving).toBe(true));
    zwolnij("w-1");
    await waitFor(() => expect(h.dialog.isSaving).toBe(false));
  });
});

describe("MyAvailabilityPanel - usunięcie okna", () => {
  it("kosz NIE kasuje od razu - najpierw pyta", () => {
    h.confirm.mockReturnValue(false);
    panel({ windows: [okno({ id: "w-7" })] });
    fireEvent.click(screen.getByLabelText("eventMeetings.actions.removeAvailability"));

    expect(h.confirm).toHaveBeenCalledWith(`${BAZA}.removeConfirm`);
    expect(h.remove).not.toHaveBeenCalled();
  });

  it("potwierdzenie kasuje TEN wiersz i mówi o tym", async () => {
    panel({ windows: [okno({ id: "w-1" }), okno({ id: "w-2" })] });
    const kosze = screen.getAllByLabelText("eventMeetings.actions.removeAvailability");
    fireEvent.click(kosze[1] as HTMLElement);

    await waitFor(() => expect(h.success).toHaveBeenCalled());
    expect(h.remove).toHaveBeenCalledWith("w-2");
    expect(h.success).toHaveBeenCalledWith("eventMeetings.toasts.availabilityRemoved");
  });

  it("KOLIZJA: okno, w którym SIEDZI spotkanie, nie znika po cichu", async () => {
    // `availability_has_meetings` mówi, ile spotkań blokuje okno. Ciche „nie
    // udało się" kazałoby uczestnikowi klikać kosz drugi raz.
    h.remove.mockRejectedValue(
      new Error("availability_has_meetings: 2 meeting(s) sit inside this window"),
    );
    panel({ windows: [okno({ id: "w-7" })] });
    fireEvent.click(screen.getByLabelText("eventMeetings.actions.removeAvailability"));

    await waitFor(() => expect(h.error).toHaveBeenCalled());
    expect(h.error).toHaveBeenCalledWith("eventMeetings.errors.availability_has_meetings");
    expect(h.success).not.toHaveBeenCalled();
  });

  it("TRWAJĄCE usunięcie odcina WSZYSTKIE kosze - drugie kliknięcie nie wysyła drugiego RPC", async () => {
    let zwolnij: (ok: boolean) => void = () => undefined;
    h.remove.mockReturnValue(
      new Promise<boolean>((resolve) => {
        zwolnij = resolve;
      }),
    );
    panel({ windows: [okno({ id: "w-1" }), okno({ id: "w-2" })] });
    const kosze = () => screen.getAllByLabelText("eventMeetings.actions.removeAvailability");
    fireEvent.click(kosze()[0] as HTMLElement);

    await waitFor(() => expect((kosze()[0] as HTMLButtonElement).disabled).toBe(true));
    // Także kosz SĄSIEDNIEGO wiersza - `remove.isPending` jest wspólny dla listy.
    expect((kosze()[1] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(kosze()[0] as HTMLElement);
    expect(h.remove).toHaveBeenCalledTimes(1);

    zwolnij(true);
    await waitFor(() => expect(h.success).toHaveBeenCalled());
  });
});

describe("MyAvailabilityPanel - dostępność", () => {
  it("lista okien nie ma naruszeń axe", async () => {
    const { container } = panel({
      windows: [okno({ id: "w-1", note: "Stoisko B12" }), okno({ id: "w-2", isOpen: false })],
    });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("stan pusty i widok bez prawa edycji też nie mają naruszeń axe", async () => {
    const pusty = panel({ windows: [] });
    const bezOkien = await axeViolations(pusty.container);
    expect(bezOkien, summarize(bezOkien)).toEqual([]);
    pusty.unmount();

    const tylkoDoOdczytu = panel({ canEdit: false });
    const bezEdycji = await axeViolations(tylkoDoOdczytu.container);
    expect(bezEdycji, summarize(bezEdycji)).toEqual([]);
  });

  it("przyciski-ikony mają nazwy - inaczej czytnik ogłasza dwa bezimienne przyciski", () => {
    const { container } = panel({ windows: [okno()] });
    const przyciski = within(container).getAllByRole("button");
    for (const przycisk of przyciski) {
      const nazwa = przycisk.getAttribute("aria-label") ?? przycisk.textContent ?? "";
      expect(nazwa.trim().length).toBeGreaterThan(0);
    }
  });
});
