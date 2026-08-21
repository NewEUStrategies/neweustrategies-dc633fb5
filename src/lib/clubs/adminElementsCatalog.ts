// Katalog elementów Klubu w panelu - REGUŁY wyprowadzone z ciała organizmu.
//
// CO BYŁO W JSX-IE. `ClubElementsCatalog.tsx` trzymał 859 linii, w których
// obok układu (karty, tabela, zakładki) siedziały cztery rzeczy o widocznych
// skutkach operacyjnych:
//
//   1. KTÓRY SŁOWNIK STOI POD KTÓRĄ ETYKIETĄ I Z JAKIM PREFIKSEM TŁUMACZEŃ.
//      Dwadzieścia dwa bloki `<VocabRow label=… values=… prefix=… />` wpisane
//      z ręki. To nie jest układ: katalog jest materiałem do pisania SQL-a
//      i do odpowiadania na zgłoszenia, więc sekcja pokazująca PIĘĆ z siedmiu
//      kodów odmowy jest gorsza niż jej brak - wygląda na kompletną. Jako dane
//      da się tego dowieść jednym przebiegiem po `CATALOG_VOCAB_CARDS`; jako
//      JSX dowodziło się tego wyłącznie czytaniem oczami.
//   2. LICZNIK SEKCJI. `SECTION_SIZE` był ręcznie sklejoną sumą długości
//      słowników - drugą kopią tej samej wiedzy. Licznik, który rozjedzie się
//      ze zbiorem, kłamie dokładnie tam, gdzie operator patrzy, ŻEBY sprawdzić,
//      czy szukanie coś znalazło. Tutaj jest POLICZONY z tych samych stałych,
//      które renderuje sekcja.
//   3. SZUKANIE PO SUROWEJ WARTOŚCI I PO TŁUMACZENIU JEDNOCZEŚNIE, bez akcentów
//      i bez wielkości liter („widocznosc” znajduje „Widoczność”, „chatham”
//      znajduje tryb atrybucji). Reguła dopasowania jest tu, a nie w wierszu.
//   4. CO ZNIKA POD FILTREM, A CO ZOSTAJE. Podgląd dostępu, galeria i macierz
//      NIE są zbiorami wartości - to narzędzia, a narzędzie, które znika przy
//      wpisaniu litery, wygląda na awarię. Zbiór `CATALOG_UNFILTERABLE` jest
//      regułą tego rozróżnienia.
//
// GRANICA WARSTW. Zero Reacta, zero i18n, zero klienta Supabase. Moduł oddaje
// KLUCZE i18n (`labelKey`, `prefix`) i deskryptory, nigdy gotowego napisu -
// tłumaczenie należy do widoku, bo tylko on wie, w jakim języku pracuje
// operator. Ikony i klasy zostają w organizmie: to jest układ.
//
// SŁOWNIK PANELU, A NIE PUBLICZNY. Część kluczy stąd (`adminClubs.moderation.*`)
// mieszka w `i18n-clubs-admin`, który trzeba jawnie dociągnąć przez
// `ensureAdminClubsI18n()`. Moduł tego NIE robi i nie może - nie zna Reacta ani
// i18next - więc jest osiągalny wyłącznie z organizmu panelu, który to woła
// (granicy pilnuje bramka `adminClubsI18nLoading.gate`).
import type { ClubAccessDraftValues } from "@/lib/clubs/adminClubEditor";
import { CAPABILITY_KEYS, type CapabilityKey } from "@/lib/clubs/capabilityMatrix";
import {
  CLUB_ACCESS_REASONS,
  CLUB_ACTIVITY_SORTS,
  CLUB_ATTRIBUTION_MODES,
  CLUB_GROUP_STATUSES,
  CLUB_INVITATION_STATUSES,
  CLUB_INVITE_CHANNELS,
  CLUB_INVITE_ERRORS,
  CLUB_JOIN_POLICIES,
  CLUB_LAYOUTS,
  CLUB_LOG_ACTIONS,
  CLUB_LOG_TARGETS,
  CLUB_MEMBER_ROLES,
  CLUB_MEMBER_STATUSES,
  CLUB_MODERATION_ACTIONS,
  CLUB_MODERATION_MODES,
  CLUB_NOTIFY_LEVELS,
  CLUB_POST_POLICIES,
  CLUB_QUALITY_REACTIONS,
  CLUB_REACTION_KINDS,
  CLUB_REPLY_SORTS,
  CLUB_SAVE_ERRORS,
  CLUB_STANCE_REACTIONS,
  CLUB_STANCES,
  CLUB_STATUSES,
  CLUB_SUBSCRIPTION_STATES,
  CLUB_THREAD_KINDS,
  CLUB_THREAD_SORTS,
  CLUB_THREAD_STATUSES,
  CLUB_VISIBILITIES,
  type ClubReactionKind,
  type ClubReactionTally,
} from "@/lib/clubs/types";

/** Sekcje katalogu - identyfikator jest też kotwicą `#club-elements-<id>`. */
export type CatalogSectionId =
  | "vocab"
  | "threadVocab"
  | "opsVocab"
  | "badges"
  | "access"
  | "gallery"
  | "matrix"
  | "reactions"
  | "reasons"
  | "errors";

/** Cztery powierzchnie katalogu - słowniki, komponenty, reguły, kody odmów. */
export type CatalogGroupId = "vocab" | "components" | "rules" | "codes";

/** Jedna OŚ słownika: etykieta, zbiór wartości i prefiks ich tłumaczeń. */
export interface CatalogVocabAxis {
  readonly labelKey: string;
  readonly values: readonly string[];
  readonly prefix: string;
}

/** Wartość słownika z przetłumaczoną etykietą - wejście filtra wiersza. */
export interface CatalogVocabValue {
  readonly value: string;
  readonly label: string;
}

/**
 * Osie słownikowe, pogrupowane w KARTY. Podział na karty nie jest kosmetyką:
 * reakcje jakościowe i reakcje stanowiska stoją osobno, bo to reguła bazy -
 * trigger podmienia jedno stanowisko na drugie, a oceny jakości sumują się
 * niezależnie.
 */
export const CATALOG_VOCAB_CARDS: Readonly<
  Record<"vocab" | "threadVocab" | "opsVocab", readonly (readonly CatalogVocabAxis[])[]>
> = {
  vocab: [
    [
      {
        labelKey: "clubElements.vocab.visibility",
        values: CLUB_VISIBILITIES,
        prefix: "club.visibility",
      },
      {
        labelKey: "clubElements.vocab.joinPolicy",
        values: CLUB_JOIN_POLICIES,
        prefix: "club.joinPolicy",
      },
      {
        labelKey: "clubElements.vocab.attribution",
        values: CLUB_ATTRIBUTION_MODES,
        prefix: "club.attribution",
      },
      {
        labelKey: "clubElements.vocab.whoCanPost",
        values: CLUB_POST_POLICIES,
        prefix: "club.whoCanPost",
      },
      {
        labelKey: "clubElements.vocab.moderation",
        values: CLUB_MODERATION_MODES,
        prefix: "club.moderation",
      },
      {
        labelKey: "clubElements.vocab.notifyLevel",
        values: CLUB_NOTIFY_LEVELS,
        prefix: "club.notify",
      },
      {
        labelKey: "clubElements.vocab.reaction",
        values: CLUB_REACTION_KINDS,
        prefix: "club.reaction",
      },
      { labelKey: "clubElements.vocab.layout", values: CLUB_LAYOUTS, prefix: "adminClubs.layout" },
    ],
  ],
  threadVocab: [
    [
      { labelKey: "clubElements.vocab.threadKind", values: CLUB_THREAD_KINDS, prefix: "club.kind" },
      {
        labelKey: "clubElements.vocab.threadStatus",
        values: CLUB_THREAD_STATUSES,
        prefix: "club.threadStatus",
      },
      { labelKey: "clubElements.vocab.threadSort", values: CLUB_THREAD_SORTS, prefix: "club.sort" },
      {
        labelKey: "clubElements.vocab.replySort",
        values: CLUB_REPLY_SORTS,
        prefix: "club.replySort",
      },
      {
        labelKey: "clubElements.vocab.activitySort",
        values: CLUB_ACTIVITY_SORTS,
        prefix: "club.sort",
      },
      { labelKey: "clubElements.vocab.stance", values: CLUB_STANCES, prefix: "club.stance" },
      {
        labelKey: "clubElements.vocab.subscription",
        values: CLUB_SUBSCRIPTION_STATES,
        prefix: "club.subscription",
      },
    ],
    [
      {
        labelKey: "clubElements.vocab.qualityReaction",
        values: CLUB_QUALITY_REACTIONS,
        prefix: "club.reaction",
      },
      {
        labelKey: "clubElements.vocab.stanceReaction",
        values: CLUB_STANCE_REACTIONS,
        prefix: "club.reaction",
      },
    ],
  ],
  opsVocab: [
    [
      {
        labelKey: "clubElements.vocab.inviteChannel",
        values: CLUB_INVITE_CHANNELS,
        prefix: "adminClubs.invitations.channelName",
      },
      {
        labelKey: "clubElements.vocab.invitationStatus",
        values: CLUB_INVITATION_STATUSES,
        prefix: "adminClubs.invitations.statusName",
      },
      {
        labelKey: "clubElements.vocab.moderationAction",
        values: CLUB_MODERATION_ACTIONS,
        prefix: "adminClubs.moderation.action",
      },
      {
        labelKey: "clubElements.vocab.logAction",
        values: CLUB_LOG_ACTIONS,
        prefix: "adminClubs.moderation.action",
      },
      {
        labelKey: "clubElements.vocab.logTarget",
        values: CLUB_LOG_TARGETS,
        prefix: "adminClubs.moderation.target",
      },
    ],
  ],
};

/**
 * Słowniki, których PEŁNE zbiory renderuje sekcja znaczników. Trzymane tutaj
 * po to, żeby licznik sekcji liczył się z tych samych stałych, które sekcja
 * pokazuje - a nie z ręcznie dopisanej sumy. To, KTÓRY atom rysuje który
 * słownik, zostaje w organizmie: tam jest zawężony typ znacznika.
 */
export const CATALOG_BADGE_DICTS: readonly (readonly string[])[] = [
  CLUB_STATUSES,
  CLUB_GROUP_STATUSES,
  CLUB_VISIBILITIES,
  CLUB_MEMBER_ROLES,
  CLUB_MEMBER_STATUSES,
];

/** Źródło kodów: zbiór kodów + prefiks zdania w słowniku i18n. */
export interface CatalogCodeSource {
  readonly codes: readonly string[];
  readonly prefix: string;
}

/**
 * Które kody skąd biorą zdanie. To jest reguła, nie układ: `duplicate_open`
 * z zaproszeń i `slug_taken` z zapisu mają zdania w INNYCH przestrzeniach
 * kluczy, a pomyłka daje w katalogu goły klucz zamiast wyjaśnienia.
 */
export const CATALOG_CODE_SOURCES: Readonly<
  Record<"reasons" | "invite" | "save", CatalogCodeSource>
> = {
  reasons: { codes: CLUB_ACCESS_REASONS, prefix: "club.reason" },
  invite: { codes: CLUB_INVITE_ERRORS, prefix: "adminClubs.invitations.error" },
  save: { codes: CLUB_SAVE_ERRORS, prefix: "adminClubs.create.error" },
};

/** Pola podglądu dostępu (`ClubAccessTab`) - licznik sekcji „access”. */
export const CATALOG_ACCESS_FIELDS = 6;

/** Pozycje galerii komponentów publicznych - licznik sekcji „gallery”. */
export const CATALOG_GALLERY_ITEMS = 5;

function axesSize(cards: readonly (readonly CatalogVocabAxis[])[]): number {
  return cards.reduce(
    (sum, axes) => sum + axes.reduce((inner, axis) => inner + axis.values.length, 0),
    0,
  );
}

/**
 * Ile wartości ma sekcja. POLICZONE ze stałych, nie wpisane z ręki - licznik
 * i zbiór nie mają jak się rozjechać.
 */
export const CATALOG_SECTION_SIZE: Readonly<Record<CatalogSectionId, number>> = {
  vocab: axesSize(CATALOG_VOCAB_CARDS.vocab),
  threadVocab: axesSize(CATALOG_VOCAB_CARDS.threadVocab),
  opsVocab: axesSize(CATALOG_VOCAB_CARDS.opsVocab),
  badges: CATALOG_BADGE_DICTS.reduce((sum, dict) => sum + dict.length, 0),
  access: CATALOG_ACCESS_FIELDS,
  gallery: CATALOG_GALLERY_ITEMS,
  matrix: CAPABILITY_KEYS.length,
  reactions: CLUB_REACTION_KINDS.length,
  reasons: CATALOG_CODE_SOURCES.reasons.codes.length,
  errors: CATALOG_CODE_SOURCES.invite.codes.length + CATALOG_CODE_SOURCES.save.codes.length,
};

/** Zakładki katalogu i ich sekcje - kolejność jest kolejnością na ekranie. */
export const CATALOG_GROUPS: readonly {
  readonly id: CatalogGroupId;
  readonly sections: readonly CatalogSectionId[];
}[] = [
  { id: "vocab", sections: ["vocab", "threadVocab", "opsVocab"] },
  { id: "components", sections: ["badges", "gallery", "reactions"] },
  { id: "rules", sections: ["access", "matrix"] },
  { id: "codes", sections: ["reasons", "errors"] },
];

/**
 * Sekcje zakładki. Wartość spoza zbioru oddaje PUSTĄ listę, a nie wyjątek:
 * identyfikator zakładki wraca z `onValueChange` Radiksa jako `string`.
 */
export function catalogGroupSections(group: string): readonly CatalogSectionId[] {
  return CATALOG_GROUPS.find((entry) => entry.id === group)?.sections ?? [];
}

/** Licznik przy zakładce - suma liczników jej sekcji. */
export function catalogGroupSize(group: string): number {
  return catalogGroupSections(group).reduce((sum, id) => sum + CATALOG_SECTION_SIZE[id], 0);
}

/** Sekcje bez własnego słownika wartości - szukanie ich NIE filtruje. */
export const CATALOG_UNFILTERABLE: ReadonlySet<CatalogSectionId> = new Set<CatalogSectionId>([
  "access",
  "gallery",
  "matrix",
]);

/**
 * Bez akcentów i wielkości liter - „widocznosc” ma znaleźć „Widoczność”.
 * `ł` osobno, bo NFD go nie rozkłada (to jedna litera z kreską, nie litera
 * plus znak diakrytyczny) - bez tej podmiany „zgloszenie” nie znajduje
 * „zgłoszenie”, a to jest najczęstsze słowo w tym panelu.
 */
export function normalizeCatalogQuery(value: string): string {
  return value
    .toLocaleLowerCase("pl")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0142/g, "l");
}

/** Wpisane szukanie sprowadzone do postaci porównywalnej (bez spacji brzegowych). */
export function catalogQuery(raw: string): string {
  return normalizeCatalogQuery(raw.trim());
}

/**
 * Które wartości osi zostają pod filtrem.
 *
 * Trafienie w ETYKIETĘ OSI zostawia CAŁĄ oś - kto wpisał „moderacja”, chce
 * zobaczyć wszystkie tryby moderacji, a nie tylko ten jeden, który ma słowo
 * „moderacja” w swojej nazwie. Bez tej gałęzi katalog odpowiadałby na pytanie
 * „jakie wartości ma ta kolumna” pustką.
 */
export function visibleVocabValues(
  label: string,
  rows: readonly CatalogVocabValue[],
  query: string,
): readonly CatalogVocabValue[] {
  if (query === "") return rows;
  if (normalizeCatalogQuery(label).includes(query)) return rows;
  return rows.filter(
    (row) =>
      normalizeCatalogQuery(row.value).includes(query) ||
      normalizeCatalogQuery(row.label).includes(query),
  );
}

/** Kod odmowy zostaje, gdy filtr trafia w SAM KOD albo w jego zdanie. */
export function catalogCodeMatches(code: string, sentence: string, query: string): boolean {
  return (
    query === "" ||
    normalizeCatalogQuery(code).includes(query) ||
    normalizeCatalogQuery(sentence).includes(query)
  );
}

/** Klucz i18n zdania dla kodu z danego źródła. */
export function catalogCodeKey(source: CatalogCodeSource, code: string): string {
  return `${source.prefix}.${code}`;
}

/** Kod z gotowym zdaniem - para renderowana w karcie kodu. */
export interface CatalogCodeRow {
  readonly code: string;
  readonly sentence: string;
}

/**
 * PEŁNY zbiór kodów źródła, przepuszczony przez filtr. `translate` wstrzykuje
 * widok - moduł nie zna i18n, ale zna prefiks, pod którym zdanie leży.
 */
export function catalogCodeRows(
  source: CatalogCodeSource,
  translate: (key: string) => string,
  query: string,
): readonly CatalogCodeRow[] {
  return source.codes
    .map((code) => ({ code, sentence: translate(catalogCodeKey(source, code)) }))
    .filter((row) => catalogCodeMatches(row.code, row.sentence, query));
}

/** Wiersze macierzy uprawnień pod filtrem - dopasowanie po nazwie zdolności. */
export function filterCapabilityKeys(query: string): readonly CapabilityKey[] {
  return CAPABILITY_KEYS.filter(
    (key) => query === "" || normalizeCatalogQuery(key).includes(query),
  );
}

/**
 * Czy sekcja jest „pusta pod filtrem”, czyli ma zniknąć.
 *
 * Warunek ma TRZY składniki i każdy jest potrzebny: bez filtra nie znika nic,
 * narzędzia (`CATALOG_UNFILTERABLE`) nie znikają nigdy, a sekcja z treścią
 * zostaje.
 */
export function catalogSectionHidden(
  id: CatalogSectionId,
  query: string,
  hasContent: boolean,
): boolean {
  return query !== "" && !CATALOG_UNFILTERABLE.has(id) && !hasContent;
}

/**
 * Sekcja znaczników nie ma słownika SUROWYCH wartości do przeszukania (ton
 * i etykieta mieszkają w atomie), więc odpowiada wyłącznie na trafienie
 * w tytuł sekcji.
 */
export function catalogBadgesVisible(sectionTitle: string, query: string): boolean {
  return query === "" || normalizeCatalogQuery(sectionTitle).includes(query);
}

/** „Nic nie znaleziono” = filtr działa, a WSZYSTKIE zbiory zostały puste. */
export function catalogNothingFound(query: string, counts: readonly number[]): boolean {
  return query !== "" && counts.every((count) => count === 0);
}

/**
 * Przełączenie własnej reakcji na poglądowym pasku.
 *
 * `active` mówi, czy reakcja JEST postawiona - dlatego licznik idzie w dół
 * przy cofaniu i w górę przy postawieniu, a `Math.max(0, …)` pilnuje, żeby
 * cofnięcie reakcji przy zerowym liczniku nie zjechało na minus (pasek pokazuje
 * dane poglądowe, więc taki rozjazd jest tu osiągalny).
 */
export function toggleReactionTally(
  tallies: readonly ClubReactionTally[],
  kind: ClubReactionKind,
  active: boolean,
): ClubReactionTally[] {
  return tallies.map((tally) =>
    tally.kind === kind
      ? { ...tally, mine: !active, total: Math.max(0, tally.total + (active ? -1 : 1)) }
      : tally,
  );
}

/** Wersja robocza podglądu dostępu - stan startowy sekcji „reguły”. */
export const CATALOG_INITIAL_DRAFT: ClubAccessDraftValues = {
  visibility: "members",
  joinPolicy: "invite",
  minTierRank: 0,
  attributionMode: "chatham",
  whoCanPost: "moderators",
  moderationMode: "trusted",
};

/** Startowy zestaw liczników reakcji - wygląda jak żywy wątek, nie jak zero. */
export const CATALOG_INITIAL_TALLIES: readonly ClubReactionTally[] = [
  { kind: "insightful", total: 7, mine: true },
  { kind: "evidence", total: 3, mine: false },
  { kind: "question", total: 1, mine: false },
  { kind: "thanks", total: 0, mine: false },
  { kind: "agree", total: 5, mine: false },
  { kind: "disagree", total: 2, mine: false },
];
