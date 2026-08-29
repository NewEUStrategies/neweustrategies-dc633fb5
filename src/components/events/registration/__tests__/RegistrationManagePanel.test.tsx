// Samoobsługa zgłoszenia po kluczu `manage_token`: jedyna droga rezygnacji dla
// uczestnika BEZ KONTA.
//
// SIEDEM RZECZY, KTÓRE PO ZEPSUCIU KOSZTUJĄ MIEJSCE ALBO ZAUFANIE:
// 1. SAMO OTWARCIE ODNOŚNIKA NICZEGO NIE ODWOŁUJE. Skanery bezpieczeństwa
//    w klientach pocztowych odwiedzają każdy adres z wiadomości; rezygnacja
//    przy wejściu na stronę zabrałaby miejsce, zanim człowiek przeczyta maila.
// 2. REZYGNACJA WYMAGA DWÓCH ŚWIADOMYCH KLIKNIĘĆ - dokładnie jak wypisanie
//    z newslettera.
// 3. KLUCZ JEDZIE DO RPC W POSTACI, W JAKIEJ PRZYSZEDŁ (asercja na argumentach
//    atrapy) - baza trzyma tylko jego SHA-256, więc literówka to „nie znaleziono".
// 4. ZŁY KSZTAŁT KLUCZA NIE OTWIERA REZYGNACJI. Sprawdzenie kształtu u siebie
//    oszczędza zapytanie, które i tak wróciłoby z odmową.
// 5. ODMOWA BAZY (nieznany klucz, zgłoszenie już zamknięte) MÓWI ZDANIEM
//    uczestnika i ZOSTAWIA go na ekranie, z którego może spróbować ponownie.
// 6. NAGŁÓWEK MÓWI, CZEGO dotyczy rezygnacja - i to w strefie WYDARZENIA,
//    a nie w strefie maszyny, która akurat renderuje stronę.
// 7. PO ODWOŁANIU nie ma już czego odwoływać: przycisk znika, a jego miejsce
//    zajmuje potwierdzenie (z informacją o osobie z listy rezerwowej).
//
// i18n jest zamockowane kluczami (parytetu PL/EN pilnuje osobna bramka
// słowników). Wyjątkiem są zdania odmowy: `registrationErrorMessage` liczy je
// POZA Reactem, na prawdziwej instancji i18next, więc tam asercja czyta to,
// co naprawdę zobaczy uczestnik w powiadomieniu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import type { EventPageHeader } from "@/lib/community/publicQueries";
import type {
  CancelRegistrationInput,
  RegistrationCancelResult,
} from "@/lib/events/publicRegistrationApi";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const fetchHeader = vi.fn<(slug: string) => Promise<EventPageHeader | null>>();
const cancel = vi.fn<(input: CancelRegistrationInput) => Promise<RegistrationCancelResult>>();
const writeText = vi.fn<(value: string) => Promise<void>>();

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

vi.mock("@/lib/community/publicQueries", () => ({
  fetchEventPageHeader: (slug: string) => fetchHeader(slug),
}));

vi.mock("@/lib/events/publicRegistrationApi", () => ({
  cancelRegistration: (input: CancelRegistrationInput) => cancel(input),
}));

const { toast } = await import("sonner");
const { RegistrationManagePanel } =
  await import("@/components/events/registration/RegistrationManagePanel");

/** 24 bajty w base64url - dokładnie taki kształt daje `_event_new_qr_token()`. */
const TOKEN = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";
const SLUG = "kongres-cee";

/** Zdania odmowy z prawdziwego słownika (`eventRegistration.errors.*`). */
const NOT_FOUND_PL = "Nie znaleźliśmy tego wydarzenia.";
const ALREADY_CLOSED_PL = "Ten zapis jest już zamknięty.";

/**
 * Wiersz `event_page_header()` ma ~50 kolumn, a panel czyta z niego DOKŁADNIE
 * cztery. Atrapa niesie tylko je - reszta nie ma jak wpłynąć na ten ekran.
 * Kolumny wygenerowanego typu są nienullowalne, choć RPC zwraca `NULL` dla
 * wydarzenia bez daty; stąd jawne rzutowanie w przypadku „bez daty".
 */
function header(over: Partial<EventPageHeader> = {}): EventPageHeader {
  return {
    title_pl: "Kongres CEE 2026",
    title_en: "CEE Congress 2026",
    starts_at: "2026-09-15T08:00:00Z",
    timezone: "Europe/Warsaw",
    ...over,
  } as EventPageHeader;
}

function renderPanel(token: string | null = TOKEN) {
  return renderWithQueryClient(<RegistrationManagePanel slug={SLUG} token={token} />);
}

function confirmButton(): HTMLElement {
  return screen.getByRole("button", { name: "eventFront.manage.confirm" });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchHeader.mockResolvedValue(header());
  cancel.mockResolvedValue({ registrationId: "r1", promotedFromWaitlist: 0 });
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

describe("RegistrationManagePanel", () => {
  it("do czasu wczytania nagłówka pokazuje szkielet, a nie gotowy ekran rezygnacji", () => {
    // Przycisk „odwołaj" narysowany przed danymi wydarzenia pozwoliłby odwołać
    // udział w czymś, czego nazwy uczestnik jeszcze nie widzi.
    fetchHeader.mockReturnValue(new Promise<EventPageHeader | null>(() => {}));
    const { container } = renderPanel();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "eventFront.manage.confirm" })).toBeNull();
  });

  it("otwarcie odnośnika z maila NICZEGO nie odwołuje", async () => {
    // Najdroższy możliwy błąd tego ekranu. Skaner poczty albo prefetch
    // przeglądarki odwiedza adres bez udziału człowieka - gdyby rezygnacja
    // działa się przy wejściu, uczestnik straciłby miejsce, zanim otworzy maila.
    renderPanel();

    expect(await screen.findByText("eventFront.manage.confirmTitle")).toBeInTheDocument();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("nagłówek mówi, CZEGO dotyczy rezygnacja - w strefie wydarzenia", async () => {
    // 08:00 UTC w Warszawie to 10:00. Godzina policzona w strefie maszyny
    // (kontener CI stoi na UTC) pokazałaby 08:00 i uczestnik uznałby, że
    // rezygnuje z innego wydarzenia.
    renderPanel();

    expect(await screen.findByText("Kongres CEE 2026")).toBeInTheDocument();
    expect(screen.getByText("15 września 2026 10:00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "eventFront.manage.backToEvent" })).toHaveAttribute(
      "href",
      `/events/${SLUG}`,
    );
  });

  it("nieznany slug nie blokuje rezygnacji - znika sam nagłówek", async () => {
    // Klucz zarządzania jest niezależny od strony wydarzenia. Gdyby brak
    // nagłówka gasił cały panel, uczestnik usuniętego z listy wydarzenia
    // nie miałby jak się wypisać.
    fetchHeader.mockResolvedValue(null);
    renderPanel();

    expect(await screen.findByText("eventFront.manage.confirmTitle")).toBeInTheDocument();
    expect(screen.queryByText("Kongres CEE 2026")).toBeNull();
    expect(screen.queryByRole("link", { name: "eventFront.manage.backToEvent" })).toBeNull();
  });

  it("wydarzenie bez daty pokazuje sam tytuł, bez pustego wiersza godziny", async () => {
    fetchHeader.mockResolvedValue(header({ starts_at: null as unknown as string }));
    renderPanel();

    expect(await screen.findByText("Kongres CEE 2026")).toBeInTheDocument();
    expect(screen.queryByText(/2026 \d\d:\d\d/)).toBeNull();
  });

  it("odnośnik BEZ klucza prosi o wklejenie go i nie pokazuje rezygnacji", async () => {
    // Ekran rezygnacji bez klucza nie miałby czego wysłać do bazy - przycisk
    // „odwołaj", który zawsze kończy się błędem, jest gorszy niż jego brak.
    renderPanel(null);

    expect(await screen.findByText("eventFront.manage.missingToken")).toBeInTheDocument();
    expect(screen.getByLabelText("eventFront.manage.tokenLabel")).toBeInTheDocument();
    expect(screen.queryByText("eventFront.manage.confirmTitle")).toBeNull();
  });

  it("klucz o złym kształcie NIE otwiera rezygnacji, poprawny - otwiera", async () => {
    // Kształt (32 znaki base64url) sprawdzamy u siebie, więc literówka z maila
    // nie kosztuje zapytania do bazy. Odwrócenie tego warunku wysyłałoby do
    // RPC każdy wpisany znak.
    renderPanel(null);
    const field = await screen.findByLabelText("eventFront.manage.tokenLabel");

    fireEvent.change(field, { target: { value: "za-krotki-klucz" } });
    expect(screen.queryByText("eventFront.manage.confirmTitle")).toBeNull();

    fireEvent.change(field, { target: { value: `  ${TOKEN}  ` } });
    expect(screen.getByText("eventFront.manage.confirmTitle")).toBeInTheDocument();
  });

  it("wklejony klucz jedzie do RPC BEZ otaczających spacji", async () => {
    // Wklejenie z klienta pocztowego dokleja białe znaki zaskakująco często,
    // a baza porównuje SHA-256 - spacja to inny skrót, czyli „nie znaleziono".
    renderPanel(null);
    fireEvent.change(await screen.findByLabelText("eventFront.manage.tokenLabel"), {
      target: { value: `  ${TOKEN}  ` },
    });

    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());

    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(cancel).toHaveBeenCalledWith({ manageToken: TOKEN });
  });

  it("rezygnacja wymaga DRUGIEGO kliknięcia - pierwsze tylko pyta", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "eventFront.manage.confirm" }));

    // Po pierwszym kliknięciu stoi para „odwołaj / zostaw zapis" i ANI JEDNO
    // wywołanie nie poszło do bazy.
    expect(screen.getByRole("button", { name: "eventFront.manage.keep" })).toBeInTheDocument();
    expect(cancel).not.toHaveBeenCalled();

    fireEvent.click(confirmButton());
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ manageToken: TOKEN }));
  });

  it("„zostaw zapis” cofa pytanie i nie wysyła nic do bazy", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "eventFront.manage.confirm" }));
    fireEvent.click(screen.getByRole("button", { name: "eventFront.manage.keep" }));

    expect(screen.queryByRole("button", { name: "eventFront.manage.keep" })).toBeNull();
    expect(confirmButton()).toBeInTheDocument();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("po odwołaniu nie ma już czego odwoływać", async () => {
    // Zostawiony przycisk zaprosiłby do drugiego wywołania, a baza odpowiada
    // na nie błędem `already_closed` - uczestnik zobaczyłby czerwony komunikat
    // po udanej rezygnacji.
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "eventFront.manage.confirm" }));
    fireEvent.click(confirmButton());

    expect(await screen.findByText("eventFront.manage.cancelled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "eventFront.manage.confirm" })).toBeNull();
    expect(screen.queryByText("eventFront.manage.confirmTitle")).toBeNull();
  });

  it("zwolnione miejsce pokazuje się TYLKO wtedy, gdy ktoś faktycznie wszedł", async () => {
    // `promoted_from_waitlist` bywa zerem (nie było kolejki). Zdanie „miejsce
    // trafiło do 0 osób" jest gorsze niż milczenie.
    cancel.mockResolvedValue({ registrationId: "r1", promotedFromWaitlist: 0 });
    const zero = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "eventFront.manage.confirm" }));
    fireEvent.click(confirmButton());
    await screen.findByText("eventFront.manage.cancelled");
    expect(screen.queryByText(/eventFront\.manage\.promoted/)).toBeNull();
    zero.unmount();

    cancel.mockResolvedValue({ registrationId: "r2", promotedFromWaitlist: 2 });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "eventFront.manage.confirm" }));
    fireEvent.click(confirmButton());
    expect(await screen.findByText("eventFront.manage.promoted(count=2)")).toBeInTheDocument();
  });

  it("nieznany albo zużyty klucz mówi ZDANIEM i zostawia uczestnika na ekranie", async () => {
    // `not_found` dostaje i literówka w kluczu, i klucz zgłoszenia, którego już
    // nie ma. Uczestnik ma zobaczyć zdanie, a nie surową głowę wyjątku plpgsql,
    // i ma zostać tam, gdzie może spróbować jeszcze raz.
    cancel.mockRejectedValue(new Error("not_found: registration does not exist"));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "eventFront.manage.confirm" }));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NOT_FOUND_PL));
    expect(screen.queryByText("eventFront.manage.cancelled")).toBeNull();
    // Pytanie wraca do stanu wyjściowego: znów jeden przycisk, bez pary
    // potwierdzającej, żeby ponowne kliknięcie było znów świadome.
    expect(screen.queryByRole("button", { name: "eventFront.manage.keep" })).toBeNull();
    expect(confirmButton()).toBeInTheDocument();
  });

  it("zgłoszenie już odwołane mówi to wprost, a nie „spróbuj ponownie”", async () => {
    // Ten sam odnośnik otwarty drugi raz (albo dwa razy kliknięty w telefonie).
    // Uczestnik ma usłyszeć „już zamknięte", a ekran nie może ogłosić rezygnacji,
    // której baza nie wykonała.
    cancel.mockRejectedValue(new Error("already_closed: this registration is already closed"));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "eventFront.manage.confirm" }));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(ALREADY_CLOSED_PL));
    expect(screen.queryByText("eventFront.manage.cancelled")).toBeNull();
  });

  it("trwające odwołanie blokuje przycisk i mówi, że pracuje", async () => {
    // Drugie kliknięcie w tę samą sprawę to drugie wywołanie RPC, a odpowiedź
    // na nie brzmi już `already_closed` - czyli błąd po udanej rezygnacji.
    let release: (value: RegistrationCancelResult) => void = () => {};
    cancel.mockImplementation(
      () =>
        new Promise<RegistrationCancelResult>((resolve) => {
          release = resolve;
        }),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "eventFront.manage.confirm" }));
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "eventFront.manage.confirming" })).toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "eventFront.manage.confirming" }));
    expect(cancel).toHaveBeenCalledTimes(1);

    release({ registrationId: "r1", promotedFromWaitlist: 0 });
    expect(await screen.findByText("eventFront.manage.cancelled")).toBeInTheDocument();
  });

  it("kopiowanie odnośnika składa PEŁNY adres strony zarządzania z kluczem", async () => {
    // To jedyny sposób, w jaki uczestnik odzyska tę stronę bez konta. Adres bez
    // klucza (albo z uciętym kluczem) prowadzi do formularza „wklej klucz",
    // którego nikt już nie ma.
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "eventFront.manage.copyLink" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/events/${SLUG}/manage?token=${TOKEN}`,
      ),
    );
    expect(toast.success).toHaveBeenCalledWith("eventFront.manage.copied");
  });

  it("odcięty schowek nie udaje sukcesu", async () => {
    // Przeglądarka blokuje schowek bez gestu użytkownika i w niezaufanym
    // kontekście. „Skopiowano" bez skopiowania kosztuje uczestnika klucz.
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "eventFront.manage.copyLink" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("eventFront.manage.manageLink"));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
