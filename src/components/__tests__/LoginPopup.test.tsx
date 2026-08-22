// LoginPopup: BRAMKA CZTERECH AKCJI zastrzeżonych na powierzchni publicznej,
// nie ozdoba. `openLoginPopup()` wołają: useSaveArticle (zapis artykułu),
// FollowButton (obserwowanie kategorii/tagu), AuthorBusinessCard (obserwowanie
// autora), GuestLoginNudge oraz trasa /reading-list. Jeśli popup się nie
// otworzy - albo otworzy BEZ tekstu kontekstowego - gość nie może wykonać
// akcji i nie wie dlaczego; awaria wygląda dokładnie jak brak funkcji.
// Do 2026-08-22 ten plik miał ZERO testów.
//
// Konwencje jak w AuthPortal.test.tsx: cały stan mutowalny mocków w
// `vi.hoisted`, PRAWDZIWA instancja i18next (LoginPopup sam wciąga nakładkę
// `@/lib/i18n-public` efektem ubocznym importu), atrapa MfaChallenge zapisująca
// `onVerified`/`onCancel`.
//
// SZYNA `@/lib/loginPopupBus` JEST PRAWDZIWA (nie mockujemy jej) - dzięki temu
// testy „kontekstu akcji zastrzeżonej" montują REALNE komponenty wywołujące
// razem z popupem i mierzą to, czego test popupu w izolacji nie zmierzy:
// czy tekst z ustawień personalizacji faktycznie dojeżdża na ekran.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n, { ensureCoreLanguage } from "@/lib/i18n";
import { AUTH_DEFAULTS, type AuthSettings } from "@/lib/authSettings";
import {
  DEFAULT_PERSONALIZED_SETTINGS,
  type PersonalizedSettings,
} from "@/hooks/usePersonalizedSettings";
import { axeViolations, summarize } from "@/test/axe";

interface TestIdentity {
  session: { user: { id: string } } | null;
  user: { id: string } | null;
  loading: boolean;
}

const h = vi.hoisted(() => ({
  authState: { session: null, user: null, loading: false } as {
    session: { user: { id: string } } | null;
    user: { id: string } | null;
    loading: boolean;
  },
  navigate: vi.fn(),
  assign: vi.fn(),
  theme: "light" as "light" | "dark",
  toggleTheme: vi.fn(),
  settings: {} as AuthSettings,
  personalized: {} as PersonalizedSettings,
  guard: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  mfaRequired: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  mfaOnVerified: null as null | (() => void),
  mfaOnCancel: null as null | (() => void),
  followsData: [] as Array<{ target_type: string; target_id: string }>,
  followMutate: vi.fn(),
  bookmarksData: [] as Array<{ entity_type: string; entity_id: string }>,
  bookmarkMutate: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => h.navigate,
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.guard,
}));
// Token dla useServerFn - realny moduł ciągnie warstwę serwerową, której test
// komponentu nie potrzebuje.
vi.mock("@/lib/auth/bruteforce.functions", () => ({ preAuthGuard: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.authState }));
vi.mock("@/hooks/useAuthSettings", () => ({ useAuthSettings: () => h.settings }));
// `safeReadingListPath` (używane przez useSaveArticle) zostaje prawdziwe -
// podmieniamy wyłącznie hook czytający ustawienia z bazy.
vi.mock("@/hooks/usePersonalizedSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/usePersonalizedSettings")>()),
  usePersonalizedSettings: () => h.personalized,
}));
vi.mock("@/hooks/useFollows", () => ({
  useFollows: () => ({ data: h.followsData }),
  useToggleFollow: () => ({ mutate: h.followMutate, isPending: false }),
}));
vi.mock("@/hooks/useBookmarks", () => ({
  useBookmarks: () => ({ data: h.bookmarksData }),
  useToggleBookmark: () => ({ mutate: h.bookmarkMutate, isPending: false }),
}));
vi.mock("@/components/ThemeProvider", () => ({
  useTheme: () => ({ theme: h.theme, toggle: h.toggleTheme }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithPassword: (...a: unknown[]) => h.signIn(...a),
      signUp: (...a: unknown[]) => h.signUp(...a),
    },
  },
}));
vi.mock("@/lib/auth/mfa", () => ({ isMfaChallengeRequired: () => h.mfaRequired() }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/components/auth/MfaChallenge", () => ({
  MfaChallenge: (props: { open: boolean; onVerified: () => void; onCancel: () => void }) => {
    h.mfaOnVerified = props.onVerified;
    h.mfaOnCancel = props.onCancel;
    return props.open ? <div data-testid="mfa-challenge-stub" /> : null;
  },
}));

import { LoginPopup } from "@/components/LoginPopup";
import { openLoginPopup, type LoginPopupMode, type LoginPopupOptions } from "@/lib/loginPopupBus";
import { GuestLoginNudge } from "@/components/readingList/molecules/GuestLoginNudge";
import { FollowButton } from "@/components/FollowButton";
import { AuthorBusinessCard } from "@/components/post/AuthorBusinessCard";
import { useSaveArticle } from "@/hooks/useSaveArticle";

const t = (key: string) => i18n.t(key);

const EMAIL = "czytelnik@example.com";
const PASSWORD = "haslo1234";

/** Otwarcie popupu prawdziwą szyną - handler woła setState, więc act(). */
function openPopup(arg?: LoginPopupMode | LoginPopupOptions) {
  act(() => {
    openLoginPopup(arg);
  });
}

/** Przycisk wywołujący - potrzebny dla testów fokusu (Radix wymaga realnego triggera). */
function OpenPopupButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => openLoginPopup()}>
      {label}
    </button>
  );
}

const TRIGGER_LABEL = "otwórz logowanie";

function emailInput(): HTMLElement {
  return screen.getByLabelText("Email");
}

function passwordInput(): HTMLElement {
  return screen.getByLabelText(t("authForms.passwordLabel"));
}

/** Przycisk submitu formularza - etykieta zależy od trybu, języka i stanu `busy`. */
function submitButton(): HTMLButtonElement {
  const btn = document.querySelector<HTMLButtonElement>('form button[type="submit"]');
  if (!btn) throw new Error("brak przycisku submit w formularzu popupu");
  return btn;
}

/**
 * Nakładka tła (overlay) Radiksa. Portal wstawia overlay i treść jako
 * BEZPOŚREDNIE dzieci `document.body`, więc szukamy po klasie `inset-0`
 * (treść dialogu pozycjonuje się przez `left-[50%]`, nie `inset-0`).
 */
function overlay(): HTMLElement {
  const el = Array.from(document.body.children).find(
    (c) => c instanceof HTMLElement && c.classList.contains("inset-0"),
  );
  if (!(el instanceof HTMLElement)) throw new Error("brak nakładki tła dialogu");
  return el;
}

/**
 * Klik w tło. Dwie właściwości Radiksa, które to wymuszają:
 *  1. `usePointerDownOutside` odracza reakcję do zdarzenia `click`, więc SAM
 *     `pointerdown` nie zamyka - potrzebna jest para pointerdown + click,
 *     dokładnie jak w przeglądarce;
 *  2. nasłuch `pointerdown` dokłada się dopiero w `setTimeout(0)` po
 *     zamontowaniu warstwy (react-dismissable-layer), więc klik oddany w tym
 *     samym makrozadaniu, w którym popup się otworzył, jeszcze nie ma
 *     odbiorcy. Dlatego ponawiamy parę zdarzeń w `waitFor` - bez własnych
 *     timerów, z limitem czasu waitFor jako jedyną granicą.
 */
async function clickOverlay() {
  await waitFor(() => {
    const bg = overlay();
    fireEvent.pointerDown(bg);
    fireEvent.click(bg);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
}

function closeButton(): HTMLElement {
  // DialogPrimitive.Close nazywa się dostępnie przez <span class="sr-only">Close</span>.
  return screen.getByRole("button", { name: "Close" });
}

function fillSignin(email = EMAIL, password = PASSWORD) {
  fireEvent.change(emailInput(), { target: { value: email } });
  fireEvent.change(passwordInput(), { target: { value: password } });
}

/** Domyka kolejkę mikrozadań po asynchronicznym `submit()`. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Komponent-uchwyt dla hooka useSaveArticle (hook nie ma własnego UI). */
function SaveArticleHarness() {
  const { toggle } = useSaveArticle({
    entityId: "post-1",
    url: "/artykul-testowy",
    title: "Artykuł testowy",
    lang: "pl",
  });
  return (
    <button type="button" onClick={toggle}>
      zapisz artykuł
    </button>
  );
}

beforeAll(async () => {
  await Promise.all([ensureCoreLanguage("pl"), ensureCoreLanguage("en")]);
  await i18n.changeLanguage("pl");
});

beforeEach(() => {
  h.authState = { session: null, user: null, loading: false };
  h.navigate.mockClear();
  h.assign.mockClear();
  h.theme = "light";
  h.toggleTheme.mockClear();
  h.settings = { ...AUTH_DEFAULTS };
  h.personalized = { ...DEFAULT_PERSONALIZED_SETTINGS };
  h.guard.mockReset().mockResolvedValue({ ok: true });
  h.signIn.mockReset().mockResolvedValue({ error: null });
  h.signUp.mockReset().mockResolvedValue({ error: null });
  h.mfaRequired.mockReset().mockResolvedValue(false);
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.mfaOnVerified = null;
  h.mfaOnCancel = null;
  h.followsData = [];
  h.followMutate.mockClear();
  h.bookmarksData = [];
  h.bookmarkMutate.mockClear();
  // `window.location.assign` w happy-dom próbowałoby realnej nawigacji.
  vi.spyOn(window.location, "assign").mockImplementation((url: string | URL) => {
    h.assign(url);
  });
  window.localStorage.clear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("pl");
});

describe("LoginPopup - otwarcie i zamknięcie", () => {
  it("domyślnie jest zamknięty - żadnego dialogu ani pola e-mail w drzewie dostępności", () => {
    render(<LoginPopup />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("openLoginPopup() otwiera dialog z domyślnym nagłówkiem z ustawień", () => {
    render(<LoginPopup />);
    openPopup();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(AUTH_DEFAULTS.popup_heading_pl)).toBeInTheDocument();
    expect(emailInput()).toBeInTheDocument();
  });

  it("Escape zamyka popup i NIE liczy się jako próba logowania", async () => {
    render(<LoginPopup />);
    openPopup();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.guard).not.toHaveBeenCalled();
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("klik w tło (overlay) zamyka popup i NIE liczy się jako próba logowania", async () => {
    render(<LoginPopup />);
    openPopup();
    await clickOverlay();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.guard).not.toHaveBeenCalled();
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("przycisk zamknięcia zamyka popup i NIE liczy się jako próba logowania", async () => {
    render(<LoginPopup />);
    openPopup();
    fireEvent.click(closeButton());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.guard).not.toHaveBeenCalled();
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("wpisany e-mail nie wysyła niczego dopóki formularz nie zostanie zatwierdzony", () => {
    render(<LoginPopup />);
    openPopup();
    fillSignin();
    expect(h.guard).not.toHaveBeenCalled();
    expect(h.signIn).not.toHaveBeenCalled();
  });
});

describe("LoginPopup - kontekst akcji zastrzeżonej", () => {
  it("title/description z opcji trafiają na ekran zamiast tekstu generycznego", () => {
    render(<LoginPopup />);
    openPopup({ title: "Zapisz ten artykuł", description: "Konto pozwala wracać do tekstów." });
    expect(screen.getByText("Zapisz ten artykuł")).toBeInTheDocument();
    expect(screen.getByText("Konto pozwala wracać do tekstów.")).toBeInTheDocument();
    expect(screen.queryByText(AUTH_DEFAULTS.popup_heading_pl)).not.toBeInTheDocument();
    expect(screen.queryByText(AUTH_DEFAULTS.popup_description_pl)).not.toBeInTheDocument();
  });

  it("brak title/description: tekst domyślny z ustawień w wersji PL", () => {
    render(<LoginPopup />);
    openPopup();
    expect(screen.getByText(AUTH_DEFAULTS.popup_heading_pl)).toBeInTheDocument();
    expect(screen.getByText(AUTH_DEFAULTS.popup_description_pl)).toBeInTheDocument();
  });

  it("brak title/description przy języku EN: tekst domyślny w wersji EN", async () => {
    render(<LoginPopup />);
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    openPopup();
    expect(screen.getByText(AUTH_DEFAULTS.popup_heading_en)).toBeInTheDocument();
    expect(screen.getByText(AUTH_DEFAULTS.popup_description_en)).toBeInTheDocument();
    expect(screen.queryByText(AUTH_DEFAULTS.popup_heading_pl)).not.toBeInTheDocument();
  });

  it("sam title bez description: opis spada na tekst domyślny z ustawień", () => {
    render(<LoginPopup />);
    openPopup({ title: "Obserwuj autora" });
    expect(screen.getByText("Obserwuj autora")).toBeInTheDocument();
    expect(screen.getByText(AUTH_DEFAULTS.popup_description_pl)).toBeInTheDocument();
  });

  it("ponowne otwarcie bez opcji czyści poprzedni kontekst", async () => {
    render(<LoginPopup />);
    openPopup({ title: "Zapisz ten artykuł" });
    expect(screen.getByText("Zapisz ten artykuł")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    openPopup();
    expect(screen.getByText(AUTH_DEFAULTS.popup_heading_pl)).toBeInTheDocument();
    expect(screen.queryByText("Zapisz ten artykuł")).not.toBeInTheDocument();
  });
});

// Cztery REALNE wywołania z repo, każde z ROZPOZNAWALNIE różnym tekstem
// kontekstowym. Szyna `loginPopupBus` jest tu prawdziwa - to jedyny sposób
// dowiedzenia, że tekst z ustawień personalizacji dojeżdża na ekran popupu.
describe("LoginPopup - realne wywołania z repo (prawdziwa szyna loginPopupBus)", () => {
  it("GuestLoginNudge przekazuje swój title/description do popupu", () => {
    render(
      <>
        <GuestLoginNudge
          text="Zaloguj się, aby zobaczyć listę."
          title="Twoja lista do przeczytania"
          description="Zaloguj się, aby zobaczyć zapisane artykuły."
        />
        <LoginPopup />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: t("readingList.signIn") }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Twoja lista do przeczytania")).toBeInTheDocument();
    expect(screen.getByText("Zaloguj się, aby zobaczyć zapisane artykuły.")).toBeInTheDocument();
    expect(screen.queryByText(AUTH_DEFAULTS.popup_heading_pl)).not.toBeInTheDocument();
    expect(screen.queryByText(AUTH_DEFAULTS.popup_description_pl)).not.toBeInTheDocument();
  });

  it("FollowButton (gość klika 'obserwuj') pokazuje restrictedTitle z personalizacji", () => {
    h.personalized = {
      ...DEFAULT_PERSONALIZED_SETTINGS,
      restrictedTitle: "Obserwuj kategorię - potrzebne konto",
      restrictedDescription: "Zaloguj się, aby obserwować tę kategorię.",
    };
    render(
      <>
        <FollowButton targetType="category" targetId="cat-1" lang="pl" />
        <LoginPopup />
      </>,
    );
    // Przycisk obserwowania to jedyny element z `aria-pressed` na ekranie.
    fireEvent.click(screen.getByRole("button", { pressed: false }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Obserwuj kategorię - potrzebne konto")).toBeInTheDocument();
    expect(screen.getByText("Zaloguj się, aby obserwować tę kategorię.")).toBeInTheDocument();
    expect(screen.queryByText(AUTH_DEFAULTS.popup_heading_pl)).not.toBeInTheDocument();
    expect(screen.queryByText(AUTH_DEFAULTS.popup_description_pl)).not.toBeInTheDocument();
    // Gość nie może zmienić stanu obserwacji - popup zastępuje mutację.
    expect(h.followMutate).not.toHaveBeenCalled();
  });

  it("AuthorBusinessCard (gość klika 'obserwuj autora') pokazuje restrictedTitle z personalizacji", () => {
    h.personalized = {
      ...DEFAULT_PERSONALIZED_SETTINGS,
      restrictedTitle: "Obserwuj autora - potrzebne konto",
      restrictedDescription: "Zaloguj się, aby dostawać powiadomienia o publikacjach.",
    };
    render(
      <>
        <AuthorBusinessCard lang="pl" name="Anna Nowak" authorId="author-1" />
        <LoginPopup />
      </>,
    );
    // Wizytówka to <aside aria-label=...>, a jej jedyny przycisk to „obserwuj autora".
    const card = screen.getByRole("complementary");
    fireEvent.click(within(card).getByRole("button"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Obserwuj autora - potrzebne konto")).toBeInTheDocument();
    expect(
      screen.getByText("Zaloguj się, aby dostawać powiadomienia o publikacjach."),
    ).toBeInTheDocument();
    expect(screen.queryByText(AUTH_DEFAULTS.popup_heading_pl)).not.toBeInTheDocument();
    expect(screen.queryByText(AUTH_DEFAULTS.popup_description_pl)).not.toBeInTheDocument();
    expect(h.followMutate).not.toHaveBeenCalled();
  });

  it("useSaveArticle (gość zapisuje artykuł przy allowGuests=false) pokazuje restrictedTitle", () => {
    h.personalized = {
      ...DEFAULT_PERSONALIZED_SETTINGS,
      enabled: true,
      allowGuests: false,
      // 0 wyłącza wygaszanie wpisów gościa, więc hook nie sięga po Date.now().
      guestExpirationDays: 0,
      restrictedTitle: "Zapisz artykuł - potrzebne konto",
      restrictedDescription: "Zaloguj się, aby wrócić do tego tekstu na innym urządzeniu.",
    };
    render(
      <>
        <SaveArticleHarness />
        <LoginPopup />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "zapisz artykuł" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Zapisz artykuł - potrzebne konto")).toBeInTheDocument();
    expect(
      screen.getByText("Zaloguj się, aby wrócić do tego tekstu na innym urządzeniu."),
    ).toBeInTheDocument();
    expect(screen.queryByText(AUTH_DEFAULTS.popup_heading_pl)).not.toBeInTheDocument();
    expect(screen.queryByText(AUTH_DEFAULTS.popup_description_pl)).not.toBeInTheDocument();
    // Zapis nie trafił nigdzie - ani do bazy, ani do localStorage.
    expect(h.bookmarkMutate).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
  });
});

describe("LoginPopup - tryb", () => {
  it("openLoginPopup('signup') otwiera popup na rejestracji", () => {
    render(<LoginPopup />);
    openPopup("signup");
    expect(screen.getByLabelText(t("authForms.nameLabel"))).toBeInTheDocument();
    expect(submitButton()).toHaveTextContent(AUTH_DEFAULTS.signup_label_pl);
    expect(passwordInput()).toHaveAttribute("minlength", "8");
    expect(passwordInput()).toHaveAttribute("autocomplete", "new-password");
  });

  it("openLoginPopup({ mode: 'signup' }) otwiera popup na rejestracji", () => {
    render(<LoginPopup />);
    openPopup({ mode: "signup" });
    expect(screen.getByLabelText(t("authForms.nameLabel"))).toBeInTheDocument();
    expect(submitButton()).toHaveTextContent(AUTH_DEFAULTS.signup_label_pl);
  });

  it("openLoginPopup('signin') otwiera popup na logowaniu", () => {
    render(<LoginPopup />);
    openPopup("signin");
    expect(screen.queryByLabelText(t("authForms.nameLabel"))).not.toBeInTheDocument();
    expect(submitButton()).toHaveTextContent(AUTH_DEFAULTS.signin_label_pl);
    expect(passwordInput()).not.toHaveAttribute("minlength");
    expect(passwordInput()).toHaveAttribute("autocomplete", "current-password");
  });

  it('brak trybu w opcjach spada na logowanie (gałąź `opts.mode ?? "signin"`)', () => {
    render(<LoginPopup />);
    openPopup({ title: "Bez trybu" });
    expect(screen.queryByLabelText(t("authForms.nameLabel"))).not.toBeInTheDocument();
    expect(submitButton()).toHaveTextContent(AUTH_DEFAULTS.signin_label_pl);
  });

  it("przełącznik u dołu prowadzi z logowania na rejestrację i z powrotem", () => {
    render(<LoginPopup />);
    openPopup();
    fireEvent.click(screen.getByRole("button", { name: t("authForms.noAccount") }));
    expect(screen.getByLabelText(t("authForms.nameLabel"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("authForms.haveAccount") }));
    expect(screen.queryByLabelText(t("authForms.nameLabel"))).not.toBeInTheDocument();
  });

  it("allow_public_signup=false: przełącznika na rejestrację NIE MA", () => {
    h.settings.allow_public_signup = false;
    render(<LoginPopup />);
    openPopup();
    expect(
      screen.queryByRole("button", { name: t("authForms.noAccount") }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("authForms.haveAccount") }),
    ).not.toBeInTheDocument();
  });

  it("język EN: etykiety przycisku submitu pochodzą z pól *_en", async () => {
    render(<LoginPopup />);
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    openPopup("signin");
    expect(submitButton()).toHaveTextContent(AUTH_DEFAULTS.signin_label_en);
    fireEvent.click(screen.getByRole("button", { name: t("authForms.noAccount") }));
    expect(submitButton()).toHaveTextContent(AUTH_DEFAULTS.signup_label_en);
  });
});

describe("LoginPopup - błąd serwera ODRĘBNY od pustego formularza", () => {
  it("nieudane logowanie: komunikat błędu I ZOSTAWIONY wpisany adres e-mail", async () => {
    h.signIn.mockResolvedValue({ error: new Error("Invalid login credentials") });
    render(<LoginPopup />);
    openPopup();
    fillSignin("czytelnik@example.com");
    fireEvent.click(submitButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    // Człowiek nie może wpisywać adresu od nowa po odmowie serwera.
    expect(emailInput()).toHaveValue("czytelnik@example.com");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(h.toastSuccess).not.toHaveBeenCalled();
    // DA SIĘ PONOWIĆ PRÓBĘ. To jest właściwa treść tej grupy: bez
    // `setBusy(false)` w `finally` (LoginPopup.tsx:161-163) przycisk zostaje
    // NA ZAWSZE wyłączony z etykietą "…", więc jedna literówka w haśle
    // zamyka człowiekowi wejście do konta do przeładowania strony. Sam
    // komunikat błędu nie jest wtedy wart nic, bo nie ma czym po nim
    // spróbować - a testy mierzące WEJŚCIE w stan pracy tego nie łapią.
    await waitFor(() => expect(submitButton()).toBeEnabled());
    expect(submitButton()).toHaveTextContent(AUTH_DEFAULTS.signin_label_pl);
  });

  it("puste pola: natywne `required` blokuje wysłanie - żadnego żądania i żadnego komunikatu serwera", () => {
    render(<LoginPopup />);
    openPopup();
    expect(emailInput()).toBeRequired();
    expect(passwordInput()).toBeRequired();

    fireEvent.click(submitButton());

    expect(h.guard).not.toHaveBeenCalled();
    expect(h.signIn).not.toHaveBeenCalled();
    // Stan „nie wypełniłeś" MUSI być odróżnialny od „serwer odmówił".
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("wypełniony e-mail bez hasła: `required` nadal blokuje żądanie", () => {
    render(<LoginPopup />);
    openPopup();
    fireEvent.change(emailInput(), { target: { value: EMAIL } });
    fireEvent.click(submitButton());
    expect(h.guard).not.toHaveBeenCalled();
    expect(h.signIn).not.toHaveBeenCalled();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  // DEFEKT PRODUKCYJNY (LoginPopup.tsx:160). `toast.error(err instanceof Error
  // ? err.message : "Error")` wyrzuca na ekran SUROWY komunikat Supabase.
  // Polskojęzyczny gość przy JEDYNEJ bramie wejścia do konta widzi angielskie
  // „Invalid login credentials" - nie wie, czy pomylił hasło, czy usługa padła,
  // więc nie wie, co zrobić dalej. Zlecenie wymaga komunikatu Z KLUCZA i18n.
  // Produkcji NIE ZMIENIAMY - test opisuje kontrakt, którego brakuje.
  it.fails(
    "DEFEKT: odmowa logowania pokazuje surowy angielski komunikat Supabase, a nie klucz i18n",
    async () => {
      h.signIn.mockResolvedValue({ error: new Error("Invalid login credentials") });
      render(<LoginPopup />);
      openPopup();
      fillSignin();
      fireEvent.click(submitButton());
      await waitFor(() => expect(h.toastError).toHaveBeenCalled());
      // FORMA ODPORNA NA WYBÓR KLUCZA. Asercja `toHaveBeenCalledWith(
      // t("auth.invalidInput"))` przypięłaby zgłoszenie do JEDNEGO konkretnego
      // klucza: gdyby ktoś naprawił defekt, ale użył trafniejszego klucza
      // (np. `auth.signinFailed`), asercja NADAL by rzucała, `it.fails` NADAL
      // byłby zielony i nikt nie dowiedziałby się, że defekt zniknął.
      // Sformułowanie negatywne gaśnie po DOWOLNEJ naprawie.
      expect(h.toastError).not.toHaveBeenCalledWith("Invalid login credentials");
    },
  );

  it("stan faktyczny (regresja w drugą stronę): toast powtarza dosłownie komunikat Supabase", async () => {
    h.signIn.mockResolvedValue({ error: new Error("Invalid login credentials") });
    render(<LoginPopup />);
    openPopup();
    fillSignin();
    fireEvent.click(submitButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Invalid login credentials"));
  });

  // DRUGA POŁOWA TEGO SAMEGO DEFEKTU: odrzucenie wartością inną niż Error
  // (np. odrzucony string z warstwy transportowej) daje nieprzetłumaczony
  // literał „Error" - komunikat, który nie mówi użytkownikowi absolutnie nic.
  it.fails(
    "DEFEKT: odrzucenie wartością inną niż Error pokazuje nieprzetłumaczony literał 'Error'",
    async () => {
      h.guard.mockRejectedValue("transport-down");
      render(<LoginPopup />);
      openPopup();
      fillSignin();
      fireEvent.click(submitButton());
      await waitFor(() => expect(h.toastError).toHaveBeenCalled());
      expect(h.toastError).not.toHaveBeenCalledWith("Error");
    },
  );

  it("stan faktyczny: odrzucenie nie-Errorem daje literał 'Error', a signIn nie jest wołany", async () => {
    h.guard.mockRejectedValue("transport-down");
    render(<LoginPopup />);
    openPopup();
    fillSignin();
    fireEvent.click(submitButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Error"));
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("guard rate_limited: komunikat Z KLUCZA i18n (ta ścieżka jest poprawna)", async () => {
    h.guard.mockRejectedValue(new Error("auth: rate_limited"));
    render(<LoginPopup />);
    openPopup();
    fillSignin();
    fireEvent.click(submitButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(t("auth.rateLimited")));
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("guard invalid_input: komunikat Z KLUCZA i18n (ta ścieżka jest poprawna)", async () => {
    h.guard.mockRejectedValue(new Error("auth: invalid_input:email"));
    render(<LoginPopup />);
    openPopup();
    fillSignin();
    fireEvent.click(submitButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(t("auth.invalidInput")));
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("guard z nieznanym błędem przechodzi bez podmiany komunikatu", async () => {
    h.guard.mockRejectedValue(new Error("boom-nieoczekiwany"));
    render(<LoginPopup />);
    openPopup();
    fillSignin();
    fireEvent.click(submitButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("boom-nieoczekiwany"));
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("rejestracja przy allow_public_signup=false: komunikat Z KLUCZA, signUp nie wołany", async () => {
    h.settings.allow_public_signup = false;
    render(<LoginPopup />);
    openPopup("signup");
    fillSignin();
    fireEvent.click(submitButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(t("authForms.signupDisabled")));
    expect(h.signUp).not.toHaveBeenCalled();
  });
});

describe("LoginPopup - podwójne kliknięcie", () => {
  it("dwa kliki submitu pod rząd wysyłają DOKŁADNIE JEDNO żądanie logowania", async () => {
    const deferred: { resolve: (value: { error: Error | null }) => void } = {
      resolve: () => {},
    };
    h.signIn.mockImplementation(
      () =>
        new Promise<{ error: Error | null }>((resolve) => {
          deferred.resolve = resolve;
        }),
    );
    render(<LoginPopup />);
    openPopup();
    fillSignin();

    const submit = submitButton();
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(h.signIn).toHaveBeenCalledTimes(1));
    expect(h.guard).toHaveBeenCalledTimes(1);
    // `disabled={busy}` - przycisk pokazuje stan pracy zamiast etykiety.
    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveTextContent("…");

    await act(async () => {
      deferred.resolve({ error: null });
      await Promise.resolve();
    });
    expect(h.signIn).toHaveBeenCalledTimes(1);
  });
});

describe("LoginPopup - dostępność", () => {
  it("fokus WCHODZI do popupu po otwarciu (pierwsze pole formularza)", async () => {
    render(
      <>
        <OpenPopupButton label={TRIGGER_LABEL} />
        <LoginPopup />
      </>,
    );
    const trigger = screen.getByRole("button", { name: TRIGGER_LABEL });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    expect(emailInput()).toHaveFocus();
  });

  // DEFEKT DOSTĘPNOŚCI. Radix przywraca fokus po zamknięciu na `DialogTrigger`,
  // a LoginPopup otwiera się SZYNĄ ZDARZEŃ, bez triggera Radiksa (patrz
  // `onCloseAutoFocus` w @radix-ui/react-dialog: robi preventDefault i celuje w
  // `context.triggerRef`, który tu jest pusty). Skutek dla użytkownika
  // klawiatury: po zamknięciu popupu fokus przepada na <body>, więc czytnik
  // ekranu traci miejsce w dokumencie, a Tab startuje od początku strony -
  // przy przycisku „zapisz artykuł" w środku długiego tekstu to oznacza
  // przewijanie całej strony od nowa. To NIE jest ograniczenie happy-dom:
  // brak triggera jest własnością produkcyjnego kodu popupu.
  it.fails("DEFEKT: po zamknięciu popupu fokus NIE wraca na element wywołujący", async () => {
    render(
      <>
        <OpenPopupButton label={TRIGGER_LABEL} />
        <LoginPopup />
      </>,
    );
    const trigger = screen.getByRole("button", { name: TRIGGER_LABEL });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus(), { timeout: 300, interval: 50 });
  });

  it("stan faktyczny: po zamknięciu fokus ląduje na <body>, nie na wywołującym przycisku", async () => {
    render(
      <>
        <OpenPopupButton label={TRIGGER_LABEL} />
        <LoginPopup />
      </>,
    );
    const trigger = screen.getByRole("button", { name: TRIGGER_LABEL });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(document.body));
    expect(trigger).not.toHaveFocus();
  });

  // CO ZOSTAŁO DOWIEDZIONE: kontrakt uwięzienia fokusu, jaki Radix REALNIE
  // wystawia w DOM - całe drzewo poza portalem dostaje `aria-hidden="true"`
  // (znacznik `data-aria-hidden` pochodzi z pakietu aria-hidden), a portal jest
  // otoczony dwiema strażnicami fokusu `data-radix-focus-guard`, które
  // przechwytują Tab wychodzący z dialogu i zawracają go do środka.
  // CZEGO NIE DA SIĘ TU DOWIEŚĆ: happy-dom nie realizuje natywnej nawigacji
  // klawiszem Tab (nie przenosi `document.activeElement`), więc nie można
  // zasymulować realnego wyjścia fokusu z modala i sprawdzić, gdzie wróci.
  // ODDZIELNIE ODNOTOWANE: Radix Dialog 1.1.23 NIE ustawia `aria-modal` na
  // treści dialogu - opiera modalność wyłącznie na `aria-hidden` rodzeństwa,
  // dlatego asercja celuje w to, co naprawdę jest w drzewie.
  it("modal odcina treść pod sobą: rodzeństwo portalu ma aria-hidden, portal ma strażnice fokusu", async () => {
    const { container } = render(
      <>
        <OpenPopupButton label={TRIGGER_LABEL} />
        <LoginPopup />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: TRIGGER_LABEL }));
    const dialog = await screen.findByRole("dialog");

    expect(container).toHaveAttribute("aria-hidden", "true");
    expect(container).toHaveAttribute("data-aria-hidden", "true");
    expect(document.querySelectorAll("[data-radix-focus-guard]")).toHaveLength(2);
    // POWIĄZANIE NAGŁÓWKA I OPISU Z DIALOGIEM. Wcześniej stały tu dwie
    // asercje bez wartości (`role === "dialog"` na węźle wziętym z
    // `findByRole("dialog")` oraz brak `aria-hidden`, który `getByRole` i tak
    // pomija) - nie istniał stan świata, w którym mogłyby paść.
    // To poniżej jest realny kontrakt, którego nikt inny nie trzyma: bez
    // `aria-labelledby`/`aria-describedby` czytnik ekranu ogłasza samo
    // "okno dialogowe", bez powodu, dla którego się otworzyło - a przy popupie
    // akcji zastrzeżonej właśnie ten powód jest całą treścią komunikatu.
    const title = document.getElementById(dialog.getAttribute("aria-labelledby") ?? "");
    const description = document.getElementById(dialog.getAttribute("aria-describedby") ?? "");
    expect(title).toHaveTextContent(AUTH_DEFAULTS.popup_heading_pl);
    expect(description).toHaveTextContent(AUTH_DEFAULTS.popup_description_pl);
  });

  // Radix renderuje dialog w PORTALU (bezpośrednio w <body>), więc `container`
  // z render() jest pusty - do axe idzie węzeł dialogu. Węzła nadrzędnego
  // (document.body) świadomie nie podajemy: własne strażnice fokusu Radiksa
  // (span[tabindex=0][aria-hidden=true]) łamią regułę `aria-hidden-focus`, co
  // jest właściwością biblioteki, a nie tego komponentu.
  it("axe: tryb logowania bez naruszeń", async () => {
    render(<LoginPopup />);
    openPopup("signin");
    const v = await axeViolations(screen.getByRole("dialog"));
    expect(v, summarize(v)).toEqual([]);
  });

  it("axe: tryb rejestracji bez naruszeń", async () => {
    h.settings.form_logo_url = "https://cdn.example.com/logo.svg";
    render(<LoginPopup />);
    openPopup("signup");
    const v = await axeViolations(screen.getByRole("dialog"));
    expect(v, summarize(v)).toEqual([]);
  });
});

describe("LoginPopup - ustawienia administratora (popup_enabled=false)", () => {
  it("wewnętrzna ścieżka w custom_login_url: nawigacja routerem, popup się NIE otwiera", () => {
    h.settings.popup_enabled = false;
    h.settings.custom_login_url = "/membership/login";
    render(<LoginPopup />);
    openPopup();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.navigate).toHaveBeenCalledWith({ to: "/membership/login" });
    expect(h.assign).not.toHaveBeenCalled();
  });

  it("białe znaki wokół ścieżki są obcinane przed decyzją o nawigacji", () => {
    h.settings.popup_enabled = false;
    h.settings.custom_login_url = "  /membership/login  ";
    render(<LoginPopup />);
    openPopup();
    expect(h.navigate).toHaveBeenCalledWith({ to: "/membership/login" });
  });

  it("pełny adres http(s): twarda nawigacja window.location.assign", () => {
    h.settings.popup_enabled = false;
    h.settings.custom_login_url = "https://idp.example.com/login";
    render(<LoginPopup />);
    openPopup();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.assign).toHaveBeenCalledWith("https://idp.example.com/login");
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("adres protokolarnie relatywny '//host' spada na /login z zachowanym trybem", () => {
    h.settings.popup_enabled = false;
    h.settings.custom_login_url = "//zly-host.example.com";
    render(<LoginPopup />);
    openPopup("signup");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.navigate).toHaveBeenCalledWith({ to: "/login", search: { mode: "signup" } });
    expect(h.assign).not.toHaveBeenCalled();
  });

  it("pusty custom_login_url spada na /login z trybem 'signin'", () => {
    h.settings.popup_enabled = false;
    h.settings.custom_login_url = "";
    render(<LoginPopup />);
    openPopup();
    expect(h.navigate).toHaveBeenCalledWith({ to: "/login", search: { mode: "signin" } });
  });
});

describe("LoginPopup - sesja i step-up MFA", () => {
  it("pojawienie się sesji zamyka otwarty popup", async () => {
    const { rerender } = render(<LoginPopup />);
    openPopup();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const identity: TestIdentity = {
      session: { user: { id: "u1" } },
      user: { id: "u1" },
      loading: false,
    };
    h.authState = identity;
    rerender(<LoginPopup />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("po odmowie logowania blokada mfaPending jest ZWOLNIONA - sesja znów zamyka popup", async () => {
    // `submit()` ustawia `setMfaPending(true)` PRZED wywołaniem Supabase, żeby
    // efekt sesji nie zamknął popupu w trakcie step-upu aal1 -> aal2. Na
    // ścieżce błędu musi to zwolnić (LoginPopup.tsx:148) - inaczej blokada
    // zostaje na stałe i popup NIGDY już się sam nie zamknie: człowiek loguje
    // się w drugiej karcie, wraca, a okno logowania wisi nad zalogowaną sesją
    // i zasłania stronę.
    // Ta linia jest w 100% pokrycia instrukcji, ale bez tego testu nie jest
    // ASERTOWANA - jej usunięcie z produkcji zostawia całą suitę zieloną.
    h.signIn.mockResolvedValue({ error: new Error("Invalid login credentials") });
    const { rerender } = render(<LoginPopup />);
    openPopup();
    fillSignin();
    fireEvent.click(submitButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const identity: TestIdentity = {
      session: { user: { id: "u1" } },
      user: { id: "u1" },
      loading: false,
    };
    h.authState = identity;
    rerender(<LoginPopup />);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("wymagane MFA: wyzwanie otwarte, popup NADAL otwarty (sesja go nie zamyka), po onVerified toast i zamknięcie", async () => {
    h.mfaRequired.mockResolvedValue(true);
    const { rerender } = render(<LoginPopup />);
    openPopup();
    fillSignin();
    fireEvent.click(submitButton());

    expect(await screen.findByTestId("mfa-challenge-stub")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(h.toastSuccess).not.toHaveBeenCalled();

    // Sesja aal1 przychodzi w trakcie step-upu - efekt sesji NIE MOŻE zamknąć
    // popupu, bo użytkownik nie skończył jeszcze logowania.
    const identity: TestIdentity = {
      session: { user: { id: "u1" } },
      user: { id: "u1" },
      loading: false,
    };
    h.authState = identity;
    rerender(<LoginPopup />);
    await flush();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    act(() => h.mfaOnVerified?.());
    expect(h.toastSuccess).toHaveBeenCalledWith(t("auth.signinOk"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByTestId("mfa-challenge-stub")).not.toBeInTheDocument();
  });

  it("anulowane MFA: popup zamknięty BEZ toastu sukcesu", async () => {
    h.mfaRequired.mockResolvedValue(true);
    render(<LoginPopup />);
    openPopup();
    fillSignin();
    fireEvent.click(submitButton());

    expect(await screen.findByTestId("mfa-challenge-stub")).toBeInTheDocument();
    act(() => h.mfaOnCancel?.());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByTestId("mfa-challenge-stub")).not.toBeInTheDocument();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("logowanie bez MFA: toast Z KLUCZA i18n i zamknięty popup", async () => {
    render(<LoginPopup />);
    openPopup();
    fillSignin();
    fireEvent.click(submitButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(t("auth.signinOk")));
    expect(h.signIn).toHaveBeenCalledWith({ email: EMAIL, password: PASSWORD });
    expect(h.guard).toHaveBeenCalledWith({ data: { kind: "login", email: EMAIL } });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByTestId("mfa-challenge-stub")).not.toBeInTheDocument();
  });
});

describe("LoginPopup - logo i pole hasła", () => {
  it("motyw jasny renderuje form_logo_url jako obraz dekoracyjny", () => {
    h.settings.form_logo_url = "https://cdn.example.com/logo-light.svg";
    h.settings.form_logo_url_dark = "https://cdn.example.com/logo-dark.svg";
    render(<LoginPopup />);
    openPopup();
    const img = within(screen.getByRole("dialog")).getByRole("presentation");
    expect(img).toHaveAttribute("src", "https://cdn.example.com/logo-light.svg");
    expect(img).toHaveAttribute("alt", "");
  });

  it("motyw ciemny woli form_logo_url_dark", () => {
    h.theme = "dark";
    h.settings.form_logo_url = "https://cdn.example.com/logo-light.svg";
    h.settings.form_logo_url_dark = "https://cdn.example.com/logo-dark.svg";
    render(<LoginPopup />);
    openPopup();
    expect(within(screen.getByRole("dialog")).getByRole("presentation")).toHaveAttribute(
      "src",
      "https://cdn.example.com/logo-dark.svg",
    );
  });

  it("motyw ciemny bez wariantu ciemnego spada na form_logo_url", () => {
    h.theme = "dark";
    h.settings.form_logo_url = "https://cdn.example.com/logo-light.svg";
    h.settings.form_logo_url_dark = "";
    render(<LoginPopup />);
    openPopup();
    expect(within(screen.getByRole("dialog")).getByRole("presentation")).toHaveAttribute(
      "src",
      "https://cdn.example.com/logo-light.svg",
    );
  });

  it("brak skonfigurowanego logo nie renderuje żadnego obrazu", () => {
    render(<LoginPopup />);
    openPopup();
    expect(within(screen.getByRole("dialog")).queryByRole("presentation")).not.toBeInTheDocument();
  });

  it("przełącznik pokaż/ukryj hasło zmienia typ pola i etykietę Z KLUCZA i18n", () => {
    render(<LoginPopup />);
    openPopup();
    expect(passwordInput()).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: t("authForms.showPassword") }));
    expect(passwordInput()).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: t("authForms.hidePassword") }));
    expect(passwordInput()).toHaveAttribute("type", "password");
  });
});

describe("LoginPopup - rejestracja", () => {
  function fillSignup(name: string | null) {
    if (name !== null) {
      fireEvent.change(screen.getByLabelText(t("authForms.nameLabel")), {
        target: { value: name },
      });
    }
    fillSignin();
  }

  it("imię wieloczłonowe: metadane display_name/first_name/last_name i toast Z KLUCZA", async () => {
    render(<LoginPopup />);
    openPopup("signup");
    fillSignup("Anna Maria Kowalska");
    fireEvent.click(submitButton());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(t("auth.signupOk")));
    expect(h.guard).toHaveBeenCalledWith({ data: { kind: "signup", email: EMAIL } });
    expect(h.signUp).toHaveBeenCalledWith({
      email: EMAIL,
      password: PASSWORD,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: {
          display_name: "Anna Maria Kowalska",
          first_name: "Anna",
          last_name: "Maria Kowalska",
          full_name: "Anna Maria Kowalska",
          signup_type: "reader",
        },
      },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("imię jednoczłonowe: nazwisko zostaje puste", async () => {
    render(<LoginPopup />);
    openPopup("signup");
    fillSignup("Anna");
    fireEvent.click(submitButton());

    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
    expect(h.signUp.mock.calls[0][0].options.data).toEqual({
      display_name: "Anna",
      first_name: "Anna",
      last_name: "",
      full_name: "Anna",
      signup_type: "reader",
    });
  });

  it("puste imię: display_name bierze się z części adresu przed @", async () => {
    render(<LoginPopup />);
    openPopup("signup");
    fillSignup(null);
    fireEvent.click(submitButton());

    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
    expect(h.signUp.mock.calls[0][0].options.data).toEqual({
      display_name: "czytelnik",
      first_name: "",
      last_name: "",
      full_name: "czytelnik",
      signup_type: "reader",
    });
  });

  it("emailRedirectTo używa wewnętrznej ścieżki z logged_in_redirect_url", async () => {
    h.settings.logged_in_redirect_url = "/witaj";
    render(<LoginPopup />);
    openPopup("signup");
    fillSignup("Anna");
    fireEvent.click(submitButton());

    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
    expect(h.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(
      `${window.location.origin}/witaj`,
    );
  });

  it("emailRedirectTo NIE wpuszcza adresu zewnętrznego - spada na '/'", async () => {
    h.settings.logged_in_redirect_url = "https://zly-host.example.com/przechwyt";
    render(<LoginPopup />);
    openPopup("signup");
    fillSignup("Anna");
    fireEvent.click(submitButton());

    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
    expect(h.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(`${window.location.origin}/`);
  });

  it("signUp zwraca error: komunikat błędu, bez toastu sukcesu, popup zostaje otwarty", async () => {
    h.signUp.mockResolvedValue({ error: new Error("User already registered") });
    render(<LoginPopup />);
    openPopup("signup");
    fillSignup("Anna");
    fireEvent.click(submitButton());

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("User already registered"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(emailInput()).toHaveValue(EMAIL);
  });
});
