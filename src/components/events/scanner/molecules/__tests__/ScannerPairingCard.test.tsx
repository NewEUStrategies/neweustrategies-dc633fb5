// Ekran PAROWANIA urządzenia - jedyne miejsce, w którym poświadczenie bramki
// przechodzi z ręki organizatora do telefonu wolontariusza.
//
// CO TEN PLIK DOWODZI (komponent stał na zerowym pokryciu):
// 1. KOD O ZŁYM KSZTAŁCIE NIE WYCHODZI Z URZĄDZENIA. `_event_scanner_device_auth`
//    wymaga 16-128 znaków base64url; kod urwany przy kopiowaniu ma zostać
//    odrzucony U SIEBIE, bez żądania, które i tak wróci z odmową - a przy okazji
//    bez wysyłania fragmentu poświadczenia w sieć.
// 2. BIAŁE ZNAKI NIE JADĄ DO BRAMKI. Kod wklejony z panelu ma spacje i znak
//    końca wiersza; nieobcięty rozjeżdża się z tym, co baza trzyma w bazie.
// 3. KOMUNIKAT O KSZTAŁCIE MA PIERWSZEŃSTWO PRZED ODMOWĄ BRAMKI. Inaczej po
//    urwaniu kodu operator czytałby „poproś organizatora o nowy" i szedł po
//    kod, którego nie potrzebuje.
// 4. ODMOWA BRAMKI JEST ZDANIEM, NIE KLUCZEM. Powstaje POZA Reactem
//    (`scannerErrorMessage` -> prawdziwa instancja i18next), więc asercja czyta
//    zdanie, które faktycznie zobaczy człowiek przy bramce.
// 5. ŁĄCZENIE W TOKU NIE ZNOSI DRUGIEGO ŻĄDANIA. Podwójny Enter z czytnika
//    sprzętowego to dwa `bootstrap` na to samo poświadczenie.
//
// i18n jest zamockowane kluczami (parytetu słowników pilnuje osobna bramka),
// z jednym wyjątkiem opisanym w punkcie 4.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

const { ScannerPairingCard } =
  await import("@/components/events/scanner/molecules/ScannerPairingCard");

/** Kod o kształcie, który przepuszcza `SCANNER_TOKEN_PATTERN` (16-128 base64url). */
const TOKEN = "nes-scanner-token-0123456789";

/** Zdanie składane przez produkcyjny mapper odmów (prawdziwy słownik PL). */
const DEVICE_REVOKED_PL = "Poświadczenie zostało unieważnione. Poproś organizatora o nowy kod.";

function mount(over: Partial<Parameters<typeof ScannerPairingCard>[0]> = {}) {
  const props = {
    onConnect: vi.fn(),
    connecting: false,
    error: null,
    online: true,
    ...over,
  };
  return { ...render(<ScannerPairingCard {...props} />), props };
}

function tokenInput(): HTMLInputElement {
  const input = screen.getByLabelText("eventScanner.pairing.tokenLabel");
  return input as HTMLInputElement;
}

function submitForm(): void {
  fireEvent.submit(tokenInput().closest("form") as HTMLFormElement);
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ScannerPairingCard - kształt kodu sprawdzamy u siebie", () => {
  it("kod o złym kształcie NIE wysyła żądania do bramki", () => {
    // Najważniejsza asercja tego pliku. Urwany kod to nie jest „prawie kod":
    // wysłanie go kosztuje żądanie, odmowę i kolejkę czekającą przy bramce,
    // a fragment poświadczenia i tak wychodzi z urządzenia.
    const { props } = mount();

    fireEvent.change(tokenInput(), { target: { value: "za-krotki" } });
    submitForm();

    expect(props.onConnect).not.toHaveBeenCalled();
    expect(screen.getByText("eventScanner.pairing.invalidToken")).toBeInTheDocument();
    expect(tokenInput()).toHaveAttribute("aria-invalid", "true");
  });

  it("znak spoza base64url jest odrzucany tak samo jak kod za krótki", () => {
    // Długość bywa dobra, a treść nie: kod skopiowany razem z otoczeniem
    // („token: abc…") ma spację i dwukropek, których wzorzec nie dopuszcza.
    const { props } = mount();

    fireEvent.change(tokenInput(), { target: { value: "token: abcdefghijklmnop" } });
    submitForm();

    expect(props.onConnect).not.toHaveBeenCalled();
    expect(screen.getByText("eventScanner.pairing.invalidToken")).toBeInTheDocument();
  });

  it("puste pole po dotknięciu NIE krzyczy o złym kształcie", () => {
    // Wolontariusz, który tylko kliknął w pole i poszedł po kod, nie ma
    // powodu widzieć czerwonego zdania - błąd dotyczy treści, nie pustki.
    mount();

    fireEvent.blur(tokenInput());

    expect(screen.queryByText("eventScanner.pairing.invalidToken")).toBeNull();
    expect(tokenInput()).toHaveAttribute("aria-invalid", "false");
  });

  it("zły kształt widać dopiero po dotknięciu pola, nie w trakcie pisania od zera", () => {
    // `touched` włącza się na `blur` albo na próbie wysyłki. Bez tego pierwsza
    // wpisana litera świeciłaby na czerwono przez cały czas wpisywania kodu.
    mount();

    fireEvent.change(tokenInput(), { target: { value: "n" } });

    expect(screen.queryByText("eventScanner.pairing.invalidToken")).toBeNull();

    fireEvent.blur(tokenInput());

    expect(screen.getByText("eventScanner.pairing.invalidToken")).toBeInTheDocument();
  });
});

describe("ScannerPairingCard - parowanie kodem", () => {
  it("poprawny kod paruje urządzenie", () => {
    const { props } = mount();

    fireEvent.change(tokenInput(), { target: { value: TOKEN } });
    submitForm();

    expect(props.onConnect).toHaveBeenCalledExactlyOnceWith(TOKEN);
    expect(screen.queryByText("eventScanner.pairing.invalidToken")).toBeNull();
  });

  it("białe znaki z wklejenia NIE jadą do bramki", () => {
    // Kod z panelu bywa kopiowany razem ze spacją i końcem wiersza. Baza
    // porównuje poświadczenie co do znaku, więc obcięcie musi zdarzyć się tu.
    const { props } = mount();

    fireEvent.change(tokenInput(), { target: { value: `  ${TOKEN}\n` } });
    submitForm();

    expect(props.onConnect).toHaveBeenCalledExactlyOnceWith(TOKEN);
  });

  it("łączenie w toku NIE wypuszcza drugiego żądania", () => {
    // Czytnik sprzętowy potrafi wysłać Enter dwa razy, a niecierpliwy
    // operator dokłada trzeci. Każde z nich to osobny `bootstrap`.
    const { props } = mount({ connecting: true });

    fireEvent.change(tokenInput(), { target: { value: TOKEN } });
    submitForm();

    expect(props.onConnect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /eventScanner.pairing.connecting/ })).toBeDisabled();
  });
});

describe("ScannerPairingCard - co czyta operator przy bramce", () => {
  it("odmowa bramki ląduje jako ZDANIE, a nie jako klucz błędu", () => {
    // `error` przychodzi z bramki jako surowa głowa odmowy; ekran ma
    // powiedzieć, co zrobić w piętnaście sekund.
    mount({ error: "device_revoked" });

    expect(screen.getByText(DEVICE_REVOKED_PL)).toBeInTheDocument();
  });

  it("zły kształt kodu PRZYKRYWA starą odmowę bramki", () => {
    // Kolejność jest celowa: po urwanym kodzie operator ma poprawić wklejenie,
    // a nie iść do organizatora po nowe poświadczenie.
    mount({ error: "device_revoked" });

    fireEvent.change(tokenInput(), { target: { value: "za-krotki" } });
    submitForm();

    expect(screen.getByText("eventScanner.pairing.invalidToken")).toBeInTheDocument();
    expect(screen.queryByText(DEVICE_REVOKED_PL)).toBeNull();
  });

  it("brak sieci mówi, że PIERWSZE podłączenie i tak go wymaga", () => {
    // Bez tego zdania wolontariusz bez zasięgu wpisywałby kod w kółko.
    mount({ online: false });

    expect(screen.getByText("eventScanner.pairing.offlineFirstRun")).toBeInTheDocument();
  });

  it("ekran mówi, SKĄD wziąć kod - ścieżka w panelu jest treścią, nie dokumentacją", () => {
    mount();

    expect(screen.getByRole("heading", { name: "eventScanner.pairing.title" })).toBeInTheDocument();
    expect(screen.getByText("eventScanner.pairing.help")).toBeInTheDocument();
  });

  it("pole kodu nie podpowiada, nie poprawia i nie zapamiętuje poświadczenia", () => {
    // Autouzupełnianie przeglądarki zostawiłoby poświadczenie w profilu
    // urządzenia, a autokorekta potrafi zmienić znak w kodzie base64url.
    mount();
    const input = tokenInput();

    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("autocapitalize", "off");
    expect(input).toHaveAttribute("autocorrect", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
  });
});

describe("ScannerPairingCard - dostępność", () => {
  it("ekran parowania z komunikatem błędu nie ma naruszeń axe", async () => {
    const { container } = mount({ error: "device_revoked", online: false });

    fireEvent.change(tokenInput(), { target: { value: "za-krotki" } });
    submitForm();

    expect(await axeViolations(container).then(summarize)).toBe("");
  });
});
