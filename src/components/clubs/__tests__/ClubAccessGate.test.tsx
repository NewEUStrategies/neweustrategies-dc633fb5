// Bramka dostępu do klubu - RENDER.
//
// Decyzję „co pokazać” testuje `lib/clubs/__tests__/gateView.test.ts` na
// czystym deskryptorze (macierz 3 × 3 × 2 × katalog progów). Tutaj sprawdzamy
// to, czego deskryptor nie obejmuje: że komponent RYSUJE to, co deskryptor
// mu każe, i że formularz rejestracji w bramce faktycznie zakłada konto.
//
// Jeden test na wariant, plus ścieżka rejestracji - bo bramka jest
// powierzchnią KONWERSJI: to jedyny moment, w którym intencja osoby trafiającej
// tu z newslettera albo wyszukiwarki jest najwyższa.
//
// ZAKRES DOŁOŻONY 2026-08-19 (bramka stała na 83,7% instrukcji / 66,3% gałęzi /
// 65,4% funkcji, bo cała KONFIGURACJA pól rejestracji była w teście zamrożona
// na trzech polach):
//
//   1. POLA REJESTRACJI SĄ KONFIGUROWALNE Z PANELU (`newsletter_settings.
//      popup_fields`), a bramka dzieli to źródło z popupem i `/login`. Każde
//      pole ma więc DWIE gałęzie - włączone i wyłączone - i każde z nich ma
//      własny handler `onChange`, którego v8 nie zaliczy bez wywołania.
//      Atrapa `useRegistrationFields` jest teraz STEROWANA Z TESTU, a nie
//      zamrożona; wariant „wszystkie pola” i „minimum” jadą tabelą.
//   2. WALIDACJA MA CZTERY WYJŚCIA, nie dwa: adres, długość hasła, niezgodność
//      powtórzenia hasła i BRAK pola wymaganego (z nazwą tego pola
//      w komunikacie). Trzecie i czwarte istniały bez ani jednego dowodu.
//   3. STAN WYSYŁKI (`busy`) blokuje przycisk i zmienia etykietę - bez tego
//      podwójne kliknięcie zakłada konto dwa razy.
//   4. PODGLĄD HASŁA to przełącznik, nie dekoracja: `type` pola musi się
//      realnie zmienić, bo inaczej ikona kłamie o stanie.
//   5. ZGODA NEWSLETTEROWA trafia do metadanych rejestracji z wartością, którą
//      użytkownik faktycznie ustawił - i NIE trafia, gdy pole jest wyłączone.
//   6. AWARIA STRAŻNIKA logowania inna niż limit prób nie może udawać limitu.
//   7. Pola opcjonalne karty klubu (`tagline`, liczniki, nazwa w drugim
//      języku) - obecne i nieobecne.
//
// CZTERY GAŁĘZIE NIEOSIĄGALNE - świadomie, z powodem:
// - linie 112 i 116, `club.member_count ?? 0` i `club.thread_count ?? 0`:
//   `club_view` typuje oba jako `number` (nie `number | null`), więc prawe
//   ramię `??` nie ma wejścia. Wymuszenie go potrzebowałoby rzutowania,
//   którego reguły repozytorium zabraniają. Obrona zostaje w kodzie na wypadek
//   zmiany kontraktu RPC - tylko nie da się jej wywołać z TypeScriptu.
// - linia 204 (`if (action.kind === "request")` - ramię `else`) i linia 225
//   (`return null` w `MemberActions`): `MemberActions` renderuje się WYŁĄCZNIE
//   dla zalogowanego, a `clubGateView` daje akcję `signup` tylko dla
//   niezalogowanego. Żadna akcja spoza trójki upgrade/plans/request tam nie
//   dojdzie. To zapasowe `null` jest martwe i jest obserwacją o KODZIE, nie
//   luką w testach - usunięcie należy do właściciela komponentu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/** Klucze pól rejestracji dokładnie w kształcie `RegistrationFieldKey`. */
const WSZYSTKIE_POLA = [
  "first_name",
  "last_name",
  "job",
  "company",
  "linkedin",
  "email",
  "phone",
  "password",
  "password_confirm",
  "newsletter_optin",
] as const;

/** Minimum, na którym stał ten plik przed rozszerzeniem zakresu. */
const MINIMUM_POL = ["first_name", "email", "password"] as const;

const h = vi.hoisted(() => ({
  auth: { session: null as { user: { id: string } } | null, loading: false },
  badges: [] as string[] | undefined,
  signUp: vi.fn(),
  preAuthGuard: vi.fn(),
  toastError: vi.fn(),
  /** Pola WŁĄCZONE w panelu - atrapa czyta to leniwie, przy każdym renderze. */
  enabled: ["first_name", "email", "password"] as readonly string[],
  /** Pola WYMAGANE - podzbiór włączonych; `email` i `password` zawsze. */
  required: ["first_name", "email", "password"] as readonly string[],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}|${JSON.stringify(options)}`,
    i18n: { language: "pl" },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children?: unknown; to?: string }) => (
    <a href={to} {...rest}>
      {children as never}
    </a>
  ),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => h.preAuthGuard }));
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/lib/profile/badges", () => ({ useUserBadges: () => ({ data: h.badges }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signUp: h.signUp } },
}));
vi.mock("@/lib/auth/bruteforce.functions", () => ({ preAuthGuard: h.preAuthGuard }));
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("@/lib/i18n-club-gate", () => ({}));
// Konfiguracja pól rejestracji jedzie Z PANELU (`newsletter_settings.popup_fields`),
// więc atrapa musi być STEROWANA Z TESTU - inaczej połowa formularza nigdy się
// nie renderuje i jej handlery zostają niewywołane. Odczyt jest LENIWY (funkcje
// czytają `h` przy wywołaniu), więc zmiana konfiguracji między testami działa
// bez przeładowywania modułu.
vi.mock("@/lib/auth/registrationFields", () => ({
  buildSignupMetadata: (input: Record<string, unknown>, context: Record<string, unknown>) => ({
    ...input,
    ...context,
  }),
  useRegistrationFields: () => ({
    isEnabled: (key: string) => h.enabled.includes(key),
    isRequired: (key: string) => h.required.includes(key),
    // Etykieta z panelu wygrywa z domyślną - zwracamy rozpoznawalny prefiks,
    // żeby test widział, KTÓRE źródło etykiety zadziałało.
    label: (key: string, fallback: string) => `panel:${key}:${fallback}`,
    visible: h.enabled.map((key) => ({ key, required: h.required.includes(key) })),
  }),
}));

import { ClubAccessGate } from "@/components/clubs/organisms/ClubAccessGate";
import { clubViewRow } from "@/test/clubs/fixtures";
import type { ClubViewRow } from "@/lib/clubs/types";

function gate(overrides: Partial<ClubViewRow> = {}) {
  return render(<ClubAccessGate club={clubViewRow(overrides)} />);
}

/** Czy w dokumencie jest element, którego treść niesie dany klucz i18n. */
function hasKey(key: string): boolean {
  return screen.queryAllByText((text) => text.includes(key)).length > 0;
}

beforeEach(() => {
  h.auth = { session: null, loading: false };
  h.badges = [];
  h.enabled = [...MINIMUM_POL];
  h.required = [...MINIMUM_POL];
  h.signUp.mockReset().mockResolvedValue({ error: null });
  h.preAuthGuard.mockReset().mockResolvedValue({ ok: true });
  h.toastError.mockReset();
  window.history.replaceState({}, "", "/club/klub-energetyczny");
});

describe("warianty bramki", () => {
  it("ANONIM widzi zdanie dla niezalogowanego i formularz rejestracji", () => {
    gate();

    expect(hasKey("clubGate.anonLead")).toBe(true);
    expect(screen.getByRole("button", { name: /clubGate\.signupSubmit/ })).toBeTruthy();
    // Bez konta nie ma czego prosić ani czego podnosić.
    expect(hasKey("clubGate.upgradeCta")).toBe(false);
    expect(hasKey("clubGate.requestCta")).toBe(false);
  });

  it("ZALOGOWANY z za niskim planem widzi upsell i NIE widzi prośby", () => {
    h.auth = { session: { user: { id: "u1" } }, loading: false };

    gate({ reason: "tier_too_low" });

    expect(hasKey("clubGate.upgradeLead")).toBe(true);
    expect(hasKey("clubGate.upgradeCta")).toBe(true);
    expect(hasKey("clubGate.plansCta")).toBe(true);
    expect(hasKey("clubGate.requestCta")).toBe(false);
    expect(hasKey("clubGate.upgradeOnlyNote")).toBe(true);
  });

  it("EKSPERT z za niskim planem widzi upsell ORAZ prośbę z notką", () => {
    h.auth = { session: { user: { id: "u1" } }, loading: false };
    h.badges = ["expert"];

    gate({ reason: "tier_too_low" });

    expect(hasKey("clubGate.upgradeCta")).toBe(true);
    expect(hasKey("clubGate.requestCta")).toBe(true);
    expect(hasKey("clubGate.expertBadge")).toBe(true);
    expect(hasKey("clubGate.upgradeOnlyNote")).toBe(false);
  });

  it("ZALOGOWANY z wystarczającym planem widzi SAMĄ prośbę o dostęp", () => {
    h.auth = { session: { user: { id: "u1" } }, loading: false };

    gate({ reason: "" });

    expect(hasKey("clubGate.joinLead")).toBe(true);
    expect(hasKey("clubGate.requestCta")).toBe(true);
    expect(hasKey("clubGate.upgradeCta")).toBe(false);
  });

  it("klub OTWARTY mówi 'dołącz', nie 'poproś'", () => {
    h.auth = { session: { user: { id: "u1" } }, loading: false };

    gate({ reason: "", join_policy: "open" });

    expect(hasKey("clubGate.joinCta")).toBe(true);
    expect(hasKey("clubGate.requestCta")).toBe(false);
  });

  it("klub TYLKO Z ZAPROSZENIA nie pokazuje prośby nawet ekspertowi", () => {
    h.auth = { session: { user: { id: "u1" } }, loading: false };
    h.badges = ["expert"];

    gate({ reason: "tier_too_low", join_policy: "invite" });

    expect(hasKey("clubGate.requestCta")).toBe(false);
    expect(hasKey("clubGate.joinCta")).toBe(false);
    expect(hasKey("clubGate.expertBadge")).toBe(false);
  });

  it("sesja W TRAKCIE ładowania jest traktowana jak brak sesji", () => {
    // Migotanie „zaloguj się" -> „poproś o dostęp" przy każdym wejściu na
    // stronę wygląda jak awaria; bramka czeka na rozstrzygnięcie sesji.
    h.auth = { session: { user: { id: "u1" } }, loading: true };

    gate({ reason: "" });

    expect(hasKey("clubGate.anonLead")).toBe(true);
  });

  it("prośba prowadzi na stronę 'o klubie' TEGO klubu", () => {
    h.auth = { session: { user: { id: "u1" } }, loading: false };

    const { container } = gate({ reason: "", slug: "klub-energetyczny" });

    const link = container.querySelector('a[href*="/club/"]');
    expect(link?.getAttribute("href")).toContain("about");
  });

  it("KAŻDY wariant pokazuje pełen katalog korzyści", () => {
    for (const session of [null, { user: { id: "u1" } }]) {
      h.auth = { session, loading: false };
      const { unmount } = gate();

      for (const key of ["threads", "library", "calendar", "network", "chatham", "briefs"]) {
        expect(hasKey(`clubGate.benefits.${key}.title`), `${key} przy session=${session}`).toBe(
          true,
        );
      }
      unmount();
    }
  });

  it("nazwa i etykieta planu biorą się z karty klubu, nie ze stałej", () => {
    gate({ name_pl: "Klub transportowy", min_tier_rank: 30 });

    expect(screen.getByText("Klub transportowy")).toBeTruthy();
    // Ranga 30 to `corporate` - lokalna mapa pokazywałaby tu „PRO".
    expect(hasKey("club.planTier.corporate")).toBe(true);
  });
});

describe("formularz rejestracji w bramce", () => {
  /**
   * Pola formularza nie mają atrybutu `name` (etykiety wiąże `htmlFor` z
   * generowanym `id`), więc trafiamy w nie po TYPIE - a ten wynika wprost
   * z konfiguracji pól rejestracji: tekst = imię, email, hasło.
   */
  function fill(email: string, password: string, firstName = "Jan") {
    for (const input of document.querySelectorAll("input")) {
      // WŁAŚCIWOŚĆ `type`, nie atrybut: pole imienia nie ma atrybutu `type`
      // w markupie (domyślne „text"), więc `getAttribute` oddaje tam `null`.
      if (input.type === "email") fireEvent.change(input, { target: { value: email } });
      else if (input.type === "password") fireEvent.change(input, { target: { value: password } });
      else if (input.type === "text") fireEvent.change(input, { target: { value: firstName } });
    }
  }

  function submit() {
    const form = document.querySelector("form");
    if (form !== null) fireEvent.submit(form);
  }

  it("odrzuca niepoprawny adres BEZ wychodzenia do bazy", async () => {
    gate();
    fill("nie-adres", "haslo12345");

    submit();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("clubGate.errors.email"));
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("odrzuca hasło krótsze niż osiem znaków", async () => {
    gate();
    fill("kandydat@example.org", "krotkie");

    submit();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("clubGate.errors.password"));
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("adres jest normalizowany do małych liter i przycinany", async () => {
    gate();
    fill("  Kandydat@Example.ORG  ", "haslo12345");

    submit();

    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
    expect(h.signUp.mock.calls[0]?.[0]).toMatchObject({ email: "kandydat@example.org" });
  });

  it("po rejestracji wraca DOKŁADNIE na tę stronę klubu", async () => {
    gate();
    fill("kandydat@example.org", "haslo12345");

    submit();

    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
    // Intencja użytkownika nie może zginąć w podróży przez skrzynkę pocztową.
    const options = h.signUp.mock.calls[0]?.[0] as { options: { emailRedirectTo: string } };
    expect(options.options.emailRedirectTo).toContain("/club/klub-energetyczny");
  });

  it("limit prób logowania daje własny komunikat, nie ogólny", async () => {
    h.preAuthGuard.mockRejectedValue(new Error("rate_limited"));
    gate();
    fill("kandydat@example.org", "haslo12345");

    submit();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("clubGate.errors.rate"));
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("odmowa rejestracji pokazuje komunikat ogólny", async () => {
    h.signUp.mockResolvedValue({ error: new Error("user exists") });
    gate();
    fill("kandydat@example.org", "haslo12345");

    submit();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("clubGate.errors.generic"));
  });

  it("po udanej rejestracji formularz ustępuje miejsca potwierdzeniu", async () => {
    gate();
    fill("kandydat@example.org", "haslo12345");

    submit();

    await waitFor(() => expect(hasKey("clubGate.sentTitle")).toBe(true));
  });
});

// --- konfiguracja pól rejestracji ------------------------------------------

describe("pola rejestracji sterowane z panelu", () => {
  /** Pole o etykiecie zawierającej dany klucz konfiguracji. */
  function pole(key: string): HTMLInputElement {
    const label = screen.getByText((text) => text.includes(`panel:${key}:`));
    const id = label.getAttribute("for");
    const input = id === null ? null : document.getElementById(id);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`test: pole ${key} nie ma powiązanego wejścia`);
    }
    return input;
  }

  function czyJestPole(key: string): boolean {
    return screen.queryAllByText((text) => text.includes(`panel:${key}:`)).length > 0;
  }

  it("wyłączone pole NIE renderuje się - panel jest jedynym źródłem prawdy", () => {
    h.enabled = ["email", "password"];
    h.required = ["email", "password"];
    gate();
    expect(czyJestPole("email")).toBe(true);
    for (const key of ["first_name", "last_name", "job", "company", "linkedin", "phone"]) {
      expect(czyJestPole(key), `pole ${key} nie powinno się renderować`).toBe(false);
    }
  });

  it("pełna konfiguracja renderuje KAŻDE pole ze słownika", () => {
    h.enabled = [...WSZYSTKIE_POLA];
    h.required = ["first_name", "email", "password", "password_confirm"];
    gate();
    for (const key of WSZYSTKIE_POLA.filter((k) => k !== "newsletter_optin")) {
      expect(czyJestPole(key), `brak pola ${key}`).toBe(true);
    }
    // Zgoda newsletterowa nie jest polem tekstowym - to pole wyboru.
    expect(screen.getByRole("checkbox")).toBeTruthy();
  });

  it.each(["first_name", "last_name", "job", "company", "linkedin", "phone"])(
    "pole %s przyjmuje wpisaną wartość - każde ma WŁASNY handler",
    (key) => {
      // v8 zalicza funkcję anonimową dopiero po jej wywołaniu, a każde z tych
      // pól ma osobne `onChange={(event) => set("...", ...)}`. Przeklejona
      // nazwa klucza przechodzi przez `tsc`, bo wszystkie są napisami.
      h.enabled = [...WSZYSTKIE_POLA];
      h.required = ["email", "password"];
      gate();
      const input = pole(key);
      fireEvent.change(input, { target: { value: `wartość-${key}` } });
      expect(input.value).toBe(`wartość-${key}`);
    },
  );

  it("etykieta pola WYMAGANEGO dostaje gwiazdkę, opcjonalnego nie", () => {
    h.enabled = ["first_name", "last_name", "email", "password"];
    h.required = ["first_name", "email", "password"];
    gate();
    const wymagane = screen.getByText((text) => text.includes("panel:first_name:"));
    const opcjonalne = screen.getByText((text) => text.includes("panel:last_name:"));
    expect(wymagane.textContent).toContain("*");
    expect(opcjonalne.textContent).not.toContain("*");
  });

  it("brak imienia I nazwiska nie zostawia pustej siatki dwukolumnowej", () => {
    // Kontener obu pól ma własny warunek `on("first_name") || on("last_name")`:
    // bez niego w formularzu zostaje puste `<div class="grid">` z marginesem.
    h.enabled = ["email", "password"];
    h.required = ["email", "password"];
    const { container } = gate();
    const siatki = container.querySelectorAll("form > .grid");
    for (const siatka of siatki) {
      expect(siatka.querySelectorAll("input").length).toBeGreaterThan(0);
    }
  });

  it("samo nazwisko bez imienia też renderuje siatkę - warunek jest ALTERNATYWĄ", () => {
    h.enabled = ["last_name", "email", "password"];
    h.required = ["email", "password"];
    gate();
    expect(czyJestPole("last_name")).toBe(true);
    expect(czyJestPole("first_name")).toBe(false);
  });

  it("zgoda newsletterowa jest domyślnie ZAZNACZONA i daje się wyłączyć", () => {
    h.enabled = [...WSZYSTKIE_POLA];
    gate();
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox.getAttribute("data-state")).toBe("checked");
    fireEvent.click(checkbox);
    expect(checkbox.getAttribute("data-state")).toBe("unchecked");
  });

  it("wyłączona zgoda newsletterowa nie renderuje pola wyboru", () => {
    h.enabled = ["email", "password"];
    gate();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

// --- podgląd hasła ---------------------------------------------------------

describe("podgląd hasła", () => {
  function polaHasla(): HTMLInputElement[] {
    return Array.from(document.querySelectorAll("input")).filter(
      (input) => input.type === "password" || input.autocomplete === "new-password",
    );
  }

  it("przełącznik zmienia TYP pola, a nie tylko ikonę", () => {
    // Ikona bez zmiany typu kłamie o stanie: użytkownik widzi „oko otwarte”
    // i nadal nie widzi hasła.
    gate();
    const przed = polaHasla()[0];
    expect(przed.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "clubGate.password" }));
    expect(polaHasla()[0].type).toBe("text");
  });

  it("przełącznik działa W OBIE strony", () => {
    gate();
    const toggle = screen.getByRole("button", { name: "clubGate.password" });
    fireEvent.click(toggle);
    expect(polaHasla()[0].type).toBe("text");
    fireEvent.click(toggle);
    expect(polaHasla()[0].type).toBe("password");
  });

  it("podgląd obejmuje TAKŻE pole powtórzenia hasła", () => {
    // Inaczej użytkownik widzi jedno hasło jawnie, a drugie w kropkach
    // i nie może ich porównać - czyli przełącznik nie robi tego, co obiecuje.
    h.enabled = [...WSZYSTKIE_POLA];
    h.required = ["email", "password", "password_confirm"];
    gate();
    fireEvent.click(screen.getByRole("button", { name: "clubGate.password" }));
    const jawne = Array.from(document.querySelectorAll("input")).filter(
      (input) => input.autocomplete === "new-password",
    );
    expect(jawne).toHaveLength(2);
    for (const input of jawne) expect(input.type).toBe("text");
  });

  it("przełącznik jest `type=button` - w formularzu nie może wysyłać", () => {
    gate();
    expect(screen.getByRole("button", { name: "clubGate.password" }).getAttribute("type")).toBe(
      "button",
    );
  });
});

// --- walidacja i wysyłka, przypadki brakujące ------------------------------

describe("walidacja formularza - cztery wyjścia, nie dwa", () => {
  /** Wypełnia pole o danej etykiecie panelowej. */
  function wpisz(key: string, value: string): void {
    const label = screen.getByText((text) => text.includes(`panel:${key}:`));
    const id = label.getAttribute("for");
    const input = id === null ? null : document.getElementById(id);
    if (!(input instanceof HTMLInputElement)) throw new Error(`test: brak pola ${key}`);
    fireEvent.change(input, { target: { value } });
  }

  function wyslij(): void {
    const form = document.querySelector("form");
    if (form !== null) fireEvent.submit(form);
  }

  it("NIEZGODNE powtórzenie hasła nie wychodzi do bazy", async () => {
    h.enabled = [...WSZYSTKIE_POLA];
    h.required = ["email", "password", "password_confirm"];
    gate();
    wpisz("email", "kandydat@example.org");
    wpisz("password", "haslo12345");
    wpisz("password_confirm", "haslo54321");
    wyslij();
    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith("clubGate.errors.passwordMismatch");
    });
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("ZGODNE powtórzenie hasła przechodzi", async () => {
    h.enabled = [...WSZYSTKIE_POLA];
    h.required = ["email", "password", "password_confirm"];
    gate();
    wpisz("email", "kandydat@example.org");
    wpisz("password", "haslo12345");
    wpisz("password_confirm", "haslo12345");
    wyslij();
    await waitFor(() => {
      expect(h.signUp).toHaveBeenCalledTimes(1);
    });
  });

  it("BRAK pola wymaganego nazywa TO pole w komunikacie", async () => {
    // Ogólne „wypełnij wymagane pola” przy formularzu z ośmioma polami jest
    // bezużyteczne - użytkownik musi wiedzieć, którego brakuje.
    // BEZ `password_confirm`: jego kontrola stoi PRZED pętlą pól wymaganych,
    // więc włączone i niewypełnione przechwyciłoby ten przypadek.
    h.enabled = WSZYSTKIE_POLA.filter((key) => key !== "password_confirm");
    h.required = ["first_name", "company", "email", "password"];
    gate();
    wpisz("email", "kandydat@example.org");
    wpisz("password", "haslo12345");
    wpisz("first_name", "Jan");
    wyslij();
    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith(
        expect.stringContaining("clubGate.errors.required"),
      );
    });
    const komunikat = String(h.toastError.mock.calls.at(-1)?.[0]);
    expect(komunikat).toContain("company");
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("pole wymagane wypełnione SAMYMI SPACJAMI liczy się jak puste", async () => {
    h.enabled = WSZYSTKIE_POLA.filter((key) => key !== "password_confirm");
    h.required = ["first_name", "email", "password"];
    gate();
    wpisz("email", "kandydat@example.org");
    wpisz("password", "haslo12345");
    wpisz("first_name", "    ");
    wyslij();
    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith(
        expect.stringContaining("clubGate.errors.required"),
      );
    });
  });

  it("zgoda newsletterowa i lista NIE są sprawdzane jako pola wymagane", async () => {
    // Oba są wykluczone z pętli sprawdzającej z premedytacją: pole wyboru nie
    // ma wartości tekstowej, a lista jest wypełniana po stronie serwera.
    h.enabled = [...WSZYSTKIE_POLA];
    h.required = [...WSZYSTKIE_POLA];
    gate();
    for (const key of WSZYSTKIE_POLA.filter((k) => k !== "newsletter_optin")) {
      if (key === "email") wpisz(key, "kandydat@example.org");
      else if (key === "password" || key === "password_confirm") wpisz(key, "haslo12345");
      else wpisz(key, "wartość");
    }
    wyslij();
    await waitFor(() => {
      expect(h.signUp).toHaveBeenCalledTimes(1);
    });
  });

  it("zgoda newsletterowa trafia do metadanych z wartością USTAWIONĄ przez użytkownika", async () => {
    h.enabled = [...WSZYSTKIE_POLA];
    h.required = ["email", "password", "password_confirm"];
    gate();
    wpisz("email", "kandydat@example.org");
    wpisz("password", "haslo12345");
    wpisz("password_confirm", "haslo12345");
    fireEvent.click(screen.getByRole("checkbox"));
    wyslij();
    await waitFor(() => {
      expect(h.signUp).toHaveBeenCalledTimes(1);
    });
    const call = h.signUp.mock.calls[0]?.[0] as {
      options: { data: { newsletterOptIn: boolean; source: string } };
    };
    expect(call.options.data.newsletterOptIn).toBe(false);
    expect(call.options.data.source).toBe("club_gate");
  });

  it("wyłączone pole zgody wysyła `newsletterOptIn = false`, a nie domyślne `true`", async () => {
    h.enabled = ["email", "password"];
    h.required = ["email", "password"];
    gate();
    wpisz("email", "kandydat@example.org");
    wpisz("password", "haslo12345");
    wyslij();
    await waitFor(() => {
      expect(h.signUp).toHaveBeenCalledTimes(1);
    });
    const call = h.signUp.mock.calls[0]?.[0] as {
      options: { data: { newsletterOptIn: boolean } };
    };
    expect(call.options.data.newsletterOptIn).toBe(false);
  });

  it("wszystkie wpisane pola profilu jadą do metadanych rejestracji", async () => {
    h.enabled = [...WSZYSTKIE_POLA];
    h.required = ["email", "password", "password_confirm"];
    gate();
    wpisz("email", "kandydat@example.org");
    wpisz("password", "haslo12345");
    wpisz("password_confirm", "haslo12345");
    wpisz("first_name", "Jan");
    wpisz("last_name", "Kowalski");
    wpisz("job", "Dyrektor");
    wpisz("company", "NES");
    wpisz("linkedin", "https://www.linkedin.com/in/jan");
    wpisz("phone", "+48 601 202 303");
    wyslij();
    await waitFor(() => {
      expect(h.signUp).toHaveBeenCalledTimes(1);
    });
    const call = h.signUp.mock.calls[0]?.[0] as {
      options: { data: Record<string, unknown> };
    };
    expect(call.options.data).toMatchObject({
      firstName: "Jan",
      lastName: "Kowalski",
      job: "Dyrektor",
      company: "NES",
      linkedin: "https://www.linkedin.com/in/jan",
      phone: "+48 601 202 303",
      email: "kandydat@example.org",
    });
  });

  it("awaria STRAŻNIKA inna niż limit prób daje komunikat ogólny, nie „limit”", async () => {
    // Zamiana tych dwóch komunikatów wysyłałaby użytkownika na czekanie
    // piętnastu minut przy awarii, która nie ma z limitem nic wspólnego.
    h.preAuthGuard.mockRejectedValue(new Error("upstream timeout"));
    h.enabled = ["email", "password"];
    h.required = ["email", "password"];
    gate();
    const label = screen.getByText((text) => text.includes("panel:email:"));
    const id = label.getAttribute("for");
    const input = id === null ? null : document.getElementById(id);
    if (input instanceof HTMLInputElement) {
      fireEvent.change(input, { target: { value: "kandydat@example.org" } });
    }
    const pw = Array.from(document.querySelectorAll("input")).find((i) => i.type === "password");
    if (pw !== undefined) fireEvent.change(pw, { target: { value: "haslo12345" } });
    wyslij();
    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith("clubGate.errors.generic");
    });
    expect(h.toastError).not.toHaveBeenCalledWith("clubGate.errors.rate");
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("odrzucenie strażnika BEZ obiektu Error też kończy się komunikatem ogólnym", async () => {
    // Strażnik jest funkcją serwerową: przy błędzie transportu odrzucenie
    // potrafi nie być instancją `Error`, a odczyt `.message` na czymkolwiek
    // innym wywracałby całą bramkę zamiast pokazać komunikat.
    h.preAuthGuard.mockRejectedValue("padło");
    h.enabled = ["email", "password"];
    h.required = ["email", "password"];
    gate();
    wpisz("email", "kandydat@example.org");
    wpisz("password", "haslo12345");
    wyslij();
    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith("clubGate.errors.generic");
    });
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it("przycisk wysyłki jest ODCINANY na czas rejestracji i zmienia etykietę", async () => {
    // Bez tego podwójne kliknięcie zakłada konto dwa razy, a druga próba
    // wraca błędem „użytkownik istnieje” na koncie, które właśnie powstało.
    let zwolnij: (() => void) | null = null;
    h.signUp.mockImplementation(
      () =>
        new Promise((resolve) => {
          zwolnij = () => resolve({ error: null });
        }),
    );
    h.enabled = ["email", "password"];
    h.required = ["email", "password"];
    gate();
    const label = screen.getByText((text) => text.includes("panel:email:"));
    const id = label.getAttribute("for");
    const input = id === null ? null : document.getElementById(id);
    if (input instanceof HTMLInputElement) {
      fireEvent.change(input, { target: { value: "kandydat@example.org" } });
    }
    const pw = Array.from(document.querySelectorAll("input")).find((i) => i.type === "password");
    if (pw !== undefined) fireEvent.change(pw, { target: { value: "haslo12345" } });
    wyslij();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /clubGate\.signupBusy/ })).toBeTruthy();
    });
    const przycisk = screen.getByRole("button", { name: /clubGate\.signupBusy/ });
    expect(przycisk.hasAttribute("disabled")).toBe(true);
    wyslij();
    expect(h.signUp).toHaveBeenCalledTimes(1);
    if (zwolnij !== null) zwolnij();
    await waitFor(() => {
      expect(hasKey("clubGate.sentTitle")).toBe(true);
    });
  });

  it("potwierdzenie wysyłki niesie ADRES i drogę do cennika", async () => {
    h.enabled = ["email", "password"];
    h.required = ["email", "password"];
    gate();
    const label = screen.getByText((text) => text.includes("panel:email:"));
    const id = label.getAttribute("for");
    const input = id === null ? null : document.getElementById(id);
    if (input instanceof HTMLInputElement) {
      fireEvent.change(input, { target: { value: "  Kandydat@Example.ORG  " } });
    }
    const pw = Array.from(document.querySelectorAll("input")).find((i) => i.type === "password");
    if (pw !== undefined) fireEvent.change(pw, { target: { value: "haslo12345" } });
    const form = document.querySelector("form");
    if (form !== null) fireEvent.submit(form);
    await waitFor(() => {
      expect(hasKey("clubGate.sentTitle")).toBe(true);
    });
    // Adres w potwierdzeniu jest ZNORMALIZOWANY - inaczej użytkownik szuka
    // wiadomości pod innym adresem, niż faktycznie ją dostał.
    expect(hasKey("kandydat@example.org")).toBe(true);
    expect(screen.getByRole("link", { name: "clubGate.plansCta" }).getAttribute("href")).toBe(
      "/pricing",
    );
    // Potwierdzenie ZASTĄPIŁO formularz.
    expect(document.querySelector("form")).toBeNull();
  });

  it("po odmowie rejestracji przycisk WRACA do stanu gotowego", async () => {
    h.signUp.mockResolvedValue({ error: new Error("user exists") });
    h.enabled = ["email", "password"];
    h.required = ["email", "password"];
    gate();
    const label = screen.getByText((text) => text.includes("panel:email:"));
    const id = label.getAttribute("for");
    const input = id === null ? null : document.getElementById(id);
    if (input instanceof HTMLInputElement) {
      fireEvent.change(input, { target: { value: "kandydat@example.org" } });
    }
    const pw = Array.from(document.querySelectorAll("input")).find((i) => i.type === "password");
    if (pw !== undefined) fireEvent.change(pw, { target: { value: "haslo12345" } });
    wyslij();
    await waitFor(() => {
      expect(h.toastError).toHaveBeenCalledWith("clubGate.errors.generic");
    });
    expect(
      screen.getByRole("button", { name: /clubGate\.signupSubmit/ }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("formularz ma drogę do LOGOWANIA dla osoby, która konto już ma", async () => {
    gate();
    const link = screen.getByRole("link", { name: "clubGate.signIn" });
    expect(link.getAttribute("href")).toBe("/login");
  });
});

// --- pola opcjonalne karty klubu -------------------------------------------

describe("karta klubu - pola opcjonalne", () => {
  it("zajawka renderuje się, gdy jest", () => {
    gate({ tagline_pl: "Energia i klimat", tagline_en: "Energy and climate" });
    expect(screen.getByText("Energia i klimat")).toBeTruthy();
  });

  it("brak zajawki nie zostawia pustego akapitu", () => {
    const { container } = gate({ tagline_pl: "", tagline_en: "" });
    const naglowek = container.querySelector("h1");
    expect(naglowek).not.toBeNull();
    // Zaraz po nagłówku ma stać lista liczników, nie puste `<p>`.
    expect(naglowek?.nextElementSibling?.tagName).toBe("DL");
  });

  it("brak nazwy w języku interfejsu degraduje do polskiej, nie do pustki", () => {
    gate({ name_pl: "Klub energetyczny", name_en: "" });
    expect(screen.getByText("Klub energetyczny")).toBeTruthy();
  });

  it("brak nazwy w OBU językach degraduje do kolumny `name_pl`, nie do pustego nagłówka", () => {
    // `pickLocalized` oddaje pusty napis, gdy obie kolumny są puste; `|| name_pl`
    // jest ostatnią linią obrony, żeby nagłówek strony nie był pusty.
    const { container } = gate({ name_pl: "", name_en: "" });
    expect(container.querySelector("h1")).not.toBeNull();
  });

  it("odznaki JESZCZE W LOCIE nie robią z nikogo eksperta", () => {
    // `?? []` przy `badgesQ.data`: zapytanie o odznaki startuje bez danych, więc
    // bez tej obrony `includes` wywalałoby całą bramkę przy pierwszym renderze.
    h.auth = { session: { user: { id: "u1" } }, loading: false };
    h.badges = undefined;
    gate({ reason: "tier_too_low" });
    expect(hasKey("clubGate.expertBadge")).toBe(false);
    expect(hasKey("clubGate.upgradeOnlyNote")).toBe(true);
  });

  it("liczniki pokazują ZERO, a nie pustkę, gdy klub jest świeży", () => {
    // Świeży klub istnieje i musi się przedstawić - „0 członków” jest
    // uczciwą informacją, a brak licznika wygląda jak awaria.
    gate({ member_count: 0, thread_count: 0 });
    expect(hasKey("clubGate.statsMembers")).toBe(true);
    expect(hasKey("clubGate.statsThreads")).toBe(true);
  });
});
