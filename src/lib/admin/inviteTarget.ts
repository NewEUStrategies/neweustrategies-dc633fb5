// Decyzja o adresacie zaproszenia - CZYSTA funkcja, bez I/O.
//
// `performSend` (`invitations.functions.ts`) zbiera konto z katalogu
// tożsamości, profil czytany kluczem serwisowym i najemcę domyślnego, a o tym,
// czy wolno cokolwiek zapisać, rozstrzyga wyłącznie `resolveInviteTarget`.
// Zasada (docs/PROMPT_ZAPROSZENIE_GRANICA_NAJEMCY.md, rozdz. 1): wysłanie
// zaproszenia nie może zmienić niczego w koncie, które należy do innego
// najemcy - w razie wątpliwości odmowa.
//
// DLACZEGO NAJEMCA DOMYŚLNY MA OSOBNY WIERSZ. `handle_new_user`
// (20260805083149) nie czyta najemcy z metadanych: KAŻDE nowe konto poza
// rejestracją `staff` rodzi się z profilem w najemcy domyślnym, w tej samej
// transakcji co `createUser`. Porównanie „profil w najemcy zaproszenia albo
// odmowa" odrzucało więc każde zaproszenie NOWEJ osoby do organizacji innej niż
// domyślna - zaraz po tym, jak samo założyło jej konto. Konto narodzone
// z zaproszenia rozpoznajemy po `app_metadata.tenant_id`, które `performSend`
// ustawia w wywołaniu `createUser`.
//
// DLACZEGO `app_metadata`, NIGDY `user_metadata`. `user_metadata` ustawia sam
// rejestrujący się klient (`signUp({ options: { data } })`) i właściciel sesji
// (`auth.updateUser({ data })`), więc wpisany tam najemca niczego nie
// poświadcza. `app_metadata` zapisuje wyłącznie klucz serwisowy.

/** Role, które wolno nadać zaproszeniem - jedno źródło dla schematów `zod` i dla wysyłki. */
export const INVITABLE_ROLES = ["admin", "editor", "author", "user"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(role: unknown): role is InvitableRole {
  return typeof role === "string" && (INVITABLE_ROLES as readonly string[]).includes(role);
}

/**
 * Jeden kod dla KAŻDEJ odmowy adresata, niezależnie od przyczyny - panel nie
 * może odróżnić „konto w innej organizacji" od „identyfikator nie pasuje do
 * adresu" (wyrocznia). Nazwa zostaje z pierwszej wersji granicy, bo pod nią
 * stoją już zapisane `last_error`.
 */
export const INVITATION_TARGET_UNAVAILABLE = "account_in_other_tenant";

/**
 * Rola zaproszenia spoza `INVITABLE_ROLES`. Kolumna `user_invitations.role` to
 * `app_role` bez ograniczenia, a administrator najemcy zapisuje ją wprost przez
 * PostgREST - bez tej bramki wpisałby sobie `super_admin`, który `performSend`
 * nadałby kluczem serwisowym.
 */
export const INVITATION_ROLE_NOT_ALLOWED = "invitation_role_not_allowed";

/**
 * `createUser` odmówił z innej przyczyny niż zajęty adres (limit, polityka
 * haseł, błąd bazy GoTrue). Panel dostaje ten kod, szczegół idzie do logu
 * serwera - surowy komunikat dostawcy tożsamości nie trafia do UI.
 */
export const ACCOUNT_CREATE_FAILED = "account_create_failed";

/** Przyczyna odmowy - wyłącznie dla typów i testów; nigdy w odpowiedzi ani w `last_error`. */
export type InviteRefusalReason =
  | "pinned_account_missing"
  | "pinned_account_mismatch"
  | "profile_in_other_tenant"
  | "profile_missing_unproven";

export type InviteTarget =
  | { kind: "create" }
  | { kind: "attach"; userId: string }
  | { kind: "refuse"; reason: InviteRefusalReason };

/** Konto z katalogu tożsamości w kształcie potrzebnym decyzji. */
export interface InviteAccount {
  id: string;
  email: string | null;
  /** `app_metadata.tenant_id` - patrz `appMetadataTenantId`. */
  appTenantId: string | null;
  /**
   * Czy ktoś kiedykolwiek się na to konto zalogował (`last_sign_in_at`).
   * Konto narodzone z zaproszenia, którego wysyłka się przerwała, nie dostało
   * ani linku, ani hasła - jeśli mimo to ma sesję w historii, jego właściciel
   * dostał się do niego inną drogą (np. „nie pamiętam hasła") i używa go jako
   * czytelnik najemcy domyślnego. Wtedy konto należy już do tamtego najemcy.
   */
  everSignedIn: boolean;
  /**
   * Adres, dla którego konto ZAŁOŻYŁ administrator z potwierdzeniem nadanym
   * kluczem serwisowym (`app_metadata.provisioned_by_admin` +
   * `provisioned_email`) - hasło tymczasowe takiego konta zna wyłącznie
   * zakładający. `null` = konto nie z tej drogi.
   */
  provisionedEmail: string | null;
}

export interface InviteTargetInput {
  invitationTenantId: string;
  invitationEmail: string;
  /** `user_invitations.auth_user_id` - skraca szukanie, niczego nie rozstrzyga. */
  pinnedAccountId: string | null;
  /** Konto znalezione po `pinnedAccountId` albo po adresie; `null` = nie istnieje. */
  account: InviteAccount | null;
  /** Najemca profilu konta (odczyt kluczem serwisowym); `null` = profilu nie ma. */
  profileTenantId: string | null;
  /** Najemca domyślny jak w `handle_new_user`; `null` = nieznany (odczyt pominięty). */
  defaultTenantId: string | null;
}

function normalizeEmail(value: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Najemca poświadczony przez klucz serwisowy przy zakładaniu konta. Cokolwiek
 * innego niż niepusty tekst daje `null`, czyli „brak poświadczenia".
 */
export function appMetadataTenantId(appMetadata: unknown): string | null {
  if (!appMetadata || typeof appMetadata !== "object") return null;
  const value = (appMetadata as Record<string, unknown>).tenant_id;
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Adres ze znacznika `adminProvisionedAppMetadata` (`provisioned_by_admin`
 * + `provisioned_email`), znormalizowany. Bez znacznika albo z adresem nie
 * będącym tekstem - `null`.
 */
export function appMetadataProvisionedEmail(appMetadata: unknown): string | null {
  if (!appMetadata || typeof appMetadata !== "object") return null;
  const meta = appMetadata as Record<string, unknown>;
  if (meta.provisioned_by_admin !== true) return null;
  const value = meta.provisioned_email;
  return typeof value === "string" && value.trim() !== "" ? value.trim().toLowerCase() : null;
}

/**
 * Reguły w kolejności (zlecenie, A1):
 *   1. brak konta: przypięty identyfikator -> odmowa; inaczej `create`;
 *   2. konto nie jest tym przypiętym albo ma inny adres niż zaproszenie -> odmowa;
 *   3. profil w najemcy zaproszenia -> `attach`;
 *   4. profil w najemcy domyślnym, a konto narodzone z zaproszenia TEGO najemcy
 *      (`app_metadata.tenant_id`) i nigdy nieużyte (`everSignedIn`) ->
 *      `attach` (nowa osoba, także ponowienie po przerwanej pierwszej wysyłce);
 *   5. profil w każdym innym najemcy -> odmowa;
 *   6. brak profilu: konto narodzone z zaproszenia tego najemcy i nigdy
 *      nieużyte -> `attach`, inaczej odmowa.
 * Błędy odczytu (katalog, profil, najemca domyślny) nie wchodzą tutaj - są
 * błędem po stronie wołającego, nigdy „brakiem".
 */
export function resolveInviteTarget(input: InviteTargetInput): InviteTarget {
  const { account, pinnedAccountId, invitationTenantId } = input;
  if (!account) {
    return pinnedAccountId
      ? { kind: "refuse", reason: "pinned_account_missing" }
      : { kind: "create" };
  }
  if (
    (pinnedAccountId && account.id !== pinnedAccountId) ||
    normalizeEmail(account.email) !== normalizeEmail(input.invitationEmail)
  ) {
    return { kind: "refuse", reason: "pinned_account_mismatch" };
  }

  const bornForThisTenant = account.appTenantId === invitationTenantId && !account.everSignedIn;
  if (input.profileTenantId === null) {
    return bornForThisTenant
      ? { kind: "attach", userId: account.id }
      : { kind: "refuse", reason: "profile_missing_unproven" };
  }
  if (input.profileTenantId === invitationTenantId) {
    return { kind: "attach", userId: account.id };
  }
  if (
    bornForThisTenant &&
    input.defaultTenantId !== null &&
    input.profileTenantId === input.defaultTenantId
  ) {
    return { kind: "attach", userId: account.id };
  }
  return { kind: "refuse", reason: "profile_in_other_tenant" };
}
