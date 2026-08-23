// Formularz rejestracji w popupie - jedyna powierzchnia, na której anonimowy
// odwiedzający zakłada konto i (opcjonalnie) trafia na listę mailingową.
//
// CO TU JEST DOWODEM, A CO TYLKO SPRAWDZENIEM. Najważniejsza część tego pliku
// dotyczy ZGODY: brak zaznaczonej zgody obowiązkowej musi zatrzymać żądanie
// zanim opuści przeglądarkę, a zgoda zaznaczona musi zostawić w bazie ślad,
// z którego da się odtworzyć, NA CO i KIEDY człowiek się zgodził. Asercje
// stoją więc na PAYLOADZIE wysyłanym do `subscribeToNewsletter`, nie na tym,
// co widać na ekranie - ekran nie jest dowodem wobec organu nadzorczego.
//
// Czas jest zamrożony (`vi.setSystemTime`), bo formularz mierzy czas wypełnienia
// (bariera antybotowa 1200 ms) - bez zamrożenia ten sam test raz przechodziłby
// ścieżką bota, a raz ścieżką człowieka.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/** Zgoda tak, jak schemat `ConsentEntry` (src/lib/newsletter.functions.ts) ją przyjmuje. */
interface ConsentPayload {
  key: string;
  text: string;
  given: boolean;
  lang: "pl" | "en";
  version?: string;
  /** Znacznik czasu udzielenia zgody - schemat go NIE deklaruje (patrz `it.fails`). */
  timestamp?: string;
}

interface SubscribePayload {
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  language: "pl" | "en";
  source: string;
  consents: ConsentPayload[];
  meta?: Record<string, string>;
}

interface SignUpArgs {
  email: string;
  password: string;
  options: {
    emailRedirectTo: string;
    data: Record<string, unknown>;
  };
}

const h = vi.hoisted(() => ({
  // Atrapy server fn są rozróżniane po TOŻSAMOŚCI obiektu, bo `useServerFn`
  // dostaje w komponencie dwie różne funkcje serwerowe.
  preAuthGuardFn: { serverFn: "preAuthGuard" },
  subscribeFn: { serverFn: "subscribeToNewsletter" },
  guard: vi.fn<(input: { data: { kind: string; email: string } }) => Promise<unknown>>(),
  subscribe: vi.fn<(input: { data: SubscribePayload }) => Promise<{ ok: boolean }>>(),
  signUp: vi.fn<(args: SignUpArgs) => Promise<{ error: { message: string } | null }>>(),
  track: vi.fn<(payload: Record<string, unknown>) => void>(),
  auth: { allow_public_signup: true, logged_in_redirect_url: "/" } as {
    allow_public_signup: boolean;
    logged_in_redirect_url: string | null;
  },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-signup-popup", () => ({}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => (fn === h.preAuthGuardFn ? h.guard : h.subscribe),
}));
vi.mock("@/lib/auth/bruteforce.functions", () => ({ preAuthGuard: h.preAuthGuardFn }));
vi.mock("@/lib/newsletter.functions", () => ({ subscribeToNewsletter: h.subscribeFn }));
vi.mock("@/lib/newsletter/popupTelemetry", () => ({
  trackNewsletterPopupEvent: h.track,
  newsletterPopupSessionId: () => "test-session",
}));
vi.mock("@/hooks/useAuthSettings", () => ({ useAuthSettings: () => h.auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signUp: h.signUp, resend: vi.fn() } },
}));

import { PopupSignupForm } from "@/components/PopupSignupForm";
import { defaultNewsletterSettings, type NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { resolvePopupFields, type PopupFieldConfig } from "@/lib/newsletter/popupFields";
import { defaultPopupDesign } from "@/lib/newsletter/popupDesign";

const MOUNTED_AT = new Date("2026-08-22T10:00:00.000Z");
/** Po tylu milisekundach formularz uznaje wypełnienie za ludzkie (próg 1200 ms). */
const HUMAN_AT = new Date("2026-08-22T10:00:02.000Z");

function settings(over: Partial<NewsletterSettings> = {}): NewsletterSettings {
  return { ...defaultNewsletterSettings(), ...over };
}

/** Nadpisanie pojedynczych pól konfiguracji formularza (reszta zostaje domyślna). */
function fieldsWith(
  ...over: Array<Partial<PopupFieldConfig> & { key: string }>
): PopupFieldConfig[] {
  return resolvePopupFields(over);
}

function renderForm(props: Partial<React.ComponentProps<typeof PopupSignupForm>> = {}) {
  const view = render(<PopupSignupForm settings={settings()} lang="pl" {...props} />);
  return view;
}

function pick<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  expect(el, `brak elementu ${selector}`).not.toBeNull();
  return el as T;
}

const emailInput = () => pick<HTMLInputElement>('input[type="email"]');
const phoneInput = () => pick<HTMLInputElement>('input[type="tel"]');
const linkedinInput = () => pick<HTMLInputElement>('input[inputmode="url"]');
const firstNameInput = () => pick<HTMLInputElement>('input[autocomplete="given-name"]');
const lastNameInput = () => pick<HTMLInputElement>('input[autocomplete="family-name"]');
const jobInput = () => pick<HTMLInputElement>('input[autocomplete="organization-title"]');
const companyInput = () => pick<HTMLInputElement>('input[autocomplete="organization"]');
const listSelect = () => pick<HTMLSelectElement>("#nl-popup-list");
const submitButton = () => pick<HTMLButtonElement>('button[type="submit"]');
const honeypotInput = () => pick<HTMLInputElement>('input[name="website"]');

function passwordInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>("input[minlength]"));
}

/**
 * Checkboxy zgód w kolejności renderowania: newsletter (opcjonalny, bez
 * `aria-required`), następnie prywatność i regulamin (obowiązkowe).
 */
function consentBoxes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="checkbox"]'));
}

const type = (el: HTMLInputElement, value: string) => fireEvent.change(el, { target: { value } });

/** Minimalny komplet danych, przy którym rejestracja przechodzi walidację. */
function fillMinimal(overrideEmail = "jan@firma.pl") {
  type(emailInput(), overrideEmail);
  const [password, confirm] = passwordInputs();
  type(password, "TajneHaslo1");
  type(confirm, "TajneHaslo1");
}

/** Przechodzi barierę antybotową bez wprowadzania niedeterminizmu. */
function actLikeHuman() {
  vi.setSystemTime(HUMAN_AT);
}

async function submit() {
  fireEvent.click(submitButton());
  // Handler jest asynchroniczny (guard -> signUp -> subscribe); domykamy
  // wszystkie mikrozadania, zanim test cokolwiek sprawdzi.
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  // Tylko `Date` jest atrapą: pełne atrapowanie zegarów zawiesza `waitFor`
  // z testing-library (sięga po `jest.advanceTimersByTime`, którego w vitest
  // nie ma), a komponent nie używa żadnych liczników czasu poza `Date.now()`.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MOUNTED_AT);
  h.guard.mockReset().mockResolvedValue({ ok: true });
  h.subscribe.mockReset().mockResolvedValue({ ok: true });
  h.signUp.mockReset().mockResolvedValue({ error: null });
  h.track.mockReset();
  h.auth = { allow_public_signup: true, logged_in_redirect_url: "/" };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// ZGODA RODO
// ---------------------------------------------------------------------------

describe("PopupSignupForm: zgoda RODO jest warunkiem, nie ozdobą", () => {
  it("bez zaznaczonej zgody na prywatność żadne żądanie nie opuszcza przeglądarki", async () => {
    renderForm();
    fillMinimal();
    actLikeHuman();
    await submit();

    expect(h.subscribe).not.toHaveBeenCalled();
    expect(h.signUp).not.toHaveBeenCalled();
    expect(h.guard).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("signupPopup.errors.privacyRequired");
  });

  it("bez zaznaczonej zgody na regulamin rejestracja także się zatrzymuje", async () => {
    renderForm({ settings: settings({ popup_require_terms: true }) });
    fillMinimal();
    const [, privacy] = consentBoxes();
    fireEvent.click(privacy);
    actLikeHuman();
    await submit();

    expect(h.subscribe).not.toHaveBeenCalled();
    expect(h.signUp).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("signupPopup.errors.termsRequired");
  });

  it("treść zgody obowiązkowej może pochodzić z globalnej polityki i nadal blokuje zapis", async () => {
    renderForm({
      settings: settings({
        popup_privacy_html_pl: null,
        popup_privacy_html_en: null,
        policy_html_pl: "Akceptuję politykę prywatności redakcji.",
      }),
    });

    expect(screen.getByText("Akceptuję politykę prywatności redakcji.")).toBeInTheDocument();
    fillMinimal();
    actLikeHuman();
    await submit();
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("zaznaczona zgoda trafia do bazy z treścią, językiem i faktem udzielenia", async () => {
    renderForm();
    fillMinimal();
    fireEvent.click(consentBoxes()[1]);
    actLikeHuman();
    await submit();

    await waitFor(() => expect(h.subscribe).toHaveBeenCalledTimes(1));
    const { consents } = h.subscribe.mock.calls[0][0].data;
    expect(consents).toEqual([
      {
        key: "newsletter",
        text: "signupPopup.newsletterConsent(lng=pl)",
        given: true,
        lang: "pl",
      },
      {
        key: "privacy",
        text: defaultNewsletterSettings().policy_html_pl,
        given: true,
        lang: "pl",
      },
    ]);
  });

  it.fails(
    "zgoda jedzie do bazy BEZ wersji i BEZ znacznika czasu - z takiego wpisu nie da się dowieść, na jaką treść i kiedy padła zgoda (art. 7 ust. 1 RODO: ciężar dowodu leży po stronie administratora)",
    async () => {
      renderForm();
      fillMinimal();
      fireEvent.click(consentBoxes()[1]);
      actLikeHuman();
      await submit();

      await waitFor(() => expect(h.subscribe).toHaveBeenCalledTimes(1));
      const [privacyConsent] = h.subscribe.mock.calls[0][0].data.consents.filter(
        (entry) => entry.key === "privacy",
      );
      expect(privacyConsent.version, "wersja treści zgody").toBeTruthy();
      expect(privacyConsent.timestamp, "znacznik czasu zgody").toBe(HUMAN_AT.toISOString());
    },
  );

  it("kilka zgód naraz zapisuje się jako osobne wpisy, każdy z własną treścią", async () => {
    renderForm({
      settings: settings({
        popup_require_terms: true,
        popup_privacy_html_pl: "Zgoda na przetwarzanie danych.",
        popup_terms_html_pl: "Akceptuję regulamin serwisu.",
      }),
    });
    fillMinimal();
    const [, privacy, terms] = consentBoxes();
    fireEvent.click(privacy);
    fireEvent.click(terms);
    actLikeHuman();
    await submit();

    await waitFor(() => expect(h.subscribe).toHaveBeenCalledTimes(1));
    const { consents } = h.subscribe.mock.calls[0][0].data;
    expect(consents.map((entry) => entry.key)).toEqual(["newsletter", "privacy", "terms"]);
    expect(consents.every((entry) => entry.given)).toBe(true);
    // Schemat dopuszcza najwyżej dziesięć zgód - realny formularz mieści się
    // w limicie z dużym zapasem, więc walidator serwera nigdy nie odrzuci wpisu.
    expect(consents.length).toBeLessThanOrEqual(10);
  });

  it("zgoda OPCJONALNA odznaczona: konto powstaje, ale na listę mailingową nic nie leci", async () => {
    renderForm();
    fillMinimal();
    const [newsletter, privacy] = consentBoxes();
    fireEvent.click(newsletter);
    fireEvent.click(privacy);
    actLikeHuman();
    await submit();

    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
    expect(h.subscribe).not.toHaveBeenCalled();
    expect(h.signUp.mock.calls[0][0].options.data.marketing_opt_in).toBe(false);
  });

  it("wyłączona zgoda na prywatność znika z formularza i nie dokłada wpisu do bazy", async () => {
    renderForm({ settings: settings({ popup_require_privacy: false }) });
    expect(consentBoxes()).toHaveLength(1);

    fillMinimal();
    actLikeHuman();
    await submit();

    await waitFor(() => expect(h.subscribe).toHaveBeenCalledTimes(1));
    expect(h.subscribe.mock.calls[0][0].data.consents.map((entry) => entry.key)).toEqual([
      "newsletter",
    ]);
  });

  it("wyłączony opt-in newslettera nie renderuje checkboxa i nie zapisuje nikogo na listę", async () => {
    renderForm({
      settings: settings({
        popup_fields: fieldsWith({ key: "newsletter_optin", enabled: false }),
      }),
    });
    fillMinimal();
    fireEvent.click(consentBoxes()[0]);
    actLikeHuman();
    await submit();

    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
    expect(h.subscribe).not.toHaveBeenCalled();
    expect(h.signUp.mock.calls[0][0].options.data.marketing_opt_in).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WALIDACJA PÓL
// ---------------------------------------------------------------------------

describe("PopupSignupForm: walidacja pól zatrzymuje śmieciowe konta", () => {
  const acceptPrivacy = () => fireEvent.click(consentBoxes()[1]);

  it("pusty adres e-mail nie tworzy konta", async () => {
    renderForm();
    acceptPrivacy();
    actLikeHuman();
    await submit();

    expect(screen.getByRole("alert")).toHaveTextContent("signupPopup.errors.invalidEmail");
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it.each([["jan"], ["jan@"], ["jan@firma"], ["jan @firma.pl"], ["@firma.pl"]])(
    "adres %s jest odrzucany zanim powstanie konto",
    async (candidate) => {
      renderForm();
      type(emailInput(), candidate);
      acceptPrivacy();
      actLikeHuman();
      await submit();

      expect(screen.getByRole("alert")).toHaveTextContent("signupPopup.errors.invalidEmail");
      expect(h.signUp).not.toHaveBeenCalled();
    },
  );

  it("adres wpisany WIELKIMI literami trafia do bazy znormalizowany - jeden człowiek to jeden wiersz", async () => {
    renderForm();
    type(emailInput(), "  JAN.Kowalski@Firma.PL  ");
    const [password, confirm] = passwordInputs();
    type(password, "TajneHaslo1");
    type(confirm, "TajneHaslo1");
    acceptPrivacy();
    actLikeHuman();
    await submit();

    await waitFor(() => expect(h.subscribe).toHaveBeenCalledTimes(1));
    expect(h.signUp.mock.calls[0][0].email).toBe("jan.kowalski@firma.pl");
    expect(h.guard.mock.calls[0][0].data.email).toBe("jan.kowalski@firma.pl");
    expect(h.subscribe.mock.calls[0][0].data.email).toBe("jan.kowalski@firma.pl");
  });

  it("hasło o jeden znak za krótkie jest odrzucane, hasło graniczne przechodzi", async () => {
    renderForm();
    type(emailInput(), "jan@firma.pl");
    const [password, confirm] = passwordInputs();
    type(password, "1234567");
    type(confirm, "1234567");
    acceptPrivacy();
    actLikeHuman();
    await submit();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "signupPopup.errors.passwordTooShort(count=8)",
    );
    expect(h.signUp).not.toHaveBeenCalled();

    type(passwordInputs()[0], "12345678");
    type(passwordInputs()[1], "12345678");
    await submit();
    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
  });

  it("rozjechane powtórzenie hasła nie zakłada konta z hasłem, którego nikt nie zna", async () => {
    renderForm();
    type(emailInput(), "jan@firma.pl");
    const [password, confirm] = passwordInputs();
    type(password, "TajneHaslo1");
    type(confirm, "TajneHaslo2");
    acceptPrivacy();
    actLikeHuman();
    await submit();

    expect(screen.getByRole("alert")).toHaveTextContent("signupPopup.errors.passwordMismatch");
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it.each([
    ["J", "za krótkie"],
    ["Jan3", "z cyfrą"],
    ["Jan<script>", "ze znacznikiem"],
  ])("imię %s (%s) nie przechodzi do metadanych konta", async (candidate) => {
    renderForm({ settings: settings({ popup_extended_fields: true }) });
    fillMinimal();
    type(firstNameInput(), candidate);
    acceptPrivacy();
    actLikeHuman();
    await submit();

    expect(screen.getByRole("alert")).toHaveTextContent("signupPopup.errors.invalidFirstName");
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("imię z polskimi znakami, apostrofem i myślnikiem jest przyjmowane", async () => {
    renderForm({ settings: settings({ popup_extended_fields: true }) });
    fillMinimal();
    type(firstNameInput(), "Zażółć O'Brien-Ćwiek");
    type(lastNameInput(), "Kowalska-Nowak");
    acceptPrivacy();
    actLikeHuman();
    await submit();

    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
    expect(h.signUp.mock.calls[0][0].options.data.display_name).toBe(
      "Zażółć O'Brien-Ćwiek Kowalska-Nowak",
    );
  });

  it("nazwisko z cyfrą jest odrzucane osobnym komunikatem niż imię", async () => {
    renderForm({ settings: settings({ popup_extended_fields: true }) });
    fillMinimal();
    type(firstNameInput(), "Jan");
    type(lastNameInput(), "Kowalski2");
    acceptPrivacy();
    actLikeHuman();
    await submit();

    expect(screen.getByRole("alert")).toHaveTextContent("signupPopup.errors.invalidLastName");
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("adres LinkedIn spoza linkedin.com nie zostaje zapisany w profilu", async () => {
    renderForm({ settings: settings({ popup_extended_fields: true }) });
    fillMinimal();
    type(linkedinInput(), "https://example.com/in/jan");
    acceptPrivacy();
    actLikeHuman();
    await submit();

    expect(screen.getByRole("alert")).toHaveTextContent("signupPopup.errors.invalidLinkedin");
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("poprawny profil LinkedIn (także bez protokołu) idzie do metadanych i do listy", async () => {
    renderForm({ settings: settings({ popup_extended_fields: true }) });
    fillMinimal();
    type(linkedinInput(), "pl.linkedin.com/in/jan-kowalski");
    acceptPrivacy();
    actLikeHuman();
    await submit();

    await waitFor(() => expect(h.subscribe).toHaveBeenCalledTimes(1));
    expect(h.subscribe.mock.calls[0][0].data.meta).toEqual({
      linkedin: "pl.linkedin.com/in/jan-kowalski",
    });
  });

  it("telefon z literami jest odrzucany, telefon z separatorami przyjmowany", async () => {
    renderForm({ settings: settings({ popup_extended_fields: true }) });
    fillMinimal();
    type(phoneInput(), "600-abc-000");
    acceptPrivacy();
    actLikeHuman();
    await submit();

    expect(screen.getByRole("alert")).toHaveTextContent("signupPopup.errors.invalidPhone");
    expect(h.signUp).not.toHaveBeenCalled();

    type(phoneInput(), "+48 (600) 000-000");
    await submit();
    await waitFor(() => expect(h.subscribe).toHaveBeenCalledTimes(1));
    expect(h.subscribe.mock.calls[0][0].data.meta).toEqual({ phone: "+48 (600) 000-000" });
  });

  it("pole oznaczone jako wymagane nie da się pominąć, a komunikat mówi które to pole", async () => {
    renderForm({
      settings: settings({
        popup_extended_fields: true,
        popup_fields: fieldsWith({ key: "job", required: true, label_pl: "Stanowisko" }),
      }),
    });
    fillMinimal();
    acceptPrivacy();
    actLikeHuman();
    await submit();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "signupPopup.errors.fieldRequired(field=Stanowisko)",
    );
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("pole opcjonalne wolno zostawić puste - rejestracja przechodzi", async () => {
    renderForm({
      settings: settings({
        popup_extended_fields: true,
        popup_fields: fieldsWith({ key: "job", required: false }),
      }),
    });
    fillMinimal();
    acceptPrivacy();
    actLikeHuman();
    await submit();

    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
    expect(h.subscribe.mock.calls[0][0].data.meta).toBeUndefined();
  });

  it("wyłączone pole rozszerzone nie renderuje się i nie blokuje zapisu, choć jest wymagane", async () => {
    renderForm({
      settings: settings({
        popup_extended_fields: true,
        popup_fields: fieldsWith(
          { key: "company", enabled: false, required: true },
          { key: "linkedin", enabled: false },
          { key: "phone", enabled: false },
        ),
      }),
    });
    expect(document.querySelector('input[autocomplete="organization"]')).toBeNull();
    expect(document.querySelector('input[type="tel"]')).toBeNull();

    fillMinimal();
    acceptPrivacy();
    actLikeHuman();
    await submit();
    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
  });

  it("pól zablokowanych (e-mail, hasło) nie da się wyłączyć z panelu - konto bez nich nie istnieje", () => {
    renderForm({
      settings: settings({
        popup_fields: fieldsWith(
          { key: "email", enabled: false, required: false },
          { key: "password", enabled: false, required: false },
          { key: "password_confirm", enabled: false },
        ),
      }),
    });

    expect(emailInput()).toBeInTheDocument();
    expect(passwordInputs()).toHaveLength(2);
  });

  it("samo imię bez nazwiska nie zostaje wciśnięte w połowę wiersza", () => {
    const { container } = render(
      <PopupSignupForm
        settings={settings({
          popup_extended_fields: true,
          popup_fields: fieldsWith({ key: "last_name", enabled: false }),
        })}
        lang="pl"
      />,
    );

    expect(firstNameInput()).toBeInTheDocument();
    expect(document.querySelector('input[autocomplete="family-name"]')).toBeNull();
    // Para imię/nazwisko traci siatkę dwukolumnową - zostaje tylko para haseł.
    expect(container.querySelectorAll(".grid.grid-cols-2")).toHaveLength(1);
  });

  it("bez trybu rozszerzonego formularz pokazuje wyłącznie adres i hasło", () => {
    renderForm({ settings: settings({ popup_extended_fields: false }) });

    expect(document.querySelector('input[autocomplete="given-name"]')).toBeNull();
    expect(document.querySelector('input[autocomplete="organization-title"]')).toBeNull();
    expect(document.querySelector('input[inputmode="url"]')).toBeNull();
    expect(document.querySelector('input[type="tel"]')).toBeNull();
    expect(emailInput()).toBeInTheDocument();
  });

  it("każde pole ma twardy limit długości, więc przepełnienie nie dojdzie do bazy", () => {
    renderForm({ settings: settings({ popup_extended_fields: true }) });

    expect(firstNameInput()).toHaveAttribute("maxlength", "80");
    expect(lastNameInput()).toHaveAttribute("maxlength", "80");
    expect(jobInput()).toHaveAttribute("maxlength", "120");
    expect(companyInput()).toHaveAttribute("maxlength", "120");
    expect(linkedinInput()).toHaveAttribute("maxlength", "200");
    expect(emailInput()).toHaveAttribute("maxlength", "254");
    expect(phoneInput()).toHaveAttribute("maxlength", "32");
    for (const input of passwordInputs()) {
      expect(input).toHaveAttribute("maxlength", "72");
      expect(input).toHaveAttribute("minlength", "8");
    }
  });

  it("imię o granicznej długości 80 znaków przechodzi walidację", async () => {
    renderForm({ settings: settings({ popup_extended_fields: true }) });
    fillMinimal();
    type(firstNameInput(), "a".repeat(80));
    acceptPrivacy();
    actLikeHuman();
    await submit();

    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// LISTA MAILINGOWA
// ---------------------------------------------------------------------------

describe("PopupSignupForm: wybór listy mailingowej", () => {
  const lists = [
    { id: "tygodnik", label_pl: "Tygodnik", label_en: "Weekly" },
    { id: "raporty", label_pl: "Raporty", label_en: "Reports" },
  ];

  it("wybrana lista jedzie do bazy w metadanych subskrybenta", async () => {
    renderForm({ settings: settings({ popup_mailing_lists: lists }) });
    fillMinimal();
    fireEvent.change(listSelect(), { target: { value: "raporty" } });
    fireEvent.click(consentBoxes()[1]);
    actLikeHuman();
    await submit();

    await waitFor(() => expect(h.subscribe).toHaveBeenCalledTimes(1));
    expect(h.subscribe.mock.calls[0][0].data.meta).toEqual({ mailing_list: "raporty" });
  });

  it("lista oznaczona jako wymagana blokuje zapis, dopóki nikt jej nie wybierze", async () => {
    renderForm({
      settings: settings({
        popup_mailing_lists: lists,
        popup_fields: fieldsWith({ key: "list", required: true, label_pl: "Lista mailingowa" }),
      }),
    });
    fillMinimal();
    fireEvent.click(consentBoxes()[1]);
    actLikeHuman();
    await submit();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "signupPopup.errors.fieldRequired(field=Lista mailingowa)",
    );
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("lista bez własnej podpowiedzi dostaje tekst z i18n, nie pustą pozycję", () => {
    renderForm({
      settings: settings({
        popup_mailing_lists: lists,
        popup_fields: fieldsWith({ key: "list", placeholder_pl: "", placeholder_en: "" }),
      }),
    });

    expect(listSelect().options[0].textContent).toBe("signupPopup.chooseList");
  });

  it("pusta konfiguracja list nie renderuje pustego wybieraka", () => {
    renderForm({ settings: settings({ popup_mailing_lists: [] }) });
    expect(document.querySelector("#nl-popup-list")).toBeNull();
  });

  it("wyłączone pole listy chowa wybierak nawet przy skonfigurowanych listach", () => {
    renderForm({
      settings: settings({
        popup_mailing_lists: lists,
        popup_fields: fieldsWith({ key: "list", enabled: false }),
      }),
    });
    expect(document.querySelector("#nl-popup-list")).toBeNull();
  });

  it("etykiety list są czytane w języku popupu", () => {
    renderForm({ settings: settings({ popup_mailing_lists: lists }), lang: "en" });
    const options = Array.from(listSelect().options).map((option) => option.textContent);
    expect(options).toEqual(["Choose a list", "Weekly", "Reports"]);
  });
});

// ---------------------------------------------------------------------------
// ZACHOWANIA O WYSOKIEJ KONSEKWENCJI
// ---------------------------------------------------------------------------

describe("PopupSignupForm: zachowania o wysokiej konsekwencji", () => {
  const acceptPrivacy = () => fireEvent.click(consentBoxes()[1]);

  it("dwa szybkie kliknięcia zakładają JEDNO konto, nie dwa", async () => {
    // Uchwyt trzymany w obiekcie, nie w `let`: przy zmiennej TypeScript zawęża
    // typ do `null` (przypisanie żyje w domknięciu) i wywołanie przestaje być
    // wywołaniem.
    const deferred = { release: () => {} };
    h.guard.mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          deferred.release = () => resolve({ ok: true });
        }),
    );

    renderForm();
    fillMinimal();
    acceptPrivacy();
    actLikeHuman();

    fireEvent.click(submitButton());
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(submitButton());
    fireEvent.click(submitButton());
    await act(async () => {
      await Promise.resolve();
    });

    expect(h.guard).toHaveBeenCalledTimes(1);
    deferred.release();
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
  });

  it("w trakcie wysyłki przycisk jest zablokowany i mówi, że konto powstaje", async () => {
    h.guard.mockImplementation(() => new Promise<unknown>(() => {}));

    renderForm();
    fillMinimal();
    acceptPrivacy();
    actLikeHuman();
    fireEvent.click(submitButton());
    await act(async () => {
      await Promise.resolve();
    });

    const button = submitButton();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("signupPopup.creatingAccount");
  });

  it("po błędzie zapisu wpisany adres ZOSTAJE w polu - nikt nie wpisuje go drugi raz", async () => {
    h.signUp.mockResolvedValue({ error: new Error("Database error saving new user") });

    renderForm();
    type(emailInput(), "jan@firma.pl");
    const [password, confirm] = passwordInputs();
    type(password, "TajneHaslo1");
    type(confirm, "TajneHaslo1");
    acceptPrivacy();
    actLikeHuman();
    await submit();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(emailInput().value).toBe("jan@firma.pl");
    expect(passwordInputs()[0].value).toBe("TajneHaslo1");
  });

  it("adres JUŻ ZAREJESTROWANY dostaje inny komunikat niż awaria zapisu", async () => {
    renderForm();
    fillMinimal();
    acceptPrivacy();
    actLikeHuman();

    h.signUp.mockResolvedValue({ error: new Error("User already registered") });
    await submit();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("User already registered"),
    );
    const duplicateMessage = screen.getByRole("alert").textContent;

    h.signUp.mockResolvedValue({ error: new Error("Database error saving new user") });
    await submit();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Database error saving new user"),
    );
    const failureMessage = screen.getByRole("alert").textContent;

    expect(duplicateMessage).toBeTruthy();
    expect(failureMessage).toBeTruthy();
    expect(duplicateMessage).not.toBe(failureMessage);
  });

  it.fails(
    "komunikat po błędzie zapisu to SUROWY tekst dostawcy, nie klucz i18n - użytkownik anglojęzycznego backendu czyta techniczny komunikat w interfejsie po polsku, a treść błędu bazy wycieka na ekran",
    async () => {
      h.signUp.mockResolvedValue({
        error: new Error('duplicate key value violates unique constraint "users_email_key"'),
      });

      renderForm();
      fillMinimal();
      acceptPrivacy();
      actLikeHuman();
      await submit();

      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      expect(screen.getByRole("alert").textContent).toMatch(/^signupPopup\.errors\./);
    },
  );

  it("przekroczony limit prób pokazuje komunikat z klucza i nie próbuje zakładać konta", async () => {
    h.guard.mockRejectedValue(new Error("rate_limited: too many attempts"));

    renderForm();
    fillMinimal();
    acceptPrivacy();
    actLikeHuman();
    await submit();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("signupPopup.errors.rateLimited"),
    );
    expect(h.signUp).not.toHaveBeenCalled();
    expect(h.track).toHaveBeenCalledWith(
      expect.objectContaining({ event: "error", errorCode: "rate_limited" }),
    );
  });

  it("awaria strażnika logowania nie udaje sukcesu - użytkownik widzi błąd", async () => {
    // Odrzucenie NIE-Errorem: tak wygląda awaria warstwy transportowej, która
    // nie opakowuje wyjątku - komponent musi ją mimo wszystko pokazać.
    h.guard.mockRejectedValue("guard offline");

    renderForm();
    fillMinimal();
    acceptPrivacy();
    actLikeHuman();
    await submit();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(h.signUp).not.toHaveBeenCalled();
    expect(h.track).toHaveBeenCalledWith(
      expect.objectContaining({ event: "error", errorCode: "exception" }),
    );
  });

  it("wyłączona rejestracja publiczna zatrzymuje formularz przed jakimkolwiek żądaniem", async () => {
    h.auth = { allow_public_signup: false, logged_in_redirect_url: "/" };

    renderForm();
    fillMinimal();
    acceptPrivacy();
    actLikeHuman();
    await submit();

    expect(screen.getByRole("alert")).toHaveTextContent("signupPopup.errors.signupDisabled");
    expect(h.guard).not.toHaveBeenCalled();
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("nieudany zapis na listę nie przewraca rejestracji konta", async () => {
    h.subscribe.mockRejectedValue(new Error("rate_limited"));
    const onSuccess = vi.fn();

    renderForm({ onSuccess });
    fillMinimal();
    acceptPrivacy();
    actLikeHuman();
    await submit();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent("signupPopup.success.title(lng=pl)");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("po udanej rejestracji panel sukcesu pokazuje adres, na który poszedł link", async () => {
    const onSuccess = vi.fn();
    renderForm({ onSuccess });
    type(emailInput(), "Jan@Firma.PL");
    const [password, confirm] = passwordInputs();
    type(password, "TajneHaslo1");
    type(confirm, "TajneHaslo1");
    acceptPrivacy();
    actLikeHuman();
    await submit();

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByText("jan@firma.pl")).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(h.track).toHaveBeenCalledWith(expect.objectContaining({ event: "success" }));
  });

  it("bot wypełniający ukryte pole dostaje pozorny sukces i ZERO żądań", async () => {
    renderForm();
    fillMinimal();
    fireEvent.click(consentBoxes()[1]);
    type(honeypotInput(), "https://spam.example");
    actLikeHuman();
    await submit();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(h.guard).not.toHaveBeenCalled();
    expect(h.signUp).not.toHaveBeenCalled();
    expect(h.subscribe).not.toHaveBeenCalled();
  });

  it("formularz odesłany w mniej niż 1,2 s też nie tworzy konta", async () => {
    renderForm();
    fillMinimal();
    fireEvent.click(consentBoxes()[1]);
    // Bez `actLikeHuman()`: zegar stoi w chwili montażu, więc czas wypełnienia
    // wynosi zero - tak wygląda odesłanie formularza przez skrypt.
    await submit();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("podgląd w adminie niczego nie zapisuje i nie podstawia danych administratora", async () => {
    renderForm({ previewOnly: true });
    expect(emailInput()).toHaveAttribute("autocomplete", "off");

    fillMinimal();
    fireEvent.click(consentBoxes()[1]);
    actLikeHuman();
    await submit();

    expect(h.guard).not.toHaveBeenCalled();
    expect(h.signUp).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// METADANE KONTA I PREZENTACJA
// ---------------------------------------------------------------------------

describe("PopupSignupForm: co ląduje w profilu i jak wygląda formularz", () => {
  const acceptPrivacy = () => fireEvent.click(consentBoxes()[1]);

  it("komplet danych rozszerzonych trafia i do konta, i do metadanych subskrybenta", async () => {
    renderForm({
      settings: settings({
        popup_extended_fields: true,
        popup_mailing_lists: [{ id: "tygodnik", label_pl: "Tygodnik", label_en: "Weekly" }],
      }),
    });
    fillMinimal();
    type(firstNameInput(), "Jan");
    type(lastNameInput(), "Kowalski");
    type(jobInput(), "Analityk");
    type(companyInput(), "NES");
    type(linkedinInput(), "https://linkedin.com/in/jan-kowalski");
    type(phoneInput(), "+48600000000");
    fireEvent.change(listSelect(), { target: { value: "tygodnik" } });
    acceptPrivacy();
    actLikeHuman();
    await submit();

    await waitFor(() => expect(h.subscribe).toHaveBeenCalledTimes(1));
    expect(h.subscribe.mock.calls[0][0].data).toMatchObject({
      email: "jan@firma.pl",
      name: "Jan Kowalski",
      firstName: "Jan",
      lastName: "Kowalski",
      language: "pl",
      source: "signup_popup",
      meta: {
        position: "Analityk",
        company: "NES",
        linkedin: "https://linkedin.com/in/jan-kowalski",
        phone: "+48600000000",
        mailing_list: "tygodnik",
      },
    });
    expect(h.signUp.mock.calls[0][0].options.data).toMatchObject({
      first_name: "Jan",
      last_name: "Kowalski",
      position: "Analityk",
      company: "NES",
      signup_type: "reader",
      signup_source: "popup",
      preferred_language: "pl",
      marketing_opt_in: true,
    });
  });

  it("bez imienia i nazwiska nazwą konta zostaje część adresu przed małpą", async () => {
    renderForm();
    fillMinimal("redakcja@nes.eu");
    acceptPrivacy();
    actLikeHuman();
    await submit();

    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
    expect(h.signUp.mock.calls[0][0].options.data.display_name).toBe("redakcja");
    expect(h.subscribe.mock.calls[0][0].data.firstName).toBeUndefined();
  });

  it("źródło zapisu odróżnia powierzchnie - inny widget to inne źródło w bazie", async () => {
    renderForm({ source: "footer" });
    fillMinimal();
    acceptPrivacy();
    actLikeHuman();
    await submit();

    await waitFor(() => expect(h.subscribe).toHaveBeenCalledTimes(1));
    expect(h.subscribe.mock.calls[0][0].data.source).toBe("signup_footer");
    expect(h.track).toHaveBeenCalledWith(expect.objectContaining({ source: "footer" }));
  });

  it("adres powrotu spoza serwisu jest ignorowany - link aktywacyjny wraca na stronę główną", async () => {
    h.auth = { allow_public_signup: true, logged_in_redirect_url: "https://phishing.example" };

    renderForm();
    fillMinimal();
    acceptPrivacy();
    actLikeHuman();
    await submit();

    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
    expect(h.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(`${window.location.origin}/`);
  });

  it("własna ścieżka powrotu z ustawień jest respektowana", async () => {
    h.auth = { allow_public_signup: true, logged_in_redirect_url: "/panel" };

    renderForm();
    fillMinimal();
    acceptPrivacy();
    actLikeHuman();
    await submit();

    await waitFor(() => expect(h.signUp).toHaveBeenCalledTimes(1));
    expect(h.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(
      `${window.location.origin}/panel`,
    );
  });

  it("etykiety i podpowiedzi pól pochodzą z konfiguracji, w obu językach", () => {
    const custom = settings({
      popup_extended_fields: true,
      popup_fields: fieldsWith({
        key: "first_name",
        label_pl: "Imię redaktora",
        label_en: "Editor first name",
        placeholder_pl: "np. Jan",
        placeholder_en: "e.g. Jane",
      }),
    });

    const { rerender } = render(<PopupSignupForm settings={custom} lang="pl" />);
    expect(screen.getByLabelText("Imię redaktora")).toHaveAttribute("placeholder", "np. Jan");

    rerender(<PopupSignupForm settings={custom} lang="en" />);
    expect(screen.getByLabelText("Editor first name")).toHaveAttribute("placeholder", "e.g. Jane");
  });

  it("pole bez podpowiedzi dostaje spacer, żeby etykieta pływająca nie skakała", () => {
    renderForm({
      settings: settings({
        popup_extended_fields: true,
        popup_fields: fieldsWith({ key: "job", placeholder_pl: "", placeholder_en: "" }),
      }),
    });
    expect(jobInput()).toHaveAttribute("placeholder", " ");
  });

  it("gwiazdka przy etykiecie odróżnia pole wymagane od opcjonalnego", () => {
    renderForm({
      settings: settings({
        popup_extended_fields: true,
        popup_fields: fieldsWith(
          { key: "first_name", required: true, label_pl: "Imię" },
          { key: "last_name", required: false, label_pl: "Nazwisko" },
        ),
      }),
    });

    expect(screen.getByLabelText("Imię *")).toBe(firstNameInput());
    expect(screen.getByLabelText("Nazwisko")).toBe(lastNameInput());
  });

  it("przełącznik podglądu hasła odsłania oba pola i zmienia własną etykietę", () => {
    renderForm();
    expect(passwordInputs().map((input) => input.type)).toEqual(["password", "password"]);

    fireEvent.click(screen.getByLabelText("signupPopup.showPassword"));
    expect(passwordInputs().map((input) => input.type)).toEqual(["text", "text"]);

    fireEvent.click(screen.getByLabelText("signupPopup.hidePassword"));
    expect(passwordInputs().map((input) => input.type)).toEqual(["password", "password"]);
  });

  it("układ jednokolumnowy z presetu nie ustawia pól obok siebie", () => {
    const design = defaultPopupDesign();
    const { container } = render(
      <PopupSignupForm
        settings={settings({
          popup_extended_fields: true,
          popup_design: { ...design, form: { ...design.form, twoColumnPairs: false } },
        })}
        lang="pl"
      />,
    );

    expect(container.querySelectorAll(".grid.grid-cols-2")).toHaveLength(0);
  });

  it("wariant kompaktowy zagęszcza odstępy formularza", () => {
    const { container } = render(<PopupSignupForm settings={settings()} lang="pl" compact />);
    expect(container.querySelector("form")).toHaveClass("space-y-2");
  });

  it("podpowiedź nad polami i link do logowania pochodzą z presetu wyglądu", () => {
    const design = defaultPopupDesign();
    render(
      <PopupSignupForm
        settings={settings({
          popup_design: {
            ...design,
            form: { ...design.form, hintPl: "Wypełnij dane", loginLinkHref: "/logowanie" },
          },
        })}
        lang="pl"
      />,
    );

    expect(screen.getByText("Wypełnij dane")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Masz już konto? Zaloguj się" });
    expect(link).toHaveAttribute("href", "/logowanie");
  });

  it("wyłączony link logowania znika, a notka cofa się do tekstu z i18n", () => {
    const design = defaultPopupDesign();
    const { container } = render(
      <PopupSignupForm
        settings={settings({
          popup_note_pl: null,
          popup_note_en: null,
          popup_design: { ...design, form: { ...design.form, showLoginLink: false } },
        })}
        lang="pl"
      />,
    );

    expect(screen.queryByRole("link", { name: "Masz już konto? Zaloguj się" })).toBeNull();
    // Notka nie znika bez śladu: brak obu kolumn cofa ją do tekstu z i18n,
    // więc pod przyciskiem nadal stoi zdanie o potwierdzeniu adresu.
    expect(screen.getByText("signupPopup.noteFallback")).toBeInTheDocument();
    expect(container.querySelectorAll("form > div")).not.toHaveLength(0);
  });

  it("angielska wersja bierze angielskie teksty CTA, notki i linku logowania", () => {
    render(
      <PopupSignupForm
        settings={settings({ popup_cta_en: "Create account", popup_note_en: "Zero spam." })}
        lang="en"
      />,
    );

    expect(submitButton()).toHaveTextContent("Create account");
    expect(screen.getByText("Zero spam.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Already have an account? Sign in" }),
    ).toBeInTheDocument();
  });

  it("brak CTA w ustawieniach cofa się do tekstu z i18n, nie do pustego przycisku", () => {
    renderForm({ settings: settings({ popup_cta_pl: "", popup_cta_en: "" }) });
    expect(submitButton()).toHaveTextContent("signupPopup.ctaFallback");
    expect(submitButton()).toHaveAttribute("aria-label", "signupPopup.ctaFallback");
  });

  it("ikona CTA z presetu renderuje się obok napisu, a jej brak nic nie psuje", () => {
    const design = defaultPopupDesign();
    const { container, rerender } = render(<PopupSignupForm settings={settings()} lang="pl" />);
    expect(container.querySelectorAll("button[type='submit'] svg")).toHaveLength(1);

    rerender(
      <PopupSignupForm
        settings={settings({
          popup_design: { ...design, form: { ...design.form, ctaIcon: "" } },
        })}
        lang="pl"
      />,
    );
    expect(container.querySelectorAll("button[type='submit'] svg")).toHaveLength(0);
  });
});
