// Wiersze RPC zaproszeń klubu - atrapy dla zakładki „Zaproszenia”.
//
// Osobny plik od `fixtures.ts`, bo tamten obsługuje powierzchnię publiczną
// i skład klubu; tu mieszkają dwa kształty, których nikt wcześniej nie
// potrzebował: `admin_club_invite_links` i `admin_club_invitations`.
//
// Kształty 1:1 z `Database["public"]["Functions"][...]["Returns"]` (przez
// aliasy z `src/lib/clubs/types.ts`), więc rozjazd kolumny w migracji wychodzi
// na typach, a nie w runtime. Świadomie BEZ rzutowań `as`.
//
// UMOWA CO DO PUSTKI: generator typów Supabase deklaruje kolumny
// `RETURNS TABLE` jako non-null, więc pustkę reprezentuje PUSTY NAPIS
// (`revoked_at: ""` = link czynny), a dla `max_uses` zero (= bez limitu).
import type { AdminClubInvitationRow, AdminClubInviteLinkRow } from "@/lib/clubs/types";
import { CLUB_BASE_ISO, CLUB_IDS } from "./fixtures";

/** Wiersz `admin_club_invite_links` - link czynny, bez limitu i bez terminu. */
export function adminClubInviteLinkRow(
  overrides: Partial<AdminClubInviteLinkRow> = {},
): AdminClubInviteLinkRow {
  return {
    id: CLUB_IDS.link,
    club_role: "member",
    created_at: CLUB_BASE_ISO,
    expires_at: "",
    label: "Konferencja Bruksela",
    max_uses: 0,
    requires_approval: false,
    revoked_at: "",
    token: "token-jawny-raz",
    used_count: 3,
    ...overrides,
  };
}

/** Wiersz `admin_club_invitations` - jeden wpis historii. */
export function adminClubInvitationRow(
  overrides: Partial<AdminClubInvitationRow> = {},
): AdminClubInvitationRow {
  return {
    id: CLUB_IDS.invitation,
    channel: "direct",
    club_role: "member",
    created_at: CLUB_BASE_ISO,
    expires_at: "",
    inviter_name: "Jan Kowalski",
    recipient: "Anna Nowak",
    status: "pending",
    ...overrides,
  };
}
