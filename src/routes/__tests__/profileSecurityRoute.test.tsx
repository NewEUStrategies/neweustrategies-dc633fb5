// Trasa `/profile/security` ZAMONTOWANA - panel bezpieczeństwa konta.
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
//
// Reguły tego panelu (walidacja hasła, adresu e-mail, kodu TOTP, widok czynników)
// są czystymi funkcjami z tabelą przypadków w
// `src/lib/auth/__tests__/securityPanel.test.ts`. Ten plik pokrywa to, czego
// tamten nie może - SKLEJENIE z klientem uwierzytelnienia:
//
//   1. PONOWNE UWIERZYTELNIENIE PRZED KAŻDĄ OPERACJĄ WRAŻLIWĄ. Zmiana hasła
//      i zdjęcie drugiego składnika idą przez `signInWithPassword` PRZED
//      właściwym żądaniem. Bez tego kroku każdy, kto usiądzie przy odblokowanym
//      ekranie, zmienia hasło i wyrzuca właściciela z konta.
//   2. POLA CZYŚCI SIĘ WYŁĄCZNIE PO SUKCESIE. Wyczyszczone po błędzie każą
//      wpisywać hasło od nowa i wyglądają jak wykonana zmiana - użytkownik
//      wychodzi przekonany, że hasło zmienił.
//   3. ZMIANA HASŁA UBIJA POZOSTAŁE SESJE. Sens zmiany hasła po wycieku polega
//      na tym, że stare tokeny przestają działać. `signOut({ scope: "others" })`
//      jest tu częścią operacji, nie osobną wygodą.
//   4. AWARIA ODCZYTU CZYNNIKÓW NIE UDAJE „2FA WYŁĄCZONE". To defekt, który
//      istniał w tej trasie: nieudany `listFactors()` zostawiał pustą tablicę,
//      a panel drukował „Wyłączone" osobie z aktywnym drugim składnikiem.
//   5. PORZUCONA KONFIGURACJA JEST SPRZĄTANA. `cancelEnroll` usuwa
//      niepotwierdzony czynnik, żeby nie został w koncie jako połowiczny wpis.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ WALIDACJI: `securityPanel.test.ts` (kolejność zastrzeżeń, granice,
//   normalizacja kodu, cztery stany widoku).
// - MECHANIKI MFA: `lib/auth/mfa.ts` na 100% - wyzwanie, weryfikacja, `toQrDataUri`.
// - USUWANIA KONTA I EKSPORTU RODO: przeniosły się do `/profile/privacy` (§10
//   audytu IA prywatności) i mają własne testy tam.
// - SIŁY HASŁA: `PasswordStrengthMeter` ma własne testy; tu jest atrapą.
//
// CZEGO NIE DA SIĘ TU PRZETESTOWAĆ, BO NIE ISTNIEJE - i to jest ustalenie, nie
// przeoczenie:
// - LISTY SESJI i WYLOGOWANIA POJEDYNCZEJ SESJI. supabase-js nie wystawia
//   listowania sesji po stronie klienta; trasa mówi to wprost w komentarzu.
//   Panel ma jedno „wyloguj pozostałe" i datę ostatniego logowania - i tylko to
//   da się sprawdzić.
// - WYŁĄCZENIA OSTATNIEGO CZYNNIKA PRZY WYMUSZONYM MFA. Platforma nie ma
//   ustawienia „drugi składnik wymagany" (klucz `auth_branding` go nie zawiera -
//   patrz `lib/authSettingsRules.ts`), więc ten stan jest nieosiągalny.
//   Osiągalne i sprawdzone: usunięcie OSTATNIEGO czynnika ma inną treść
//   potwierdzenia niż usunięcie jednego z wielu.
// CZTERY GAŁĘZIE NIEOSIĄGALNE - obrona w kodzie bez wejścia z zewnątrz:
// `cancelEnroll`/`activateEnroll` sprawdzają `enroll`, choć oba przyciski
// renderują się WYŁĄCZNIE wtedy, gdy konfiguracja trwa; `confirmRemove` po
// `factorRemovalProblem() === null` powtarza `!removeId || !email` jako zawężenie
// typu (wejścia już nie ma); a `onOpenChange(true)` dla STEROWANEGO dialogu
// Radiksa nigdy nie leci. Obrona zostaje w kodzie na wypadek przestawienia tych
// warunków - tylko nie da się jej wywołać bez rozmontowania gwarancji, która ją
// czyni zbędną.
// PIĘĆ GAŁĘZI, KTÓRYCH TU NIE DOMKNIĘTO - z numerami linii i powodem, żeby
// nikt ich nie szukał drugi raz. Wszystkie to STRAŻNIKI OBRONNE, które stały
// się nieosiągalne wtedy, gdy reguły panelu wyjechały do czystego modułu
// `lib/auth/securityPanel.ts` (ten jest na 100%):
// - `profile.security.tsx:95`  `if (!email) return` w zmianie hasła. Linia
//   wyżej `passwordChangeProblem` zwraca już `noEmail`, więc do tego strażnika
//   dochodzi wyłącznie stan, który przed nim wypadł.
// - `profile.security.tsx:253` ten sam wzorzec przy usuwaniu czynnika:
//   `factorRemovalProblem` odsiewa brak adresu wcześniej.
// - `profile.security.tsx:215` `if (!enroll) return` w aktywacji czynnika oraz
//   `:207` `if (enroll)` w anulowaniu - obie funkcje są wołane WYŁĄCZNIE
//   z dialogu, który nie istnieje bez `enroll`.
// - `profile.security.tsx:532` `onOpenChange(true)` dialogu usuwania. Dialog
//   jest sterowany przez `removeId`, nie ma wyzwalacza, więc Radix nie ma skąd
//   zgłosić otwarcia.
// Domknięcie którejkolwiek z nich wymagałoby wywołania handlera OBOK
// interfejsu - a taki test dowodzi tylko tego, że umie ominąć przycisk.
// Zmierzone: 98,12% instrukcji, 92,18% gałęzi, 100% funkcji, 100% linii.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Factor } from "@supabase/supabase-js";

const h = vi.hoisted(() => ({
  user: { email: "osoba@example.com", last_sign_in_at: "2026-08-20T10:00:00.000Z" } as {
    email?: string;
    last_sign_in_at?: string;
  } | null,
  signOut: vi.fn(),
  /** Wywołania klienta uwierzytelnienia w kolejności - dowód na re-auth. */
  calls: [] as string[],
  reauthError: null as unknown,
  updateUserError: null as unknown,
  signOutScopeError: null as unknown,
  listFactorsError: null as unknown,
  /**
   * Czy udana odpowiedź `listFactors()` ma PRZYJŚĆ BEZ pola `totp`. Kształt
   * odpowiedzi zależy od typów czynników włączonych w projekcie Supabase, więc
   * brak tego pola nie jest awarią - jest brakiem czynników TOTP.
   */
  listFactorsTotpMissing: false,
  factors: [] as Factor[],
  enrollResult: null as unknown,
  enrollError: null as unknown,
  challengeError: null as unknown,
  verifyError: null as unknown,
  unenrollError: null as unknown,
  changeEmailError: null as unknown,
  changeEmailPayloads: [] as unknown[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user, signOut: h.signOut, session: {}, loading: false }),
}));
vi.mock("@/lib/account.functions", () => ({
  changeMyEmail: (payload: unknown) => {
    h.calls.push("changeMyEmail");
    h.changeEmailPayloads.push(payload);
    return h.changeEmailError === null
      ? Promise.resolve({ ok: true })
      : Promise.reject(h.changeEmailError);
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithPassword: (args: { email: string; password: string }) => {
        h.calls.push(`signInWithPassword:${args.password}`);
        return Promise.resolve({ error: h.reauthError });
      },
      updateUser: (args: { password?: string }) => {
        h.calls.push(`updateUser:${args.password ?? ""}`);
        return Promise.resolve({ error: h.updateUserError });
      },
      signOut: (args?: { scope?: string }) => {
        h.calls.push(`signOut:${args?.scope ?? "global"}`);
        return Promise.resolve({ error: h.signOutScopeError });
      },
      mfa: {
        listFactors: () => {
          h.calls.push("listFactors");
          return Promise.resolve({
            data:
              h.listFactorsError !== null
                ? null
                : h.listFactorsTotpMissing
                  ? {}
                  : { totp: h.factors },
            error: h.listFactorsError,
          });
        },
        enroll: () => {
          h.calls.push("enroll");
          return Promise.resolve({ data: h.enrollResult, error: h.enrollError });
        },
        challenge: () => {
          h.calls.push("challenge");
          return Promise.resolve({
            data: h.challengeError === null ? { id: "chal-1" } : null,
            error: h.challengeError,
          });
        },
        verify: () => {
          h.calls.push("verify");
          return Promise.resolve({ error: h.verifyError });
        },
        unenroll: (args: { factorId: string }) => {
          h.calls.push(`unenroll:${args.factorId}`);
          return h.unenrollError === null
            ? Promise.resolve({ error: null })
            : Promise.reject(h.unenrollError);
        },
      },
    },
  },
}));
vi.mock("@/components/molecules/PasswordStrengthMeter", () => ({
  PasswordStrengthMeter: () => <div data-testid="strength" />,
}));
// Radix AlertDialog nie renderuje treści pod happy-dom bez pełnego pointer API.
// Atrapa oddaje kontrakt: zawartość widoczna TYLKO gdy `open`, plus `onOpenChange`.
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
    onOpenChange,
  }: {
    open: boolean;
    children?: ReactNode;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="remove-dialog">
        <button type="button" data-testid="dialog-close" onClick={() => onOpenChange(false)}>
          zamknij
        </button>
        {children}
      </div>
    ) : null,
  AlertDialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children?: ReactNode }) => (
    <p data-testid="remove-body">{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children?: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
    disabled,
  }: {
    children?: ReactNode;
    onClick: (event: { preventDefault: () => void }) => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      data-testid="remove-confirm"
      disabled={disabled}
      onClick={() => onClick({ preventDefault: () => undefined })}
    >
      {children}
    </button>
  ),
}));

import { renderRoute } from "@/test/routeHarness";
import { Route as SecurityRoute } from "@/routes/profile.security";

const PATH = "/profile/security";

function factor(id: string, friendly = "Aplikacja"): Factor {
  return {
    id,
    friendly_name: friendly,
    factor_type: "totp",
    status: "verified",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

async function mount() {
  const view = await renderRoute({ route: SecurityRoute, path: PATH, initialEntry: PATH });
  // `listFactors()` rozstrzyga się mikrozadaniem PO synchronicznym renderze.
  await waitFor(() => expect(h.calls).toContain("listFactors"));
  return view;
}

const byId = (id: string) => document.getElementById(id) as HTMLInputElement;
const status = () => screen.getByTestId("mfa-status").textContent;

/**
 * Formularz zgłoszony PRZEZ `submit`, nie kliknięciem przycisku.
 *
 * PO CO. Pola noszą `required` i `minLength={8}` (a adres e-mail `type="email"`),
 * więc walidacja natywna przeglądarki blokuje kliknięcie ZANIM zdąży się wykonać
 * walidacja trasy. Test klikający przycisk „dowodziłby" wtedy, że reguła trasy
 * działa, choć nigdy jej nie uruchomił - i przeoczyłby jej usunięcie.
 */
function submitForm(field: string) {
  const form = byId(field).closest("form");
  if (!form) throw new Error(`test: pole ${field} nie stoi w formularzu`);
  fireEvent.submit(form);
}

async function fillPasswordForm(next = "nowe-haslo-1", confirm = next, current = "stare-haslo") {
  fireEvent.change(byId("cur"), { target: { value: current } });
  fireEvent.change(byId("pw"), { target: { value: next } });
  fireEvent.change(byId("pw2"), { target: { value: confirm } });
  submitForm("pw");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { email: "osoba@example.com", last_sign_in_at: "2026-08-20T10:00:00.000Z" };
  h.calls = [];
  h.reauthError = null;
  h.updateUserError = null;
  h.signOutScopeError = null;
  h.listFactorsError = null;
  h.listFactorsTotpMissing = false;
  h.factors = [];
  h.enrollResult = { id: "factor-1", totp: { qr_code: "otpauth://x", secret: "SEKRET" } };
  h.enrollError = null;
  h.challengeError = null;
  h.verifyError = null;
  h.unenrollError = null;
  h.changeEmailError = null;
  h.changeEmailPayloads = [];
});

afterEach(() => cleanup());

describe("zmiana hasła", () => {
  it("odrzuca nowe hasło za krótkie PRZED jakimkolwiek żądaniem", async () => {
    await mount();
    h.calls = [];
    await fillPasswordForm("krotkie");
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.security.tooShort"));
    expect(h.calls).toEqual([]);
  });

  it("odrzuca niezgodne potwierdzenie PRZED jakimkolwiek żądaniem", async () => {
    await mount();
    h.calls = [];
    await fillPasswordForm("nowe-haslo-1", "nowe-haslo-2");
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.security.mismatch"));
    expect(h.calls).toEqual([]);
  });

  it("odrzuca nowe hasło równe obecnemu", async () => {
    await mount();
    h.calls = [];
    await fillPasswordForm("to-samo-haslo", "to-samo-haslo", "to-samo-haslo");
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.security.sameAsCurrent"),
    );
    expect(h.calls).toEqual([]);
  });

  it("wygasła sesja daje komunikat o sesji, nie o haśle", async () => {
    h.user = {};
    await mount();
    h.calls = [];
    await fillPasswordForm();
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.security.sessionExpired"),
    );
    expect(h.calls).toEqual([]);
  });

  it("BŁĘDNE obecne hasło: re-auth pada, hasła NIE zmieniamy", async () => {
    h.reauthError = { message: "Invalid login credentials" };
    await mount();
    h.calls = [];
    await fillPasswordForm();
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.security.wrongCurrent"));
    // Cała treść tego testu: `updateUser` NIE zostało zawołane.
    expect(h.calls).toEqual(["signInWithPassword:stare-haslo"]);
  });

  it("droga szczęśliwa: re-auth, zmiana, ubicie pozostałych sesji - W TEJ kolejności", async () => {
    await mount();
    h.calls = [];
    await fillPasswordForm();
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("profile.security.updated"));
    expect(h.calls).toEqual([
      "signInWithPassword:stare-haslo",
      "updateUser:nowe-haslo-1",
      // Sens zmiany hasła po wycieku polega na tym, że stare tokeny przestają
      // działać - bez tego kroku napastnik z wykradzioną sesją zostaje w koncie.
      "signOut:others",
    ]);
  });

  it("po sukcesie pola są WYCZYSZCZONE", async () => {
    await mount();
    await fillPasswordForm();
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(byId("cur").value).toBe("");
    expect(byId("pw").value).toBe("");
    expect(byId("pw2").value).toBe("");
  });

  it("po BŁĘDZIE BAZY pola NIE są czyszczone - i to jest cała treść testu", async () => {
    // Wyczyszczone pola po nieudanej zmianie wyglądają jak zmiana wykonana:
    // użytkownik wychodzi z panelu przekonany, że hasło zmienił.
    h.updateUserError = { message: "Password should be at least 6 characters" };
    await mount();
    await fillPasswordForm();
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(byId("cur").value).toBe("stare-haslo");
    expect(byId("pw").value).toBe("nowe-haslo-1");
    expect(byId("pw2").value).toBe("nowe-haslo-1");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("po błędzie re-auth pola też zostają", async () => {
    h.reauthError = { message: "Invalid login credentials" };
    await mount();
    await fillPasswordForm();
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(byId("cur").value).toBe("stare-haslo");
  });
});

describe("zmiana adresu e-mail", () => {
  async function submitEmail(next: string, password = "haslo-biezace") {
    fireEvent.change(byId("new-email"), { target: { value: next } });
    fireEvent.change(byId("email-pw"), { target: { value: password } });
    submitForm("new-email");
  }

  it("pokazuje obecny adres jako pole tylko do odczytu", async () => {
    await mount();
    expect(byId("cur-email").value).toBe("osoba@example.com");
    expect(byId("cur-email").readOnly).toBe(true);
  });

  it("odrzuca niepoprawny adres PRZED żądaniem", async () => {
    await mount();
    h.calls = [];
    await submitEmail("osoba-bez-malpy");
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.security.email.invalid"),
    );
    expect(h.calls).toEqual([]);
  });

  it("odrzuca wniosek bez hasła - zmiana adresu to przejęcie konta w jednym kroku", async () => {
    await mount();
    h.calls = [];
    await submitEmail("nowy@example.org", "");
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.security.email.needPassword"),
    );
    expect(h.calls).toEqual([]);
  });

  it("odrzuca adres identyczny z obecnym", async () => {
    await mount();
    h.calls = [];
    await submitEmail("OSOBA@example.com");
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.security.email.sameAsCurrent"),
    );
    expect(h.calls).toEqual([]);
  });

  it("wysyła znormalizowany adres i hasło do server fn", async () => {
    await mount();
    await submitEmail("  nowy@example.org  ");
    await waitFor(() => expect(h.changeEmailPayloads).toHaveLength(1));
    expect(h.changeEmailPayloads[0]).toEqual({
      data: { email: "nowy@example.org", password: "haslo-biezace" },
    });
    expect(h.toastSuccess).toHaveBeenCalledWith("profile.security.email.sent");
  });

  it("po sukcesie pola są wyczyszczone", async () => {
    await mount();
    await submitEmail("nowy@example.org");
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(byId("new-email").value).toBe("");
    expect(byId("email-pw").value).toBe("");
  });

  it("odmowa serwera zostawia pola i pokazuje jej komunikat", async () => {
    h.changeEmailError = new Error("Adres jest już zajęty");
    await mount();
    await submitEmail("nowy@example.org");
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Adres jest już zajęty"));
    expect(byId("new-email").value).toBe("nowy@example.org");
    expect(byId("email-pw").value).toBe("haslo-biezace");
  });

  it("odmowa bez komunikatu degraduje do klucza, nie do „undefined”", async () => {
    h.changeEmailError = { code: "23505" };
    await mount();
    await submitEmail("nowy@example.org");
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.security.email.invalid"),
    );
  });
});

describe("sesje", () => {
  it("pokazuje datę ostatniego logowania", async () => {
    await mount();
    expect(screen.getByText("profile.security.lastSignIn:", { exact: false })).toBeTruthy();
  });

  it("brak daty ostatniego logowania pokazuje kreskę, nie „Invalid Date”", async () => {
    h.user = { email: "osoba@example.com" };
    await mount();
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("wylogowanie pozostałych sesji idzie z zakresem `others`", async () => {
    await mount();
    h.calls = [];
    fireEvent.click(screen.getByText("profile.security.signOutOthers"));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.security.signedOutOthers"),
    );
    // `global` wylogowałby też TO urządzenie - użytkownik wypada z panelu,
    // w którym właśnie klikał.
    expect(h.calls).toEqual(["signOut:others"]);
  });

  it("AWARIA W TRAKCIE nie mówi, że sesje zostały wylogowane", async () => {
    // Fałszywe potwierdzenie jest tu groźniejsze niż brak potwierdzenia:
    // użytkownik przestaje szukać obcej sesji, która nadal działa.
    h.signOutScopeError = { message: "Network error" };
    await mount();
    fireEvent.click(screen.getByText("profile.security.signOutOthers"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Network error"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("wylogowanie na tym urządzeniu idzie przez kontekst uwierzytelnienia", async () => {
    // `signOut` z `useAuth` czyści cache zapytań i przekierowuje - klient
    // Supabase sam tego nie zrobi, a bez tego następna osoba przy tym samym
    // komputerze widzi dane poprzedniej.
    await mount();
    fireEvent.click(screen.getByText("profile.security.signOut"));
    await waitFor(() => expect(h.signOut).toHaveBeenCalledTimes(1));
  });
});

describe("drugi składnik: awaria kontra pustka", () => {
  it("BRAK CZYNNIKÓW po udanym odczycie: status „wyłączone” i zdanie o braku", async () => {
    h.factors = [];
    await mount();
    await waitFor(() => expect(status()).toBe("profile.security.mfa.statusDisabled"));
    expect(screen.getByText("profile.security.mfa.none")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("AWARIA ODCZYTU: status „nieznany” i alert - NIE „wyłączone”", async () => {
    // To jest defekt, który ta trasa miała: nieudany `listFactors()` zostawiał
    // pustą tablicę, a panel drukował „Wyłączone" osobie z aktywnym drugim
    // składnikiem. Taka osoba albo konfiguruje 2FA po raz drugi, albo przestaje
    // mu wierzyć - w obu przypadkach panel skłamał o bezpieczeństwie konta.
    h.listFactorsError = { message: "Network error" };
    await mount();
    await waitFor(() => expect(status()).toBe("profile.security.mfa.statusUnknown"));
    expect(screen.getByRole("alert").textContent).toBe("profile.security.mfa.loadFailed");
    expect(screen.queryByText("profile.security.mfa.none")).toBeNull();
  });

  it("ODPOWIEDŹ BEZ POLA `totp` to BRAK czynników, nie awaria", async () => {
    // Kształt odpowiedzi `listFactors()` zależy od typów czynników włączonych
    // w projekcie Supabase - pole `totp` może w niej nie wystąpić. Odczyt SIĘ
    // UDAŁ, więc panel ma powiedzieć „wyłączone", a nie „nieznany": alarm przy
    // poprawnym odczycie uczy ignorować alarmy. Bez `?? []` na tym polu trasa
    // wywaliłaby się na `factors.length` i cały panel bezpieczeństwa zniknąłby
    // z ekranu - razem ze zmianą hasła i wylogowaniem urządzeń.
    h.listFactorsTotpMissing = true;
    await mount();
    await waitFor(() => expect(status()).toBe("profile.security.mfa.statusDisabled"));
    expect(screen.getByText("profile.security.mfa.none")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("LISTA CZYNNIKÓW: status „włączone” i wpis na każdy czynnik", async () => {
    h.factors = [factor("f1", "Telefon"), factor("f2", "")];
    await mount();
    await waitFor(() => expect(status()).toBe("profile.security.mfa.statusEnabled"));
    expect(screen.getByText("Telefon")).toBeTruthy();
    // Czynnik bez własnej nazwy dostaje nazwę zastępczą, nie pusty wiersz.
    expect(screen.getByText("profile.security.mfa.defaultFactorName")).toBeTruthy();
  });
});

describe("drugi składnik: konfiguracja", () => {
  it("rozpoczęcie konfiguracji pokazuje kod QR i sekret do przepisania", async () => {
    await mount();
    fireEvent.click(screen.getByText("profile.security.mfa.enroll"));
    await waitFor(() => expect(screen.getByText("SEKRET")).toBeTruthy());
    // Sekret w postaci tekstowej jest obowiązkowy: nie każdy może zeskanować kod.
    expect(document.querySelector("img[width='180']")).toBeTruthy();
  });

  it("nieudane rozpoczęcie konfiguracji nie pokazuje pustego formularza kodu", async () => {
    h.enrollError = { message: "rate limited" };
    await mount();
    fireEvent.click(screen.getByText("profile.security.mfa.enroll"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.security.mfa.enrollError"),
    );
    expect(document.getElementById("mfa-code")).toBeNull();
  });

  it("brak danych z rozpoczęcia konfiguracji też jest błędem, nie pustym ekranem", async () => {
    h.enrollResult = null;
    await mount();
    fireEvent.click(screen.getByText("profile.security.mfa.enroll"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.security.mfa.enrollError"),
    );
  });

  async function startEnroll() {
    fireEvent.click(screen.getByText("profile.security.mfa.enroll"));
    await waitFor(() => expect(document.getElementById("mfa-code")).toBeTruthy());
  }

  it("kod niekompletny nie jedzie do weryfikacji", async () => {
    await mount();
    await startEnroll();
    h.calls = [];
    fireEvent.change(byId("mfa-code"), { target: { value: "123" } });
    fireEvent.click(screen.getByText("profile.security.mfa.activate"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.security.mfa.invalidCode"),
    );
    expect(h.calls).toEqual([]);
  });

  it("kod wklejony z odstępem jest przyjmowany - normalizacja działa w polu", async () => {
    await mount();
    await startEnroll();
    fireEvent.change(byId("mfa-code"), { target: { value: "123 456" } });
    expect(byId("mfa-code").value).toBe("123456");
  });

  it("KOD BŁĘDNY albo PRZETERMINOWANY: weryfikacja pada, konfiguracja zostaje otwarta", async () => {
    // Supabase nie rozdziela „zły kod" od „kod wygasł" - w obu przypadkach
    // odpowiedzią jest ten sam błąd weryfikacji. Istotne jest, żeby panel
    // NIE zamknął formularza: użytkownik ma wpisać następny kod z aplikacji.
    h.verifyError = { message: "Invalid TOTP code" };
    await mount();
    await startEnroll();
    fireEvent.change(byId("mfa-code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByText("profile.security.mfa.activate"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.security.mfa.verifyError"),
    );
    expect(document.getElementById("mfa-code")).toBeTruthy();
  });

  it("awaria wyzwania też zostawia formularz otwarty", async () => {
    h.challengeError = { message: "challenge failed" };
    await mount();
    await startEnroll();
    fireEvent.change(byId("mfa-code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByText("profile.security.mfa.activate"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.security.mfa.verifyError"),
    );
    expect(document.getElementById("mfa-code")).toBeTruthy();
  });

  it("kod poprawny: wyzwanie, weryfikacja, ODŚWIEŻENIE listy", async () => {
    await mount();
    await startEnroll();
    h.calls = [];
    h.factors = [factor("factor-1")];
    fireEvent.change(byId("mfa-code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByText("profile.security.mfa.activate"));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.security.mfa.activated"),
    );
    // Bez odświeżenia panel po włączeniu 2FA nadal pokazuje „Wyłączone".
    expect(h.calls).toEqual(["challenge", "verify", "listFactors"]);
    await waitFor(() => expect(status()).toBe("profile.security.mfa.statusEnabled"));
  });

  it("PORZUCONA konfiguracja jest sprzątana - niepotwierdzony czynnik nie zostaje", async () => {
    await mount();
    await startEnroll();
    h.calls = [];
    fireEvent.click(screen.getByText("profile.security.mfa.cancel"));
    await waitFor(() => expect(h.calls).toEqual(["unenroll:factor-1"]));
    expect(document.getElementById("mfa-code")).toBeNull();
  });

  it("awaria sprzątania nie blokuje zamknięcia formularza", async () => {
    // Połowiczny czynnik w koncie jest kłopotem po stronie serwera; zablokowany
    // formularz jest kłopotem użytkownika, który chce po prostu wyjść.
    h.unenrollError = new Error("network");
    await mount();
    await startEnroll();
    fireEvent.click(screen.getByText("profile.security.mfa.cancel"));
    await waitFor(() => expect(document.getElementById("mfa-code")).toBeNull());
  });
});

describe("drugi składnik: usunięcie", () => {
  async function openRemoveDialog(factors: Factor[]) {
    h.factors = factors;
    await mount();
    await waitFor(() => expect(screen.getAllByText("profile.security.mfa.remove")).toBeTruthy());
    fireEvent.click(screen.getAllByText("profile.security.mfa.remove")[0]);
    await waitFor(() => expect(screen.getByTestId("remove-dialog")).toBeTruthy());
  }

  it("potwierdzenie jest NIEAKTYWNE bez hasła", async () => {
    await openRemoveDialog([factor("f1"), factor("f2")]);
    expect((screen.getByTestId("remove-confirm") as HTMLButtonElement).disabled).toBe(true);
  });

  it("BŁĘDNE hasło: re-auth pada, czynnik NIE jest usuwany", async () => {
    h.reauthError = { message: "Invalid login credentials" };
    await openRemoveDialog([factor("f1"), factor("f2")]);
    fireEvent.change(byId("mfa-remove-pw"), { target: { value: "zle-haslo" } });
    h.calls = [];
    fireEvent.click(screen.getByTestId("remove-confirm"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.security.mfa.wrongPassword"),
    );
    expect(h.calls).toEqual(["signInWithPassword:zle-haslo"]);
    // Okno zostaje otwarte - użytkownik ma poprawić hasło, nie zaczynać od nowa.
    expect(screen.getByTestId("remove-dialog")).toBeTruthy();
  });

  it("hasło poprawne: re-auth, usunięcie, odświeżenie listy", async () => {
    await openRemoveDialog([factor("f1"), factor("f2")]);
    fireEvent.change(byId("mfa-remove-pw"), { target: { value: "dobre-haslo" } });
    h.calls = [];
    h.factors = [factor("f2")];
    fireEvent.click(screen.getByTestId("remove-confirm"));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.security.mfa.removed"),
    );
    expect(h.calls).toEqual(["signInWithPassword:dobre-haslo", "unenroll:f1", "listFactors"]);
  });

  it("USUNIĘCIE OSTATNIEGO czynnika ma inną treść potwierdzenia", async () => {
    // Zdjęcie ostatniego czynnika zdejmuje z konta CAŁĄ warstwę ochrony -
    // to samo zdanie, co przy jednej z trzech aplikacji, tego nie mówi.
    await openRemoveDialog([factor("f1")]);
    expect(screen.getByTestId("remove-body").textContent).toBe(
      "profile.security.mfa.removeLastBody",
    );
  });

  it("usunięcie jednego z wielu czynników ma zwykłą treść potwierdzenia", async () => {
    await openRemoveDialog([factor("f1"), factor("f2")]);
    expect(screen.getByTestId("remove-body").textContent).toBe("profile.security.mfa.removeBody");
  });

  it("zamknięcie okna czyści wpisane hasło", async () => {
    // Hasło pozostawione w polu ukrytego okna wraca przy następnym otwarciu -
    // i wystarcza jedno kliknięcie, żeby zdjąć czynnik bez świadomej decyzji.
    await openRemoveDialog([factor("f1"), factor("f2")]);
    fireEvent.change(byId("mfa-remove-pw"), { target: { value: "haslo" } });
    fireEvent.click(screen.getByTestId("dialog-close"));
    await waitFor(() => expect(screen.queryByTestId("remove-dialog")).toBeNull());

    fireEvent.click(screen.getAllByText("profile.security.mfa.remove")[0]);
    await waitFor(() => expect(screen.getByTestId("remove-dialog")).toBeTruthy());
    expect(byId("mfa-remove-pw").value).toBe("");
  });

  it("brak adresu z sesji blokuje usunięcie przed żądaniem", async () => {
    // Sesja bez adresu (wygasła, odświeżona bez claimów) nie daje czym
    // potwierdzić tożsamości - żądanie nie ma prawa wyjść.
    h.user = {};
    await openRemoveDialog([factor("f1"), factor("f2")]);
    fireEvent.change(byId("mfa-remove-pw"), { target: { value: "haslo" } });
    h.calls = [];
    fireEvent.click(screen.getByTestId("remove-confirm"));
    await waitFor(() => expect(h.calls).toEqual([]));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odmowa usunięcia po stronie bazy nie mówi, że czynnik zniknął", async () => {
    await openRemoveDialog([factor("f1"), factor("f2")]);
    fireEvent.change(byId("mfa-remove-pw"), { target: { value: "haslo" } });
    h.unenrollError = null;
    // Odmowa idzie polem `error`, nie odrzuceniem obietnicy - tak odpowiada API.
    const authModule = await import("@/integrations/supabase/client");
    const unenroll = vi
      .spyOn(authModule.supabase.auth.mfa, "unenroll")
      .mockResolvedValue({ data: null, error: { message: "denied" } } as never);
    fireEvent.click(screen.getByTestId("remove-confirm"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.security.mfa.removeError"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
    unenroll.mockRestore();
  });
});

describe("odnośnik do huba prywatności", () => {
  it("panel prowadzi do /profile/privacy - granica nie wynika z nazwy pozycji", async () => {
    // §10 audytu IA prywatności: eksport danych i usunięcie konta przeniosły się
    // stąd do /profile/privacy. Ten odnośnik jest jedynym miejscem, w którym
    // użytkownik dowie się, gdzie ich szukać.
    await mount();
    const link = screen.getByText("profile.security.privacyLink").closest("a");
    expect(link?.getAttribute("href")).toBe("/profile/privacy");
  });
});
