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
//     maila - i to przez maszynę, nie przez człowieka. Otwarcie robi wyłącznie
//     PODGLĄD (REG-15).
//
//  3. STAN ZAPROSZENIA PRZED FORMULARZEM. Wykorzystane, wygasłe, odwołane
//     wydarzenie, zakończone wydarzenie i zwrócone zamówienie to zdanie zamiast
//     formularza - delegat nie wypełnia danych, których baza i tak nie przyjmie.
//
//  4. FORMULARZ WYDARZENIA. Pola obowiązkowe i regulaminy przychodzą
//     z `event_registration_form(slug)` - przycisk jest odcięty, dopóki ich nie
//     ma, a do bazy jadą odpowiedzi i zaakceptowane regulaminy.
//
//  5. KONTO I ZGŁOSZENIE. Notka mówi zawczasu, czy zgłoszenie trafi do konta
//     (potwierdzony adres zaproszenia), a zgoda marketingowa pojawia się
//     WYŁĄCZNIE wtedy, gdy baza może ją zapisać.
//
//  6. ODMOWY TO RÓŻNE ZDANIA. `invalid_token`, `seat_taken`,
//     `invitation_expired` prowadzą do różnych decyzji delegata; `event_ended`
//     mówi językiem zaproszenia. Asercje czytają PRAWDZIWE zdania ze słownika,
//     bo mapa odmów liczy je poza Reactem, na prawdziwej instancji i18next.
//
//  7. KLUCZE WRACAJĄ RAZ. `qr_token` i `manage_token` przychodzą JEDEN RAZ -
//     ekran musi je pokazać, a nie schować „na potem”, którego już nie będzie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import type {
  PackageInviteAcceptInput,
  PackageInviteAcceptResult,
  PackageInvitePreview,
} from "@/lib/events/packageInviteApi";
import {
  EMPTY_REGISTRATION_FORM,
  type RegistrationForm,
} from "@/lib/events/registrationFormSurface";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";

const h = vi.hoisted(() => ({
  przyjmij: vi.fn<(input: PackageInviteAcceptInput) => Promise<PackageInviteAcceptResult>>(),
  podglad: vi.fn<(token: string) => Promise<PackageInvitePreview | null>>(),
  formularz: vi.fn<(slug: string) => Promise<RegistrationForm>>(),
  sesja: { current: null as { user: { id: string } } | null },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.sesja.current }) }));

// Sprawdzanie kształtu tokenu jedzie PRAWDZIWE - podmieniamy wyłącznie granicę
// sieci, żeby dało się policzyć, czy żądanie w ogóle wyszło.
vi.mock("@/lib/events/packageInviteApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/packageInviteApi")>()),
  acceptPackageInvite: (input: PackageInviteAcceptInput) => h.przyjmij(input),
  fetchPackageInvitePreview: (token: string) => h.podglad(token),
}));

vi.mock("@/lib/events/publicRegistrationApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/publicRegistrationApi")>()),
  fetchRegistrationForm: (slug: string) => h.formularz(slug),
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
const EVENT_ENDED_INVITE_PL = "Wydarzenie już się odbyło - zaproszenia nie można przyjąć.";

const TERM_ID = "33333333-3333-4333-8333-333333333333";

function podglad(over: Partial<PackageInvitePreview> = {}): PackageInvitePreview {
  return {
    state: "open",
    eventId: "22222222-2222-4222-8222-222222222222",
    eventSlug: "kongres-2026",
    eventTitlePl: "Kongres 2026",
    eventTitleEn: "Congress 2026",
    eventStartsAt: "2026-11-20T09:00:00Z",
    inviteName: "Anna",
    inviteEmailHint: "a***@example.com",
    accountMatches: false,
    expiresAt: null,
    ...over,
  };
}

/** Formularz wydarzenia z obowiązkowym polem i regulaminem. */
function formularzZPolami(): RegistrationForm {
  return {
    ...EMPTY_REGISTRATION_FORM,
    isOpen: true,
    closedReason: null,
    fields: [
      {
        id: "f-1",
        key: "sektor",
        fieldType: "text",
        labelPl: "Sektor",
        labelEn: "Sector",
        helpPl: "",
        helpEn: "",
        isRequired: true,
        options: [],
      },
    ],
    terms: [
      {
        id: TERM_ID,
        key: "regulamin",
        labelPl: "Regulamin kongresu",
        labelEn: "Congress terms",
        bodyPl: "Treść regulaminu.",
        bodyEn: "Terms body.",
        externalUrl: null,
        isRequired: true,
        version: 2,
      },
    ],
  };
}

function wynik(over: Partial<PackageInviteAcceptResult> = {}): PackageInviteAcceptResult {
  return {
    registrationId: "11111111-1111-4111-8111-111111111111",
    eventId: "22222222-2222-4222-8222-222222222222",
    eventSlug: "kongres-2026",
    status: "approved",
    awaitingPayment: false,
    qrToken: "Qr9d_Xy1-Zw3zEr8TyU2iOp6AsDf5gHk",
    manageToken: "Mg7d_Xy4-Vw2zEr1TyU9iOp3AsDf8gHl",
    accountLinked: false,
    ...over,
  };
}

/**
 * Etykieta pola OBOWIĄZKOWEGO: `FieldBox` dopisuje do niej „ *”. Dopasowanie
 * dokładne z opcjonalną gwiazdką - zapytanie o brak pola (`queryBy...`) nie
 * może przejść tylko dlatego, że etykieta ma inny ogon.
 */
function wymagane(klucz: string): RegExp {
  return new RegExp(`^${klucz.replace(/\./g, "\\.")}( \\*)?$`);
}

/** Czeka, aż podgląd i formularz wydarzenia dojadą i formularz stanie. */
async function formularzGotowy(): Promise<void> {
  await screen.findByLabelText(wymagane("eventRegistration.fields.firstName"));
  await waitFor(() => expect(h.formularz).toHaveBeenCalled());
}

/** Wypełnia dane wymagane przez RPC (bez pól wydarzenia). */
function wypelnij(): void {
  fireEvent.change(screen.getByLabelText(wymagane("eventRegistration.fields.firstName")), {
    target: { value: "Anna" },
  });
  fireEvent.change(screen.getByLabelText(wymagane("eventRegistration.fields.lastName")), {
    target: { value: "Kowalska" },
  });
  fireEvent.click(
    screen.getByRole("checkbox", { name: "eventRegistration.consents.dataProcessing" }),
  );
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
  h.sesja.current = null;
  h.przyjmij.mockResolvedValue(wynik());
  h.podglad.mockResolvedValue(podglad());
  h.formularz.mockResolvedValue(EMPTY_REGISTRATION_FORM);
});

describe("PackageInviteAccept - kształt tokenu rozstrzygamy U SIEBIE", () => {
  it("brak tokenu w adresie kończy się zdaniem o złym odnośniku, BEZ żądania", () => {
    renderWithQueryClient(<PackageInviteAccept token={null} />);

    expect(screen.getByText("eventRegistration.invite.badTokenTitle")).toBeTruthy();
    expect(screen.getByText("eventRegistration.invite.badTokenBody")).toBeTruthy();
    expect(h.przyjmij).not.toHaveBeenCalled();
    expect(h.podglad).not.toHaveBeenCalled();
  });

  it("token za krótki NIE wysyła żądania - baza nie ma prawa go znać", () => {
    renderWithQueryClient(<PackageInviteAccept token="Ab3d_Xy9-Qw1z" />);

    expect(screen.getByText("eventRegistration.invite.badTokenTitle")).toBeTruthy();
    expect(h.przyjmij).not.toHaveBeenCalled();
    expect(h.podglad).not.toHaveBeenCalled();
  });

  it("token z obcym znakiem (spacja, ukośnik) też odpada bez żądania", () => {
    const { unmount } = renderWithQueryClient(
      <PackageInviteAccept token="Ab3d Xy9-Qw1zEr4TyU7iOp2AsDf1gH" />,
    );
    expect(screen.getByText("eventRegistration.invite.badTokenTitle")).toBeTruthy();
    unmount();

    renderWithQueryClient(<PackageInviteAccept token="Ab3d/Xy9-Qw1zEr4TyU7iOp2AsDf1gHj" />);
    expect(screen.getByText("eventRegistration.invite.badTokenTitle")).toBeTruthy();
    expect(h.podglad).not.toHaveBeenCalled();
  });

  it("zły odnośnik zostawia DROGĘ DALEJ - listę wydarzeń, a nie ślepy zaułek", () => {
    renderWithQueryClient(<PackageInviteAccept token="za-krotki" />);

    expect(
      screen
        .getByRole("link", { name: "eventRegistration.invite.backToEvents" })
        .getAttribute("href"),
    ).toBe("/events");
  });

  it("token o poprawnym kształcie: PODGLĄD z tym tokenem, potem FORMULARZ, a nie potwierdzenie", async () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);

    expect(await screen.findByText("eventRegistration.invite.title")).toBeTruthy();
    expect(h.podglad).toHaveBeenCalledWith(TOKEN);
    await formularzGotowy();
    expect(h.formularz).toHaveBeenCalledWith("kongres-2026");
    expect(screen.queryByText("eventRegistration.invite.successTitle")).toBeNull();
  });

  it("dłuższy token kupującego (dwa UUID) jest RÓWNIE dobry - baza ma dwa kształty", async () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN_KUPUJACEGO} />);

    expect(await screen.findByText("eventRegistration.invite.title")).toBeTruthy();
  });

  it("SAMO WEJŚCIE na stronę niczego nie przyjmuje - miejsce zostaje wolne", async () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await formularzGotowy();

    expect(h.przyjmij).not.toHaveBeenCalled();
  });
});

describe("PackageInviteAccept - stan zaproszenia przed formularzem (REG-15)", () => {
  it.each([
    ["used", "eventRegistration.invite.stateUsed"],
    ["expired", "eventRegistration.invite.stateExpired"],
    ["event_ended", "eventRegistration.invite.stateEventEnded"],
    ["event_cancelled", "eventRegistration.invite.stateEventCancelled"],
    ["order_cancelled", "eventRegistration.invite.stateOrderCancelled"],
    ["order_refunded", "eventRegistration.invite.stateOrderRefunded"],
    ["unavailable", "eventRegistration.invite.stateUnavailable"],
  ] as const)("stan `%s` to zdanie zamiast formularza", async (stan, zdanie) => {
    h.podglad.mockResolvedValue(podglad({ state: stan }));
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);

    expect(await screen.findByText(zdanie)).toBeTruthy();
    expect(screen.queryByLabelText(wymagane("eventRegistration.fields.firstName"))).toBeNull();
    expect(h.przyjmij).not.toHaveBeenCalled();
  });

  it("nieznany token z podglądu (`invalid_token` wartością) - zdanie, bez formularza", async () => {
    h.podglad.mockRejectedValue(new Error("invalid_token: invitation refused"));
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);

    expect(await screen.findByText(INVALID_TOKEN_PL)).toBeTruthy();
    expect(screen.queryByLabelText(wymagane("eventRegistration.fields.firstName"))).toBeNull();
  });

  it("baza sprzed migracji (podgląd `null`) - sam formularz, jak dotąd", async () => {
    h.podglad.mockResolvedValue(null);
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);

    expect(
      await screen.findByLabelText(wymagane("eventRegistration.fields.firstName")),
    ).toBeTruthy();
    expect(h.formularz).not.toHaveBeenCalled();
  });

  it("podgląd pokazuje wydarzenie i ZAMASKOWANY adres zaproszenia", async () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);

    expect(
      await screen.findByText("eventRegistration.invite.forEvent(title=Kongres 2026)"),
    ).toBeTruthy();
    // Pełnego adresu baza nie oddaje - ekran pokazuje dokładnie maskę z podglądu.
    expect(
      screen.getByText("eventRegistration.invite.addressedTo(email=a***@example.com)"),
    ).toBeTruthy();
  });
});

describe("PackageInviteAccept - konto i zgoda marketingowa", () => {
  it("niezalogowany: podpowiedź logowania, BEZ pola marketingu", async () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await formularzGotowy();

    expect(screen.getByText("eventRegistration.invite.signInHint")).toBeTruthy();
    expect(
      screen.queryByRole("checkbox", { name: "eventRegistration.consents.marketing" }),
    ).toBeNull();
  });

  it("zalogowany na INNY adres: notka, że zgłoszenie nie trafi do konta, BEZ marketingu", async () => {
    h.sesja.current = { user: { id: "u-1" } };
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await formularzGotowy();

    expect(screen.getByText("eventRegistration.invite.accountOther")).toBeTruthy();
    expect(
      screen.queryByRole("checkbox", { name: "eventRegistration.consents.marketing" }),
    ).toBeNull();
  });

  it("zalogowany na POTWIERDZONY adres zaproszenia: notka i pole marketingu, które jedzie do bazy", async () => {
    h.sesja.current = { user: { id: "u-1" } };
    h.podglad.mockResolvedValue(podglad({ accountMatches: true }));
    h.przyjmij.mockResolvedValue(wynik({ accountLinked: true }));
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await formularzGotowy();

    expect(screen.getByText("eventRegistration.invite.accountMatches")).toBeTruthy();
    wypelnij();
    fireEvent.click(screen.getByRole("checkbox", { name: "eventRegistration.consents.marketing" }));
    wyslij();

    await waitFor(() => expect(h.przyjmij).toHaveBeenCalledTimes(1));
    expect(h.przyjmij.mock.calls[0]?.[0].consentMarketing).toBe(true);
    expect(await screen.findByText("eventRegistration.invite.accountLinked")).toBeTruthy();
  });

  it("po przyjęciu bez dowiązania zalogowany widzi, że zgłoszenie nie jest w jego koncie", async () => {
    h.sesja.current = { user: { id: "u-1" } };
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await formularzGotowy();
    wypelnij();
    wyslij();

    expect(await screen.findByText("eventRegistration.invite.accountNotLinked")).toBeTruthy();
  });
});

describe("PackageInviteAccept - formularz pilnuje tego, czego wymaga baza", () => {
  it("bez kompletu danych przycisk jest ODCIĘTY - kliknięcie nie ma jak wysłać żądania", async () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await formularzGotowy();

    expect(przyciskWyslij()).toHaveProperty("disabled", true);
    wyslij();
    expect(h.przyjmij).not.toHaveBeenCalled();
  });

  it("wysyłka Enterem bez imienia i nazwiska mówi CZEGO brakuje i nie idzie do bazy", async () => {
    const { container } = renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await formularzGotowy();
    wyslijEnterem(container);

    expect(await screen.findByText("eventRegistration.validation.firstName")).toBeTruthy();
    expect(screen.getByText("eventRegistration.validation.lastName")).toBeTruthy();
    expect(h.przyjmij).not.toHaveBeenCalled();
  });

  it("wysyłka Enterem bez zgody na przetwarzanie danych też się zatrzymuje", async () => {
    const { container } = renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await formularzGotowy();
    fireEvent.change(screen.getByLabelText(wymagane("eventRegistration.fields.firstName")), {
      target: { value: "Anna" },
    });
    fireEvent.change(screen.getByLabelText(wymagane("eventRegistration.fields.lastName")), {
      target: { value: "Kowalska" },
    });
    wyslijEnterem(container);

    expect(await screen.findByText("eventRegistration.validation.dataProcessing")).toBeTruthy();
    expect(screen.queryByText("eventRegistration.validation.firstName")).toBeNull();
    expect(h.przyjmij).not.toHaveBeenCalled();
  });

  it("komplet danych ODBLOKOWUJE przycisk", async () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await formularzGotowy();
    wypelnij();

    expect(przyciskWyslij()).toHaveProperty("disabled", false);
  });

  it("komplet danych wysyła DOKŁADNIE ten token, zgodę i język formularza", async () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await formularzGotowy();
    wypelnij();
    wyslij();

    await waitFor(() => expect(h.przyjmij).toHaveBeenCalledTimes(1));
    expect(h.przyjmij).toHaveBeenCalledWith({
      token: TOKEN,
      firstName: "Anna",
      lastName: "Kowalska",
      jobTitle: undefined,
      companyText: undefined,
      answers: [],
      acceptedTermIds: [],
      consentDataProcessing: true,
      consentMarketing: false,
      lang: "pl",
    });
  });

  it("pola i regulaminy WYDARZENIA: bez nich przycisk odcięty, z nimi jadą do bazy", async () => {
    h.formularz.mockResolvedValue(formularzZPolami());
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await screen.findByLabelText(/^Sektor/);
    wypelnij();

    // Brak odpowiedzi na pole obowiązkowe i brak regulaminu - baza odmówiłaby
    // (`missing_required_fields`, `terms_required`).
    expect(przyciskWyslij()).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText(/Sektor/), { target: { value: "energia" } });
    expect(przyciskWyslij()).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Regulamin kongresu/ }));
    expect(przyciskWyslij()).toHaveProperty("disabled", false);
    wyslij();

    await waitFor(() => expect(h.przyjmij).toHaveBeenCalledTimes(1));
    const wejscie = h.przyjmij.mock.calls[0]?.[0];
    expect(wejscie?.answers).toEqual([{ key: "sektor", value: "energia" }]);
    expect(wejscie?.acceptedTermIds).toEqual([TERM_ID]);
  });

  it("puste pola nieobowiązkowe jadą jako BRAK, a nie jako „wyczyść”", async () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await formularzGotowy();
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
    await formularzGotowy();
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

  it("sufity pól są atrybutem pola - te same liczby co baza", async () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await formularzGotowy();

    expect(
      screen
        .getByLabelText(wymagane("eventRegistration.fields.firstName"))
        .getAttribute("maxLength"),
    ).toBe("80");
    expect(
      screen.getByLabelText("eventRegistration.fields.jobTitle").getAttribute("maxLength"),
    ).toBe("160");
    expect(
      screen.getByLabelText("eventRegistration.fields.company").getAttribute("maxLength"),
    ).toBe("200");
  });
});

describe("PackageInviteAccept - odmowy, różne zdania", () => {
  /** Wysyła komplet danych i czeka na zdanie odmowy z prawdziwego słownika. */
  async function odmowa(kod: string): Promise<string> {
    h.przyjmij.mockReset();
    h.przyjmij.mockRejectedValue(new Error(`${kod}: refused by database`));
    const widok = renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await formularzGotowy();
    wypelnij();
    wyslij();
    await waitFor(() => expect(h.przyjmij).toHaveBeenCalledTimes(1));
    const alert = await waitFor(() => {
      const node = widok.container.querySelector(".bg-destructive\\/5");
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

  it("`event_ended` mówi językiem ZAPROSZENIA, a nie „zapisy są zamknięte”", async () => {
    expect(await odmowa("event_ended")).toContain(EVENT_ENDED_INVITE_PL);
  });

  it("te zdania są NAPRAWDĘ różne - żadne dwa się nie pokrywają", async () => {
    const zdania = [
      await odmowa("invalid_token"),
      await odmowa("seat_taken"),
      await odmowa("invitation_expired"),
      await odmowa("order_refunded"),
    ];

    expect(new Set(zdania).size).toBe(4);
  });

  it("odmowa ZOSTAWIA formularz - delegat nie przepisuje danych od nowa", async () => {
    h.przyjmij.mockRejectedValue(new Error("invitation_expired: token past its window"));
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await formularzGotowy();
    wypelnij();
    wyslij();

    await waitFor(() => expect(screen.getByText(INVITATION_EXPIRED_PL)).toBeTruthy());
    const imie = screen.getByLabelText(wymagane("eventRegistration.fields.firstName"));
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
    await formularzGotowy();
    wypelnij();
    wyslij();

    expect(await screen.findByText("eventRegistration.invite.successTitle")).toBeTruthy();
    expect(screen.getByText("Qr9d_Xy1-Zw3zEr8TyU2iOp6AsDf5gHk")).toBeTruthy();
    expect(screen.getByText("Mg7d_Xy4-Vw2zEr1TyU9iOp3AsDf8gHl")).toBeTruthy();
    expect(screen.getByText("eventRegistration.invite.qrHint")).toBeTruthy();
  });

  it("po potwierdzeniu formularza już NIE MA - drugie kliknięcie nie ma czego zająć", async () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await formularzGotowy();
    wypelnij();
    wyslij();

    await screen.findByText("eventRegistration.invite.successTitle");
    expect(screen.queryByLabelText(wymagane("eventRegistration.fields.firstName"))).toBeNull();
    expect(screen.queryByRole("button", { name: /eventRegistration\.invite\.submit/ })).toBeNull();
  });

  it("zgłoszenie bez kodu wejścia nie rysuje pustej ramki na kod", async () => {
    h.przyjmij.mockResolvedValue(wynik({ qrToken: null, manageToken: null }));
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await formularzGotowy();
    wypelnij();
    wyslij();

    expect(await screen.findByText("eventRegistration.invite.successTitle")).toBeTruthy();
    expect(screen.queryByText("eventRegistration.invite.qrTitle")).toBeNull();
    expect(screen.queryByText("eventRegistration.result.manageTokenTitle")).toBeNull();
  });
});

describe("PackageInviteAccept - pakiet jeszcze nieopłacony (TIX-07)", () => {
  it("miejsce czekające na płatność NIE mówi „miejsce jest Twoje” ani „zatwierdzone”", async () => {
    h.przyjmij.mockResolvedValue(
      wynik({ status: "pending", awaitingPayment: true, qrToken: null }),
    );
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    wypelnij();
    wyslij();

    expect(await screen.findByText("eventRegistration.invite.awaitingTitle")).toBeTruthy();
    expect(screen.getByText("eventRegistration.invite.awaitingBody")).toBeTruthy();
    expect(screen.queryByText("eventRegistration.invite.successTitle")).toBeNull();
    expect(screen.queryByText("eventRegistration.invite.successBody")).toBeNull();
    expect(screen.queryByText("eventRegistration.invite.qrTitle")).toBeNull();
    // Klucz samoobsługi zostaje - delegat bez konta potrzebuje go od razu.
    expect(screen.getByText("eventRegistration.result.manageTokenTitle")).toBeTruthy();
  });

  it("oba języki mają zdania stanu oczekiwania", () => {
    for (const lang of ["pl", "en"] as const) {
      for (const key of [
        "eventRegistration.invite.awaitingTitle",
        "eventRegistration.invite.awaitingBody",
      ]) {
        expect(realT(lang)(key)).not.toBe(key);
      }
    }
  });
});

describe("PackageInviteAccept - dostępność", () => {
  it("formularz zaproszenia (z polami i regulaminem) nie ma naruszeń axe", async () => {
    h.formularz.mockResolvedValue(formularzZPolami());
    const { container } = renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await screen.findByLabelText(/^Sektor/);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("ekran złego odnośnika nie ma naruszeń axe", async () => {
    const { container } = renderWithQueryClient(<PackageInviteAccept token="za-krotki" />);

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("potwierdzenie z kodami nie ma naruszeń axe", async () => {
    renderWithQueryClient(<PackageInviteAccept token={TOKEN} />);
    await formularzGotowy();
    wypelnij();
    wyslij();

    await screen.findByText("eventRegistration.invite.successTitle");
    const violations = await axeViolations(container());
    expect(violations, summarize(violations)).toEqual([]);
  });
});

function container(): HTMLElement {
  return document.body;
}
