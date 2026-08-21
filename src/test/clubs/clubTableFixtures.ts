// Atrapa wiersza `admin_club_groups` - brakujące ogniwo w `src/test/clubs/fixtures.ts`.
//
// PO CO OSOBNY PLIK. `fixtures.ts` ma atrapę wiersza PRODUKTOWEJ projekcji grupy
// (`clubGroupRow` z `club_groups_list`), ale projekcja ADMINISTRACYJNA to inny
// kształt: nie ma `can_read`/`can_post_thread`/`reason`, bo panel widzi wszystko,
// a ma pełny zestaw kolumn `*_inherited`. Wiersz jest typowany aliasem
// `AdminClubGroupRow`, więc rozjazd kolumny w migracji wychodzi na typach
// w każdym teście, który go używa - świadomie BEZ rzutowań `as`.
//
// UWAGA CO DO PUSTEK: `RETURNS TABLE` typuje kolumny jako non-null, a RPC oddaje
// pustkę pustym NAPISEM - dlatego domyślne `anchor_type`/`anchor_id` to "",
// a nie `null`.
import type { AdminClubGroupRow } from "@/lib/clubs/types";
import { CLUB_BASE_ISO, CLUB_IDS } from "./fixtures";

export function adminClubGroupRow(overrides: Partial<AdminClubGroupRow> = {}): AdminClubGroupRow {
  return {
    id: CLUB_IDS.group,
    club_id: CLUB_IDS.club,
    slug: "dyskusje",
    name_pl: "Dyskusje",
    name_en: "Discussions",
    description_pl: "",
    description_en: "",
    accent_color: "#0f766e",
    icon: "messages-square",
    sort_order: 1,
    status: "active",
    visibility: "public",
    visibility_inherited: true,
    min_tier_rank: 20,
    min_tier_rank_inherited: true,
    moderation_mode: "trusted",
    moderation_mode_inherited: true,
    attribution_mode: "attributed",
    attribution_mode_inherited: true,
    who_can_post: "members",
    who_can_post_inherited: true,
    anchor_type: "",
    anchor_id: "",
    opens_at: CLUB_BASE_ISO,
    closes_at: CLUB_BASE_ISO,
    last_activity_at: CLUB_BASE_ISO,
    thread_count: 4,
    ...overrides,
  };
}
