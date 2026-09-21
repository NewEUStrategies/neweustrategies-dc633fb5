// Mapowanie kodów błędów operacji na kontach (accountAdmin.functions.ts) na
// klucze i18n. Administrator nigdy nie widzi technicznego komunikatu w stylu
// "Forbidden: user outside tenant" - dostaje zdanie, które wyjaśnia przyczynę
// i podpowiada, co zrobić dalej.
import { ADMIN_ACCOUNT_ERROR } from "./accountAdmin.functions";

const KEY_BY_CODE: Record<string, string> = {
  [ADMIN_ACCOUNT_ERROR.outsideTenant]: "adminUsers.accountErrOutsideTenant",
  [ADMIN_ACCOUNT_ERROR.selfDelete]: "adminUsers.accountErrSelfDelete",
  [ADMIN_ACCOUNT_ERROR.confirmMismatch]: "adminUsers.accountErrConfirmMismatch",
  [ADMIN_ACCOUNT_ERROR.lookupFailed]: "adminUsers.accountErrLookupFailed",
  [ADMIN_ACCOUNT_ERROR.deleteFailed]: "adminUsers.accountErrDeleteFailed",
};

/** Starsze/serwerowe komunikaty techniczne rozpoznawane po treści. */
const LEGACY_MATCHERS: ReadonlyArray<[RegExp, string]> = [
  [/outside tenant/i, "adminUsers.accountErrOutsideTenant"],
  [/forbidden/i, "adminUsers.accountErrOutsideTenant"],
];

/** Zwraca klucz i18n dla dowolnego błędu operacji administracyjnej na koncie. */
export function accountAdminErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const direct = KEY_BY_CODE[message.trim()];
  if (direct) return direct;
  for (const [pattern, key] of LEGACY_MATCHERS) {
    if (pattern.test(message)) return key;
  }
  return "adminUsers.accountErrGeneric";
}
