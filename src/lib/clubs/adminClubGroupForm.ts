// Edytor działu klubu - REGUŁY wyjęte z ciała `ClubGroupEditorDialog`.
//
// CO BYŁO W JSX-IE I DLACZEGO TO REGUŁA, A NIE UKŁAD.
//
//   1. DZIEDZICZENIE JEST KONTRAKTEM RPC, NIE STYLEM POLA. Wartość
//      odziedziczona jedzie do bazy jako PUSTY STRING (a próg planu jako
//      `null`), nie jako wartość widoczna w wyłączonej dropliście. Wysłanie
//      wartości efektywnej „przyklejałoby" ustawienie klubu do działu: pierwsza
//      późniejsza zmiana ustawienia klubu przestawałaby działać, i to bez
//      żadnego komunikatu. Migracja jawnie traktuje `''` tak samo jak `NULL`.
//   2. ZDJĘCIE DZIEDZICZENIA WIDOCZNOŚCI SPROWADZA WARTOŚĆ W DÓŁ.
//      `club_groups.visibility` ma CHECK bez `public`: dział NIE MOŻE być
//      bardziej otwarty niż klub. Przy dziedziczeniu pokazujemy wartość
//      efektywną (a ta w klubie publicznym bywa `public`), więc w momencie
//      nadpisania trzeba ją zawęzić - inaczej administrator zapisywałby wybór,
//      który baza odbija. To jedyne pole z takim zawężeniem i JEST TO
//      NIESYMETRYCZNE: pozostałe cztery ustawienia (kto zakłada temat,
//      moderacja, atrybucja, próg planu) klient przepuszcza w obie strony -
//      węższe i szersze - bo ich pilnuje wyłącznie baza.
//   3. „PUSTE ZNACZY WYCZYŚĆ". Opis wyczyszczony w formularzu jedzie jako
//      `null`, nie jako `""` - inaczej pusty akapit zostaje w bazie i wraca na
//      ekran po odświeżeniu jak zignorowany zapis.
//   4. NAZWA ANGIELSKA DZIEDZICZY PO POLSKIEJ - dział bez `name_en` pokazywałby
//      pustą nazwę na `/en/`.
//   5. HARMONOGRAM: `timestamptz` <-> `<input type="datetime-local">`. Pole HTML
//      nie umie pokazać strefy ani sekund, a wartość niepoprawna musi wyjść
//      jako PUSTA, nie jako `Invalid Date` w payloadzie.
//   6. WALIDACJA ODRZUCA PUSTY ADRES ALBO PUSTĄ NAZWĘ POLSKĄ *ZANIM* poleci
//      żądanie - RPC odbiłoby to komunikatem, którego nie tłumaczymy.
//   7. KASOWANIE MA TRZY RÓŻNE ODMOWY z trzema różnymi następnymi krokami
//      („dział nie jest pusty", „to ostatni dział", cokolwiek innego). Jedno
//      „nie udało się" zostawia administratora bez ruchu.
//   8. PRZYCISK KASOWANIA JEST WYŁĄCZONY, gdy odmowa jest PEWNA (brak
//      rodzeństwa albo dział z tematami bez wskazanego celu). Kliknięcie pod
//      pewny błąd uczy ignorowania komunikatów.
//
// UKŁADEM (i dlatego tego tu nie ma) jest: jedna kolumna do `sm` i dwie wyżej,
// ramki sekcji, kolejność sekcji, czerwone tło strefy kasowania.
//
// GRANICA WARSTW: zero Reacta, zero i18n, zero klienta Supabase. Wychodzą stąd
// KLUCZE i18n oraz deskryptory, nigdy gotowy tekst. Klucze `adminClubs.*`
// mieszkają w słowniku PANELU (`i18n-clubs-admin`), który komponent musi
// dociągnąć sam przez `ensureAdminClubsI18n()`.
import {
  CLUB_ATTRIBUTION_MODES,
  CLUB_GROUP_STATUSES,
  CLUB_GROUP_VISIBILITIES,
  CLUB_MODERATION_MODES,
  CLUB_POST_POLICIES,
  CLUB_VISIBILITIES,
  narrowClubEnum,
  toClubGroupVisibility,
  toGroupSettings,
  type ClubAttributionMode,
  type ClubGroupStatus,
  type ClubGroupUpsertInput,
  type ClubModerationMode,
  type ClubPostPolicy,
  type ClubVisibility,
  type GroupInheritanceFields,
} from "./types";

/**
 * Wersja robocza formularza działu. Pole `*Inherit` steruje tym, czy wartość
 * w ogóle poleci do RPC - dziedziczenie wysyła pusty string, nie wartość.
 */
export interface ClubGroupDraft {
  slug: string;
  namePl: string;
  nameEn: string;
  descriptionPl: string;
  descriptionEn: string;
  status: ClubGroupStatus;
  visibility: ClubVisibility;
  visibilityInherit: boolean;
  whoCanPost: ClubPostPolicy;
  whoCanPostInherit: boolean;
  moderationMode: ClubModerationMode;
  moderationModeInherit: boolean;
  attributionMode: ClubAttributionMode;
  attributionModeInherit: boolean;
  minTierRank: number;
  minTierRankInherit: boolean;
  opensAt: string;
  closesAt: string;
}

/**
 * Wiersz działu w kształcie, którego ten moduł FAKTYCZNIE czyta. Osobny typ,
 * a nie `AdminClubGroupRow`, bo obie projekcje działu (administracyjna
 * `admin_club_groups` i produktowa `club_groups_list`) mają ten podzbiór -
 * i dzięki temu przepisanie na wersję roboczą nie wymaga rzutowania.
 */
export interface ClubGroupDraftSource extends GroupInheritanceFields {
  slug: string;
  name_pl: string;
  name_en: string;
  description_pl: string | null;
  description_en: string | null;
  status: string;
  opens_at: string | null;
  closes_at: string | null;
}

/**
 * `timestamptz` z bazy -> wartość dla `<input type="datetime-local">`.
 * Strefa i sekundy lecą do kosza: pole HTML nie umie ich pokazać, a wartość
 * niepoprawna (albo brak wartości) musi dać PUSTE pole, nie napis
 * „Invalid Date" na ekranie.
 */
export function clubGroupLocalInput(value: string | null): string {
  if (value === null || value === "") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * Odwrotność: wartość pola HTML -> ISO dla RPC. Pustka i wartość niepoprawna
 * dają `null` („brak terminu"), a nie `Invalid Date` w payloadzie - kolumna
 * `timestamptz` odbiłaby to błędem po stronie serwera.
 */
export function clubGroupIsoFromLocalInput(value: string): string | null {
  if (value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Wiersz RPC -> wersja robocza. Kolumny CHECK-owe są zawężane słownikiem
 * (generator Supabase typuje je jako goły `string`), a flagi `*_inherited`
 * przechodzą wprost - bazę stać na rozwiązanie dziedziczenia, klient go NIE
 * powtarza.
 */
export function toClubGroupDraft(group: ClubGroupDraftSource): ClubGroupDraft {
  const settings = toGroupSettings(group);
  return {
    slug: group.slug,
    namePl: group.name_pl,
    nameEn: group.name_en,
    descriptionPl: group.description_pl ?? "",
    descriptionEn: group.description_en ?? "",
    status: narrowClubEnum<ClubGroupStatus>(group.status, CLUB_GROUP_STATUSES, "draft"),
    visibility: settings.visibility.value,
    visibilityInherit: settings.visibility.inherited,
    whoCanPost: settings.whoCanPost.value,
    whoCanPostInherit: settings.whoCanPost.inherited,
    moderationMode: settings.moderationMode.value,
    moderationModeInherit: settings.moderationMode.inherited,
    attributionMode: settings.attributionMode.value,
    attributionModeInherit: settings.attributionMode.inherited,
    minTierRank: settings.minTierRank.value,
    minTierRankInherit: settings.minTierRank.inherited,
    opensAt: clubGroupLocalInput(group.opens_at),
    closesAt: clubGroupLocalInput(group.closes_at),
  };
}

/** Puste pole tekstowe jedzie jako `null`, nie jako `""`. */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Blokada zapisu. Zwraca KLUCZ komunikatu albo `null`, gdy wolno wysłać.
 * Adres i nazwa polska są wymagane po stronie RPC, więc sprawdzamy je tutaj -
 * komunikat bazy jest angielskim literałem z migracji.
 */
export function clubGroupSaveBlockKey(draft: ClubGroupDraft): string | null {
  return draft.slug.trim() === "" || draft.namePl.trim() === ""
    ? "adminClubs.requiredFields"
    : null;
}

/**
 * Payload `admin_club_group_upsert`. Wartość odziedziczona jedzie jako pusty
 * string (próg planu jako `null`) - patrz punkt 1 nagłówka pliku.
 */
export function clubGroupSavePayload(
  draft: ClubGroupDraft,
  ids: { id: string; clubId: string },
): ClubGroupUpsertInput {
  const namePl = draft.namePl.trim();
  const nameEn = draft.nameEn.trim();
  return {
    id: ids.id,
    club_id: ids.clubId,
    slug: draft.slug.trim(),
    name_pl: namePl,
    name_en: nameEn !== "" ? nameEn : namePl,
    description_pl: orNull(draft.descriptionPl),
    description_en: orNull(draft.descriptionEn),
    status: draft.status,
    visibility: draft.visibilityInherit ? "" : draft.visibility,
    who_can_post: draft.whoCanPostInherit ? "" : draft.whoCanPost,
    moderation_mode: draft.moderationModeInherit ? "" : draft.moderationMode,
    attribution_mode: draft.attributionModeInherit ? "" : draft.attributionMode,
    min_tier_rank: draft.minTierRankInherit ? null : draft.minTierRank,
    opens_at: clubGroupIsoFromLocalInput(draft.opensAt),
    closes_at: clubGroupIsoFromLocalInput(draft.closesAt),
  };
}

/** Pięć ustawień działu, które mogą dziedziczyć z klubu. */
export const CLUB_GROUP_OVERRIDE_FIELDS = [
  "visibility",
  "whoCanPost",
  "moderationMode",
  "attributionMode",
  "minTierRank",
] as const;

export type ClubGroupOverrideField = (typeof CLUB_GROUP_OVERRIDE_FIELDS)[number];

/**
 * Łatka wersji roboczej po przełączeniu „dziedzicz <-> nadpisz".
 *
 * Widoczność jest wyjątkiem w JEDNĄ stronę: przy ZDJĘCIU dziedziczenia wartość
 * schodzi do słownika działu (`public` -> `members`), bo CHECK
 * `club_groups.visibility` nie zna `public`. Przy WŁĄCZENIU dziedziczenia
 * wartości nie ruszamy - i tak nie poleci do bazy, a po zapisie wróci z RPC
 * jako wartość efektywna klubu.
 */
export function clubGroupOverridePatch(
  field: ClubGroupOverrideField,
  inherit: boolean,
  draft: Pick<ClubGroupDraft, "visibility">,
): Partial<ClubGroupDraft> {
  switch (field) {
    case "visibility":
      return inherit
        ? { visibilityInherit: true }
        : { visibilityInherit: false, visibility: toClubGroupVisibility(draft.visibility) };
    case "whoCanPost":
      return { whoCanPostInherit: inherit };
    case "moderationMode":
      return { moderationModeInherit: inherit };
    case "attributionMode":
      return { attributionModeInherit: inherit };
    case "minTierRank":
      return { minTierRankInherit: inherit };
  }
}

/**
 * Słownik dropListy widoczności. Przy dziedziczeniu MUSI umieć wyrenderować
 * wartość efektywną klubu (a ta bywa `public`), przy nadpisaniu obowiązuje
 * węższy słownik działu. Wybór złej tablicy daje albo pustą droplistę, albo
 * wybór, który baza odbija.
 */
export function clubGroupVisibilityOptions(inherited: boolean): readonly ClubVisibility[] {
  return inherited ? CLUB_VISIBILITIES : CLUB_GROUP_VISIBILITIES;
}

/** Próg planu z pola liczbowego. Pustka i śmieć schodzą do `0`, nie do `NaN`. */
export function clubGroupMinTierFromInput(raw: string): number {
  return Number(raw) || 0;
}

/** Deskryptor jednej dropListy ustawienia dziedziczonego (poza widocznością). */
export interface ClubGroupOverrideOptions {
  whoCanPost: readonly ClubPostPolicy[];
  moderationMode: readonly ClubModerationMode[];
  attributionMode: readonly ClubAttributionMode[];
}

export const CLUB_GROUP_OVERRIDE_OPTIONS: ClubGroupOverrideOptions = {
  whoCanPost: CLUB_POST_POLICIES,
  moderationMode: CLUB_MODERATION_MODES,
  attributionMode: CLUB_ATTRIBUTION_MODES,
};

/** Rodzeństwo BEZ kasowanego działu - to są jedyne cele przeniesienia wątków. */
export function clubGroupMoveTargets<T extends { id: string }>(
  siblings: readonly T[],
  groupId: string | undefined,
): readonly T[] {
  return siblings.filter((sibling) => sibling.id !== groupId);
}

/** Dział z wątkami wymaga celu przeniesienia. Brak liczby = brak wątków. */
export function clubGroupHasThreads(threadCount: number | null | undefined): boolean {
  return (threadCount ?? 0) > 0;
}

/**
 * Czy przycisk kasowania wolno kliknąć. Wyłączamy go dokładnie wtedy, gdy
 * odmowa jest PEWNA: zapis w locie, brak rodzeństwa (klub bez działu nie ma
 * gdzie przyjąć tematu), dział z wątkami bez wskazanego celu.
 */
export function canDeleteClubGroup(input: {
  isPending: boolean;
  targetCount: number;
  hasThreads: boolean;
  moveTo: string;
}): boolean {
  if (input.isPending) return false;
  if (input.targetCount === 0) return false;
  return !(input.hasThreads && input.moveTo === "");
}

/** Treść okna potwierdzenia. Dział z wątkami ostrzega o PRZENIESIENIU. */
export interface ClubGroupDeleteConfirm {
  titleKey: string;
  descriptionKey: string;
}

export function clubGroupDeleteConfirm(hasThreads: boolean): ClubGroupDeleteConfirm {
  return {
    titleKey: "adminClubs.groups.deleteConfirmTitle",
    descriptionKey: hasThreads
      ? "adminClubs.groups.deleteConfirmMove"
      : "adminClubs.groups.deleteConfirmBody",
  };
}

/**
 * Napis strefy kasowania. Dział z wątkami dostaje klucz Z LICZEBNIKIEM (polska
 * mnogość ma cztery formy, więc liczba MUSI dojść do i18next), a dział pusty -
 * klucz bez liczebnika. Doklejenie `count` do klucza bez form mnogich każe
 * i18next szukać `..._one`/`..._other` i cofać się do klucza bazowego - napis
 * ten sam, ale zależny od kolejności wpisów w słowniku.
 */
export interface ClubGroupDeleteNotice {
  key: string;
  /** `null` = klucz bez liczebnika. */
  count: number | null;
}

export function clubGroupDeleteNotice(
  threadCount: number | null | undefined,
): ClubGroupDeleteNotice {
  const count = threadCount ?? 0;
  return count > 0
    ? { key: "adminClubs.groups.deleteWithThreads", count }
    : { key: "adminClubs.groups.deleteEmpty", count: null };
}

/** Potwierdzenie po skasowaniu: z liczbą przeniesionych wątków albo bez. */
export interface ClubGroupDeletedToast {
  key: string;
  /** `null` = klucz bez liczebnika (nic nie przeniesiono). */
  count: number | null;
}

export function clubGroupDeletedToast(moved: number): ClubGroupDeletedToast {
  return moved > 0
    ? { key: "adminClubs.groups.deletedWithMove", count: moved }
    : { key: "adminClubs.groups.deleted", count: null };
}

/**
 * Odmowa kasowania -> klucz komunikatu. Dopasowanie idzie po TREŚCI wyjątku,
 * bo PostgREST nie przepuszcza SQLSTATE w ustrukturyzowanej formie, a
 * komunikaty są stałymi literalami z migracji (nie tłumaczymy ich, więc są
 * stabilne). Ta sama zasada, co w `toClubSaveError`.
 */
export function clubGroupDeleteErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("group not empty")) return "adminClubs.groups.deleteNeedsTarget";
  if (message.includes("last group")) return "adminClubs.groups.deleteLast";
  return "adminClubs.saveFailed";
}
