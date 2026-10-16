// Mapa wyników wysyłki zaproszeń na klucze i18n (`invitationErrors.ts`).
// Dowodzi, że panel nigdy nie dostaje surowego kodu ani komunikatu dostawcy
// tożsamości: znany kod i każdy prefiks ze szczegółem mają własne zdanie,
// a wszystko inne - klucz ogólny. Parytet PL/EN liczony z listy, którą mapa
// sama eksportuje, więc nowy kod bez tłumaczenia czerwieni ten plik.
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_CREATE_FAILED,
  INVITATION_ROLE_NOT_ALLOWED,
  INVITATION_TARGET_UNAVAILABLE,
} from "../inviteTarget";
import {
  INVITATION_ERROR_GENERIC_KEY,
  INVITATION_ERROR_KEYS,
  invitationErrorKey,
} from "../invitationErrors";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-users";

describe("invitationErrorKey", () => {
  it.each([
    [INVITATION_TARGET_UNAVAILABLE, "adminUsers.invitationErrTargetUnavailable"],
    [INVITATION_ROLE_NOT_ALLOWED, "adminUsers.invitationErrRoleNotAllowed"],
    [ACCOUNT_CREATE_FAILED, "adminUsers.invitationErrCreateFailed"],
    ["activation_send_limit_reached", "adminUsers.activationSendLimitReached"],
    ["auth_directory_scan_exhausted", "adminUsers.invitationErrDirectoryUnavailable"],
  ])("kod %s -> %s", (code, key) => {
    expect(invitationErrorKey(code)).toBe(key);
  });

  it.each([
    ["profile_write_failed:duplicate key", "adminUsers.invitationErrWriteFailed"],
    ["author_write_failed:timeout", "adminUsers.invitationErrWriteFailed"],
    ["role_write_failed:permission denied", "adminUsers.invitationErrWriteFailed"],
    ["password_reset_failed:weak password", "adminUsers.invitationErrWriteFailed"],
    ["default_tenant_lookup_failed:timeout", "adminUsers.invitationErrDirectoryUnavailable"],
    ["email_failed:550 mailbox unavailable", "adminUsers.invitationErrEmailFailed"],
    ["link_failed:rate limited", "adminUsers.invitationErrEmailFailed"],
  ])("prefiks ze szczegółem %s -> %s", (code, key) => {
    expect(invitationErrorKey(code)).toBe(key);
  });

  it("kod otoczony spacjami nadal trafia we własne zdanie", () => {
    expect(invitationErrorKey(`  ${INVITATION_TARGET_UNAVAILABLE} `)).toBe(
      "adminUsers.invitationErrTargetUnavailable",
    );
  });

  it.each([
    null,
    undefined,
    "",
    "boom",
    "Database error saving new user",
    // Prefiks musi stać na początku - szczegół z innym kodem w treści nie wystarcza.
    "unexpected: email_failed:550",
    // Kod bez dwukropka nie jest prefiksem ze szczegółem.
    "email_failed",
  ])("%j daje klucz ogólny, nigdy surowy tekst", (code) => {
    expect(invitationErrorKey(code)).toBe(INVITATION_ERROR_GENERIC_KEY);
  });

  it("lista kluczy obejmuje każdy wynik mapy, bez powtórzeń", () => {
    expect(new Set(INVITATION_ERROR_KEYS).size).toBe(INVITATION_ERROR_KEYS.length);
    expect(INVITATION_ERROR_KEYS).toContain(INVITATION_ERROR_GENERIC_KEY);
    expect(INVITATION_ERROR_KEYS).toContain(invitationErrorKey("link_failed:x"));
  });

  it.each(INVITATION_ERROR_KEYS)("%s istnieje w PL i EN", (key) => {
    const pl = i18n.getResource("pl", "translation", key);
    const en = i18n.getResource("en", "translation", key);
    expect(typeof pl).toBe("string");
    expect(typeof en).toBe("string");
    expect(pl).not.toBe("");
    expect(en).not.toBe("");
  });
});
