// Decyzje panelu bezpieczeństwa konta (/profile/security) - CZYSTY moduł.
//
// PO CO OSOBNY PLIK. `lib/auth/mfa.ts` stoi na 100%, `bruteforce.functions.ts`
// na 100% - reguły bezpieczeństwa są dowiedzione. Panel, w którym użytkownik ich
// UŻYWA, miał 537 linii i zero wykonanych funkcji: walidacje hasła, adresu
// e-mail i kodu TOTP mieszkały w ciele komponentu, między `setBusy(true)`
// a `toast.error`. Reguła, której nie da się wywołać bez wypełnienia formularza,
// nie ma tabeli przypadków - a to reguły, których złamanie oznacza albo utratę
// dostępu do konta, albo jego przejęcie.
//
// TRZY STANY, NIE DWA. Najważniejsza rzecz w tym pliku to `factorsView`.
// Panel czytał listę czynników jako `factors.length > 0 ? włączone : wyłączone`,
// a przy NIEUDANYM odczycie zostawiał pustą tablicę - czyli mówił osobie
// z aktywnym drugim składnikiem, że nie ma żadnego. To ta sama klasa defektu, co
// „awaria kontra pustka" na listach panelu, tylko o cięższej konsekwencji:
// użytkownik, który uwierzy, że 2FA jest wyłączone, albo je konfiguruje po raz
// drugi, albo przestaje się nim chronić.
import type { Factor } from "@supabase/supabase-js";

/** Minimalna długość hasła - ta sama liczba, którą wymusza `minLength` w polu. */
export const MIN_PASSWORD_LENGTH = 8;

/** Prefiks kluczy i18n panelu. Funkcje zwracają KLUCZ, nigdy gotowy tekst. */
const KEY = "profile.security.";

export type PasswordChangeProblem =
  "noEmail" | "currentMissing" | "tooShort" | "mismatch" | "sameAsCurrent";

export interface PasswordChangeInput {
  /** Obecne hasło - służy do ponownego uwierzytelnienia przed zmianą. */
  readonly current: string;
  readonly next: string;
  readonly confirm: string;
  /** Adres z sesji; bez niego nie da się ponownie uwierzytelnić. */
  readonly email: string | null | undefined;
}

/**
 * Pierwsze zastrzeżenie do zmiany hasła albo `null`.
 *
 * KOLEJNOŚĆ JEST CZĘŚCIĄ KONTRAKTU. Brak adresu z sesji wychodzi PIERWSZY, bo
 * bez niego nie ma czego uwierzytelniać - panel, który najpierw sprawdza długość,
 * pokazuje „hasło za krótkie" osobie, której problemem jest wygasła sesja.
 */
export function passwordChangeProblem(input: PasswordChangeInput): PasswordChangeProblem | null {
  if (!input.email) return "noEmail";
  if (input.current === "") return "currentMissing";
  if (input.next.length < MIN_PASSWORD_LENGTH) return "tooShort";
  if (input.next !== input.confirm) return "mismatch";
  // Zmiana hasła na to samo przechodzi w Supabase bez błędu: użytkownik widzi
  // „hasło zmienione", pozostałe sesje lecą, a sekret jest ten sam co przed
  // wyciekiem, którym się przestraszył. To jedyny powód, dla którego ktoś to
  // robi - więc cicha zgoda jest tu najgorszą odpowiedzią.
  if (input.next === input.current) return "sameAsCurrent";
  return null;
}

/** Zastrzeżenie do zmiany hasła → KLUCZ i18n. */
export function passwordProblemKey(problem: PasswordChangeProblem): string {
  switch (problem) {
    case "noEmail":
      return `${KEY}sessionExpired`;
    case "currentMissing":
      return `${KEY}currentRequired`;
    case "tooShort":
      return `${KEY}tooShort`;
    case "mismatch":
      return `${KEY}mismatch`;
    case "sameAsCurrent":
      return `${KEY}sameAsCurrent`;
  }
}

export type EmailChangeProblem = "invalid" | "needPassword" | "sameAsCurrent";

export interface EmailChangeInput {
  readonly next: string;
  readonly password: string;
  readonly current: string | null | undefined;
}

/**
 * Kształt adresu e-mail sprawdzany po stronie klienta. Świadomie zgrubny:
 * dowodem istnienia adresu jest KLIKNIĘCIE W LINK POTWIERDZAJĄCY, nie wyrażenie
 * regularne, a nadmiernie ciasny wzorzec odrzuca adresy realnie działające
 * (znaki plus, domeny wielopoziomowe, nowe TLD).
 */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function emailChangeProblem(input: EmailChangeInput): EmailChangeProblem | null {
  const next = input.next.trim();
  if (!EMAIL_SHAPE.test(next)) return "invalid";
  if (input.password === "") return "needPassword";
  // Porównanie bez wielkości litery: część lokalna bywa wrażliwa na wielkość
  // w standardzie, ale żaden dostawca tak nie działa, a wysłanie linku
  // potwierdzającego na bieżący adres wygląda jak awaria.
  if (input.current && next.toLowerCase() === input.current.trim().toLowerCase()) {
    return "sameAsCurrent";
  }
  return null;
}

export function emailProblemKey(problem: EmailChangeProblem): string {
  switch (problem) {
    case "invalid":
      return `${KEY}email.invalid`;
    case "needPassword":
      return `${KEY}email.needPassword`;
    case "sameAsCurrent":
      return `${KEY}email.sameAsCurrent`;
  }
}

/** Adres, który realnie poleci do serwera - ten sam, który sprawdziła walidacja. */
export function normalizeEmail(raw: string): string {
  return raw.trim();
}

/** Kod TOTP ma dokładnie sześć cyfr. */
const TOTP_CODE_LENGTH = 6;

/**
 * Wpisany kod obcięty do cyfr. Aplikacje uwierzytelniające pokazują kod
 * z odstępem („123 456"), a menedżery haseł wklejają go razem ze spacją -
 * odrzucenie takiego wklejenia jako „nieprawidłowy kod" jest błędem panelu,
 * nie użytkownika.
 */
export function normalizeMfaCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, TOTP_CODE_LENGTH);
}

/** Czy kod da się w ogóle wysłać do weryfikacji. */
export function isCompleteMfaCode(code: string): boolean {
  return new RegExp(`^\\d{${TOTP_CODE_LENGTH}}$`).test(code);
}

/**
 * Widok listy czynników - CZTERY rozłączne stany, nie dwa.
 *
 * `unknown` istnieje wyłącznie dlatego, że odczyt może się nie udać, a wtedy
 * „nie mam czynników" i „nie wiem, czy mam czynniki" to dwie różne wiadomości
 * dla użytkownika. Zlanie ich mówi osobie z aktywnym 2FA, że go nie ma.
 */
export type FactorsView =
  | { readonly kind: "loading" }
  | { readonly kind: "unknown" }
  | { readonly kind: "empty" }
  | { readonly kind: "list"; readonly factors: readonly Factor[] };

export interface FactorsState {
  readonly loading: boolean;
  /** Odczyt zakończony błędem - NIE to samo, co „brak czynników". */
  readonly failed: boolean;
  readonly factors: readonly Factor[];
}

export function factorsView(state: FactorsState): FactorsView {
  if (state.loading) return { kind: "loading" };
  if (state.failed) return { kind: "unknown" };
  if (state.factors.length === 0) return { kind: "empty" };
  return { kind: "list", factors: state.factors };
}

/** Klucz i18n statusu drugiego składnika - z „nie wiem" jako osobną wartością. */
export function mfaStatusKey(view: FactorsView): string {
  switch (view.kind) {
    case "list":
      return `${KEY}mfa.statusEnabled`;
    case "empty":
      return `${KEY}mfa.statusDisabled`;
    case "loading":
    case "unknown":
      return `${KEY}mfa.statusUnknown`;
  }
}

export interface FactorRemovalInput {
  readonly factorId: string | null;
  readonly password: string;
  readonly email: string | null | undefined;
  /** Ile czynników jest dziś aktywnych - potrzebne dla ostrzeżenia o ostatnim. */
  readonly factorCount: number;
}

export type FactorRemovalProblem = "noFactor" | "noEmail" | "needPassword";

/**
 * Czy usunięcie czynnika wolno w ogóle wysłać. Samo prawo do usunięcia należy do
 * właściciela konta - panel pilnuje wyłącznie tego, żeby żądanie było kompletne
 * i potwierdzone hasłem.
 *
 * O WYMUSZONYM MFA: platforma NIE MA dziś ustawienia „drugi składnik wymagany"
 * (klucz `auth_branding` go nie zawiera, patrz `lib/authSettingsRules.ts`), więc
 * stan „wyłączam ostatni czynnik przy wymuszonym MFA" jest nieosiągalny i nie ma
 * czego blokować. Osiągalne i istotne jest to, że usunięcie OSTATNIEGO czynnika
 * zdejmuje z konta całą warstwę ochrony - stąd `isLastFactor` niżej, po którym
 * panel podnosi treść potwierdzenia.
 */
export function factorRemovalProblem(input: FactorRemovalInput): FactorRemovalProblem | null {
  if (input.factorId === null) return "noFactor";
  if (!input.email) return "noEmail";
  if (input.password === "") return "needPassword";
  return null;
}

/** Czy usuwany czynnik jest ostatnim - decyduje o treści potwierdzenia. */
export function isLastFactor(input: Pick<FactorRemovalInput, "factorCount">): boolean {
  return input.factorCount <= 1;
}
