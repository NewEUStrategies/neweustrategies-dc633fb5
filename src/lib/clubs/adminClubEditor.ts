// Edytor klubu w panelu - WERSJA ROBOCZA i PAYLOAD zapisu jako czyste funkcje.
//
// PO CO OSOBNY MODUŁ. Trasa `admin.community.clubs.$clubId.tsx` trzymała trzy
// rzeczy w swoim ciele: przepisanie wiersza RPC na wersję roboczą formularza
// (dwie funkcje), wykrycie realnej zmiany i złożenie payloadu zapisu (28 pól
// w jednym literale wewnątrz handlera `onClick`). Każda z nich jest REGUŁĄ
// o widocznych skutkach, a nie układem:
//
//   1. DEGRADACJA WARTOŚCI Z RPC. Generator Supabase typuje kolumny CHECK-owe
//      jako goły `string`, więc wersja robocza musi zawęzić je słownikiem
//      z wartością domyślną. Fallback nie jest neutralny: dla `who_can_post`
//      jest `moderators`, a dla `moderation_mode` - `trusted`, bo pomyłka
//      w tę drugą stronę OTWIERA klub, którego CHECK-a nikt nie zmienił.
//   2. „PUSTE" ZNACZY „WYCZYŚĆ", NIE „NIE RUSZAJ". Pole tekstowe wyczyszczone
//      przez administratora jedzie do bazy jako `null`, a nie jako `""` ani
//      jako brak klucza - inaczej zajawka usunięta w panelu wraca po
//      odświeżeniu i wygląda jak zignorowany zapis.
//   3. NAZWA ANGIELSKA DZIEDZICZY PO POLSKIEJ. Klub bez `name_en` nie może
//      pokazać pustego tytułu na `/en/`, więc puste pole angielskie jedzie
//      z wartością polską. To reguła treściowa - i była zaszyta w jednej
//      linii literału payloadu.
//   4. WERSJA ROBOCZA JEST BRUDNA TYLKO PRZY REALNEJ ZMIANIE. Przycisk
//      „Zapisz", który nic nie zapisuje, uczy ignorowania przycisku - a przy
//      dwudziestu ośmiu polach porównanie „na oko" nie istnieje.
//
// GRANICA WARSTW. Zero Reacta, zero i18n, zero klienta Supabase. Wejściem jest
// wiersz `admin_club_get` (przez alias `AdminClubDetailRow`), wyjściem gołe
// struktury i `ClubUpsertInput`. Autoryzacja nie jest tu liczona ani powtarzana
// - jest w SECURITY DEFINER RPC i w pgTAP.
import {
  CLUB_ATTRIBUTION_MODES,
  CLUB_JOIN_POLICIES,
  CLUB_MODERATION_MODES,
  CLUB_POST_POLICIES,
  CLUB_STATUSES,
  CLUB_VISIBILITIES,
  narrowClubEnum,
  toClubLayout,
  type AdminClubDetailRow,
  type ClubAttributionMode,
  type ClubJoinPolicy,
  type ClubLayout,
  type ClubModerationMode,
  type ClubPostPolicy,
  type ClubStatus,
  type ClubUpsertInput,
  type ClubVisibility,
} from "./types";

/** Zakładki edytora. Kolejność listy = kolejność na pasku. */
export const CLUB_EDITOR_TABS = [
  "general",
  "access",
  "groups",
  "threads",
  "members",
  "invitations",
  "permissions",
  "moderation",
  "analytics",
] as const;

export type ClubEditorTab = (typeof CLUB_EDITOR_TABS)[number];

/**
 * Zakładka z adresu. `?tab=` jest KONTRAKTEM LINKU: administrator, który wysyła
 * komuś odnośnik do zakładki „Uprawnienia", wysyła odnośnik do zakładki
 * „Uprawnienia", a nie do pierwszej zakładki edytora. Wartość nieznana
 * degraduje się do pierwszej zakładki, a nie wywala trasy - stary link
 * z usuniętą zakładką ma otworzyć edytor, nie ekran błędu.
 */
export function clubEditorTab(raw: unknown): ClubEditorTab {
  if (typeof raw !== "string") return "general";
  return (CLUB_EDITOR_TABS as readonly string[]).includes(raw) ? (raw as ClubEditorTab) : "general";
}

/** Wersja robocza zakładki „Ogólne". Kształt 1:1 z `ClubGeneralTab`. */
export interface ClubGeneralDraftValues {
  slug: string;
  namePl: string;
  nameEn: string;
  taglinePl: string;
  taglineEn: string;
  descriptionPl: string;
  descriptionEn: string;
  rulesPl: string;
  rulesEn: string;
  policyArea: string;
  status: ClubStatus;
  cover: string;
  layout: ClubLayout;
}

/** Wersja robocza zakładki „Dostęp". Kształt 1:1 z `ClubAccessTab`. */
export interface ClubAccessDraftValues {
  visibility: ClubVisibility;
  joinPolicy: ClubJoinPolicy;
  minTierRank: number;
  attributionMode: ClubAttributionMode;
  whoCanPost: ClubPostPolicy;
  moderationMode: ClubModerationMode;
}

/**
 * Wiersz RPC -> wersja robocza „Ogólnych". Kolumny nullowalne stają się pustym
 * napisem, bo pole formularza nie umie trzymać `null`; droga powrotna
 * (`""` -> `null`) jest w `clubEditorPayload`.
 */
export function toClubGeneralDraft(club: AdminClubDetailRow): ClubGeneralDraftValues {
  return {
    slug: club.slug,
    namePl: club.name_pl,
    nameEn: club.name_en,
    taglinePl: club.tagline_pl ?? "",
    taglineEn: club.tagline_en ?? "",
    descriptionPl: club.description_pl ?? "",
    descriptionEn: club.description_en ?? "",
    rulesPl: club.rules_pl ?? "",
    rulesEn: club.rules_en ?? "",
    policyArea: club.policy_area ?? "",
    status: narrowClubEnum<ClubStatus>(club.status, CLUB_STATUSES, "draft"),
    cover: club.cover_image_url ?? "",
    layout: toClubLayout(club.layout),
  };
}

/**
 * Wiersz RPC -> wersja robocza „Dostępu".
 *
 * Wartości domyślne są tu WĘŻSZE z rozmysłem: nieznana wartość `visibility`
 * degraduje się do `members` (nie do `public`), `who_can_post` do `moderators`
 * (nie do `members`), a `moderation_mode` do `trusted`. Fallback, który
 * poszerza dostęp, otwierałby klub przy pierwszej nieznanej wartości w bazie.
 */
export function toClubAccessDraft(club: AdminClubDetailRow): ClubAccessDraftValues {
  return {
    visibility: narrowClubEnum<ClubVisibility>(club.visibility, CLUB_VISIBILITIES, "members"),
    joinPolicy: narrowClubEnum<ClubJoinPolicy>(club.join_policy, CLUB_JOIN_POLICIES, "request"),
    minTierRank: club.min_tier_rank,
    attributionMode: narrowClubEnum<ClubAttributionMode>(
      club.attribution_mode,
      CLUB_ATTRIBUTION_MODES,
      "attributed",
    ),
    whoCanPost: narrowClubEnum<ClubPostPolicy>(
      club.who_can_post,
      CLUB_POST_POLICIES,
      "moderators",
    ),
    moderationMode: narrowClubEnum<ClubModerationMode>(
      club.moderation_mode,
      CLUB_MODERATION_MODES,
      "trusted",
    ),
  };
}

/**
 * Czy wersja robocza różni się od stanu z serwera.
 *
 * Porównanie idzie przez PRZEPISANIE wiersza na wersję roboczą, nie przez
 * porównanie z wierszem wprost: inaczej `tagline_pl = null` w bazie i `""`
 * w formularzu wyglądałyby jak zmiana i przycisk „Zapisz" byłby aktywny
 * zawsze.
 */
export function isClubEditorDirty(
  club: AdminClubDetailRow,
  general: ClubGeneralDraftValues,
  access: ClubAccessDraftValues,
): boolean {
  return (
    JSON.stringify(toClubGeneralDraft(club)) !== JSON.stringify(general) ||
    JSON.stringify(toClubAccessDraft(club)) !== JSON.stringify(access)
  );
}

/** Powód, dla którego zapisu NIE wolno wysłać. `null` = wolno. */
export type ClubEditorBlock = "slug_required" | "name_required";

/**
 * Czy wersja robocza da się zapisać. Slug i nazwa polska są wymagane po
 * stronie bazy (`clubs: slug and name_pl are required`), więc panel nie ma
 * powodu wysyłać żądania, które i tak wróci błędem - i ma powiedzieć, CZEGO
 * brakuje, zamiast „nie udało się zapisać".
 */
export function clubEditorBlock(general: ClubGeneralDraftValues): ClubEditorBlock | null {
  if (general.slug.trim().length === 0) return "slug_required";
  if (general.namePl.trim().length === 0) return "name_required";
  return null;
}

/** Puste pole tekstowe -> `null`, czyli „wyczyść", a nie „nie ruszaj". */
function orNull(value: string): string | null {
  return value.trim() || null;
}

/**
 * Payload zapisu klubu. Trzy reguły warte osobnej uwagi:
 *
 * - PUSTE POLE JEDZIE JAKO `null`. Zajawka usunięta w panelu musi zniknąć
 *   z bazy; `""` zostawiałby puste zdanie w treści, a brak klucza znaczyłby
 *   „nie ruszaj" i zmiana cicho by się nie zapisała.
 * - NAZWA ANGIELSKA DZIEDZICZY PO POLSKIEJ. Klub bez `name_en` pokazywałby
 *   pusty tytuł na `/en/`.
 * - WSZYSTKO JEST PRZYCINANE. Slug ze spacją na końcu łamie CHECK w bazie,
 *   a nazwa ze spacją wiodącą psuje sortowanie listy klubów.
 */
export function clubEditorPayload(
  clubId: string,
  general: ClubGeneralDraftValues,
  access: ClubAccessDraftValues,
): ClubUpsertInput {
  const namePl = general.namePl.trim();
  const nameEn = general.nameEn.trim();
  return {
    id: clubId,
    slug: general.slug.trim(),
    name_pl: namePl,
    name_en: nameEn.length > 0 ? nameEn : namePl,
    tagline_pl: orNull(general.taglinePl),
    tagline_en: orNull(general.taglineEn),
    description_pl: orNull(general.descriptionPl),
    description_en: orNull(general.descriptionEn),
    rules_pl: orNull(general.rulesPl),
    rules_en: orNull(general.rulesEn),
    policy_area: orNull(general.policyArea),
    status: general.status,
    cover_image_url: orNull(general.cover),
    layout: general.layout,
    visibility: access.visibility,
    join_policy: access.joinPolicy,
    min_tier_rank: access.minTierRank,
    attribution_mode: access.attributionMode,
    who_can_post: access.whoCanPost,
    moderation_mode: access.moderationMode,
  };
}

/**
 * Normalizacja sluga WPISYWANEGO w polu. Robimy to w locie, a nie walidujemy po
 * zapisie: CHECK w bazie odrzuca wszystko poza `[a-z0-9-]`, więc lepiej nie
 * pozwolić wpisać czegoś, co i tak zostanie odrzucone. Zwielokrotnione
 * myślniki są zwijane, bo `klub--energetyczny` i `klub-energetyczny` to dla
 * czytelnika ten sam adres, a dla bazy dwa różne.
 */
export function normalizeClubSlugInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-");
}

/**
 * Czy slug w wersji roboczej różni się od zapisanego. To jedyne pole tego
 * formularza, którego zmiana psuje coś POZA formularzem - istniejące linki do
 * klubu - więc dostaje osobne ostrzeżenie. Pusty slug zapisany (klub jeszcze
 * nieutworzony) NIE jest zmianą: ostrzeżenie o zepsutych linkach przy
 * zakładaniu klubu jest bez sensu.
 */
export function isClubSlugChanged(draftSlug: string, persistedSlug: string): boolean {
  return draftSlug !== persistedSlug && persistedSlug.length > 0;
}

/** Filtry listy klubów w panelu, w kształcie oczekiwanym przez `useAdminClubs`. */
export interface AdminClubListFilters {
  search: string;
  status: ClubStatus | null;
  visibility: ClubVisibility | null;
  limit: number;
  offset: number;
}

/**
 * Filtry listy klubów. `offset` liczony ze STRONY, bo panel myśli stronami,
 * a RPC oknem - i to przeliczenie było jedynym miejscem, w którym błąd o jeden
 * gubił całą stronę wyników bez żadnego komunikatu.
 */
export function adminClubListFilters(input: {
  search: string;
  status: ClubStatus | null;
  visibility: ClubVisibility | null;
  page: number;
  pageSize: number;
}): AdminClubListFilters {
  return {
    search: input.search,
    status: input.status,
    visibility: input.visibility,
    limit: input.pageSize,
    offset: (input.page - 1) * input.pageSize,
  };
}

/**
 * Czy lista jest ZAWĘŻONA filtrami. Rozstrzyga, który komunikat pustki
 * pokazać: „nie ma jeszcze klubów" (zaproszenie do utworzenia) czy „nic nie
 * pasuje do filtrów" (zaproszenie do ich wyczyszczenia). Pomyłka w tę stronę
 * mówi administratorowi, że baza jest pusta, kiedy jest tylko zawężona.
 */
export function hasAdminClubFilters(input: {
  search: string;
  status: ClubStatus | null;
  visibility: ClubVisibility | null;
}): boolean {
  return input.search.trim().length > 0 || input.status !== null || input.visibility !== null;
}
