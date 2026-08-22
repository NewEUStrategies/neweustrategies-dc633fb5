// GuestCheckoutGate: TRZECIE wejście do logowania w tej aplikacji.
//
// DLACZEGO TEN PLIK POWSTAJE. Audyt pokrycia opisał obszar jako "portal
// logowania (hasło, magic link)", ale wyliczył go PO NAZWACH PLIKÓW - trasa
// `/login`, popup, szyna zdarzeń, portal - i przez to zgubił jedyne miejsce
// w całym repo, które faktycznie wysyła MAGIC LINK
// (`supabase.auth.signInWithOtp` z `shouldCreateUser: true`). Ten sam błąd
// metody (zakres po nazwach plików, nie po ścieżkach użytkownika) wcześniej
// zgubił drugą implementację importu WordPressa i panel SEO admina.
//
// DLACZEGO STAWKA JEST TU WYŻSZA NIŻ PRZY ZWYKŁYM FORMULARZU. Ta bramka stoi
// PRZED PŁATNOŚCIĄ - `src/routes/checkout.$planId.tsx:149` owija nią cały
// checkout. Jeśli wysyłka linku milczy albo komunikat o błędzie nie dojdzie,
// gość NIE MOŻE ZAPŁACIĆ i nie ma pojęcia dlaczego: awaria wygląda dla niego
// jak brak funkcji, nie jak awaria. Sprzedaż nie kończy się błędem, tylko
// ciszą - a cisza nie trafia do żadnego zgłoszenia.
//
// STAN ZMIERZONY PRZED TYM PLIKIEM: statements 51,72%, branches 42,85%,
// FUNCTIONS 20% (1 z 5), lines 51,85% (14/27). Niepokryte były linie 75-94,
// czyli CAŁA funkcja `submit()` - dokładnie ścieżka magic linka - oraz 133-143,
// czyli handlery `onChange` obu pól.
//
// UWAGA O `catch` BEZ PARAMETRU (GuestCheckoutGate.tsx:91). Prawdziwa treść
// błędu z Supabase NIE dociera do użytkownika - zawsze widzi ogólne `c.error`.
// Traktujemy to jako ŚWIADOMĄ decyzję (nie wystawiamy surowej odpowiedzi
// serwera na ekranie płatności), więc test asertuje właśnie komunikat ogólny
// ORAZ to, że surowa treść nie wyciekła - żeby regresja w drugą stronę
// (wyciek "AuthApiError: rate limit exceeded" na ekran zakupu) była widoczna.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import type { RouterLinkStubProps } from "@/test/routerLinkStub";

/** Kształt jedynego argumentu, jaki bramka przekazuje do `signInWithOtp`. */
interface OtpArgs {
  email: string;
  options?: {
    shouldCreateUser?: boolean;
    emailRedirectTo?: string;
    data?: { full_name: string };
  };
}

/** Kształt odpowiedzi `signInWithOtp` w części, z której korzysta bramka. */
interface OtpResult {
  error: { message: string } | null;
}

const h = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  loading: false,
  // Świadomie `string`, nie `AppLang`: chcemy dowieść zachowania gałęzi
  // `lang === "en" ? "en" : "pl"` także dla wartości, której typ nie
  // przewiduje (np. locale doklejone w przyszłości).
  lang: "pl" as string,
  signInWithOtp: vi.fn<(args: OtpArgs) => Promise<OtpResult>>(),
  toastError: vi.fn<(message: string) => void>(),
  linkProps: [] as RouterLinkStubProps[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signInWithOtp: h.signInWithOtp } },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: h.session,
    user: h.session?.user ?? null,
    roles: [],
    tenantId: null,
    loading: h.loading,
    isStaff: false,
    isAdmin: false,
    isSuperAdmin: false,
    signOut: async () => {},
  }),
}));
vi.mock("sonner", () => ({ toast: { error: h.toastError } }));
vi.mock("@/lib/i18n/useLang", () => ({ useLang: () => h.lang }));
// `Link` czyta kontekst routera i bez `RouterProvider` rzuca. Wspólna atrapa
// daje dostępny `<a href>`, a opakowanie zapisuje propsy - bo `search` nigdy
// nie ląduje w DOM, a to ono decyduje, w jakim trybie otworzy się `/login`.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...actual,
    Link: (props: RouterLinkStubProps) => {
      h.linkProps.push(props);
      return <RouterLinkStub {...props} />;
    },
  };
});

import { GuestCheckoutGate } from "@/components/checkout/GuestCheckoutGate";

// Napisy: stała `COPY` w module produkcyjnym NIE jest eksportowana, więc
// asertujemy na literałach. Świadomie nie zmieniamy produkcji, żeby ją
// wyeksportować - to byłaby zmiana poza zakresem zadania.
const PL = {
  title: "Dokończ zakup",
  lead: "Zaloguj się albo utwórz konto e-mailem - potrzebujemy go, żeby przypisać zamówienie, dostęp i fakturę.",
  signIn: "Mam konto - zaloguj się",
  orGuest: "Kontynuuj jako gość",
  email: "Adres e-mail",
  name: "Imię i nazwisko",
  send: "Wyślij link i wróć do zakupu",
  sent: "Sprawdź skrzynkę - wysłaliśmy link. Po kliknięciu wrócisz na tę stronę i dokończysz płatność.",
  invalid: "Podaj poprawny adres e-mail.",
  error: "Nie udało się wysłać linku. Spróbuj ponownie.",
} as const;

const EN = {
  title: "Complete your purchase",
  lead: "Sign in or create an account with your email - we need it to attach the order, access and invoice.",
  signIn: "I have an account - sign in",
  orGuest: "Continue as guest",
  email: "Email address",
  name: "Full name",
  send: "Email me a link and return to checkout",
  sent: "Check your inbox - we sent a link. Opening it brings you back here to finish the payment.",
  invalid: "Enter a valid email address.",
  error: "We could not send the link. Please try again.",
} as const;

const CHILD_TEXT = "PŁATNOŚĆ-W-ŚRODKU";

beforeEach(() => {
  cleanup();
  h.session = null;
  h.loading = false;
  h.lang = "pl";
  h.signInWithOtp.mockReset().mockResolvedValue({ error: null });
  h.toastError.mockReset();
  h.linkProps.length = 0;
});

/** Odpal mikrozadania po interakcji - `submit()` jest asynchroniczne. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function renderGate() {
  return render(
    <GuestCheckoutGate>
      <p>{CHILD_TEXT}</p>
    </GuestCheckoutGate>,
  );
}

function emailInput() {
  return screen.getByLabelText(PL.email);
}

function nameInput() {
  return screen.getByLabelText(PL.name);
}

function sendButton() {
  return screen.getByRole("button", { name: PL.send });
}

/** Ostatnie wywołanie `signInWithOtp` - rzuca, gdy nie było żadnego. */
function lastOtpArgs(): OtpArgs {
  const call = h.signInWithOtp.mock.calls.at(-1);
  if (!call) throw new Error("signInWithOtp nie zostało wywołane");
  return call[0];
}

/** Wypełnij adres (i opcjonalnie imię) i wyślij link. */
async function submitWith(email: string, fullName?: string) {
  if (fullName !== undefined) fireEvent.change(nameInput(), { target: { value: fullName } });
  fireEvent.change(emailInput(), { target: { value: email } });
  fireEvent.click(sendButton());
  await flush();
}

describe("GuestCheckoutGate - trzy stany bramki", () => {
  it("loading: spinner, BRAK formularza i BRAK dzieci", () => {
    h.loading = true;
    renderGate();
    expect(screen.getByLabelText("loading")).toBeInTheDocument();
    expect(screen.queryByLabelText(PL.email)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: PL.send })).not.toBeInTheDocument();
    expect(screen.queryByText(CHILD_TEXT)).not.toBeInTheDocument();
  });

  it("sesja obecna: renderuje DZIECI i NIE renderuje formularza bramki", () => {
    // Kontrakt bramki: zalogowany kupujący nie może zobaczyć ekranu logowania
    // w środku ścieżki płatności.
    h.session = { user: { id: "u-1" } };
    renderGate();
    expect(screen.getByText(CHILD_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(PL.title)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(PL.email)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: PL.signIn })).not.toBeInTheDocument();
  });

  it("brak sesji i loading=false: formularz bramki, dzieci NIE renderowane", () => {
    renderGate();
    expect(screen.getByText(PL.title)).toBeInTheDocument();
    expect(screen.getByText(PL.lead)).toBeInTheDocument();
    expect(screen.getByText(PL.orGuest)).toBeInTheDocument();
    expect(emailInput()).toBeInTheDocument();
    expect(nameInput()).toBeInTheDocument();
    expect(sendButton()).toBeInTheDocument();
    expect(screen.queryByText(CHILD_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("loading")).not.toBeInTheDocument();
  });
});

describe("GuestCheckoutGate - walidacja adresu PRZED wysyłką", () => {
  // Stan "nie wypełniłeś" musi być odróżnialny od "serwer odmówił": przy
  // odrzuceniu lokalnym do Supabase nie leci ŻADNE żądanie, więc gość nie
  // czeka na list, który nigdy nie zostanie wysłany.
  const rejected: readonly (readonly [string, string])[] = [
    ["pusty", ""],
    ["tylko biały znak", "   "],
    ["bez @", "jan"],
    ["@ bez domeny", "jan@"],
    ["bez kropki i TLD", "jan@example"],
    ["TLD jednoznakowy", "jan@example.p"],
    ["spacja w środku", "jan @example.pl"],
    ["podwójna małpa", "jan@@example.pl"],
  ];

  it.each(rejected)("odrzuca adres (%s): toast i zero żądań", async (_opis, value) => {
    renderGate();
    await submitWith(value);
    expect(h.toastError).toHaveBeenCalledWith(PL.invalid);
    expect(h.signInWithOtp).not.toHaveBeenCalled();
    expect(screen.queryByText(PL.sent)).not.toBeInTheDocument();
  });

  const accepted: readonly (readonly [string, string, string])[] = [
    ["zwykły", "jan@example.pl", "jan@example.pl"],
    ["TLD dwuznakowy", "jan@example.co", "jan@example.co"],
    ["poddomena", "jan@mail.example.com", "jan@mail.example.com"],
    ["otaczające spacje", "  jan@example.pl  ", "jan@example.pl"],
  ];

  it.each(accepted)(
    "przyjmuje adres (%s) i wysyła wartość PO trim()",
    async (_opis, typed, expected) => {
      renderGate();
      await submitWith(typed);
      expect(h.toastError).not.toHaveBeenCalled();
      expect(h.signInWithOtp).toHaveBeenCalledTimes(1);
      expect(lastOtpArgs().email).toBe(expected);
    },
  );

  it("adres z WIELKIMI LITERAMI idzie do Supabase bez zmiany wielkości znaków", async () => {
    // Stan faktyczny, nie życzenie: produkcja robi wyłącznie `trim()`, żadnej
    // normalizacji `toLowerCase()` tu nie ma. Zapisujemy to jawnie, żeby
    // ewentualna przyszła normalizacja była świadomą zmianą, a nie skutkiem
    // ubocznym - Supabase i tak porównuje adresy bez wielkości znaków.
    renderGate();
    await submitWith("Jan@Example.PL");
    expect(lastOtpArgs().email).toBe("Jan@Example.PL");
  });
});

describe("GuestCheckoutGate - ścieżka magic linka", () => {
  it("sukces: pełny kształt żądania do signInWithOtp, pole po polu", async () => {
    renderGate();
    await submitWith("jan@example.pl", "Jan Kowalski");

    const args = lastOtpArgs();
    expect(h.signInWithOtp).toHaveBeenCalledTimes(1);
    expect(args.email).toBe("jan@example.pl");
    // Bez `shouldCreateUser: true` gość BEZ konta nie dostanie żadnego listu -
    // Supabase odmawia wysyłki nieznanemu adresowi, a bramka nie ma czym
    // założyć właściciela zamówienia.
    expect(args.options?.shouldCreateUser).toBe(true);
    // Bez `emailRedirectTo` kliknięcie linku ląduje na stronie startowej,
    // nie w koszyku - czyli zakup porzucony po poprawnym logowaniu.
    expect(args.options?.emailRedirectTo).toBe(window.location.href);
    expect(args.options?.data).toEqual({ full_name: "Jan Kowalski" });
  });

  it("po sukcesie: ekran potwierdzenia z aria-live, a formularz ZNIKA", async () => {
    renderGate();
    await submitWith("jan@example.pl");

    const confirmation = await screen.findByText(PL.sent);
    expect(confirmation).toHaveAttribute("aria-live", "polite");
    // Formularza już nie ma, więc nie da się wysłać drugiego listu.
    expect(screen.queryByLabelText(PL.email)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(PL.name)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: PL.send })).not.toBeInTheDocument();
  });

  it("pole imienia wypełnione: options.data to full_name PO trim()", async () => {
    renderGate();
    await submitWith("jan@example.pl", "  Jan Kowalski  ");
    expect(lastOtpArgs().options?.data).toEqual({ full_name: "Jan Kowalski" });
  });

  it("pole imienia puste: options.data jest undefined", async () => {
    renderGate();
    await submitWith("jan@example.pl");
    expect(lastOtpArgs().options?.data).toBeUndefined();
  });

  it("pole imienia z samych spacji: options.data jest undefined", async () => {
    renderGate();
    await submitWith("jan@example.pl", "    ");
    expect(lastOtpArgs().options?.data).toBeUndefined();
  });
});

describe("GuestCheckoutGate - awaria wysyłki linku", () => {
  it("zwrócony error: ogólny komunikat, brak potwierdzenia, formularz wraca do użycia z ADRESEM", async () => {
    h.signInWithOtp.mockResolvedValue({ error: { message: "AuthApiError: rate limit exceeded" } });
    renderGate();
    await submitWith("jan@example.pl", "Jan Kowalski");

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(PL.error));
    // Surowa treść z Supabase nie wychodzi na ekran płatności (patrz nagłówek
    // pliku: `catch` bez parametru to decyzja, nie przeoczenie).
    expect(h.toastError).not.toHaveBeenCalledWith("AuthApiError: rate limit exceeded");
    expect(screen.queryByText(PL.sent)).not.toBeInTheDocument();
    // Człowiek musi móc kliknąć ponownie i NIE wpisywać adresu od nowa.
    expect(sendButton()).not.toBeDisabled();
    expect(emailInput()).toHaveValue("jan@example.pl");
    expect(nameInput()).toHaveValue("Jan Kowalski");
  });

  it("rzucony wyjątek (brak sieci): ta sama ścieżka catch, ten sam ogólny komunikat", async () => {
    h.signInWithOtp.mockRejectedValue(new Error("Failed to fetch"));
    renderGate();
    await submitWith("jan@example.pl");

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(PL.error));
    expect(h.toastError).not.toHaveBeenCalledWith("Failed to fetch");
    expect(screen.queryByText(PL.sent)).not.toBeInTheDocument();
    expect(sendButton()).not.toBeDisabled();
    expect(emailInput()).toHaveValue("jan@example.pl");
  });

  it("podwójne kliknięcie wysyła DOKŁADNIE jedno żądanie", async () => {
    // Sterowany, nierozstrzygnięty promise - żadnych timerów, żadnego zegara.
    let release: (result: OtpResult) => void = () => {};
    h.signInWithOtp.mockImplementation(
      () =>
        new Promise<OtpResult>((resolve) => {
          release = resolve;
        }),
    );
    renderGate();
    fireEvent.change(emailInput(), { target: { value: "jan@example.pl" } });

    fireEvent.click(sendButton());
    await flush();
    expect(sendButton()).toBeDisabled();
    fireEvent.click(sendButton());
    await flush();

    expect(h.signInWithOtp).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ error: null });
      await Promise.resolve();
    });
    expect(await screen.findByText(PL.sent)).toBeInTheDocument();
  });
});

describe("GuestCheckoutGate - druga ścieżka: konto już istnieje", () => {
  it("przycisk logowania prowadzi na /login z search { mode: signin }", async () => {
    renderGate();
    const link = screen.getByRole("link", { name: PL.signIn });
    expect(link).toHaveAttribute("href", "/login");
    // `search` nie trafia do DOM, a właśnie ono ustawia tryb formularza na
    // logowanie zamiast rejestracji. To jedyne połączenie tej bramki z trasą
    // `/login`: jeśli się urwie, gość Z KONTEM nie ma jak wejść w checkoucie.
    const props = h.linkProps.find((p) => p.to === "/login");
    expect(props).toBeDefined();
    expect(props?.search).toEqual({ mode: "signin" });
  });

  it("po wysłaniu linku wejście dla posiadaczy konta nadal istnieje", async () => {
    renderGate();
    await submitWith("jan@example.pl");
    expect(await screen.findByText(PL.sent)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: PL.signIn })).toHaveAttribute("href", "/login");
  });
});

describe("GuestCheckoutGate - dwujęzyczność", () => {
  it("lang=en: wszystkie napisy bramki po angielsku", () => {
    h.lang = "en";
    renderGate();
    expect(screen.getByText(EN.title)).toBeInTheDocument();
    expect(screen.getByText(EN.lead)).toBeInTheDocument();
    expect(screen.getByText(EN.orGuest)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: EN.signIn })).toBeInTheDocument();
    expect(screen.getByLabelText(EN.email)).toBeInTheDocument();
    expect(screen.getByLabelText(EN.name)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: EN.send })).toBeInTheDocument();
    expect(screen.queryByText(PL.title)).not.toBeInTheDocument();
  });

  it("lang=en: walidacja i potwierdzenie też po angielsku", async () => {
    h.lang = "en";
    renderGate();
    fireEvent.click(screen.getByRole("button", { name: EN.send }));
    await flush();
    expect(h.toastError).toHaveBeenCalledWith(EN.invalid);

    fireEvent.change(screen.getByLabelText(EN.email), { target: { value: "jan@example.pl" } });
    fireEvent.click(screen.getByRole("button", { name: EN.send }));
    expect(await screen.findByText(EN.sent)).toBeInTheDocument();
  });

  it("lang=pl: napisy po polsku", () => {
    renderGate();
    expect(screen.getByText(PL.title)).toBeInTheDocument();
    expect(screen.queryByText(EN.title)).not.toBeInTheDocument();
  });

  it("lang inny niż en spada na polski", () => {
    // Gałąź `lang === "en" ? "en" : "pl"` - domyślnie polski, nigdy pusty
    // ekran, także dla locale, którego dziś nie ma w typie.
    h.lang = "de";
    renderGate();
    expect(screen.getByText(PL.title)).toBeInTheDocument();
    expect(screen.queryByText(EN.title)).not.toBeInTheDocument();
  });
});

describe("GuestCheckoutGate - dostępność", () => {
  it("stan formularza: brak naruszeń axe", async () => {
    const { container } = renderGate();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("stan po wysyłce linku: brak naruszeń axe", async () => {
    const { container } = renderGate();
    await submitWith("jan@example.pl");
    expect(await screen.findByText(PL.sent)).toBeInTheDocument();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

// ─── DEFEKTY PRODUKCYJNE (zgłoszenie, NIE naprawa) ───────────────────────────

describe("GuestCheckoutGate - defekty zgłoszone", () => {
  it.fails("odrzucony adres powinien oznaczyć POLE, nie tylko pokazać toast", async () => {
    // CO JEST ZEPSUTE: `submit()` przy złym adresie woła wyłącznie
    // `toast.error(c.invalid)`. `FloatingInput` przyjmuje `error` i wystawia
    // `aria-invalid` oraz `aria-describedby`, ale bramka tego nie używa.
    // CO WIDZI UŻYTKOWNIK: znikający po kilku sekundach komunikat nad
    // ekranem, a pole z błędnym adresem wygląda dalej poprawnie. Osoba
    // z czytnikiem ekranu albo powiększeniem może nie zauważyć toastu wcale -
    // klika "Wyślij" w pętli i nie dowiaduje się, że problem jest w adresie,
    // ani w którym z dwóch pól.
    renderGate();
    await submitWith("jan@example");
    expect(emailInput()).toHaveAttribute("aria-invalid", "true");
  });

  it.fails("Enter w polu adresu powinien wysyłać link", async () => {
    // CO JEST ZEPSUTE: pola i przycisk nie są opakowane w `<form>`, a przycisk
    // nie jest `type="submit"` - nie ma żadnej obsługi klawisza Enter.
    // CO WIDZI UŻYTKOWNIK: wpisuje adres, naciska Enter (odruch przy każdym
    // formularzu w sieci) i NIC się nie dzieje - żaden list, żaden komunikat.
    // W tym miejscu ścieżki, tuż przed płatnością, cisza jest najgorszą
    // z możliwych odpowiedzi: wygląda jak zepsuta strona sklepu.
    renderGate();
    fireEvent.change(emailInput(), { target: { value: "jan@example.pl" } });
    fireEvent.keyDown(emailInput(), { key: "Enter", code: "Enter" });
    await flush();
    expect(h.signInWithOtp).toHaveBeenCalledTimes(1);
  });
});
