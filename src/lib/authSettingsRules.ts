// Reguły spójności ustawień logowania - CZYSTY moduł.
//
// PO CO OSOBNY PLIK. `/admin/login-settings` to 533 linie, w których decyzja
// „czy tę kombinację wolno zapisać" mieszkała między `<Switch/>` a `<Input/>`.
// Panel decyduje o tym, czy w ogóle da się wejść na serwis: wyłączony popup
// z adresem logowania poza serwisem, przekierowanie po zalogowaniu wskazujące
// z powrotem na formularz, zamknięta rejestracja - każde z tych ustawień może
// zamknąć wejście wszystkim naraz, a odwrócić to może wyłącznie ktoś, kto jest
// już w środku. Reguła, której nie da się wywołać bez kliknięcia w panelu, nie
// ma dowodu.
//
// CO JEST, A CZEGO NIE MA W TYM SCHEMACIE - żeby nie było nieporozumienia.
// Klucz `auth_branding` NIE zawiera przełączników metod logowania, wymuszenia
// MFA ani trybu „tylko na zaproszenie". Drugi składnik jest decyzją KONTA
// (`supabase.auth.mfa`, patrz `lib/auth/mfa.ts` i `/profile/security`), a
// zaproszenia są wierszami w `user_invitations`, nie flagą w ustawieniach.
// Trzy „kombinacje niemożliwe" z zadania mają więc w tym schemacie swoje
// realne odpowiedniki, wypisane niżej po jednej regule - i ani jednej reguły
// na pole, którego nie ma. Wymyślanie takiego pola dałoby zielony test na
// nieistniejącym ryzyku.
//
// KAŻDA REGUŁA JEST PODPARTA KONSUMENTEM. W nawiasie przy każdej stoi plik,
// który to ustawienie realnie czyta - bez tego reguła jest opinią, nie zaporą.
import { AUTH_DEFAULTS, type AuthSettings } from "@/lib/authSettings";

/** Dozwolone położenia formularza - jedyne trzy, które rozumie `AuthPortal`. */
export const LOGIN_POSITIONS = ["left", "center", "right"] as const;

export type LoginPosition = (typeof LOGIN_POSITIONS)[number];

/** Kanoniczny adres wbudowanego formularza logowania (trasa `src/routes/login.tsx`). */
export const LOGIN_ROUTE = "/login";

export function isLoginPosition(value: unknown): value is LoginPosition {
  return typeof value === "string" && (LOGIN_POSITIONS as readonly string[]).includes(value);
}

/**
 * Ścieżka WEWNĘTRZNA w rozumieniu konsumentów: `LoginPopup` i `useAuth` honorują
 * wyłącznie adresy zaczynające się od „/", odrzucając „//host" (adres
 * protokołowo-relatywny prowadzi na obcy serwer, mimo że wygląda na ścieżkę).
 */
export function isInternalPath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

/** Pełny adres http(s) - jedyna forma zewnętrzna, którą `LoginPopup` wykonuje. */
export function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//.test(value);
}

/**
 * Ścieżka bez części zapytania i fragmentu - „/login?mode=signup" i „/login"
 * prowadzą do TEGO SAMEGO formularza, więc pętli logowania nie wolno przegapić
 * z powodu parametru w adresie.
 */
function pathOf(value: string): string {
  const trimmed = value.trim();
  const cut = trimmed.search(/[?#]/);
  const path = cut === -1 ? trimmed : trimmed.slice(0, cut);
  // Ukośnik na końcu nie tworzy innej trasy („/login/" == „/login").
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * Klucze `AuthSettings` o wartości logicznej i tekstowej - wyliczone Z TYPU, nie
 * wypisane z ręki. Dopisanie pola do `AuthSettings` automatycznie trafia do
 * właściwej grupy, a brak go w literale niżej jest błędem KOMPILACJI.
 */
type BooleanKey = {
  [K in keyof AuthSettings]: AuthSettings[K] extends boolean ? K : never;
}[keyof AuthSettings];
type TextKey = Exclude<
  { [K in keyof AuthSettings]: AuthSettings[K] extends string ? K : never }[keyof AuthSettings],
  "login_position"
>;

/**
 * Czy wartość jest obiektem z kluczami tekstowymi. STRAŻNIK, nie rzutowanie:
 * warunek sprawdza kształt w RUNTIME i dopiero on zawęża typ - `as` przepuściłby
 * tu tablicę i `null`, czyli dokładnie te dwa kształty, które baza potrafi zwrócić
 * zamiast wiersza ustawień.
 */
function isSettingsRow(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Odczyt ustawień z bazy z domyślnymi - JEDNO miejsce, które decyduje, co
 * znaczy „brak wiersza", „wiersz częściowy" i „wartość spoza enuma".
 *
 * DLACZEGO NIE `{...DEFAULTS, ...row}`. Rozlewanie surowego wiersza przepuszcza
 * wartość spoza enuma (`login_position: "top"`) i wartość złego typu
 * (`popup_enabled: "yes"`, czyli prawda w każdym `if`) prosto do widoku. Ten
 * odczyt zawęża je do domyślnej - zachowując zastane zachowanie `AuthPortal`,
 * dla którego wszystko poza „center" znaczy „pokaż hero", czyli „right".
 *
 * Literał na końcu jest wypisany JAWNIE, bo to on daje gwarancję kompletności:
 * pole dopisane do `AuthSettings` bez wpisu tutaj nie kompiluje się, więc nie da
 * się dodać ustawienia, które po odczycie z bazy jest `undefined`.
 */
export function readAuthSettings(raw: unknown): AuthSettings {
  const row: Record<string, unknown> = isSettingsRow(raw) ? raw : {};

  const flag = (key: BooleanKey): boolean => {
    const value = row[key];
    return typeof value === "boolean" ? value : AUTH_DEFAULTS[key];
  };
  const text = (key: TextKey): string => {
    const value = row[key];
    return typeof value === "string" ? value : AUTH_DEFAULTS[key];
  };
  const position = row.login_position;

  return {
    popup_enabled: flag("popup_enabled"),
    allow_public_signup: flag("allow_public_signup"),
    signup_label_pl: text("signup_label_pl"),
    signup_label_en: text("signup_label_en"),
    signin_label_pl: text("signin_label_pl"),
    signin_label_en: text("signin_label_en"),
    popup_heading_pl: text("popup_heading_pl"),
    popup_heading_en: text("popup_heading_en"),
    popup_description_pl: text("popup_description_pl"),
    popup_description_en: text("popup_description_en"),
    form_logo_url: text("form_logo_url"),
    form_logo_url_dark: text("form_logo_url_dark"),
    login_position: isLoginPosition(position) ? position : AUTH_DEFAULTS.login_position,
    login_bg_url: text("login_bg_url"),
    login_bg_color: text("login_bg_color"),
    custom_login_url: text("custom_login_url"),
    logged_in_redirect_url: text("logged_in_redirect_url"),
    logout_redirect_url: text("logout_redirect_url"),
    show_back_to_home: flag("show_back_to_home"),
    hero_title_pl: text("hero_title_pl"),
    hero_title_en: text("hero_title_en"),
    hero_subtitle_pl: text("hero_subtitle_pl"),
    hero_subtitle_en: text("hero_subtitle_en"),
    hero_image_url_light: text("hero_image_url_light"),
    hero_image_url_dark: text("hero_image_url_dark"),
    signup_image_url_light: text("signup_image_url_light"),
    signup_image_url_dark: text("signup_image_url_dark"),
    reset_image_url_light: text("reset_image_url_light"),
    reset_image_url_dark: text("reset_image_url_dark"),
    privacy_url: text("privacy_url"),
    terms_url: text("terms_url"),
    show_language_switcher: flag("show_language_switcher"),
  };
}

export type AuthSettingsIssueSeverity = "blocking" | "warning";

export interface AuthSettingsIssue {
  /** Stabilny identyfikator reguły - po nim asertują testy i po nim liczy się historia. */
  readonly id: string;
  /** Pole, przy którym panel ma pokazać komunikat. */
  readonly field: keyof AuthSettings;
  readonly severity: AuthSettingsIssueSeverity;
  /** KLUCZ i18n, nigdy gotowy tekst - patrz `lib/i18n-admin-login-settings`. */
  readonly messageKey: string;
}

const KEY = "adminLoginSettings.issue.";

/**
 * Wszystkie zastrzeżenia do kombinacji ustawień, w kolejności od najgroźniejszych.
 *
 * `blocking` znaczy „zapis odrzucony": kombinacja zamyka wejście na serwis albo
 * czyni je nieodwracalnym z zewnątrz. `warning` znaczy „zapis wolno wykonać, ale
 * administrator musi wiedzieć": ustawienie, które konsument po cichu zignoruje,
 * jest gorsze od braku ustawienia, bo wygląda na działające.
 */
export function authSettingsIssues(s: AuthSettings): readonly AuthSettingsIssue[] {
  const issues: AuthSettingsIssue[] = [];

  const custom = s.custom_login_url.trim();
  const loggedIn = s.logged_in_redirect_url.trim();
  const logout = s.logout_redirect_url.trim();

  // 1. PĘTLA LOGOWANIA (`components/auth/AuthPortal.tsx`, `components/PopupSignupForm.tsx`).
  //    Przekierowanie po zalogowaniu wskazujące na sam formularz odsyła
  //    użytkownika tam, skąd przyszedł - w interfejsie wygląda to jak „hasło
  //    nie działa", choć sesja powstała. To odpowiednik „wszystkie metody
  //    logowania wyłączone": metody działają, a wejść nie da się.
  const loginEntries = new Set([LOGIN_ROUTE]);
  if (custom !== "" && isInternalPath(custom)) loginEntries.add(pathOf(custom));
  if (loggedIn !== "" && isInternalPath(loggedIn) && loginEntries.has(pathOf(loggedIn))) {
    issues.push({
      id: "loggedInRedirectLoopsToLogin",
      field: "logged_in_redirect_url",
      severity: "blocking",
      messageKey: `${KEY}loggedInRedirectLoopsToLogin`,
    });
  }

  // 2. WYJŚCIE Z SERWISU BEZ POWROTU (`components/LoginPopup.tsx`).
  //    Popup wyłączony + adres logowania poza serwisem = jedyne wejście, jakie
  //    widzi użytkownik, prowadzi na obcy host. Jeśli ten host przestanie
  //    odpowiadać, do panelu nie wejdzie nikt, kto nie zna `/login` z pamięci.
  if (!s.popup_enabled && custom !== "" && isAbsoluteHttpUrl(custom)) {
    issues.push({
      id: "onlyEntryPointIsExternal",
      field: "custom_login_url",
      severity: "blocking",
      messageKey: `${KEY}onlyEntryPointIsExternal`,
    });
  }

  // 3. USTAWIENIE, KTÓRE KONSUMENT ZIGNORUJE (`components/LoginPopup.tsx`).
  //    Ani ścieżka wewnętrzna, ani pełny http(s) - `LoginPopup` cofa się do
  //    `/login` i milczy. Administrator widzi wpisany adres i wierzy, że działa.
  if (custom !== "" && !isInternalPath(custom) && !isAbsoluteHttpUrl(custom)) {
    issues.push({
      id: "customLoginUrlIgnored",
      field: "custom_login_url",
      severity: "warning",
      messageKey: `${KEY}customLoginUrlIgnored`,
    });
  }

  // 4. TO SAMO PO STRONIE WYLOGOWANIA (`hooks/useAuth.tsx`).
  //    `signOut` honoruje wyłącznie ścieżkę wewnętrzną; wszystko inne cofa się
  //    do strony głównej w bloku `catch`/`if` bez żadnego komunikatu.
  if (logout !== "" && !isInternalPath(logout)) {
    issues.push({
      id: "logoutRedirectIgnored",
      field: "logout_redirect_url",
      severity: "warning",
      messageKey: `${KEY}logoutRedirectIgnored`,
    });
  }

  // 5. PRZYCISK BEZ NAPISU (`components/auth/AuthPortal.tsx` czyta etykiety
  //    wprost z ustawień, bez fallbacku na słownik). Pusta etykieta „Zaloguj"
  //    to wejście, którego nie widać - w jednym języku, więc administrator
  //    pracujący po polsku nie zauważy braku w EN.
  const labels: readonly (readonly [keyof AuthSettings, string])[] = [
    ["signin_label_pl", "signinLabelEmpty"],
    ["signin_label_en", "signinLabelEmpty"],
  ];
  for (const [field, id] of labels) {
    if (String(s[field]).trim() === "") {
      issues.push({
        id: `${id}:${field}`,
        field,
        severity: "blocking",
        messageKey: `${KEY}${id}`,
      });
    }
  }

  // 6. ZAMKNIĘTA REJESTRACJA (`AuthPortal`, `PopupSignupForm`, `LoginPopup`).
  //    Legalny tryb pracy (serwis tylko dla zaproszonych), ale w tym schemacie
  //    NIE MA przełącznika zaproszeń, którym można by go zrównoważyć: jedyną
  //    drogą nowej osoby staje się wiersz w `user_invitations` wystawiony przez
  //    kogoś ze środka. To ma być decyzją, nie skutkiem ubocznym kliknięcia.
  if (!s.allow_public_signup) {
    issues.push({
      id: "publicSignupClosed",
      field: "allow_public_signup",
      severity: "warning",
      messageKey: `${KEY}publicSignupClosed`,
    });
  }

  return issues;
}

/** Czy w zestawie jest zastrzeżenie, które blokuje zapis. */
export function hasBlockingIssue(issues: readonly AuthSettingsIssue[]): boolean {
  return issues.some((issue) => issue.severity === "blocking");
}

export interface AuthSettingsSaveContext {
  /** Ustawieniami logowania zarządza wyłącznie super_admin - patrz trasa panelu. */
  readonly isSuperAdmin: boolean;
}

export type AuthSettingsSaveDecision =
  | { readonly allowed: true; readonly warnings: readonly AuthSettingsIssue[] }
  | {
      readonly allowed: false;
      readonly reasonKey: string;
      readonly issues: readonly AuthSettingsIssue[];
    };

/**
 * Decyzja o zapisie - JEDNA funkcja, którą woła panel przed `mutateAsync`.
 *
 * Kolejność jest częścią kontraktu: brak uprawnienia odrzuca zapis PRZED
 * sprawdzeniem spójności. Odwrotna kolejność podpowiadałaby osobie bez
 * uprawnień, które kombinacje przechodzą walidację.
 */
export function decideAuthSettingsSave(
  s: AuthSettings,
  context: AuthSettingsSaveContext,
): AuthSettingsSaveDecision {
  if (!context.isSuperAdmin) {
    return {
      allowed: false,
      reasonKey: "adminLoginSettings.errNoPermission",
      issues: [],
    };
  }
  const issues = authSettingsIssues(s);
  const blocking = issues.filter((issue) => issue.severity === "blocking");
  if (blocking.length > 0) {
    return { allowed: false, reasonKey: "adminLoginSettings.errInconsistent", issues: blocking };
  }
  return { allowed: true, warnings: issues };
}

/** Kod błędu PostgREST, jeśli błąd go niesie. */
function errorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Błąd zapisu → KLUCZ i18n. Surowy komunikat Postgresa („new row violates
 * row-level security policy for table \"site_settings\"") w toaście nie mówi
 * administratorowi, co zrobić, a wystawia nazwy tabel i polityk osobie, która
 * właśnie NIE MA do nich prawa.
 */
export function authSettingsSaveErrorKey(error: unknown): string {
  switch (errorCode(error)) {
    // Odmowa RLS / brak grantu - to nie jest awaria, to jest brak uprawnienia.
    case "42501":
      return "adminLoginSettings.errNoPermission";
    // Kolizja klucza `(tenant_id, key)` - ktoś zapisał w tym samym momencie.
    case "23505":
      return "adminLoginSettings.errConflict";
    default:
      return "adminLoginSettings.errGeneric";
  }
}
