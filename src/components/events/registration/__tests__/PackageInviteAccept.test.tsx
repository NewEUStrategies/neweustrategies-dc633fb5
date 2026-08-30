// ZAPROSZENIE NA MIEJSCE Z PAKIETU - ostatni krok łańcucha delegowania.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. ZŁY KSZTAŁT TOKENU NIE WYSYŁA ŻĄDANIA. Odnośnik urwany przez klienta
//     pocztowy ma dostać odpowiedź NATYCHMIAST, u siebie. Każde pytanie do bazy
//     o literówkę zużywa próbę limitu na tokenie, który nie ma prawa istnieć -
//     i zamienia pomyłkę w wektor odgadywania cudzych zaproszeń.
//
//  2. SAMO WEJŚCIE NICZEGO NIE ZMIENIA. Skanery bezpieczeństwa w klientach
//     pocztowych odwiedzają każdy adres z wiadomości. Gdyby otwarcie strony
//     przyjmowało zaproszenie, miejsce zostałoby zajęte przed przeczytaniem
//     maila - i to przez maszynę, nie przez człowieka.
//
//  3. TRZY ODMOWY TO TRZY RÓŻNE ZDANIA. `invalid_token` (zaproszenia nie ma),
//     `seat_taken` (ktoś już z niego skorzystał) i `invitation_expired`
//     (wygasło) prowadzą do TRZECH RÓŻNYCH decyzji delegata: sprawdź odnośnik,
//     nic nie rób, poproś o nowy. Jedno „nie udało się” na wszystkie trzy
//     zostawia człowieka bez następnego kroku - a organizatora z telefonem.
//     Asercje czytają PRAWDZIWE zdania ze słownika, bo `registrationErrorMessage`
//     liczy je poza Reactem, na prawdziwej instancji i18next.
//
//  4. KLUCZE WRACAJĄ RAZ. Udane wywołanie kasuje skrót tokenu, więc `qr_token`
//     i `manage_token` przychodzą JEDEN RAZ - ekran musi je pokazać, a nie
//     schować „na potem”, którego już nie będzie.
//
//  5. FORMULARZ PILNUJE TEGO, CO WYMAGA BAZA. Brak imienia i brak zgody na
//     przetwarzanie danych zatrzymują wysyłkę PRZED żądaniem i mówią, czego
//     brakuje.
//
//  6. PUSTE POLA NIEOBOWIĄZKOWE NIE JADĄ DO RPC. Brak klucza znaczy „nie
//     dotykaj”; jawny pusty napis skasowałby dane osoby wpisane przez
//     organizatora przy przypisywaniu miejsca.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Kształtu tokenu jako funkcji
// (`isPackageInviteToken`) - jedzie PRAWDZIWY, bo to on jest przedmiotem dowodu
// numer 1. (2) Mapowania kodów odmowy (`registrationFailure`) - ma własny plik;
// tutaj dowodzimy, że trzy różne kody DOCHODZĄ na ekran jako trzy różne zdania.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import type {
  PackageInviteAcceptInput,
  PackageInviteAcceptResult,
} from "@/lib/events/packageInviteApi";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({
  przyjmij: vi.fn<(input: PackageInviteAcceptInput) => Promise<PackageInviteAcceptResult>>(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

// Sprawdzanie kształtu tokenu jedzie PRAWDZIWE - podmieniamy wyłącznie granicę
// sieci, żeby dało się policzyć, czy żądanie w ogóle wyszło.
vi.mock("@/lib/events/packageInviteApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/packageInviteApi")>()),
  acceptPackageInvite: (input: PackageInviteAcceptInput) => h.przyjmij(input),
}));

const { PackageInviteAccept } =
  await import("@/components/events/registration/PackageInviteAccept");

/** 24 bajty w base64url - dokładnie taki kształt daje `_event_new_qr_token()`. */
const TOKEN = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";
/** Drugi kształt z bazy: dwa UUID bez myślników (`event_package_seat_invite`). */
const TOKEN_KUPUJACEGO = "0123456789abcdef0123456789abcdef" + "fedcba9876543210fedcba9876543210";

/** Zdania odmowy z PRAWDZIWEGO słownika (`eventRegistration.errors.*`). */
const INVALID_TOKEN_PL = "Zaproszenie jest nieważne lub zostało cofnięte.";
const SEAT_TAKEN_PL = "To zaproszenie zostało już wykorzystane.";
const INVITATION_EXPIRED_PL = "Zaproszenie wygasło - poproś organizatora o nowe.";

function wynik(over: Partial<PackageInviteAcceptResult> = {}): PackageInviteAcceptResult {
  return {
    registrationId: "11111111-1111-4111-8111-111111111111",
    eventId: "22222222-2222-4222-8222-222222222222",
    status: "approved",
    qrToken: "Qr9d_Xy1-Zw3zEr8TyU2iOp6AsDf5gHk",
    manageToken: "Mg7d_Xy4-Vw2zEr1TyU9iOp3AsDf8gHl",
    ...over,
  };
}

/** Wypełnia formularz kompletem danych wymaganych przez RPC. */
function wypelnij(): void {
  fireEvent.change(screen.getByLabelText("eventRegistration.fields.firstName"), {
    target: { value: "Anna" },
  });
  fireEvent.change(screen.getByLabelText("eventRegistration.fields.lastName"), {
    target: { value: "Kowalska" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
}

function przyciskWyslij(): HTMLElement {
  return screen.getByRole("button", { name: /eventRegistration\.invite\.submit/ });
}

function wyslij(): void {
  fireEvent.click(przyciskWyslij());
}

/**
 * WYSYŁKA KLAWISZEM ENTER, czyli domyślne wysłanie formularza z pola tekstowego.
 * Przycisk jest `disabled`, dopóki brakuje danych, więc kliknięcie nie ma jak
 * uruchomić walidacji - a Enter ma. To jedyna droga, którą uczestnik dojdzie do
 * zdania „czego brakuje”, i dlatego to ona jest tu przedmiotem dowodu.
 */
function wyslijEnterem(container: HTMLElement): void {
  const form = container.querySelector("form");
  if (form === null) throw new Error("test: brak formularza zaproszenia");
  fireEvent.submit(form);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.przyjmij.mockResolvedValue(wynik());
});

describe("PackageInviteAccept - kształt tokenu rozstrzygamy U SIEBIE", () => {
  it("brak tokenu w adresie kończy się zdaniem o złym odnośniku, BEZ żądania", () => {
    renderWithQueryClient(<PackageInviteAccept token={null} />);

    expect(screen.getByText("eventRegistration.invite.badTokenTitle")).toBeTruthy();
    expect(screen.getByText("eventRegistration.invite.badTokenBody")).toBeTruthy();
    expect(h.przyjmij).not.toHaveBeenCalled();
  });

  it("token za krótki NIE wysyła żądania - baza nie ma prawa go znać", () => {
    renderWithQueryClient(<PackageInviteAccept token="Ab3d_Xy9-Qw1z" />);

    expect(screen.getByText("eventRegistration.invite.badTokenTitle")).toBeTruthy();
    expect(h.przyjmij).not.toHaveBeenCalled();
  });

  it("token z obcym znakiem (spacja, ukośnik) też odpada bez żądania", () => {
    const { unmount } = renderWithQueryClient(
      <PackageInviteAccept token="Ab3d Xy9-Qw1zEr4TyU7iOp2AsDf1gH" />,
    );
    expect(screen.getByText("eventRegistration.invite.badTokenTitle")).toBeTruthy();
    unmount();

    renderWithQueryClient(<PackageInviteAccept token="Ab3d/Xy9-Qw1zEr4TyU7iOp2AsDf1gHj" />);
    expect(screen.getByText("eventRegistration.invite.badTokenTitle")).toBeTruthy();
    expect(h.przyjmij).not.toHaveBeenCalled();
  });

  it("zły odnośnik zostawia DROGĘ DALEJ - listę wydarzeń, a nie ślepy zaułek", () => {
    renderWithQueryClient(<PackageInviteAccept token="za-krotki" />);

    expect(
      screen
        .getByRole("link", { name: "eventRegistration.invite.backToEvents" })
        .getAttribute("href"),
    ).toBe("/events");
  });

  it("token o poprawnym kształcie pokazuje FORMULARZ, a nie od razu potwierdzenie", () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);

    expect(screen.getByText("eventRegistration.invite.title")).toBeTruthy();
    expect(screen.getByLabelText("eventRegistration.fields.firstName")).toBeTruthy();
    expect(screen.queryByText("eventRegistration.invite.successTitle")).toBeNull();
  });

  it("dłuższy token kupującego (dwa UUID) jest RÓWNIE dobry - baza ma dwa kształty", () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN_KUPUJACEGO} />);

    expect(screen.getByText("eventRegistration.invite.title")).toBeTruthy();
  });

  it("SAMO WEJŚCIE na stronę niczego nie przyjmuje - miejsce zostaje wolne", () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);

    expect(h.przyjmij).not.toHaveBeenCalled();
  });
});

describe("PackageInviteAccept - formularz pilnuje tego, czego wymaga baza", () => {
  it("bez kompletu danych przycisk jest ODCIĘTY - kliknięcie nie ma jak wysłać żądania", () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);

    expect(przyciskWyslij()).toHaveProperty("disabled", true);
    wyslij();
    expect(h.przyjmij).not.toHaveBeenCalled();
  });

  it("wysyłka Enterem bez imienia i nazwiska mówi CZEGO brakuje i nie idzie do bazy", async () => {
    const { container } = renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    wyslijEnterem(container);

    expect(await screen.findByText("eventRegistration.errors.invalidName")).toBeTruthy();
    expect(h.przyjmij).not.toHaveBeenCalled();
  });

  it("wysyłka Enterem bez zgody na przetwarzanie danych też się zatrzymuje", async () => {
    const { container } = renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    fireEvent.change(screen.getByLabelText("eventRegistration.fields.firstName"), {
      target: { value: "Anna" },
    });
    fireEvent.change(screen.getByLabelText("eventRegistration.fields.lastName"), {
      target: { value: "Kowalska" },
    });
    wyslijEnterem(container);

    expect(await screen.findByText("eventRegistration.validation.dataProcessing")).toBeTruthy();
    expect(screen.queryByText("eventRegistration.errors.invalidName")).toBeNull();
    expect(h.przyjmij).not.toHaveBeenCalled();
  });

  it("komplet danych ODBLOKOWUJE przycisk", () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    wypelnij();

    expect(przyciskWyslij()).toHaveProperty("disabled", false);
  });

  it("komplet danych wysyła DOKŁADNIE ten token i zgodę, którą zaznaczył człowiek", async () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    wypelnij();
    wyslij();

    await waitFor(() => expect(h.przyjmij).toHaveBeenCalledTimes(1));
    expect(h.przyjmij).toHaveBeenCalledWith({
      token: TOKEN,
      firstName: "Anna",
      lastName: "Kowalska",
      jobTitle: undefined,
      companyText: undefined,
      consentDataProcessing: true,
    });
  });

  it("puste pola nieobowiązkowe jadą jako BRAK, a nie jako „wyczyść”", async () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    wypelnij();
    // Same białe znaki to nadal brak - inaczej spacja skasowałaby stanowisko
    // wpisane przez organizatora przy przypisywaniu miejsca.
    fireEvent.change(screen.getByLabelText("eventRegistration.fields.jobTitle"), {
      target: { value: "   " },
    });
    wyslij();

    await waitFor(() => expect(h.przyjmij).toHaveBeenCalledTimes(1));
    const wejscie = h.przyjmij.mock.calls[0]?.[0];
    expect(wejscie?.jobTitle).toBeUndefined();
    expect(wejscie?.companyText).toBeUndefined();
  });

  it("wypełnione pola nieobowiązkowe jadą PRZYCIĘTE", async () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    wypelnij();
    fireEvent.change(screen.getByLabelText("eventRegistration.fields.jobTitle"), {
      target: { value: "  Dyrektorka ds. energii  " },
    });
    fireEvent.change(screen.getByLabelText("eventRegistration.fields.company"), {
      target: { value: " Instytut Bałtycki " },
    });
    wyslij();

    await waitFor(() => expect(h.przyjmij).toHaveBeenCalledTimes(1));
    const wejscie = h.przyjmij.mock.calls[0]?.[0];
    expect(wejscie?.jobTitle).toBe("Dyrektorka ds. energii");
    expect(wejscie?.companyText).toBe("Instytut Bałtycki");
  });
});

describe("PackageInviteAccept - trzy odmowy, trzy różne zdania", () => {
  /** Wysyła komplet danych i czeka na zdanie odmowy z prawdziwego słownika. */
  async function odmowa(kod: string): Promise<string> {
    // Licznik zerujemy TU, a nie w `beforeEach`: jeden przypadek porównuje trzy
    // odmowy z rzędu i bez tego druga wysyłka nigdy nie doczekałaby się „jedno
    // wywołanie”.
    h.przyjmij.mockReset();
    h.przyjmij.mockRejectedValue(new Error(`${kod}: refused by database`));
    const widok = renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    wypelnij();
    wyslij();
    await waitFor(() => expect(h.przyjmij).toHaveBeenCalledTimes(1));
    const alert = await waitFor(() => {
      const node = widok.container.querySelector(".text-destructive");
      if (node === null) throw new Error("test: brak zdania odmowy na ekranie");
      return node;
    });
    const tresc = alert.textContent ?? "";
    widok.unmount();
    return tresc;
  }

  it("`invalid_token`: zaproszenia nie ma - sprawdź odnośnik", async () => {
    expect(await odmowa("invalid_token")).toContain(INVALID_TOKEN_PL);
  });

  it("`seat_taken`: ktoś już z niego skorzystał - nie ma co robić", async () => {
    expect(await odmowa("seat_taken")).toContain(SEAT_TAKEN_PL);
  });

  it("`invitation_expired`: wygasło - poproś organizatora o nowe", async () => {
    expect(await odmowa("invitation_expired")).toContain(INVITATION_EXPIRED_PL);
  });

  it("te trzy zdania są NAPRAWDĘ różne - żadne dwa się nie pokrywają", async () => {
    const zdania = [
      await odmowa("invalid_token"),
      await odmowa("seat_taken"),
      await odmowa("invitation_expired"),
    ];

    expect(new Set(zdania).size).toBe(3);
  });

  it("odmowa ZOSTAWIA formularz - delegat nie przepisuje danych od nowa", async () => {
    h.przyjmij.mockRejectedValue(new Error("invitation_expired: token past its window"));
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    wypelnij();
    wyslij();

    await waitFor(() => expect(screen.getByText(INVITATION_EXPIRED_PL)).toBeTruthy());
    const imie = screen.getByLabelText("eventRegistration.fields.firstName");
    expect(imie).toHaveProperty("value", "Anna");
    expect(screen.queryByText("eventRegistration.invite.successTitle")).toBeNull();
  });

  it("nieznany kod nie udaje znanego - wraca zdanie zapasowe, a nie treść z bazy", async () => {
    const tresc = await odmowa("violates_check_constraint_event_seats");

    expect(tresc).not.toContain("violates");
    expect(tresc).not.toContain(INVALID_TOKEN_PL);
  });
});

describe("PackageInviteAccept - potwierdzenie", () => {
  it("pokazuje KOD WEJŚCIA i KLUCZ SAMOOBSŁUGI - obydwa wracają tylko raz", async () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    wypelnij();
    wyslij();

    expect(await screen.findByText("eventRegistration.invite.successTitle")).toBeTruthy();
    expect(screen.getByText("Qr9d_Xy1-Zw3zEr8TyU2iOp6AsDf5gHk")).toBeTruthy();
    expect(screen.getByText("Mg7d_Xy4-Vw2zEr1TyU9iOp3AsDf8gHl")).toBeTruthy();
    expect(screen.getByText("eventRegistration.invite.qrHint")).toBeTruthy();
  });

  it("po potwierdzeniu formularza już NIE MA - drugie kliknięcie nie ma czego zająć", async () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    wypelnij();
    wyslij();

    await screen.findByText("eventRegistration.invite.successTitle");
    expect(screen.queryByLabelText("eventRegistration.fields.firstName")).toBeNull();
    expect(screen.queryByRole("button", { name: /eventRegistration\.invite\.submit/ })).toBeNull();
  });

  it("zgłoszenie bez kodu wejścia nie rysuje pustej ramki na kod", async () => {
    h.przyjmij.mockResolvedValue(wynik({ qrToken: null, manageToken: null }));
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    wypelnij();
    wyslij();

    expect(await screen.findByText("eventRegistration.invite.successTitle")).toBeTruthy();
    expect(screen.queryByText("eventRegistration.invite.qrTitle")).toBeNull();
    expect(screen.queryByText("eventRegistration.result.manageTokenTitle")).toBeNull();
  });
});

describe("PackageInviteAccept - dostępność", () => {
  it("formularz zaproszenia nie ma naruszeń axe", async () => {
    const { container } = renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("ekran złego odnośnika nie ma naruszeń axe", async () => {
    const { container } = renderWithQueryClient(<PackageInviteAccept token="za-krotki" />);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("potwierdzenie z kodami nie ma naruszeń axe", async () => {
    const { container } = renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    wypelnij();
    wyslij();

    await screen.findByText("eventRegistration.invite.successTitle");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
