// Zaproszenia do klubu w panelu (zakładka „Zaproszenia”) - REGUŁY jako czyste
// funkcje.
//
// CO BYŁO W JSX-IE. Organizm `ClubInvitationsTab` trzymał w drzewie renderu
// całą logikę czterech kanałów wejścia: listę ról możliwych do nadania
// (tablica literałów obok komponentu), wybór ścieżki wysyłki wraz z jej
// bramką (`mode === "person" ? userId.length === 0 : email.trim().length === 0`
// w atrybucie `disabled`, drugi raz w `handleSend`), złożenie dwóch różnych
// ładunków mutacji, przełożenie wyjątku bazy na klucz komunikatu
// (`toClubInviteError` + interpolacja klucza w wywołaniu `toast.error`),
// parsowanie limitu użyć linku (`Number.parseInt` + `Number.isFinite && > 0`),
// budowę adresu zaproszenia (`${window.location.origin}/club/join/${token}`),
// stan wiersza linku (`revoked_at !== null`, `max_uses !== null`,
// `expires_at ? ... : "-"`, `label ?? klucz`) oraz złożenie kluczy słownika
// dla kanału i statusu w historii.
//
// DLACZEGO TO SĄ REGUŁY, A NIE UKŁAD.
//
//   * ROLA `lead` NIE JEST OFEROWANA i to jest reguła bezpieczeństwa, nie
//     przypadek: `ClubInviteLinkInput.role` ma typ `Exclude<ClubMemberRole,
//     "lead">`, a RPC `admin_club_invite_link_create` odrzuca rolę
//     podwyższoną nadaną masowo. Prowadzącego nadaje się imiennie, nie
//     linkiem z newslettera - więc lista ról wypada z SŁOWNIKA przez
//     odsianie, a nie przez przepisanie literałów obok niego (przepisana
//     tablica rozjeżdża się z CHECK-iem przy pierwszej migracji).
//   * KOMUNIKAT BŁĘDU BIERZE SIĘ Z KODU, nie z tekstu wyjątku. Baza rzuca
//     „clubs: invite quota exceeded” po angielsku; użytkownik ma zobaczyć
//     zdanie mówiące, CO ZROBIĆ, w swoim języku. Kod bez dopasowania musi
//     spadać na ogólny komunikat, a nie pokazywać surowy wyjątek.
//   * BRAMKA WYSYŁKI decyduje, czy mutacja w ogóle wychodzi z przeglądarki.
//     Ta sama reguła gasi przycisk i przerywa handler - dwa razy napisana
//     ręcznie rozjeżdżała się przy każdej zmianie ścieżki.
//   * LIMIT UŻYĆ jest wpisywany ręcznie, więc „0”, „-3” i „abc” to trzy
//     różne sposoby napisania „bez limitu”. Zero wysłane do bazy znaczy link
//     martwy w chwili utworzenia.
//   * STAN LINKU (unieważniony / aktywny) rozstrzyga, czy pokazujemy akcję
//     unieważnienia - link unieważniony drugi raz to zapytanie, na które baza
//     odpowiada „nic nie zmieniłem”.
//
// GRANICA WARSTW. Zero Reacta, zero i18n, zero klienta bazy, zero `window`.
// Adres zaproszenia dostaje `origin` ARGUMENTEM, bo `window.location` nie
// istnieje po stronie serwera - a ta funkcja ma dać się sprawdzić bez DOM-u.
// Wyjściem są deskryptory i KLUCZE i18n; w tym pliku nie ma gotowego napisu
// pokazywanego użytkownikowi.
//
// UMOWA CO DO PUSTKI. Generator typów Supabase deklaruje kolumny
// `RETURNS TABLE` jako non-null, więc `label`, `revoked_at` i `expires_at`
// mają typ `string`, choć baza zwraca tam NULL. Pustkę reprezentuje PUSTY
// NAPIS, a `null` zostaje dla wywołań z kodu - obie wartości znaczą to samo.
// Dla `max_uses` (typ `number`) pustką jest zero i każda liczba niedodatnia.
import {
  CLUB_MEMBER_ROLES,
  toClubInviteError,
  type AdminClubInvitationRow,
  type AdminClubInviteLinkRow,
  type ClubMemberRole,
} from "./types";

/** Rola, którą wolno nadać zaproszeniem. `lead` wypada Z DEFINICJI TYPU. */
export type InvitableClubRole = Exclude<ClubMemberRole, "lead">;

/**
 * Role oferowane w dropliście zaproszenia - słownik ról klubu MINUS rola
 * prowadzącego. Odsianie, a nie druga tablica literałów: dodanie roli do
 * CHECK-a w migracji ma dokładnie jedno miejsce do poprawienia.
 */
export const INVITABLE_CLUB_ROLES: readonly InvitableClubRole[] = CLUB_MEMBER_ROLES.filter(
  (role): role is InvitableClubRole => role !== "lead",
);

/** Czy wartość jest rolą, którą wolno nadać zaproszeniem. */
export function isInvitableClubRole(value: string): value is InvitableClubRole {
  return (INVITABLE_CLUB_ROLES as readonly string[]).includes(value);
}

/** Zawężenie do roli zapraszalnej. `lead` i wartość nieznana schodzą do
 *  `member` - degradacja idzie W DÓŁ, nigdy w górę. */
export function toInvitableClubRole(value: string | null): InvitableClubRole {
  return value !== null && isInvitableClubRole(value) ? value : "member";
}

/** Ścieżka wysyłki wybrana przełącznikiem nad kontrolką. */
export type ClubInviteMode = "person" | "email";

/** Wersja robocza formularza wysyłki - dokładnie to, co trzymają pola. */
export interface ClubInviteDraft {
  readonly mode: ClubInviteMode;
  readonly userId: string;
  readonly email: string;
  readonly role: InvitableClubRole;
  readonly message: string;
}

/** Ładunek jednej z dwóch mutacji wysyłki, rozróżniony kanałem. */
export type ClubInviteSend =
  | {
      readonly channel: "direct";
      readonly userId: string;
      readonly role: ClubMemberRole;
      readonly message: string | null;
    }
  | { readonly channel: "email"; readonly email: string; readonly role: InvitableClubRole };

/**
 * Czy jest co wysyłać. Jedna reguła dla przycisku i dla handlera - inaczej
 * kliknięcie w gaszony przycisk (klawiatura, podwójny klik) wysyłało puste
 * zaproszenie.
 */
export function canSendClubInvite(draft: ClubInviteDraft): boolean {
  return draft.mode === "person" ? draft.userId.length > 0 : draft.email.trim().length > 0;
}

/**
 * Ładunek wysyłki albo `null`, gdy wysyłać nie ma czego.
 *
 * Wiadomość jest przycinana i pusta schodzi do `null`: kolumna `message`
 * w `club_invitations` rozróżnia „bez wiadomości” od „wiadomość złożona ze
 * spacji”, a to drugie w powiadomieniu wygląda jak awaria szablonu.
 * Ścieżka e-mail wiadomości NIE nosi - magic link idzie szablonem
 * transakcyjnym, którego treści panel nie ustawia.
 */
export function clubInviteSendPayload(draft: ClubInviteDraft): ClubInviteSend | null {
  if (draft.mode === "person") {
    return draft.userId.length === 0
      ? null
      : {
          channel: "direct",
          userId: draft.userId,
          role: draft.role,
          message: draft.message.trim() === "" ? null : draft.message.trim(),
        };
  }
  const email = draft.email.trim();
  return email.length === 0 ? null : { channel: "email", email, role: draft.role };
}

/**
 * Klucz komunikatu dla wyjątku z RPC zaproszeń. Kod nierozpoznany schodzi na
 * ogólny komunikat zapisu - użytkownik nigdy nie widzi tekstu z Postgresa.
 */
export function clubInviteErrorKey(error: unknown): string {
  const code = toClubInviteError(error);
  return code === null ? "adminClubs.saveFailed" : `adminClubs.invitations.error.${code}`;
}

/** Wersja robocza formularza linku zapraszającego. */
export interface ClubInviteLinkDraft {
  readonly label: string;
  readonly maxUses: string;
  readonly role: InvitableClubRole;
}

/** Ładunek `admin_club_invite_link_create` bez identyfikatora klubu. */
export interface ClubInviteLinkPayload {
  readonly label: string | null;
  readonly role: InvitableClubRole;
  readonly maxUses: number | null;
}

/**
 * Ładunek utworzenia linku. Limit użyć wpisywany ręcznie, więc każda wartość,
 * z której nie da się przeczytać liczby DODATNIEJ, znaczy „bez limitu”: zero
 * i liczba ujemna dają link martwy w chwili utworzenia, a `NaN` w kolumnie
 * `max_uses` baza odrzuca.
 */
export function clubInviteLinkPayload(draft: ClubInviteLinkDraft): ClubInviteLinkPayload {
  const parsed = Number.parseInt(draft.maxUses, 10);
  return {
    label: draft.label.trim() === "" ? null : draft.label.trim(),
    role: draft.role,
    maxUses: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
  };
}

/**
 * Adres zaproszenia. `origin` jest argumentem, bo `window` nie istnieje przy
 * renderze serwerowym - a ta reguła ma dać się sprawdzić bez DOM-u.
 */
export function clubInviteJoinUrl(origin: string, token: string): string {
  return `${origin}/club/join/${token}`;
}

/** Pole opcjonalne wiersza: pustka to `null`, nie pusty napis. */
function optional(value: string | null): string | null {
  return value === null || value === "" ? null : value;
}

/** Wiersz tabeli linków w postaci gotowej do wyrenderowania. */
export interface ClubInviteLinkView {
  readonly id: string;
  /** `null` = bez etykiety; napis klucza zastępczego składa komponent. */
  readonly label: string | null;
  readonly roleKey: string;
  readonly used: number;
  /** `null` = bez limitu użyć. */
  readonly maxUses: number | null;
  readonly expiresAt: string | null;
  readonly revoked: boolean;
  readonly statusKey: string;
  /** Link unieważniony nie ma już czego unieważniać. */
  readonly canRevoke: boolean;
}

/**
 * Mapowanie wiersza linku na widok.
 *
 * Klucz roli powstaje z wartości SUROWEJ, nie zawężonej - świadomie. Rola
 * spoza słownika ma oblać bramkę i18n brakującym kluczem, a nie po cichu
 * pokazać etykietę roli domyślnej: link nadający rolę, której panel nie zna,
 * jest zdarzeniem do zbadania, nie do wygładzenia.
 */
export function toClubInviteLinkView(link: AdminClubInviteLinkRow): ClubInviteLinkView {
  const revoked = optional(link.revoked_at) !== null;
  return {
    id: link.id,
    label: optional(link.label),
    roleKey: `club.role.${link.club_role}`,
    used: link.used_count,
    maxUses: link.max_uses > 0 ? link.max_uses : null,
    expiresAt: optional(link.expires_at),
    revoked,
    statusKey: revoked ? "adminClubs.invitations.revoked" : "adminClubs.invitations.activeLink",
    canRevoke: !revoked,
  };
}

/** Deskryptor potwierdzenia unieważnienia linku - operacja NIEODWRACALNA. */
export const CLUB_INVITE_REVOKE_PROMPT = {
  titleKey: "adminClubs.invitations.revokeConfirmTitle",
  bodyKey: "adminClubs.invitations.revokeConfirmBody",
  successKey: "adminClubs.invitations.revoked",
} as const;

/** Wiersz historii zaproszeń w postaci gotowej do wyrenderowania. */
export interface ClubInvitationView {
  /** Klucz Reacta: historia jest UNIĄ dwóch źródeł, więc `id` bywa wspólny
   *  dla dwóch kanałów - klucz musi nieść jedno i drugie. */
  readonly key: string;
  readonly recipient: string;
  readonly channelKey: string;
  readonly roleKey: string;
  readonly statusKey: string;
  readonly inviter: string;
  readonly createdAt: string;
}

/** Klucz nazwy kanału. Cztery ścieżki wejścia z `CLUB_INVITE_CHANNELS`. */
export function clubInviteChannelKey(channel: string): string {
  return `adminClubs.invitations.channelName.${channel}`;
}

/**
 * Klucz nazwy statusu.
 *
 * Prefiks to `invitations`, nie `invites` - literówka sprawiała, że `t()`
 * zawsze schodziło do `defaultValue` i wypisywało surowy status z bazy.
 * Status jedzie SUROWY, bo lista robi unię `club_invitations` i
 * `user_invitations`, a ta druga dokłada własne stany (`sent`, `failed`),
 * których nie ma w `CLUB_INVITATION_STATUSES`. Zawężenie do słownika klubu
 * zamieniłoby je na status nieprawdziwy.
 */
export function clubInvitationStatusKey(status: string): string {
  return `adminClubs.invitations.statusName.${status}`;
}

/** Mapowanie wiersza historii na widok. */
export function toClubInvitationView(row: AdminClubInvitationRow): ClubInvitationView {
  return {
    key: `${row.channel}-${row.id}`,
    recipient: row.recipient,
    channelKey: clubInviteChannelKey(row.channel),
    roleKey: `club.role.${row.club_role}`,
    statusKey: clubInvitationStatusKey(row.status),
    inviter: row.inviter_name,
    createdAt: row.created_at,
  };
}
