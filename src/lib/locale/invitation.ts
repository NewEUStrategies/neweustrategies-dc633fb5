/** Server-safe copy shared by the real invitation and its preview. */
const pl = {
  loginAddress: "Adres logowania",
  role: "Rola",
  organisation: "Organizacja",
  temporaryPassword: "Hasło tymczasowe",
  activate: "Aktywuj konto",
  signIn: "Zaloguj się",
  copyLink: "Jeśli przycisk nie działa, skopiuj ten adres do przeglądarki:",
  changePassword: "Po pierwszym zalogowaniu ustaw własne hasło w ustawieniach konta.",
};
const en: Record<keyof typeof pl, string> = {
  loginAddress: "Sign-in address",
  role: "Role",
  organisation: "Organisation",
  temporaryPassword: "Temporary password",
  activate: "Activate account",
  signIn: "Sign in",
  copyLink: "If the button does not work, copy this address into your browser:",
  changePassword: "After your first sign-in, set your own password in the account settings.",
};
export const invitationCopy = { pl, en };
