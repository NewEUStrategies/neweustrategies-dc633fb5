// Ekran PO zapisie - TRZY ROZNE ZDANIA dla trzech roznych sytuacji uczestnika.
//
// Sasiedni `RegistrationConfirmation.test.tsx` dowodzi drogi DO KASY. Ten plik
// domyka to, czego tamten nie dotyka: co czlowiek czyta o WLASNYM zgloszeniu i
// co mu zostaje w reku, gdy zamknie karte.
//
// 1. „ZAPISANY", „LISTA OCZEKUJACYCH", „DO ZAPLATY" TO TRZY ROZNE STANY SWIATA.
//    Jedno zdanie „dziekujemy za zgloszenie" na wszystkie trzy konczy sie tym,
//    ze ktos z listy rezerwowej przyjezdza na wydarzenie, a ktos niezaplacony
//    jest przekonany, ze ma wejsciowke.
// 2. POZYCJA NA LISCIE JEST CZESCIA ODPOWIEDZI. „Jestes 2." i „jestes na
//    liscie" to inna decyzja o zakupie biletu na pociag.
// 3. KLUCZ SAMOOBSLUGI POKAZUJEMY RAZ. Baza trzyma wylacznie jego SHA-256, wiec
//    odswiezenie strony go traci - musi byc widoczny w calosci, kopiowalny co
//    do znaku i wsparty odnoskiem, ktory da sie wyslac sobie mailem.
// 4. REZYGNACJA ZNIKA PO REZYGNACJI. Przycisk „odwolaj" nad zdaniem „rezygnacja
//    przyjeta" zaprasza do drugiego wywolania RPC, ktore odpowie odmowa.
//
// ATRAPUJEMY WYLACZNIE GRANICE: wywolanie server fn kasy, sesje, srodowisko
// bramki, modal operatora Stripe, toasty i i18n. Molekula kasy i atom
// formatujacy kwote jada PRAWDZIWE - to one decyduja, co uczestnik zobaczy.
//
// RODO: identyfikatory i klucz sa syntetyczne, kwoty umowne.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import type { RegistrationResult } from "@/lib/events/publicRegistrationApi";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";

const checkout = vi.fn();
const writeText = vi.fn<(value: string) => Promise<void>>();

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => vi.fn(),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => checkout,
}));

vi.mock("@/lib/billing/checkout.functions", () => ({
  createCheckoutOrder: { name: "createCheckoutOrder" },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: { user: { id: "u-1" } } }) }));

vi.mock("@/lib/stripe", () => ({ getStripeEnvironment: () => "sandbox" }));

vi.mock("@/components/checkout/LazyEmbeddedCheckoutDialog", () => ({
  LazyEmbeddedCheckoutDialog: ({ clientSecret }: { clientSecret: string | null }) =>
    clientSecret === null ? null : <div data-testid="checkout-modal">{clientSecret}</div>,
}));

const { toast } = await import("sonner");
const { RegistrationConfirmation } =
  await import("@/components/events/registration/RegistrationConfirmation");

const SLUG = "kongres cee";
const REGISTRATION_ID = "11111111-1111-1111-1111-111111111111";
const EVENT_ID = "22222222-2222-2222-2222-222222222222";
/** 24 bajty base64url - dokladnie taki ksztalt daje `_event_new_qr_token()`. */
const MANAGE_TOKEN = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";

function result(over: Partial<RegistrationResult> = {}): RegistrationResult {
  return {
    registrationId: REGISTRATION_ID,
    eventId: EVENT_ID,
    personId: null,
    status: "approved",
    decisionSource: null,
    waitlistPosition: null,
    ticketTypeId: null,
    qrToken: null,
    manageToken: null,
    paymentRequired: false,
    paymentStatus: "not_required",
    amountCents: null,
    currency: null,
    ...over,
  };
}

function renderConfirmation(
  over: Partial<RegistrationResult> = {},
  state: { cancelled?: boolean; cancelling?: boolean } = {},
) {
  const onCancel = vi.fn();
  const view = renderWithQueryClient(
    <RegistrationConfirmation
      result={result(over)}
      slug={SLUG}
      eventId={EVENT_ID}
      cancelled={state.cancelled ?? false}
      cancelling={state.cancelling ?? false}
      onCancel={onCancel}
    />,
  );
  return { ...view, onCancel };
}

beforeEach(() => {
  vi.clearAllMocks();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

// ---------------------------------------------------------------------------
// TRZY STANY, TRZY ZDANIA.
// ---------------------------------------------------------------------------
describe("RegistrationConfirmation - co uczestnik czyta o swoim zgloszeniu", () => {
  it("zapis przyjety od reki mowi „jestes zapisany”", () => {
    renderConfirmation({ status: "approved", qrToken: "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj" });

    expect(screen.getByText("eventRegistration.result.approved")).toBeInTheDocument();
    expect(screen.queryByText("eventRegistration.result.paymentTitle")).not.toBeInTheDocument();
  });

  it("zapis czekajacy na decyzje organizatora NIE obiecuje miejsca", () => {
    renderConfirmation({ status: "pending" });

    expect(screen.getByText("eventRegistration.result.pending")).toBeInTheDocument();
    expect(screen.queryByText("eventRegistration.result.approved")).not.toBeInTheDocument();
  });

  it("lista oczekujacych podaje POZYCJE, bo od niej zalezy decyzja o przyjezdzie", () => {
    renderConfirmation({ status: "waitlist", waitlistPosition: 2 });

    expect(screen.getByText("eventRegistration.result.waitlist(position=2)")).toBeInTheDocument();
  });

  it("lista oczekujacych bez pozycji ma WLASNE zdanie, a nie „pozycja null”", () => {
    // `waitlist_position` bywa nieznane (zapis sprzed migracji, promocja w toku).
    // Zdanie z pusta pozycja czyta sie jak awaria ekranu.
    renderConfirmation({ status: "waitlist", waitlistPosition: null });

    expect(screen.getByText("eventRegistration.result.waitlistNoPosition")).toBeInTheDocument();
    expect(screen.queryByText(/position=/)).not.toBeInTheDocument();
  });

  it("zgloszenie do oplacenia mowi to PRZED kluczem samoobslugi i bez obietnicy wejsciowki", () => {
    renderConfirmation({
      status: "pending",
      paymentRequired: true,
      paymentStatus: "unpaid",
      amountCents: 15000,
      currency: "PLN",
      ticketTypeId: "33333333-3333-3333-3333-333333333333",
      manageToken: MANAGE_TOKEN,
    });

    const payment = screen.getByText("eventRegistration.result.paymentTitle");
    const token = screen.getByText("eventRegistration.result.manageTokenTitle", {
      selector: "h2",
    });
    // Kolejnosc w dokumencie jest tresciowa: czlowiek, ktory zobaczy najpierw
    // ramke z kluczem, wychodzi z ekranu przekonany, ze ma wejsciowke.
    expect(payment.compareDocumentPosition(token) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText("eventRegistration.result.paymentNoTicketYet")).toBeInTheDocument();
  });

  it("trzy stany daja TRZY ROZNE zdania, a nie jedno na wszystko", () => {
    const sentences: string[] = [];
    for (const over of [
      { status: "approved" } as const,
      { status: "waitlist", waitlistPosition: 4 } as const,
      { status: "pending", paymentRequired: true, amountCents: 9900, currency: "PLN" } as const,
    ]) {
      const view = renderConfirmation(over);
      const banner = view.container.querySelector("section > p");
      sentences.push(banner?.textContent ?? "");
      view.unmount();
    }
    // Sama ROZNORODNOSC zdan niczego nie dowodzi - trzy rozne zdania w zlej
    // kolejnosci to nadal ktos z listy rezerwowej przekonany, ze ma miejsce.
    // Kazdy stan musi dostac SWOJE zdanie, i to zdanie przypisane wlasnie jemu.
    expect(sentences).toEqual([
      "eventRegistration.result.approved",
      "eventRegistration.result.waitlist(position=4)",
      "eventRegistration.result.pending",
    ]);
  });

  it("zdanie o statusie stoi w obszarze zywym - formularz znika, wiec jest co oglosic", () => {
    // Potwierdzenie PODMIENIA formularz w miejscu. Bez `aria-live` czytnik
    // ekranu nie mowi nic: uzytkownik klika „wyslij" i nie wie, czy cokolwiek
    // sie stalo.
    const { container } = renderConfirmation({ status: "approved" });

    expect(container.querySelector("section")).toHaveAttribute("aria-live", "polite");
  });
});

// ---------------------------------------------------------------------------
// KLUCZ SAMOOBSLUGI.
// ---------------------------------------------------------------------------
describe("RegistrationConfirmation - klucz zarzadzania zapisem", () => {
  it("pokazuje klucz w calosci i uprzedza, ze widac go tylko raz", () => {
    renderConfirmation({ manageToken: MANAGE_TOKEN });

    expect(screen.getByText(MANAGE_TOKEN)).toBeInTheDocument();
    expect(screen.getByText("eventRegistration.result.manageTokenHint")).toBeInTheDocument();
  });

  it("odnosnik do samoobslugi niesie klucz w adresie i przezyje zamkniecie karty", () => {
    // Goly napis do przepisania z ekranu ginie razem z zakladka; adres da sie
    // zapisac i otworzyc na telefonie w dniu wydarzenia.
    renderConfirmation({ manageToken: MANAGE_TOKEN });

    expect(screen.getByText("eventFront.manage.manageLink").closest("a")).toHaveAttribute(
      "href",
      `/events/kongres%20cee/manage?token=${MANAGE_TOKEN}`,
    );
  });

  it("kopiowanie oddaje klucz CO DO ZNAKU - baza zna tylko jego SHA-256", async () => {
    renderConfirmation({ manageToken: MANAGE_TOKEN });

    fireEvent.click(screen.getByRole("button", { name: /manageTokenTitle/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(MANAGE_TOKEN));
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("udane kopiowanie potwierdza sie na przycisku i NIE alarmuje", async () => {
    renderConfirmation({ manageToken: MANAGE_TOKEN });
    const button = screen.getByRole("button", { name: /manageTokenTitle/ });
    // Przed kliknieciem stoi ikona kopiowania - inaczej „potwierdzenie" byloby
    // stanem, w ktorym przycisk jest od poczatku i nic nie oznacza.
    expect(button.querySelector("svg")?.getAttribute("class") ?? "").toContain("copy");

    fireEvent.click(button);

    await waitFor(() =>
      expect(button.querySelector("svg")?.getAttribute("class") ?? "").toContain("check"),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("potwierdzenie kopiowania GASNIE, wiec drugie kopiowanie tez je pokaze", async () => {
    // Bez wygaszenia przycisk zostaje na zawsze w stanie „skopiowano" - a to
    // jedyna informacja zwrotna, jaka ma czlowiek wklejajacy klucz do notatki.
    // Drugie klikniecie wygladaloby wtedy tak samo jak brak reakcji.
    vi.useFakeTimers();
    try {
      renderConfirmation({ manageToken: MANAGE_TOKEN });
      const button = screen.getByRole("button", { name: /manageTokenTitle/ });

      fireEvent.click(button);
      await act(async () => {});
      expect(button.querySelector("svg")?.getAttribute("class") ?? "").toContain("check");

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(button.querySelector("svg")?.getAttribute("class") ?? "").toContain("copy");
    } finally {
      vi.useRealTimers();
    }
  });

  it("odciety schowek NIE zabiera klucza z ekranu - zostaje do przepisania", async () => {
    // Uprawnienia przegladarki potrafia zablokowac `navigator.clipboard`.
    // Jedyna kopia klucza jest na tym ekranie, wiec nie moze zniknac razem
    // z nieudanym kliknieciem.
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    renderConfirmation({ manageToken: MANAGE_TOKEN });

    fireEvent.click(screen.getByRole("button", { name: /manageTokenTitle/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(screen.getByText(MANAGE_TOKEN)).toBeInTheDocument();
  });

  it("nieudane kopiowanie melduje ZDANIE O BLEDZIE, a nie tytul sekcji", async () => {
    // Powiadomienie o bledzie z trescia tytulu ramki („Klucz do zarzadzania
    // zapisem") nie mowi ANI ze kopiowanie sie nie udalo, ANI co zrobic dalej
    // (przepisac klucz recznie) - powtarza tylko naglowek, ktory uzytkownik ma
    // przed oczami. Odmowa schowka ma wiec wlasny klucz w slowniku.
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    renderConfirmation({ manageToken: MANAGE_TOKEN });

    fireEvent.click(screen.getByRole("button", { name: /manageTokenTitle/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalledWith("eventRegistration.result.manageTokenTitle");
    expect(toast.error).toHaveBeenCalledWith("eventRegistration.result.manageTokenCopyFailed");
  });

  it("zalogowany wlasciciel bez klucza nie oglada pustej ramki", () => {
    // `event_register` oddaje `manage_token` tylko tam, gdzie jest potrzebny.
    // Ramka z pustym `<code>` wygladalaby jak utracony klucz.
    renderConfirmation({ manageToken: null });

    expect(screen.queryByText("eventRegistration.result.manageTokenHint")).not.toBeInTheDocument();
    expect(screen.queryByText("eventFront.manage.manageLink")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// REZYGNACJA.
// ---------------------------------------------------------------------------
describe("RegistrationConfirmation - rezygnacja z zapisu", () => {
  it("gosc bez konta ma dzialajacy przycisk, a nie prosbe o kontakt z organizatorem", () => {
    const { onCancel } = renderConfirmation({ manageToken: MANAGE_TOKEN });

    fireEvent.click(screen.getByRole("button", { name: "eventRegistration.actions.cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("w trakcie rezygnacji przycisk jest zablokowany - jedno kliknięcie, jedno RPC", () => {
    const { onCancel } = renderConfirmation({ manageToken: MANAGE_TOKEN }, { cancelling: true });

    const button = screen.getByRole("button", { name: "eventRegistration.actions.cancelling" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("po rezygnacji zostaje JEDNO zdanie, bez klucza, kasy i przycisku odwolania", () => {
    renderConfirmation(
      {
        status: "pending",
        paymentRequired: true,
        amountCents: 15000,
        currency: "PLN",
        ticketTypeId: "33333333-3333-3333-3333-333333333333",
        manageToken: MANAGE_TOKEN,
      },
      { cancelled: true },
    );

    expect(screen.getByText("eventRegistration.result.cancelled")).toBeInTheDocument();
    expect(screen.queryByText("eventRegistration.result.pending")).not.toBeInTheDocument();
    // Wezwanie do zaplaty za odwolane zgloszenie to prosba o pieniadze za nic.
    expect(screen.queryByText("eventRegistration.result.paymentTitle")).not.toBeInTheDocument();
    expect(screen.queryByText(MANAGE_TOKEN)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "eventRegistration.actions.cancel" }),
    ).not.toBeInTheDocument();
  });
});

describe("RegistrationConfirmation - dostepnosc pelnego ekranu", () => {
  it("ekran z kluczem i rezygnacja nie ma naruszen dostepnosci", async () => {
    const { container } = renderConfirmation({
      status: "waitlist",
      waitlistPosition: 2,
      manageToken: MANAGE_TOKEN,
    });

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
