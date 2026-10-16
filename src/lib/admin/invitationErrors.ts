// Mapowanie wyników wysyłki zaproszeń (`SendResult.error`, `last_error`,
// `ProvisionResult.errors[].error`) na klucze i18n panelu.
//
// Administrator nie widzi surowego kodu ani komunikatu dostawcy tożsamości:
// dostaje zdanie, które mówi, co się stało i co zrobić. Nieznany kod daje
// bezpieczny klucz ogólny - nigdy surowy tekst.
//
// ZALEŻNOŚĆ W JEDNĄ STRONĘ. Kody stoją w czystym `inviteTarget.ts`, a ten
// moduł importuje je stamtąd - nie z `invitations.functions.ts`, który testy
// UI atrapują w całości (mapa straciłaby wtedy swoje kody).
//
// Klucze są podawane do `t()` dynamicznie, więc statyczne wyszukiwanie
// użytych kluczy ich nie widzi - każdy komponent, który wyświetla wynik przez
// tę mapę, importuje `@/lib/i18n-admin-users` ręcznie.
import {
  ACCOUNT_CREATE_FAILED,
  INVITATION_ROLE_NOT_ALLOWED,
  INVITATION_TARGET_UNAVAILABLE,
} from "./inviteTarget";

const KEY_BY_CODE: Record<string, string> = {
  [INVITATION_TARGET_UNAVAILABLE]: "adminUsers.invitationErrTargetUnavailable",
  [INVITATION_ROLE_NOT_ALLOWED]: "adminUsers.invitationErrRoleNotAllowed",
  [ACCOUNT_CREATE_FAILED]: "adminUsers.invitationErrCreateFailed",
  activation_send_limit_reached: "adminUsers.activationSendLimitReached",
  auth_directory_scan_exhausted: "adminUsers.invitationErrDirectoryUnavailable",
};

/**
 * Kody z doklejonym szczegółem (`prefiks:komunikat`) - szczegół zostaje
 * w logu i w `last_error`, panel pokazuje wyłącznie zdanie dla prefiksu.
 */
const KEY_BY_PREFIX: ReadonlyArray<[string, string]> = [
  ["profile_write_failed:", "adminUsers.invitationErrWriteFailed"],
  ["author_write_failed:", "adminUsers.invitationErrWriteFailed"],
  ["role_write_failed:", "adminUsers.invitationErrWriteFailed"],
  ["password_reset_failed:", "adminUsers.invitationErrWriteFailed"],
  ["default_tenant_lookup_failed:", "adminUsers.invitationErrDirectoryUnavailable"],
  ["email_failed:", "adminUsers.invitationErrEmailFailed"],
  ["link_failed:", "adminUsers.invitationErrEmailFailed"],
];

export const INVITATION_ERROR_GENERIC_KEY = "adminUsers.invitationErrGeneric";

/** Klucz i18n dla kodu wyniku wysyłki; pusty albo nieznany kod - klucz ogólny. */
export function invitationErrorKey(code: string | null | undefined): string {
  const value = (code ?? "").trim();
  const direct = KEY_BY_CODE[value];
  if (direct) return direct;
  for (const [prefix, key] of KEY_BY_PREFIX) {
    if (value.startsWith(prefix)) return key;
  }
  return INVITATION_ERROR_GENERIC_KEY;
}

/** Wszystkie klucze, które mapa może zwrócić - dla testu parytetu PL/EN. */
export const INVITATION_ERROR_KEYS: readonly string[] = Array.from(
  new Set([
    ...Object.values(KEY_BY_CODE),
    ...KEY_BY_PREFIX.map(([, key]) => key),
    INVITATION_ERROR_GENERIC_KEY,
  ]),
);
