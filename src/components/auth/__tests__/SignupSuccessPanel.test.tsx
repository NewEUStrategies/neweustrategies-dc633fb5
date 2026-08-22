// Ekran po rejestracji konta - jedyne miejsce, w którym człowiek dowiaduje się,
// że konto NIE JEST jeszcze aktywne.
//
// CO TEN PLIK DOWODZI. `SignupSuccessPanel` jest ostatnim krokiem rejestracji.
// Jeśli przestanie działać, użytkownik wychodzi z formularza przekonany, że ma
// konto, a linku aktywacyjnego nigdy nie kliknie - czyli konto istnieje, ale
// nie da się na nie zalogować, a przy kolejnej próbie rejestracji dostanie
// „adres już zajęty”. Dowodzimy czterech rzeczy:
//
//   1. KOMUNIKAT O POTWIERDZENIU ADRESU jest na ekranie zawsze i jest przypięty
//      do JĘZYKA POPUPU (`lng`), nie do aktywnego języka interfejsu - podgląd
//      w adminie renderuje obie wersje obok siebie, a osoba rejestrująca się na
//      stronie EN nie może dostać polskiego zdania „potwierdź rejestrację”.
//   2. ADRES DOCELOWY jest pokazany, gdy jest znany, i nie zostawia puste
//      miejsce, gdy go nie ma. To adres, na który człowiek ma zaraz zajrzeć.
//   3. PONOWNE WYSŁANIE działa, jest jednorazowe (nie da się go klikać w pętli)
//      i przechodzi przez `supabase.auth.resend` z właściwym typem `signup`
//      oraz adresem powrotu - zły `emailRedirectTo` wyrzuca człowieka po
//      kliknięciu linku na obcą stronę.
//   4. AWARIA PONOWIENIA MA WŁASNY KOMUNIKAT i pozwala spróbować jeszcze raz.
//      Cicha porażka to najgorszy możliwy wynik: człowiek czeka na wiadomość,
//      która nie przyjdzie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - SAMEGO FORMULARZA REJESTRACJI (walidacja pól, honeypot, zapis na listę):
//   `PopupSignupForm` jest właścicielem tej logiki; tutaj wchodzimy dopiero po
//   przejściu w stan sukcesu.
// - REJESTRU PÓL I METADANYCH KONTA:
//   `src/lib/auth/__tests__/registrationFields.test.ts`.
// - PORTALU LOGOWANIA I ŚCIEŻKI HASŁA:
//   `src/components/auth/__tests__/AuthPortal.test.tsx`,
//   `src/routes/__tests__/resetPasswordRoute.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";

/** Odpowiedź `supabase.auth.resend` w kształcie, który czyta komponent. */
interface ResendResult {
  error: { message: string } | null;
}

const h = vi.hoisted(() => ({
  /** Argumenty każdego wywołania `auth.resend` - dowód na kształt żądania. */
  calls: [] as unknown[],
  /** `null` = zwróć sukces natychmiast; inaczej wynik podany przez test. */
  result: null as null | { error: { message: string } | null },
  /** `true` = rzuć wyjątkiem (awaria transportu, nie odpowiedź serwera). */
  throws: false,
  /** Gdy ustawione, wywołanie CZEKA, aż test je zwolni - bez timerów. */
  release: null as null | ((value: { error: { message: string } | null }) => void),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      resend: (args: unknown) => {
        h.calls.push(args);
        if (h.throws) return Promise.reject(new Error("brak połączenia"));
        if (h.release !== null) {
          return new Promise<{ error: { message: string } | null }>((resolve) => {
            h.release = resolve;
          });
        }
        return Promise.resolve(h.result ?? { error: null });
      },
    },
  },
}));

import { SignupSuccessPanel } from "@/components/auth/SignupSuccessPanel";

/** RODO: adres i adres powrotu wyłącznie w domenach testowych. */
const EMAIL = "nowe.konto@example.com";
const REDIRECT = "https://example.org/potwierdzenie";

/** Klucz w postaci, w jakiej widzi go asercja (atrapa i18n dokleja parametry). */
function key(name: string, lang: "pl" | "en" = "pl") {
  return `signupPopup.success.${name}(lng=${lang})`;
}

function resendButton() {
  return screen.getByRole("button", { name: key("resend") });
}

/** Zwolnienie wstrzymanego wywołania `resend` i domknięcie kolejki mikrozadań. */
async function releaseResend(result: ResendResult) {
  const resolve = h.release;
  expect(resolve).not.toBeNull();
  await act(async () => {
    resolve?.(result.error === null ? { error: null } : { error: result.error });
    await Promise.resolve();
  });
}

beforeEach(() => {
  h.calls = [];
  h.result = null;
  h.throws = false;
  h.release = null;
});

afterEach(() => {
  cleanup();
});

describe("SignupSuccessPanel - komunikat o potwierdzeniu adresu", () => {
  it("mówi wprost, że rejestracja wymaga kliknięcia linku, i pokazuje adres", () => {
    render(<SignupSuccessPanel email={EMAIL} lang="pl" />);
    expect(screen.getByText(key("title"))).toBeInTheDocument();
    expect(screen.getByText(key("body"))).toBeInTheDocument();
    expect(screen.getByText(key("spamHint"))).toBeInTheDocument();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
  });

  it("jest ogłoszony czytnikowi ekranu jako uprzejmy status, nie jako alarm", () => {
    // `role=status` + `aria-live=polite`: treść wjeżdża w miejsce formularza,
    // więc osoba korzystająca z czytnika musi ją usłyszeć bez przerywania.
    const { container } = render(<SignupSuccessPanel email={EMAIL} lang="pl" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(container.querySelector(".signup-success")).toBe(status);
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = render(<SignupSuccessPanel email={EMAIL} lang="pl" />);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("tłumaczenie jest przypięte do języka popupu, nie do języka interfejsu", () => {
    // Podgląd w adminie renderuje wersję PL i EN obok siebie, więc `lng` MUSI
    // być wymuszone jawnie przy każdym kluczu.
    render(<SignupSuccessPanel email={EMAIL} lang="en" />);
    expect(screen.getByText(key("title", "en"))).toBeInTheDocument();
    expect(screen.getByText(key("body", "en"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: key("resend", "en") })).toBeInTheDocument();
    expect(screen.queryByText(key("title"))).not.toBeInTheDocument();
  });

  it("bez znanego adresu nie renderuje pustego akapitu w miejscu adresu", () => {
    // Wariant osiągalny w produkcji: ścieżka honeypota w `PopupSignupForm`
    // przechodzi w stan sukcesu bez sprawdzenia adresu.
    const { container } = render(<SignupSuccessPanel email="" lang="pl" />);
    expect(container.querySelectorAll(".break-all")).toHaveLength(0);
    // Reszta komunikatu zostaje - człowiek nadal wie, że musi potwierdzić.
    expect(screen.getByText(key("title"))).toBeInTheDocument();
  });
});

describe("SignupSuccessPanel - ponowne wysłanie wiadomości", () => {
  it("wysyła ponowienie typu `signup` z adresem powrotu", async () => {
    render(<SignupSuccessPanel email={EMAIL} lang="pl" redirectTo={REDIRECT} />);
    await act(async () => {
      fireEvent.click(resendButton());
    });
    // Zły `type` wysyła wiadomość o odzysku hasła, a zły `emailRedirectTo`
    // wyrzuca człowieka po kliknięciu linku na obcy adres.
    expect(h.calls).toEqual([
      { type: "signup", email: EMAIL, options: { emailRedirectTo: REDIRECT } },
    ]);
  });

  it("bez adresu powrotu nie dokłada pustej opcji przekierowania", async () => {
    render(<SignupSuccessPanel email={EMAIL} lang="pl" />);
    await act(async () => {
      fireEvent.click(resendButton());
    });
    expect(h.calls).toEqual([{ type: "signup", email: EMAIL }]);
  });

  it("po sukcesie potwierdza wysłanie i nie da się kliknąć drugi raz", async () => {
    render(<SignupSuccessPanel email={EMAIL} lang="pl" />);
    await act(async () => {
      fireEvent.click(resendButton());
    });
    const button = screen.getByRole("button", { name: key("resendSent") });
    expect(button).toBeDisabled();
    // Blokada w pętli jest przedmiotem dowodu: klikanie „wyślij ponownie”
    // w kółko zamawia u dostawcy poczty tyle samo wiadomości i kończy się
    // limitem, po którym NIE PRZYCHODZI ŻADNA.
    fireEvent.click(button);
    expect(h.calls).toHaveLength(1);
  });

  it("w trakcie wysyłania pokazuje stan i blokuje przycisk", async () => {
    h.release = () => undefined;
    render(<SignupSuccessPanel email={EMAIL} lang="pl" />);
    await act(async () => {
      fireEvent.click(resendButton());
    });
    const pending = screen.getByRole("button", { name: key("resendSending") });
    expect(pending).toBeDisabled();
    // To jest jedyna dostępna z interfejsu ochrona przed podwójnym wysłaniem:
    // strażnik `resend === "sending"` w `onResend` (SignupSuccessPanel.tsx:31)
    // stoi ZA wyłączonym przyciskiem i jest już nieosiągalny.
    fireEvent.click(pending);
    expect(h.calls).toHaveLength(1);

    await releaseResend({ error: null });
    expect(screen.getByRole("button", { name: key("resendSent") })).toBeDisabled();
  });

  it("klik przy pustym adresie nie wychodzi do sieci", async () => {
    // Ta połowa zachowania jest poprawna: `resend` z pustym adresem to pewny
    // błąd API, więc żądanie nie ma prawa wyjść. Druga połowa - to, że przycisk
    // wygląda przy tym na aktywny i nie mówi nic - jest zgłoszona osobno
    // w sekcji „defekty” na dole pliku.
    render(<SignupSuccessPanel email="" lang="pl" />);
    await act(async () => {
      fireEvent.click(resendButton());
    });
    expect(h.calls).toEqual([]);
    expect(screen.queryByText(key("resendError"))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: key("resend") })).toBeInTheDocument();
  });

  it("odmowa serwera ma własny komunikat i pozwala spróbować jeszcze raz", async () => {
    h.result = { error: { message: "za szybko" } };
    render(<SignupSuccessPanel email={EMAIL} lang="pl" />);
    await act(async () => {
      fireEvent.click(resendButton());
    });
    expect(screen.getByText(key("resendError"))).toBeInTheDocument();
    // Po odmowie przycisk wraca do stanu wyjściowego - inaczej człowiek zostaje
    // z komunikatem o błędzie i bez żadnego wyjścia.
    const again = resendButton();
    expect(again).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(again);
    });
    expect(h.calls).toHaveLength(2);
  });

  it("awaria transportu jest obsłużona tym samym komunikatem, nie wyjątkiem", async () => {
    // Rzucony wyjątek (brak sieci) nie może wywalić całego popupu - wtedy
    // człowiek traci z ekranu także informację o potwierdzeniu adresu.
    h.throws = true;
    render(<SignupSuccessPanel email={EMAIL} lang="pl" />);
    await act(async () => {
      fireEvent.click(resendButton());
    });
    expect(screen.getByText(key("resendError"))).toBeInTheDocument();
    expect(screen.getByText(key("title"))).toBeInTheDocument();
  });

  it("udane ponowienie sprząta komunikat o poprzednim błędzie", async () => {
    h.result = { error: { message: "za szybko" } };
    render(<SignupSuccessPanel email={EMAIL} lang="pl" />);
    await act(async () => {
      fireEvent.click(resendButton());
    });
    expect(screen.getByText(key("resendError"))).toBeInTheDocument();

    h.result = { error: null };
    await act(async () => {
      fireEvent.click(resendButton());
    });
    expect(screen.queryByText(key("resendError"))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: key("resendSent") })).toBeDisabled();
  });
});

describe("SignupSuccessPanel - podgląd w panelu administratora", () => {
  it("w podglądzie przycisk jest wyłączony i nie wychodzi do sieci", () => {
    render(<SignupSuccessPanel email={EMAIL} lang="pl" redirectTo={REDIRECT} previewOnly />);
    const button = resendButton();
    expect(button).toBeDisabled();
    fireEvent.click(button);
    // Podgląd w adminie nie może zamawiać prawdziwych wiadomości na adres,
    // który redaktor akurat wpisał w pole przykładowe.
    expect(h.calls).toEqual([]);
  });

  it("poza podglądem przycisk jest aktywny od razu - domyślna wartość propsa", () => {
    render(<SignupSuccessPanel email={EMAIL} lang="pl" />);
    expect(resendButton()).not.toBeDisabled();
  });

  it("podgląd nadal pokazuje pełną treść komunikatu", () => {
    render(<SignupSuccessPanel email={EMAIL} lang="pl" previewOnly />);
    expect(screen.getByText(key("title"))).toBeInTheDocument();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
  });
});

describe("SignupSuccessPanel - defekty", () => {
  it.fails("DEFEKT: bez znanego adresu przycisk ponowienia wygląda na aktywny i milczy", () => {
    // CO JEST NIE TAK: `SignupSuccessPanel.tsx:31` przerywa `onResend` przy
    // pustym adresie (`!email`), ale `disabled` w linii 90 sprawdza tylko
    // `previewOnly` i stan wysyłki. Przycisk zostaje aktywny, klik nie robi
    // nic i NIE USTAWIA nawet stanu błędu.
    // GDZIE: src/components/auth/SignupSuccessPanel.tsx:31 kontra :90.
    // JAK TO OSIĄGNĄĆ W PRODUKCJI: `PopupSignupForm.tsx:164-167` - ścieżka
    // honeypota (zgłoszenie szybsze niż 1200 ms) przechodzi w stan sukcesu
    // BEZ sprawdzenia adresu, więc panel dostaje `email=""`.
    // KONSEKWENCJA DLA UŻYTKOWNIKA: człowiek widzi „potwierdź rejestrację”,
    // nie widzi adresu, klika „wyślij link ponownie” i nie dostaje ani
    // wiadomości, ani błędu, ani potwierdzenia - żadnej informacji, że ta
    // droga jest zamknięta. Poprawne zachowanie: wyłączyć przycisk (albo
    // pokazać `resendError`), gdy adresu nie ma.
    render(<SignupSuccessPanel email="" lang="pl" />);
    const button = resendButton();
    expect(button).toBeDisabled();
  });
});
