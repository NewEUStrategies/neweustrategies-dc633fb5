// Discussion Club - kontrakt domenowy po stronie klienta.
//
// Slowniki sa wyprowadzone z CHECK-ow w bazie i sluza za JEDYNE zrodlo prawdy
// dla dropList w panelu. Gdy CHECK w migracji sie zmieni, a te tablice nie,
// test kontraktu (src/lib/clubs/__tests__/clubContract.test.ts) oblewa - bo
// droplista z wartoscia spoza CHECK-a to blad, ktory widac dopiero przy
// zapisie, czyli po stracie tego, co uzytkownik wpisal.
import type { Database } from "@/integrations/supabase/types";

/** Widocznosc klubu. Osobna os od polityki wstepu - patrz V1 §1.1. */
export const CLUB_VISIBILITIES = ["public", "members", "private", "secret"] as const;
export type ClubVisibility = (typeof CLUB_VISIBILITIES)[number];

/**
 * Widocznosc, ktora wolno USTAWIC na dziale. CHECK w bazie
 * (`club_groups_visibility_check`) zna tylko trzy wartosci - 'public' nie jest
 * pomylka w slowniku, tylko swiadoma asymetria: dzial nie moze byc bardziej
 * otwarty niz klub, ktory go zawiera, wiec publicznosc wychodzi wylacznie
 * z DZIEDZICZENIA (NULL w kolumnie), nigdy z nadpisania.
 *
 * Dwie tablice zamiast jednej, bo to dwie rozne role: `CLUB_VISIBILITIES`
 * opisuje wartosci, ktore wolno ZOBACZYC (takze odziedziczone 'public'),
 * a ta - wartosci, ktore wolno ZAPISAC. Droplista nadpisania karmiona
 * pierwsza z nich oddawala administratorowi wybor, ktory baza odrzuca
 * dopiero przy zapisie - czyli po stracie tego, co wpisal.
 */
export const CLUB_GROUP_VISIBILITIES = ["members", "private", "secret"] as const;
export type ClubGroupVisibility = (typeof CLUB_GROUP_VISIBILITIES)[number];

/** Widocznosc efektywna -> najblizsza wartosc, ktora wolno ustawic na dziale. */
export function toClubGroupVisibility(value: string): ClubGroupVisibility {
  return (CLUB_GROUP_VISIBILITIES as readonly string[]).includes(value)
    ? (value as ClubGroupVisibility)
    : "members";
}

/** Polityka wstepu. Kombinacja public + invite jest poprawna i czesta. */
export const CLUB_JOIN_POLICIES = ["open", "request", "invite"] as const;
export type ClubJoinPolicy = (typeof CLUB_JOIN_POLICIES)[number];

/** Tryb atrybucji wypowiedzi (regula Chatham House). */
export const CLUB_ATTRIBUTION_MODES = ["attributed", "chatham", "anonymous_allowed"] as const;
export type ClubAttributionMode = (typeof CLUB_ATTRIBUTION_MODES)[number];

/** Kto zaklada temat. Domyslnie moderators - przejscie na members to decyzja
 *  produktowa w droplistcie, nie zmiana architektury (V2 §0). */
export const CLUB_POST_POLICIES = ["members", "moderators", "staff_only"] as const;
export type ClubPostPolicy = (typeof CLUB_POST_POLICIES)[number];

/** Tryb moderacji. trusted = premoderacja tylko ponizej progu reputacji. */
export const CLUB_MODERATION_MODES = ["post", "pre", "trusted"] as const;
export type ClubModerationMode = (typeof CLUB_MODERATION_MODES)[number];

export const CLUB_STATUSES = ["draft", "active", "archived"] as const;
export type ClubStatus = (typeof CLUB_STATUSES)[number];

export const CLUB_GROUP_STATUSES = ["draft", "scheduled", "active", "frozen", "archived"] as const;
export type ClubGroupStatus = (typeof CLUB_GROUP_STATUSES)[number];

/** Rola W KLUBIE. Osobna os od public.app_role - nigdy ich nie mieszac. */
export const CLUB_MEMBER_ROLES = ["lead", "moderator", "member", "observer"] as const;
export type ClubMemberRole = (typeof CLUB_MEMBER_ROLES)[number];

export const CLUB_MEMBER_STATUSES = ["active", "pending", "invited", "banned", "left"] as const;
export type ClubMemberStatus = (typeof CLUB_MEMBER_STATUSES)[number];

/**
 * Uklad strony klubu. Nie kosmetyka: `magazine` wyroznia jeden watek, wiec
 * zmienia to, co czytelnik zobaczy PIERWSZE. Slownik musi odpowiadac CHECK-owi
 * clubs_layout_check z migracji 20260808160000.
 */
export const CLUB_LAYOUTS = ["list", "cards", "magazine", "editorial"] as const;
export type ClubLayout = (typeof CLUB_LAYOUTS)[number];

export function toClubLayout(value: string | null | undefined): ClubLayout {
  return value !== null &&
    value !== undefined &&
    (CLUB_LAYOUTS as readonly string[]).includes(value)
    ? (value as ClubLayout)
    : "list";
}

/**
 * Kody odmowy zapisu klubu. Panel pokazywal dotad jedno zdanie "Nie udalo sie
 * zapisac" na KAZDA awarie - a zajety adres, nierozwiazany tenant i brak
 * uprawnien to trzy rozne problemy z trzema roznymi nastepnymi krokami.
 * Administrator, ktory nie wie, ktory z nich go spotkal, nie ma co zrobic.
 */
export const CLUB_SAVE_ERRORS = [
  "slug_taken",
  "missing_fields",
  "forbidden",
  "tenant_unresolved",
  "not_found",
  "unknown",
] as const;
export type ClubSaveError = (typeof CLUB_SAVE_ERRORS)[number];

/**
 * Mapuje wyjatek z RPC na kod slownikowy. Dopasowanie idzie po TRESCI
 * komunikatu, bo PostgREST nie przepuszcza SQLSTATE w ustrukturyzowanej formie,
 * a komunikaty sa stalymi literalami w migracji - nie tlumaczymy ich, wiec sa
 * stabilne.
 */
export function toClubSaveError(error: unknown): ClubSaveError {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("slug already taken")) return "slug_taken";
  if (message.includes("slug and name_pl are required")) return "missing_fields";
  if (message.includes("tenant not resolved")) return "tenant_unresolved";
  if (message.includes("not found")) return "not_found";
  if (message.includes("forbidden")) return "forbidden";
  return "unknown";
}

/**
 * Slug z nazwy. Ta sama regula, co w club_create_thread po stronie bazy:
 * male litery, cyfry i myslniki, polskie znaki rozlozone na ASCII. Robimy to
 * w kliencie, zeby pole adresu wypelnialo sie na oczach piszacego - a nie
 * dopiero po zapisie.
 */
const PL_MAP: Readonly<Record<string, string>> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
};

export function clubSlugFromName(name: string): string {
  const lowered = name.toLowerCase();
  let ascii = "";
  for (const ch of lowered) ascii += PL_MAP[ch] ?? ch;
  return ascii
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export const CLUB_NOTIFY_LEVELS = ["all", "mentions", "digest", "none"] as const;
export type ClubNotifyLevel = (typeof CLUB_NOTIFY_LEVELS)[number];

/**
 * Poziom powiadomien z bazy sprowadzony do slownika kodu. `digest` jest
 * domyslna wartoscia kolumny w `club_members`, wiec jest tez poprawnym
 * domyslem dla wiersza, ktorego jeszcze nie ma (osoba przed dolaczeniem).
 */
export function toClubNotifyLevel(value: string | null | undefined): ClubNotifyLevel {
  return value !== null &&
    value !== undefined &&
    (CLUB_NOTIFY_LEVELS as readonly string[]).includes(value)
    ? (value as ClubNotifyLevel)
    : "digest";
}

/**
 * Kody powodu z club_capabilities().reason. UI mapuje kod na zdanie ORAZ na
 * wlasciwa akcje - dlatego to jest domkniety slownik, a nie wolny tekst.
 * Zbior musi odpowiadac galeziom w migracji 20260808090000.
 */
export const CLUB_ACCESS_REASONS = [
  "not_found",
  "auth_required",
  "not_member",
  "tier_too_low",
  "group_frozen",
  "not_open_yet",
  "window_closed",
  "archived",
  "banned",
  "pre_moderation",
  // Podglad cudzych uprawnien nie ma sesji tamtej osoby, wiec nie policzy jej
  // rangi planu. RPC zglasza to jawnie zamiast zgadywac - i panel ma to
  // powtorzyc, bo "brak przeszkod" bylo tu po prostu nieprawda.
  "tier_unknown",
] as const;
export type ClubAccessReason = (typeof CLUB_ACCESS_REASONS)[number];

/** Rola efektywna zwracana przez club_capabilities - rola klubowa albo brak. */
export type ClubEffectiveRole = ClubMemberRole | "non_member" | "banned";

// ---------------------------------------------------------------------------
// Ksztalty zwracane przez RPC. Wyprowadzone z wygenerowanego kontraktu, zeby
// rozjazd migracja <-> klient wychodzil przy kompilacji, a nie w przegladarce.
// ---------------------------------------------------------------------------
type Fn = Database["public"]["Functions"];

type RowOf<T> = T extends readonly (infer R)[] ? R : never;

/**
 * Korekta nullowalnosci. Generator typow Supabase dla `RETURNS TABLE` wypuszcza
 * KAZDA kolumne jako non-null, bo Postgres nie deklaruje tam nullowalnosci -
 * a czesc z nich baza realnie zwraca jako NULL (autor w trybie chatham, rodzic
 * odpowiedzi pierwszego poziomu, powod przy braku przeszkod). Bez tej korekty
 * klient jest typowany na dane, ktorych nigdy nie dostanie: `?? null` w kodzie
 * wyglada jak martwa galaz, a atrapa w tescie nie da sie napisac zgodnie
 * z prawda.
 */
type NullableCols<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] | null };

export type ClubCapabilitiesRow = NullableCols<RowOf<Fn["club_capabilities"]["Returns"]>, "reason">;
export type ClubListRow = RowOf<Fn["club_list"]["Returns"]>;
export type ClubViewRow = RowOf<Fn["club_view"]["Returns"]>;
export type ClubGroupRow = RowOf<Fn["club_groups_list"]["Returns"]>;
export type ClubMemberRow = RowOf<Fn["club_members_list"]["Returns"]>;
export type ClubMembershipRow = RowOf<Fn["club_my_memberships"]["Returns"]>;
export type AdminClubRow = RowOf<Fn["admin_club_list"]["Returns"]>;
/**
 * Karta klubu dla edytora w panelu.
 *
 * KOREKTA NULLOWALNOSCI, nie kosmetyka. `admin_club_get` wybiera kolumny wprost
 * z `public.clubs`, a tam DZIEWIEC kolumn tekstowych jest nullowalnych
 * (`tagline_*`, `description_*`, `rules_*`, `accent_color`, `cover_image_url`,
 * `policy_area` - patrz `20260808090000_discussion_clubs_a1_structure.sql`).
 * Generator typow Supabase dla `RETURNS TABLE` deklaruje kazda kolumne jako
 * non-null, wiec bez tej korekty `club.tagline_pl ?? ""` w edytorze wygladalo
 * na martwa galaz, a atrapy w testach NIE DALO SIE napisac zgodnie z typem -
 * dokladnie sytuacja, dla ktorej powstal `NullableCols` (patrz komentarz wyzej).
 */
export type AdminClubDetailRow = NullableCols<
  RowOf<Fn["admin_club_get"]["Returns"]>,
  | "tagline_pl"
  | "tagline_en"
  | "description_pl"
  | "description_en"
  | "rules_pl"
  | "rules_en"
  | "accent_color"
  | "cover_image_url"
  | "policy_area"
>;
export type AdminClubGroupRow = RowOf<Fn["admin_club_groups"]["Returns"]>;
export type AdminClubStatsRow = RowOf<Fn["admin_club_stats"]["Returns"]>;

/**
 * Zdolnosci w formie znormalizowanej. RPC zwraca `reason` jako `string` (bo
 * SQL nie ma unii literalow), a tutaj zawezamy go do slownika - z jawnym
 * fallbackiem, zeby nieznany kod z nowszej migracji nie wywrocil interfejsu.
 */
export interface ClubCapabilities {
  canRead: boolean;
  canPostThread: boolean;
  canReply: boolean;
  canReact: boolean;
  canModerate: boolean;
  canManage: boolean;
  canInvite: boolean;
  canSeeMembers: boolean;
  canRevealAuthor: boolean;
  effectiveRole: ClubEffectiveRole;
  reason: ClubAccessReason | null;
}

/** Zdolnosci calkowicie zamkniete - stan wyjsciowy zanim RPC odpowie. */
export const NO_CLUB_CAPABILITIES: ClubCapabilities = {
  canRead: false,
  canPostThread: false,
  canReply: false,
  canReact: false,
  canModerate: false,
  canManage: false,
  canInvite: false,
  canSeeMembers: false,
  canRevealAuthor: false,
  effectiveRole: "non_member",
  reason: null,
};

function isAccessReason(value: string | null): value is ClubAccessReason {
  return value !== null && (CLUB_ACCESS_REASONS as readonly string[]).includes(value);
}

function isEffectiveRole(value: string | null): value is ClubEffectiveRole {
  return (
    value === "non_member" ||
    value === "banned" ||
    (value !== null && (CLUB_MEMBER_ROLES as readonly string[]).includes(value))
  );
}

/**
 * Normalizacja wiersza z club_capabilities. Czysta funkcja - testowalna bez
 * bazy i bez Reacta, co jest calym sensem trzymania jej tutaj.
 */
export function toClubCapabilities(row: ClubCapabilitiesRow | null | undefined): ClubCapabilities {
  if (!row) return NO_CLUB_CAPABILITIES;
  const reason = row.reason ?? null;
  const role = row.effective_role ?? null;
  return {
    canRead: row.can_read === true,
    canPostThread: row.can_post_thread === true,
    canReply: row.can_reply === true,
    canReact: row.can_react === true,
    canModerate: row.can_moderate === true,
    canManage: row.can_manage === true,
    canInvite: row.can_invite === true,
    canSeeMembers: row.can_see_members === true,
    canRevealAuthor: row.can_reveal_author === true,
    effectiveRole: isEffectiveRole(role) ? role : "non_member",
    // Nieznany kod traktujemy jak brak powodu: interfejs pokaze ogolna
    // odmowe zamiast surowego stringa z bazy.
    reason: isAccessReason(reason) ? reason : null,
  };
}

// ---------------------------------------------------------------------------
// Dziedziczenie ustawien grupy
// ---------------------------------------------------------------------------

/**
 * Wartosc ustawienia grupy wraz z informacja, czy pochodzi z klubu.
 * Baza rozwiazuje dziedziczenie i zwraca oba pola (kolumny *_inherited),
 * wiec klient NIE powtarza reguly - tylko ja prezentuje.
 */
export interface InheritedSetting<T> {
  value: T;
  inherited: boolean;
}

export interface ClubGroupSettings {
  visibility: InheritedSetting<ClubVisibility>;
  whoCanPost: InheritedSetting<ClubPostPolicy>;
  moderationMode: InheritedSetting<ClubModerationMode>;
  minTierRank: InheritedSetting<number>;
  attributionMode: InheritedSetting<ClubAttributionMode>;
}

/**
 * Zawezenie GOLEGO `string` z RPC do slownika, z degradacja do wartosci
 * domyslnej. Generator Supabase typuje kolumny CHECK-owe jako `string`, wiec
 * bez tego kazdy konsument robilby wlasne rzutowanie - a rzutowanie nie ma
 * galezi dla wartosci spoza slownika i cicho przepuszcza kod, ktorego i18n nie
 * zna (efekt: goly klucz na ekranie).
 *
 * EKSPORTOWANE, bo dokladnie ta sama funkcja stala skopiowana w trasie edytora
 * klubu (`admin.community.clubs.$clubId.tsx`). Dwie kopie tej samej degradacji
 * znaczyly dwa mozliwe fallbacki dla tej samej kolumny.
 */
export function narrowClubEnum<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Alias wewnetrzny - historyczna nazwa uzywana w tym pliku. */
const narrow = narrowClubEnum;

/**
 * Zawezenie trybu atrybucji KLUBU. Generator Supabase typuje `attribution_mode`
 * jako goly `string`, wiec bez tego kazdy konsument robilby wlasne rzutowanie -
 * a rzutowanie nie ma galezi dla wartosci spoza slownika i cicho przepuszcza
 * kod, ktorego i18n nie zna (efekt: goly klucz na ekranie).
 */
export function toClubAttributionMode(value: string | null): ClubAttributionMode {
  return narrow(value, CLUB_ATTRIBUTION_MODES, "attributed");
}

/**
 * Wariant `toClubAttributionMode` dla miejsc, w ktorych BRAK wartosci znaczy
 * "dziedzicz", a nie "domyslnie attributed" - podmiana pustki na tryb podpisany
 * pokazywalaby autorowi zasade ostrzejsza, niz obowiazuje w dziale.
 */
export function isClubAttributionMode(value: string | null): value is ClubAttributionMode {
  return value !== null && (CLUB_ATTRIBUTION_MODES as readonly string[]).includes(value);
}

/**
 * Ksztalt strukturalny wspolny dla obu projekcji grupy (produktowej
 * club_groups_list i administracyjnej admin_club_groups). Dzieki temu jedna
 * funkcja obsluguje oba wiersze bez rzutowania - roznia sie polami spoza
 * dziedziczenia (can_read, reason), ktorych ta funkcja i tak nie czyta.
 */
export interface GroupInheritanceFields {
  visibility: string | null;
  visibility_inherited: boolean;
  who_can_post: string | null;
  who_can_post_inherited: boolean;
  moderation_mode: string | null;
  moderation_mode_inherited: boolean;
  min_tier_rank: number | null;
  min_tier_rank_inherited: boolean;
  attribution_mode: string | null;
  attribution_mode_inherited: boolean;
}

/** Wyciaga z wiersza grupy pieciopolowy zestaw ustawien z flaga dziedziczenia. */
export function toGroupSettings(row: GroupInheritanceFields): ClubGroupSettings {
  return {
    visibility: {
      value: narrow(row.visibility, CLUB_VISIBILITIES, "members"),
      inherited: row.visibility_inherited === true,
    },
    whoCanPost: {
      value: narrow(row.who_can_post, CLUB_POST_POLICIES, "moderators"),
      inherited: row.who_can_post_inherited === true,
    },
    moderationMode: {
      value: narrow(row.moderation_mode, CLUB_MODERATION_MODES, "trusted"),
      inherited: row.moderation_mode_inherited === true,
    },
    minTierRank: {
      value: typeof row.min_tier_rank === "number" ? row.min_tier_rank : 0,
      inherited: row.min_tier_rank_inherited === true,
    },
    attributionMode: {
      value: narrow(row.attribution_mode, CLUB_ATTRIBUTION_MODES, "attributed"),
      inherited: row.attribution_mode_inherited === true,
    },
  };
}

// ---------------------------------------------------------------------------
// Wejscia mutacji
// ---------------------------------------------------------------------------

/**
 * Patch klubu. Pole nieobecne = "nie ruszaj" (RPC czyta obecnosc klucza
 * operatorem ?), pole ustawione na null = "wyczysc". Dlatego typy opcjonalnych
 * tekstow to `string | null`, a nie `string | undefined`.
 */
export interface ClubUpsertInput {
  id?: string;
  slug?: string;
  name_pl?: string;
  name_en?: string;
  tagline_pl?: string | null;
  tagline_en?: string | null;
  description_pl?: string | null;
  description_en?: string | null;
  icon?: string;
  accent_color?: string | null;
  cover_image_url?: string | null;
  visibility?: ClubVisibility;
  join_policy?: ClubJoinPolicy;
  min_tier_rank?: number;
  attribution_mode?: ClubAttributionMode;
  who_can_post?: ClubPostPolicy;
  moderation_mode?: ClubModerationMode;
  policy_area?: string | null;
  rules_pl?: string | null;
  rules_en?: string | null;
  status?: ClubStatus;
  layout?: ClubLayout;
}

/**
 * Patch grupy. Pusty string w polu ustawienia oznacza "dziedzicz z klubu" -
 * tak samo jak NULL. Droplista dziedziczenia wysyla wlasnie pusty string,
 * bo Radix Select nie potrafi przechowac wartosci null.
 */
export interface ClubGroupUpsertInput {
  id?: string;
  club_id?: string;
  slug?: string;
  name_pl?: string;
  name_en?: string;
  description_pl?: string | null;
  description_en?: string | null;
  icon?: string | null;
  accent_color?: string | null;
  sort_order?: number;
  visibility?: ClubVisibility | "";
  who_can_post?: ClubPostPolicy | "";
  moderation_mode?: ClubModerationMode | "";
  min_tier_rank?: number | null;
  attribution_mode?: ClubAttributionMode | "";
  opens_at?: string | null;
  closes_at?: string | null;
  status?: ClubGroupStatus;
  anchor_type?: string | null;
  anchor_id?: string | null;
}

export interface ClubMemberUpsertInput {
  clubId: string;
  userId: string;
  role?: ClubMemberRole;
  status?: ClubMemberStatus;
  /** Pominiete = "nie ruszaj kadencji". Do jej zdjecia sluzy `clearRoleExpiry`. */
  roleExpiresAt?: string | null;
  /** Jawne zdjecie kadencji. Bez tego pola nie da sie odroznic "nie przyslalem
   *  terminu" od "zdejmij termin" - a wczesniej ta niejednoznacznosc cicho
   *  kasowala kadencje przy KAZDEJ zmianie roli z panelu. */
  clearRoleExpiry?: boolean;
}

// ---------------------------------------------------------------------------
// Sciezka D: kampanie segmentowe
// ---------------------------------------------------------------------------

/**
 * Rodzaje regul segmentu. Slownik odpowiada galeziom
 * `club_segment_candidate_ids` - regula spoza tej listy rozwiazuje sie
 * w bazie na zbior PUSTY, wiec droplista z wlasnym pomyslem na rodzaj
 * dawalaby kampanie, ktora cicho nie wysyla niczego.
 */
export const CLUB_SEGMENT_KINDS = [
  "badge",
  "specialization",
  "other_club",
  "policy_follow",
  "event_rsvp",
] as const;
export type ClubSegmentKind = (typeof CLUB_SEGMENT_KINDS)[number];

/** Regula w postaci, w ktorej jedzie do RPC jako jsonb. */
export interface ClubSegmentRule {
  kind: ClubSegmentKind;
  /** `badge` */
  badge?: string;
  /** `specialization` */
  value?: string;
  /** `other_club` */
  club_id?: string;
  /** `policy_follow` */
  item_id?: string;
  /** `event_rsvp` */
  event_id?: string;
  /** Nazwa zapisywanej kampanii - `club_segment_rules.name` jest NOT NULL. */
  name?: string;
}

/**
 * Czy regula jest KOMPLETNA. Rodzaj bez swojej wartosci rozwiazuje sie na zbior
 * pusty, wiec przycisk "wyslij" ma byc wtedy nieaktywny - a nie wysylac
 * kampanie do zera osob i raportowac sukces.
 */
export function isClubSegmentRuleComplete(rule: ClubSegmentRule): boolean {
  const filled = (value: string | undefined): boolean =>
    value !== undefined && value.trim().length > 0;
  switch (rule.kind) {
    case "badge":
      return filled(rule.badge);
    case "specialization":
      return filled(rule.value);
    case "other_club":
      return filled(rule.club_id);
    case "policy_follow":
      return filled(rule.item_id);
    case "event_rsvp":
      return filled(rule.event_id);
  }
}

export interface ClubSegmentPreview {
  matched: number;
  already_member: number;
  blocked: number;
  will_send: number;
}

export interface AdminClubListFilters {
  search?: string;
  status?: ClubStatus | null;
  visibility?: ClubVisibility | null;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Etap A2: zaproszenia
// ---------------------------------------------------------------------------

/** Cztery sciezki wejscia do klubu (V2 §3.1). */
export const CLUB_INVITE_CHANNELS = ["direct", "email", "link", "segment"] as const;
export type ClubInviteChannel = (typeof CLUB_INVITE_CHANNELS)[number];

export const CLUB_INVITATION_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "expired",
  "revoked",
] as const;
export type ClubInvitationStatus = (typeof CLUB_INVITATION_STATUSES)[number];

export type ClubMyInvitationRow = RowOf<Fn["club_my_invitations"]["Returns"]>;
export type AdminClubInvitationRow = RowOf<Fn["admin_club_invitations"]["Returns"]>;
export type AdminClubInviteLinkRow = RowOf<Fn["admin_club_invite_links"]["Returns"]>;

export interface ClubInviteLinkInput {
  clubId: string;
  label?: string | null;
  /** Rola `lead` jest tu celowo NIEDOSTEPNA - prowadzacego nadaje sie
   *  imiennie, nie masowo linkiem z newslettera. */
  role?: Exclude<ClubMemberRole, "lead">;
  maxUses?: number | null;
  expiresAt?: string | null;
  requiresApproval?: boolean;
  groupId?: string | null;
}

/**
 * Kody bledow rzucanych przez RPC zaproszen. Mapowane na komunikat, ktory mowi
 * uzytkownikowi, CO ZROBIC - a nie powtarza tresci wyjatku z bazy.
 */
export const CLUB_INVITE_ERRORS = [
  "quota_exceeded",
  "already_member",
  "recently_declined",
  "user_unavailable",
  "elevated_role",
  "link_expired",
  "link_revoked",
  "link_exhausted",
  "invitation_required",
  "tier_too_low",
  "banned",
] as const;
export type ClubInviteError = (typeof CLUB_INVITE_ERRORS)[number];

/**
 * Tlumaczy komunikat wyjatku z Postgresa na kod slownikowy. Baza rzuca teksty
 * po angielsku ("clubs: invite quota exceeded"), a interfejs potrzebuje kodu,
 * z ktorego zlozy zdanie w jezyku uzytkownika. Zero regexpow po polskiej
 * stronie - dopasowanie idzie po stalym fragmencie komunikatu z migracji.
 */
export function toClubInviteError(error: unknown): ClubInviteError | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("invite quota exceeded")) return "quota_exceeded";
  if (message.includes("already a member")) return "already_member";
  if (message.includes("recently declined")) return "recently_declined";
  if (message.includes("user not available")) return "user_unavailable";
  if (message.includes("elevated role requires admin")) return "elevated_role";
  if (message.includes("link expired")) return "link_expired";
  if (message.includes("link revoked")) return "link_revoked";
  if (message.includes("link exhausted")) return "link_exhausted";
  if (message.includes("invitation required")) return "invitation_required";
  if (message.includes("tier too low")) return "tier_too_low";
  if (message.includes("banned")) return "banned";
  return null;
}

// ---------------------------------------------------------------------------
// Etap A3: tematy i odpowiedzi
// ---------------------------------------------------------------------------

/** Rodzaj tematu. To NIE jest etykieta - zmienia cykl zycia (V1 §1.3). */
export const CLUB_THREAD_KINDS = [
  "discussion",
  "question",
  "position",
  "resource",
  "announcement",
  "poll",
] as const;
export type ClubThreadKind = (typeof CLUB_THREAD_KINDS)[number];

export const CLUB_THREAD_STATUSES = [
  "pending",
  "open",
  "resolved",
  "dormant",
  "locked",
  "hidden",
  "deleted",
] as const;
export type ClubThreadStatus = (typeof CLUB_THREAD_STATUSES)[number];

/**
 * Sorty listy tematow. `unanswered` jest celowo wyeksponowany: temat bez
 * odpowiedzi to porazka klubu, a nie neutralny stan (V1 §5.2).
 *
 * KAZDA wartosc jest realnym porzadkiem w `club_threads_list` (migracja A18).
 * Wczesniej slownik obiecywal piec, a RPC znalo dwa - warstwa API po cichu
 * mapowala reszte na 'hot', wiec trzy pozycje droplisty byly nieodroznialne
 * od domyslnej. Rozszerzenie tej listy bez galezi w SQL powtorzy ten blad.
 */
export const CLUB_THREAD_SORTS = ["hot", "new", "unanswered", "top", "mine", "subscribed"] as const;
export type ClubThreadSort = (typeof CLUB_THREAD_SORTS)[number];

/** Sorty, ktore wymagaja sesji: filtruja po wolajacym, wiec dla anonima
 *  zwrocilyby pusty zbior i sugerowaly, ze klub jest pusty. */
export const CLUB_THREAD_SORTS_REQUIRING_SESSION: readonly ClubThreadSort[] = [
  "mine",
  "subscribed",
];

/** Porzadki odpowiedzi. `stance` grupuje wg stanowiska autora - to jedyny
 *  widok, ktory pokazuje MAPE SPORU zamiast kolejnosci wpisywania (V1 §4.4),
 *  i ma sens wylacznie w watku typu `position`. */
export const CLUB_REPLY_SORTS = ["chronological", "best", "stance"] as const;
export type ClubReplySort = (typeof CLUB_REPLY_SORTS)[number];

/**
 * Wiersz listy tematow z kolumnami NULLOWALNYMI oznaczonymi jawnie.
 *
 * Generator typow Supabase deklaruje kazda kolumne RETURNS TABLE jako
 * niepusta, a `club_threads_list` zwraca NULL w calej projekcji autora, kiedy
 * klub dziala pod regula Chatham House albo wpis jest anonimowy. Bez tego
 * `thread.author_name.trim()` kompilowalo sie i wywracalo dopiero na produkcji
 * - dokladnie w klubie, w ktorym najbardziej zalezy nam na poprawnosci.
 *
 * `ClubReplyRow` mial to od poczatku; brak tego samego na watkach byl
 * niedopatrzeniem, nie decyzja.
 */
export type ClubThreadListRow = NullableCols<
  RowOf<Fn["club_threads_list"]["Returns"]>,
  | "anchor_type"
  | "anchor_id"
  | "anchor_label"
  | "author_id"
  | "author_name"
  | "author_avatar"
  | "author_slug"
  | "author_alias"
  | "posted_by_admin_name"
  | "pinned_at"
  | "last_reply_at"
  | "excerpt"
  // Ikona tematu jest opcjonalna: starsze watki jej nie maja, a autor nie
  // musi jej wybierac - lista renderuje wtedy ikone rodzaju watku.
  | "icon"
>;
export type ClubThreadViewRow = NullableCols<RowOf<Fn["club_thread_view"]["Returns"]>, "icon">;

export type ClubReplyRow = NullableCols<
  RowOf<Fn["club_replies_list"]["Returns"]>,
  | "parent_id"
  | "author_id"
  | "author_name"
  | "author_avatar"
  | "author_slug"
  | "author_alias"
  | "posted_by_admin_name"
  | "edited_at"
  // Stanowisko wychodzi wylacznie w watku `position` i wylacznie przy
  // autorstwie jawnym - we wszystkich pozostalych przypadkach jest NULL-em.
  | "author_stance"
>;

/**
 * Statusy odpowiedzi w projekcji odczytowej. Slownik jest zamkniety i musi
 * zgadzac sie z CHECK-iem w `club_replies` - komponent porownujacy status
 * z wartoscia spoza tego zbioru pisze warunek, ktory nigdy nie jest prawdziwy,
 * i cicho zostawia akcje na wpisie, ktory jej nie powinien miec.
 */
export const CLUB_REPLY_STATUSES = ["pending", "visible", "hidden", "deleted"] as const;
export type ClubReplyStatus = (typeof CLUB_REPLY_STATUSES)[number];

/** Czy wpis jest jeszcze w obiegu dyskusji (a wiec: czy wolno go redagowac,
 *  cytowac i na niego reagowac). */
export function isClubReplyLive(status: string): boolean {
  return status === "visible" || status === "pending";
}

/** Powody zgloszenia - ten sam slownik, co w `user_reports`. */
export const CLUB_REPORT_REASONS = [
  "spam",
  "harassment",
  "impersonation",
  "inappropriate",
  "other",
] as const;
export type ClubReportReason = (typeof CLUB_REPORT_REASONS)[number];

/** Podpowiedz kotwicy dla kompozytora (RPC `club_anchor_suggest`). */
export type ClubAnchorSuggestion = RowOf<Fn["club_anchor_suggest"]["Returns"]>;

/** Rodzaje kotwic dopuszczane przez CHECK na `club_threads.anchor_type`. */
export const CLUB_ANCHOR_TYPES = [
  "eu_policy_item",
  "post",
  "event",
  "research_program",
  "club_thread",
] as const;
export type ClubAnchorType = (typeof CLUB_ANCHOR_TYPES)[number];

/**
 * Etykieta autora gotowa do renderu. Sedno: komponent NIE decyduje o
 * anonimowosci - dostaje albo imie, albo alias, bo baza juz rozstrzygnela,
 * co wolno pokazac. Gdyby decydowal komponent, kazde nowe miejsce renderujace
 * autora byloby nowa szansa na wyciek tozsamosci.
 */
export interface ClubAuthorLabel {
  kind: "named" | "alias" | "unknown";
  name: string;
  avatarUrl: string | null;
  profileSlug: string | null;
}

interface AuthorProjection {
  author_id: string | null;
  author_name: string | null;
  author_avatar: string | null;
  author_slug: string | null;
  author_alias: string | null;
}

/**
 * @param anonymousLabel przetlumaczony wzorzec z {{alias}}, np. "Uczestnik {{alias}}"
 * @param unknownLabel przetlumaczona etykieta usunietego konta
 */
export function toAuthorLabel(
  row: AuthorProjection,
  anonymousLabel: string,
  unknownLabel: string,
): ClubAuthorLabel {
  if (row.author_alias !== null && row.author_alias.length > 0) {
    return {
      kind: "alias",
      name: anonymousLabel.replace("{{alias}}", row.author_alias),
      avatarUrl: null,
      profileSlug: null,
    };
  }
  if (row.author_name !== null && row.author_name.length > 0) {
    return {
      kind: "named",
      name: row.author_name,
      avatarUrl: row.author_avatar,
      profileSlug: row.author_slug,
    };
  }
  // Brak i imienia, i aliasu: konto usuniete (author_id -> NULL przy
  // anonimizacji, V1 §7). Tresc zostaje, autorstwo nie.
  return { kind: "unknown", name: unknownLabel, avatarUrl: null, profileSlug: null };
}

/** Wezel drzewa odpowiedzi. Drzewo sklada sie z plaskiej listy z `depth`. */
export interface ClubReplyNode {
  reply: ClubReplyRow;
  children: ClubReplyNode[];
}

/**
 * Sklada plaska liste w drzewo przyciete do 2 poziomow - ta sama regula, co
 * buildCommentTree w lib/comments/tree.ts. Sierota (rodzic poza zbiorem, bo
 * ukryty przez moderacje) laduje na poziomie glownym zamiast zniknac:
 * odpowiedz, ktora przepadla razem z ukrytym rodzicem, wyglada jak utrata
 * danych, a nie jak moderacja.
 */
export function buildClubReplyTree(rows: readonly ClubReplyRow[]): ClubReplyNode[] {
  const nodes = new Map<string, ClubReplyNode>();
  for (const reply of rows) nodes.set(reply.id, { reply, children: [] });

  const roots: ClubReplyNode[] = [];
  for (const reply of rows) {
    const node = nodes.get(reply.id);
    if (!node) continue;
    const parent = reply.parent_id !== null ? nodes.get(reply.parent_id) : undefined;
    if (parent && parent.reply.id !== reply.id) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// ---------------------------------------------------------------------------
// Etap A4: reakcje, stanowiska, subskrypcje
// ---------------------------------------------------------------------------

/**
 * Slownik reakcji jest ZAMKNIETY i podzielony na dwie grupy o roznym
 * zachowaniu. To nie jest lista emoji - to sa dane zasilajace ranking,
 * reputacje i mape stanowisk (V1 §4.2).
 */
export const CLUB_QUALITY_REACTIONS = ["insightful", "evidence", "question", "thanks"] as const;
export const CLUB_STANCE_REACTIONS = ["agree", "disagree"] as const;
export const CLUB_REACTION_KINDS = [...CLUB_QUALITY_REACTIONS, ...CLUB_STANCE_REACTIONS] as const;

export type ClubQualityReaction = (typeof CLUB_QUALITY_REACTIONS)[number];
export type ClubStanceReaction = (typeof CLUB_STANCE_REACTIONS)[number];
export type ClubReactionKind = (typeof CLUB_REACTION_KINDS)[number];

export type ClubReactionTarget = "thread" | "reply";

/** Reakcje grupy "stanowisko" wykluczaja sie wzajemnie - trigger w bazie
 *  podmienia jedna na druga. Klient musi znac te regule, zeby optymistyczna
 *  aktualizacja nie pokazala obu naraz przez ulamek sekundy. */
export function isStanceReaction(kind: ClubReactionKind): kind is ClubStanceReaction {
  return (CLUB_STANCE_REACTIONS as readonly string[]).includes(kind);
}

export const CLUB_STANCES = ["support", "oppose", "abstain"] as const;
export type ClubStance = (typeof CLUB_STANCES)[number];

export const CLUB_SUBSCRIPTION_STATES = ["subscribed", "muted"] as const;
export type ClubSubscriptionState = (typeof CLUB_SUBSCRIPTION_STATES)[number];

export type ClubReactionRow = RowOf<Fn["club_reactions_for"]["Returns"]>;
// Tryb poufny zeruje tożsamość, więc te kolumny bywają puste - generator
// typów tego nie widzi.
export type ClubReactionActorRow = NullableCols<
  RowOf<Fn["club_reaction_actors"]["Returns"]>,
  "user_id" | "display_name" | "headline" | "avatar_url" | "slug"
>;
export type ClubStanceSummaryRow = RowOf<Fn["club_stance_summary"]["Returns"]>;

/** Jedna twarz pod wpisem: kto zareagował i czym. */
export interface ClubReactionActor {
  /** `null` w trybie poufnym (Chatham House) - wtedy zostaje sam znacznik. */
  userId: string | null;
  name: string | null;
  headline: string | null;
  avatarUrl: string | null;
  slug: string | null;
  isMe: boolean;
  /** Wszystkie reakcje TEJ osoby pod TYM celem - jedna twarz, nie pięć. */
  kinds: ClubReactionKind[];
}

/**
 * Scala wsadowy wynik `club_reaction_actors` po celu i po osobie. Jedna osoba,
 * która postawiła trzy reakcje, ma pokazać się raz - inaczej pasek twarzy
 * kłamie o liczbie ludzi w rozmowie.
 */
export function groupReactionActors(
  rows: readonly ClubReactionActorRow[],
): Map<string, ClubReactionActor[]> {
  const out = new Map<string, ClubReactionActor[]>();
  for (const row of rows) {
    if (!(CLUB_REACTION_KINDS as readonly string[]).includes(row.kind)) continue;
    const kind = row.kind as ClubReactionKind;
    const list = out.get(row.target_id) ?? [];
    // Anonim nie ma id, więc nie da się go scalić - każdy wiersz to osobna
    // twarz, i tak neutralna.
    const existing = row.user_id === null ? undefined : list.find((a) => a.userId === row.user_id);
    if (existing) {
      if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
      continue;
    }
    list.push({
      userId: row.user_id,
      name: row.display_name,
      headline: row.headline,
      avatarUrl: row.avatar_url,
      slug: row.slug,
      isMe: row.is_me === true,
      kinds: [kind],
    });
    out.set(row.target_id, list);
  }
  // Ja na początku: własna reakcja jest najczęściej sprawdzaną informacją.
  for (const list of out.values()) {
    list.sort((a, b) => Number(b.isMe) - Number(a.isMe));
  }
  return out;
}

/** Reakcje jednego celu w formie gotowej do renderu paska. */
export interface ClubReactionTally {
  kind: ClubReactionKind;
  total: number;
  mine: boolean;
}

/**
 * Grupuje wsadowy wynik `club_reactions_for` po celu. Zwraca mape, bo pasek
 * reakcji renderuje sie per wpis, a jedno zapytanie obsluguje cala widoczna
 * partie - dokladnie jak useBadgesForUsers na /people.
 */
export function groupReactions(rows: readonly ClubReactionRow[]): Map<string, ClubReactionTally[]> {
  const out = new Map<string, ClubReactionTally[]>();
  for (const row of rows) {
    if (!(CLUB_REACTION_KINDS as readonly string[]).includes(row.kind)) continue;
    const list = out.get(row.target_id) ?? [];
    list.push({
      kind: row.kind as ClubReactionKind,
      total: Number(row.total),
      mine: row.mine === true,
    });
    out.set(row.target_id, list);
  }
  // Stala kolejnosc: najpierw jakosc, potem stanowisko. Pasek, w ktorym
  // przyciski skacza po klikniecu, jest nieuzywalny.
  const order = new Map(CLUB_REACTION_KINDS.map((k, i) => [k, i]));
  for (const list of out.values()) {
    list.sort((a, b) => (order.get(a.kind) ?? 0) - (order.get(b.kind) ?? 0));
  }
  return out;
}

/**
 * Wynik przelaczenia reakcji PRZED odpowiedzia serwera. Odwzorowuje regule
 * triggera: klikniecie tej samej reakcji ja zdejmuje, a klikniecie
 * przeciwnego stanowiska PODMIENIA (nie dodaje drugiego).
 */
export function applyReactionToggle(
  current: readonly ClubReactionTally[],
  kind: ClubReactionKind,
): ClubReactionTally[] {
  const existing = current.find((r) => r.kind === kind);

  if (existing?.mine === true) {
    // Zdjecie wlasnej reakcji. Licznik zero znaczy, ze przycisk znika z paska.
    return current
      .map((r) => (r.kind === kind ? { ...r, total: r.total - 1, mine: false } : r))
      .filter((r) => r.total > 0);
  }

  const next = current.map((r) => {
    // Przeciwne stanowisko schodzi razem z postawieniem nowego.
    if (isStanceReaction(kind) && isStanceReaction(r.kind) && r.kind !== kind && r.mine) {
      return { ...r, total: r.total - 1, mine: false };
    }
    return r;
  });

  const idx = next.findIndex((r) => r.kind === kind);
  if (idx >= 0) {
    next[idx] = { ...next[idx], total: next[idx].total + 1, mine: true };
  } else {
    next.push({ kind, total: 1, mine: true });
  }

  const order = new Map(CLUB_REACTION_KINDS.map((k, i) => [k, i]));
  return next
    .filter((r) => r.total > 0)
    .sort((a, b) => (order.get(a.kind) ?? 0) - (order.get(b.kind) ?? 0));
}

// ---------------------------------------------------------------------------
// Etap A7: koordynacja w panelu
// ---------------------------------------------------------------------------

export type AdminClubThreadRow = RowOf<Fn["admin_club_threads"]["Returns"]>;
export type AdminClubReplyRow = RowOf<Fn["admin_club_replies"]["Returns"]>;
export type ClubSearchHit = RowOf<Fn["club_search"]["Returns"]>;
export type ClubSemanticHit = RowOf<Fn["club_semantic_search"]["Returns"]>;
export type ClubAnchorHit = RowOf<Fn["club_threads_for_anchor"]["Returns"]>;

/**
 * Wynik wyszukiwania po SCALENIU dwoch warstw: pelnotekstowej (`club_search`)
 * i semantycznej (`club_semantic_search`). Warstwy odpowiadaja na dwa rozne
 * pytania - "gdzie padlo to slowo" i "gdzie mowiono o tej sprawie" - wiec
 * `match` jedzie do interfejsu: czytelnik ma widziec, dlaczego wiersz tu jest,
 * zanim zdziwi sie brakiem swojej frazy w tytule.
 */
export interface ClubSearchResult {
  thread_id: string;
  thread_slug: string;
  title: string;
  kind: string;
  club_id: string;
  club_slug: string;
  club_name_pl: string;
  club_name_en: string;
  reply_count: number;
  last_reply_at: string | null;
  /** Fragment z `ts_headline`. Warstwa semantyczna go nie ma - stad `null`. */
  snippet: string | null;
  match: "text" | "semantic";
}

/** Trafienie pelnotekstowe -> wiersz wyniku. */
export function toClubSearchResult(hit: ClubSearchHit): ClubSearchResult {
  return {
    thread_id: hit.thread_id,
    thread_slug: hit.thread_slug,
    title: hit.title,
    kind: hit.kind,
    club_id: hit.club_id,
    club_slug: hit.club_slug,
    club_name_pl: hit.club_name_pl,
    club_name_en: hit.club_name_en,
    reply_count: hit.reply_count,
    last_reply_at: hit.last_reply_at,
    snippet: hit.snippet,
    match: "text",
  };
}

/** Trafienie semantyczne -> wiersz wyniku (bez fragmentu, bo RPC go nie liczy). */
export function toClubSemanticResult(hit: ClubSemanticHit): ClubSearchResult {
  return {
    thread_id: hit.thread_id,
    thread_slug: hit.thread_slug,
    title: hit.title,
    kind: hit.kind,
    club_id: hit.club_id,
    club_slug: hit.club_slug,
    club_name_pl: hit.club_name_pl,
    club_name_en: hit.club_name_en,
    reply_count: hit.reply_count,
    last_reply_at: hit.last_reply_at,
    snippet: null,
    match: "semantic",
  };
}

/**
 * Scalenie warstw. Pelnotekstowe idzie PIERWSZE i wygrywa duplikaty: jesli
 * fraza dosłownie pada w watku, to jest lepsza odpowiedz niz podobienstwo
 * kosinusowe, a fragment z podswietleniem jest tego dowodem dla czytelnika.
 * Semantyka dokłada to, czego FTS z definicji nie znajdzie - inne slowa o tej
 * samej sprawie.
 */
export function mergeClubSearchResults(
  text: readonly ClubSearchHit[],
  semantic: readonly ClubSemanticHit[],
  limit = 20,
): ClubSearchResult[] {
  const out = text.map(toClubSearchResult);
  const seen = new Set(out.map((r) => r.thread_id));
  for (const hit of semantic) {
    if (out.length >= limit) break;
    if (seen.has(hit.thread_id)) continue;
    seen.add(hit.thread_id);
    out.push(toClubSemanticResult(hit));
  }
  return out.slice(0, limit);
}

/** Wiersz strumienia aktywnosci ponad klubami (strona glowna klubow). Nie ma
 *  tu `author_id` w ZADNYM trybie atrybucji - hub jest powierzchnia odkrywania,
 *  a czego RPC nie zwraca, tego zaden komponent nie wyswietli przez pomylke. */
export type ClubActivityRow = RowOf<Fn["club_activity_feed"]["Returns"]>;

export const CLUB_ACTIVITY_SORTS = ["new", "hot"] as const;
export type ClubActivitySort = (typeof CLUB_ACTIVITY_SORTS)[number];
export type AdminClubModerationItem = RowOf<Fn["admin_club_moderation_queue"]["Returns"]>;
export type AdminClubModerationLogRow = RowOf<Fn["admin_club_moderation_log"]["Returns"]>;

/** Akcje moderacyjne dostepne z panelu. `restore` idzie osobnym RPC, bo musi
 *  wiedziec, DO JAKIEGO statusu wrocic - a to zalezy od rodzaju celu. */
export const CLUB_MODERATION_ACTIONS = [
  "approve",
  "hide",
  "delete",
  "restore",
  "lock",
  "unlock",
  "pin",
  "unpin",
] as const;
export type ClubModerationAction = (typeof CLUB_MODERATION_ACTIONS)[number];

/** Akcje, ktore dotycza WYLACZNIE watku - odpowiedzi nie da sie przypiac
 *  ani zamknac. Panel musi to wiedziec, zeby nie pokazywac martwych przyciskow. */
export const THREAD_ONLY_ACTIONS: readonly ClubModerationAction[] = [
  "lock",
  "unlock",
  "pin",
  "unpin",
];

/**
 * Pelny slownik akcji, jakie moga stac w `club_moderation_log`. Nadzbior
 * CLUB_MODERATION_ACTIONS: dziennik notuje takze zdarzenia, ktorych nie da sie
 * WYWOLAC jako akcji moderacyjnej (blokada, publikacja w imieniu, kasowanie
 * grupy). Filtr dziennika czyta wlasnie te liste, a nie te powyzej.
 */
export const CLUB_LOG_ACTIONS = [
  "approve",
  "hide",
  "delete",
  "restore",
  "lock",
  "unlock",
  "pin",
  "unpin",
  "ban",
  "unban",
  "reveal_author",
  "role_change",
  "member_add",
  "post_on_behalf",
  "move",
  "edit",
  "group_delete",
] as const;
export type ClubLogAction = (typeof CLUB_LOG_ACTIONS)[number];

/** Typy celu, jakie moga stac w dzienniku. */
export const CLUB_LOG_TARGETS = ["thread", "reply", "member", "group"] as const;
export type ClubLogTarget = (typeof CLUB_LOG_TARGETS)[number];

export function isActionApplicable(
  action: ClubModerationAction,
  target: "thread" | "reply",
): boolean {
  return target === "thread" || !THREAD_ONLY_ACTIONS.includes(action);
}

/**
 * Etykieta wpisu wprowadzonego przez redakcje. Zwraca `null`, gdy autor
 * publikowal sam - komponent renderuje adnotacje TYLKO wtedy, gdy jest co
 * powiedziec, zamiast pokazywac pusty znacznik przy kazdym wpisie.
 */
export function adminAttributionNote(
  postedByAdminName: string | null,
  template: string,
): string | null {
  if (postedByAdminName === null || postedByAdminName.length === 0) return null;
  return template.replace("{{name}}", postedByAdminName);
}
