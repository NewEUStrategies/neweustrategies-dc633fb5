// Bramka dostępu do klubu - RENDER.
//
// Decyzję „co pokazać" testuje `lib/clubs/__tests__/gateView.test.ts` na
// czystym deskryptorze (macierz 3 × 3 × 2 × katalog progów). Tutaj sprawdzamy
// to, czego deskryptor nie obejmuje: że komponent RYSUJE to, co deskryptor
// mu każe, i że formularz rejestracji w bramce faktycznie zakłada konto.
//
// Jeden test na wariant, plus ścieżka rejestracji - bo bramka jest
// powierzchnią KONWERSJI: to jedyny moment, w którym intencja osoby trafiającej
// tu z newslettera albo wyszukiwarki jest najwyższa.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  auth: { session: null as { user: { id: string } } | null, loading: false },
  badges: [] as string[],
  signUp: vi.fn(),
  preAuthGuard: vi.fn(),
  toastError: vi.fn(),
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
vi.mock("@/lib/auth/registrationFields", () => ({
  buildSignupMetadata: (input: Record<string, unknown>) => input,
  useRegistrationFields: () => ({
    isEnabled: (key: string) => ["email", "password", "first_name"].includes(key),
    isRequired: (key: string) => ["email", "password", "first_name"].includes(key),
    label: (_key: string, fallback: string) => fallback,
    visible: [
      { key: "first_name", required: true },
      { key: "email", required: true },
      { key: "password", required: true },
    ],
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
