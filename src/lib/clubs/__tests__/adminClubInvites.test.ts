// Reguły zaproszeń do klubu w panelu - tabela przypadków bez Reacta.
//
// CO TEN PLIK DOWODZI.
//   1. ROLA `lead` NIE JEST OFEROWANA i nie może się w ofercie pojawić przez
//      dopisanie wartości do słownika: lista powstaje przez ODSIANIE
//      `CLUB_MEMBER_ROLES`, więc nowa rola w CHECK-u wchodzi do oferty
//      automatycznie, a `lead` wypada zawsze. RPC
//      `admin_club_invite_link_create` odrzuca role podwyższone nadane
//      masowo, więc oferowanie ich byłoby proponowaniem wyboru, który baza
//      unieważni.
//   2. BRAMKA WYSYŁKI jest JEDNA dla przycisku i dla handlera - inaczej
//      kliknięcie z klawiatury albo podwójne kliknięcie wysyłało pustkę.
//   3. DWA KANAŁY WYSYŁKI składają DWA różne ładunki: ścieżka osobowa niesie
//      wiadomość (przyciętą, pustka schodzi do `null`), ścieżka e-mailowa
//      NIE niesie jej wcale, bo idzie szablonem transakcyjnym.
//   4. KOD ODMOWY Z BAZY zamienia się w KLUCZ i18n
//      `adminClubs.invitations.error.<kod>`, a wyjątek nierozpoznany schodzi
//      na ogólny komunikat zapisu - użytkownik nigdy nie widzi tekstu
//      z Postgresa.
//   5. LIMIT UŻYĆ: wszystko, z czego nie da się przeczytać liczby DODATNIEJ,
//      znaczy „bez limitu” - zero w kolumnie `max_uses` dałoby link martwy
//      w chwili utworzenia.
//   6. STAN LINKU rozstrzyga widoczność akcji unieważnienia i znosi obie
//      postacie pustki, w jakich RPC oddaje kolumny nullowalne.
//   7. CZTERY KANAŁY i WSZYSTKIE STATUSY historii składają klucze słownika,
//      w tym dwa stany dokładane przez `user_invitations` (`sent`, `failed`),
//      których nie ma w `CLUB_INVITATION_STATUSES`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Tablicy „komunikat bazy -> kod”, którą
// pilnuje `inviteErrors.test.ts`; tutaj sprawdzamy wyłącznie ZŁOŻENIE KLUCZA
// z kodu i ścieżkę braku dopasowania. (2) Istnienia kluczy w słownikach PL/EN -
// to bramka `i18nDictionaries.test.ts`. (3) Sklejenia z mutacjami i renderu -
// `ClubInvitationsTab.test.tsx`.
import { describe, expect, it } from "vitest";
import {
  CLUB_INVITE_REVOKE_PROMPT,
  INVITABLE_CLUB_ROLES,
  canSendClubInvite,
  clubInvitationStatusKey,
  clubInviteChannelKey,
  clubInviteErrorKey,
  clubInviteJoinUrl,
  clubInviteLinkPayload,
  clubInviteSendPayload,
  isInvitableClubRole,
  toClubInvitationView,
  toClubInviteLinkView,
  toInvitableClubRole,
  type ClubInviteDraft,
} from "../adminClubInvites";
import { CLUB_INVITATION_STATUSES, CLUB_INVITE_CHANNELS, CLUB_MEMBER_ROLES } from "../types";
import { CLUB_BASE_ISO, CLUB_IDS, clubIsoOffset } from "@/test/clubs/fixtures";
import { adminClubInvitationRow, adminClubInviteLinkRow } from "@/test/clubs/clubRosterFixtures";

/** Wersja robocza formularza - domyślnie ścieżka osobowa bez wyboru osoby. */
function szkic(overrides: Partial<ClubInviteDraft> = {}): ClubInviteDraft {
  return { mode: "person", userId: "", email: "", role: "member", message: "", ...overrides };
}

describe("role możliwe do nadania zaproszeniem", () => {
  it("oferta to słownik ról MINUS prowadzący", () => {
    expect(INVITABLE_CLUB_ROLES).toEqual(CLUB_MEMBER_ROLES.filter((role) => role !== "lead"));
    expect(INVITABLE_CLUB_ROLES).not.toContain("lead");
    expect(INVITABLE_CLUB_ROLES.length).toBe(CLUB_MEMBER_ROLES.length - 1);
  });

  it("rozpoznaje rolę zapraszalną i odrzuca prowadzącego", () => {
    for (const role of INVITABLE_CLUB_ROLES) expect(isInvitableClubRole(role)).toBe(true);
    expect(isInvitableClubRole("lead")).toBe(false);
    expect(isInvitableClubRole("chairman")).toBe(false);
  });

  it("zawężenie schodzi do `member`, więc prowadzący nie wchodzi bocznymi drzwiami", () => {
    expect(toInvitableClubRole("moderator")).toBe("moderator");
    expect(toInvitableClubRole("lead")).toBe("member");
    expect(toInvitableClubRole("chairman")).toBe("member");
    expect(toInvitableClubRole(null)).toBe("member");
  });
});

describe("bramka wysyłki", () => {
  it("ścieżka osobowa wymaga wybranej osoby", () => {
    expect(canSendClubInvite(szkic())).toBe(false);
    expect(canSendClubInvite(szkic({ userId: CLUB_IDS.member }))).toBe(true);
  });

  it("ścieżka e-mailowa nie przyjmuje adresu ze spacji", () => {
    expect(canSendClubInvite(szkic({ mode: "email" }))).toBe(false);
    expect(canSendClubInvite(szkic({ mode: "email", email: "   " }))).toBe(false);
    expect(canSendClubInvite(szkic({ mode: "email", email: " a@b.eu " }))).toBe(true);
  });

  it("wybrana osoba NIE odblokowuje ścieżki e-mailowej i odwrotnie", () => {
    expect(canSendClubInvite(szkic({ mode: "email", userId: CLUB_IDS.member }))).toBe(false);
    expect(canSendClubInvite(szkic({ email: "a@b.eu" }))).toBe(false);
  });
});

describe("ładunek wysyłki", () => {
  it("brak odbiorcy NIE daje ładunku w żadnej ze ścieżek", () => {
    expect(clubInviteSendPayload(szkic())).toBeNull();
    expect(clubInviteSendPayload(szkic({ mode: "email", email: "  " }))).toBeNull();
  });

  it("ścieżka osobowa niesie rolę i PRZYCIĘTĄ wiadomość", () => {
    expect(
      clubInviteSendPayload(
        szkic({ userId: CLUB_IDS.member, role: "moderator", message: "  Zapraszam  " }),
      ),
    ).toEqual({
      channel: "direct",
      userId: CLUB_IDS.member,
      role: "moderator",
      message: "Zapraszam",
    });
  });

  it("wiadomość ze spacji schodzi do null, a nie do napisu ze spacją", () => {
    const payload = clubInviteSendPayload(szkic({ userId: CLUB_IDS.member, message: "   " }));

    expect(payload).toEqual({
      channel: "direct",
      userId: CLUB_IDS.member,
      role: "member",
      message: null,
    });
  });

  it("ścieżka e-mailowa przycina adres i NIE niesie wiadomości", () => {
    expect(
      clubInviteSendPayload(
        szkic({ mode: "email", email: " osoba@instytucja.eu ", message: "cokolwiek" }),
      ),
    ).toEqual({ channel: "email", email: "osoba@instytucja.eu", role: "member" });
  });
});

describe("klucz komunikatu odmowy", () => {
  it("rozpoznany komunikat bazy daje klucz kodu, nie tekst wyjątku", () => {
    expect(clubInviteErrorKey(new Error("clubs: invite quota exceeded"))).toBe(
      "adminClubs.invitations.error.quota_exceeded",
    );
    expect(clubInviteErrorKey(new Error("clubs: elevated role requires admin"))).toBe(
      "adminClubs.invitations.error.elevated_role",
    );
    expect(clubInviteErrorKey("clubs: link exhausted")).toBe(
      "adminClubs.invitations.error.link_exhausted",
    );
  });

  it("wyjątek nierozpoznany schodzi na ogólny komunikat zapisu", () => {
    expect(clubInviteErrorKey(new Error("connection reset"))).toBe("adminClubs.saveFailed");
    expect(clubInviteErrorKey(null)).toBe("adminClubs.saveFailed");
  });
});

describe("ładunek linku zapraszającego", () => {
  it("etykieta jest przycinana, a pusta schodzi do null", () => {
    expect(clubInviteLinkPayload({ label: "  Bruksela  ", maxUses: "", role: "member" })).toEqual({
      label: "Bruksela",
      role: "member",
      maxUses: null,
    });
    expect(clubInviteLinkPayload({ label: "   ", maxUses: "", role: "member" }).label).toBeNull();
  });

  it("wszystko, z czego nie da się przeczytać liczby dodatniej, znaczy BEZ LIMITU", () => {
    for (const maxUses of ["", "   ", "0", "-3", "abc", "-0"]) {
      expect(
        clubInviteLinkPayload({ label: "", maxUses, role: "member" }).maxUses,
        `limit „${maxUses}”`,
      ).toBeNull();
    }
  });

  it("liczba dodatnia przechodzi, także wpisana z ogonem", () => {
    expect(clubInviteLinkPayload({ label: "", maxUses: "5", role: "member" }).maxUses).toBe(5);
    expect(clubInviteLinkPayload({ label: "", maxUses: "12abc", role: "member" }).maxUses).toBe(12);
    expect(clubInviteLinkPayload({ label: "", maxUses: "7.9", role: "observer" })).toEqual({
      label: null,
      role: "observer",
      maxUses: 7,
    });
  });
});

describe("adres zaproszenia", () => {
  it("powstaje z origin podanego argumentem, bez sięgania po window", () => {
    expect(clubInviteJoinUrl("https://nes.eu", "tok-1")).toBe("https://nes.eu/club/join/tok-1");
  });
});

describe("wiersz tabeli linków", () => {
  it("link CZYNNY ma akcję unieważnienia i plakietkę stanu czynnego", () => {
    expect(toClubInviteLinkView(adminClubInviteLinkRow())).toEqual({
      id: CLUB_IDS.link,
      label: "Konferencja Bruksela",
      roleKey: "club.role.member",
      used: 3,
      maxUses: null,
      expiresAt: null,
      revoked: false,
      statusKey: "adminClubs.invitations.activeLink",
      canRevoke: true,
    });
  });

  it("link UNIEWAŻNIONY nie ma już czego unieważniać", () => {
    const widok = toClubInviteLinkView(adminClubInviteLinkRow({ revoked_at: clubIsoOffset(-30) }));

    expect(widok.revoked).toBe(true);
    expect(widok.canRevoke).toBe(false);
    expect(widok.statusKey).toBe("adminClubs.invitations.revoked");
  });

  it("dane CZĘŚCIOWE: pusta etykieta i zerowy limit znaczą brak, nie pustkę na ekranie", () => {
    const widok = toClubInviteLinkView(
      adminClubInviteLinkRow({ label: "", max_uses: 0, expires_at: "" }),
    );

    expect(widok.label).toBeNull();
    expect(widok.maxUses).toBeNull();
    expect(widok.expiresAt).toBeNull();
  });

  it("limit i termin przechodzą, gdy są ustawione", () => {
    const widok = toClubInviteLinkView(
      adminClubInviteLinkRow({ max_uses: 10, expires_at: CLUB_BASE_ISO, club_role: "observer" }),
    );

    expect(widok.maxUses).toBe(10);
    expect(widok.expiresAt).toBe(CLUB_BASE_ISO);
    expect(widok.roleKey).toBe("club.role.observer");
  });

  it("deskryptor potwierdzenia unieważnienia niesie trzy klucze i nic więcej", () => {
    expect(CLUB_INVITE_REVOKE_PROMPT).toEqual({
      titleKey: "adminClubs.invitations.revokeConfirmTitle",
      bodyKey: "adminClubs.invitations.revokeConfirmBody",
      successKey: "adminClubs.invitations.revoked",
    });
  });
});

describe("wiersz historii zaproszeń", () => {
  it("każdy z CZTERECH kanałów składa własny klucz nazwy", () => {
    expect(CLUB_INVITE_CHANNELS.length).toBe(4);
    for (const channel of CLUB_INVITE_CHANNELS) {
      expect(clubInviteChannelKey(channel)).toBe(`adminClubs.invitations.channelName.${channel}`);
    }
  });

  it("statusy klubu ORAZ dwa stany dokładane przez kanał e-mail mają klucze", () => {
    for (const status of [...CLUB_INVITATION_STATUSES, "sent", "failed"]) {
      expect(clubInvitationStatusKey(status)).toBe(`adminClubs.invitations.statusName.${status}`);
    }
  });

  it("klucz Reacta niesie KANAŁ I IDENTYFIKATOR, bo historia jest unią dwóch źródeł", () => {
    expect(toClubInvitationView(adminClubInvitationRow({ channel: "link", id: "x1" })).key).toBe(
      "link-x1",
    );
    expect(toClubInvitationView(adminClubInvitationRow({ channel: "email", id: "x1" })).key).toBe(
      "email-x1",
    );
  });

  it("wpis historii przechodzi na trzy klucze i trzy wartości surowe", () => {
    expect(
      toClubInvitationView(
        adminClubInvitationRow({ channel: "segment", club_role: "observer", status: "declined" }),
      ),
    ).toEqual({
      key: `segment-${CLUB_IDS.invitation}`,
      recipient: "Anna Nowak",
      channelKey: "adminClubs.invitations.channelName.segment",
      roleKey: "club.role.observer",
      statusKey: "adminClubs.invitations.statusName.declined",
      inviter: "Jan Kowalski",
      createdAt: CLUB_BASE_ISO,
    });
  });
});
