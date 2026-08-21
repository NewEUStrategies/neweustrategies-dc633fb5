// Kampania segmentowa klubu - BUDOWA SEGMENTU i BRAMKA WYSYŁKI jako czyste reguły.
//
// CZEGO TU NIE BYŁO. `ClubSegmentCampaign` trzymał w JSX-ie cztery rzeczy, z
// których każda decyduje o tym, do KOGO pójdzie nieodwracalne zaproszenie:
// złożenie reguły z pięciu pól formularza (`switch` w `useMemo`), wybór pola
// widocznego dla danego rodzaju reguły (trzy ternary i jedna alternatywa w
// atrybutach), warunek włączenia przycisku (koniunkcja czterech wyrażeń w jednej
// linii) i stan podglądu (drabinka czterech zagnieżdżonych ternary). Każda z nich
// jest REGUŁĄ o widocznych skutkach:
//
//   1. REGUŁA JEST DANYMI, NIE FORMULARZEM. `ClubSegmentRule` odpowiada gałęziom
//      `club_segment_candidate_ids`; rodzaj bez swojej wartości rozwiązuje się
//      w bazie na zbiór PUSTY, więc niedokończona reguła nie ma prawa dojechać
//      do RPC z komunikatem o sukcesie.
//   2. KOTWICA JEST WSPÓŁDZIELONA PRZEZ DWA RODZAJE O RÓŻNYCH TYPACH ENCJI.
//      `policy_follow` przyjmuje wyłącznie akt prawny, `event_rsvp` wyłącznie
//      wydarzenie - identyfikator z poprzedniego rodzaju jest w nowym po prostu
//      nieistniejącą encją, czyli znowu zbiór pusty.
//   3. PODGLĄD JEST OBOWIĄZKOWY, NIE OPCJONALNY. Wysyłka włącza się dopiero, gdy
//      baza policzyła, ilu ludzi to realnie dotknie, i gdy ta liczba jest większa
//      od zera. Podgląd w locie, awaria podglądu i trwająca wysyłka blokują
//      przycisk - inaczej administrator „potwierdza” liczbę, której nie zobaczył.
//   4. LICZBA W PRZYCISKU JEST TREŚCIĄ POTWIERDZENIA. Zaproszenie masowe jest
//      nieodwracalne wobec cudzych skrzynek, więc etykieta mówi DOKŁADNIE, ile
//      zaproszeń pójdzie - `sendCount` z licznikiem, a nie ogólne „wyślij”.
//
// GRANICA WARSTW. Zero Reacta, zero i18next, zero klienta Supabase - wychodzą
// stąd KLUCZE i18n oraz deskryptory, nigdy gotowy tekst i nigdy element.
//
// SŁOWNIK PANELU, A NIE PUBLICZNY. Klucze `adminClubs.segment.*` mieszkają
// w `i18n-clubs-admin`, który trzeba jawnie dociągnąć przez
// `ensureAdminClubsI18n()`. Moduł tego NIE robi i nie może - nie zna Reacta ani
// i18next - więc jest osiągalny wyłącznie z organizmu panelu, który to woła
// (granicy pilnuje bramka `adminClubsI18nLoading.gate`).
import {
  isClubSegmentRuleComplete,
  type ClubAnchorType,
  type ClubMemberRole,
  type ClubSegmentKind,
  type ClubSegmentPreview,
  type ClubSegmentRule,
} from "./types";

/**
 * Role możliwe do nadania kampanią. `lead` celowo poza listą - prowadzącego
 * wyznacza się imiennie, nie masowo.
 */
export const CLUB_SEGMENT_CAMPAIGN_ROLES = [
  "moderator",
  "member",
  "observer",
] as const satisfies readonly ClubMemberRole[];

export type ClubSegmentCampaignRole = (typeof CLUB_SEGMENT_CAMPAIGN_ROLES)[number];

/** Pięć pól formularza kampanii - jedno z nich wypełnia regułę danego rodzaju. */
export interface ClubSegmentDraft {
  kind: ClubSegmentKind;
  badge: string;
  specialization: string;
  otherClubId: string;
  /** Identyfikator kotwicy - wspólny dla `policy_follow` i `event_rsvp`. */
  anchorId: string;
}

/**
 * Złożenie reguły w postaci, w której jedzie do RPC jako jsonb. Rodzaj wybiera
 * DOKŁADNIE jedno pole; pozostałe nie trafiają do reguły, bo baza czyta klucz
 * właściwy dla gałęzi, a nadmiarowe pola tylko zaciemniałyby zapisaną kampanię.
 */
export function clubSegmentRule(draft: ClubSegmentDraft): ClubSegmentRule {
  const kind = draft.kind;
  switch (kind) {
    case "badge":
      return { kind, badge: draft.badge };
    case "specialization":
      return { kind, value: draft.specialization.trim() };
    case "other_club":
      return { kind, club_id: draft.otherClubId };
    case "policy_follow":
      return { kind, item_id: draft.anchorId };
    case "event_rsvp":
      return { kind, event_id: draft.anchorId };
  }
}

/** Czy wersja robocza daje regułę KOMPLETNĄ (czyli niepustą po stronie bazy). */
export function isClubSegmentDraftComplete(draft: ClubSegmentDraft): boolean {
  return isClubSegmentRuleComplete(clubSegmentRule(draft));
}

/** Które pole formularza obsługuje dany rodzaj reguły. */
export type ClubSegmentField = "badge" | "specialization" | "other_club" | "anchor";

export function clubSegmentField(kind: ClubSegmentKind): ClubSegmentField {
  switch (kind) {
    case "badge":
      return "badge";
    case "specialization":
      return "specialization";
    case "other_club":
      return "other_club";
    case "policy_follow":
    case "event_rsvp":
      return "anchor";
  }
}

/** Deskryptor pola kotwicy: TYP encji i etykieta - albo `null`, gdy nie dotyczy. */
export interface ClubSegmentAnchorField {
  anchorType: ClubAnchorType;
  labelKey: string;
}

export function clubSegmentAnchorField(kind: ClubSegmentKind): ClubSegmentAnchorField | null {
  if (kind === "policy_follow") {
    return { anchorType: "eu_policy_item", labelKey: "adminClubs.segment.policyLabel" };
  }
  if (kind === "event_rsvp") {
    return { anchorType: "event", labelKey: "adminClubs.segment.eventLabel" };
  }
  return null;
}

/**
 * Kluby dostępne w regule `other_club`. Klub, w którym stoi kampania, wypada
 * z listy: zaproszenie własnych członków do własnego klubu to zbiór, który
 * podgląd i tak odsieje w całości.
 */
export function clubSegmentOtherClubs<T extends { id: string }>(
  rows: readonly T[],
  clubId: string,
): T[] {
  return rows.filter((row) => row.id !== clubId);
}

/** Jedna liczba podglądu - opis, wartość i to, czy jest liczbą GŁÓWNĄ. */
export interface ClubSegmentPreviewCell {
  id: "matched" | "already_member" | "blocked" | "will_send";
  labelKey: string;
  value: number;
  emphasis: boolean;
}

/**
 * Cztery liczby sumujące się do `matched`. Administrator ma widzieć nie tylko
 * „ile pójdzie”, ale i „dlaczego reszta nie” - dlatego odsiew jest w podglądzie,
 * a nie tylko w wyniku wysyłki.
 */
export function clubSegmentPreviewCells(
  preview: ClubSegmentPreview,
): readonly ClubSegmentPreviewCell[] {
  return [
    {
      id: "matched",
      labelKey: "adminClubs.segment.matched",
      value: preview.matched,
      emphasis: false,
    },
    {
      id: "already_member",
      labelKey: "adminClubs.segment.alreadyMember",
      value: preview.already_member,
      emphasis: false,
    },
    {
      id: "blocked",
      labelKey: "adminClubs.segment.blocked",
      value: preview.blocked,
      emphasis: false,
    },
    {
      id: "will_send",
      labelKey: "adminClubs.segment.willSend",
      value: preview.will_send,
      emphasis: true,
    },
  ];
}

/**
 * Co stoi MIĘDZY regułą a przyciskiem. Pięć stanów, bo tyle ich realnie jest:
 * niedokończona reguła, awaria podglądu, podgląd w locie, policzone liczby
 * i cisza (zapytanie jeszcze nie wystartowało - reguła kompletna, ale odpowiedzi
 * nie ma i nic się nie liczy).
 */
export type ClubSegmentPreviewView =
  | { state: "incomplete" }
  | { state: "failed" }
  | { state: "loading" }
  | { state: "counts"; cells: readonly ClubSegmentPreviewCell[] }
  | { state: "idle" };

export function clubSegmentPreviewView(params: {
  complete: boolean;
  isError: boolean;
  isPending: boolean;
  preview: ClubSegmentPreview | null;
}): ClubSegmentPreviewView {
  if (!params.complete) return { state: "incomplete" };
  if (params.isError) return { state: "failed" };
  if (params.isPending) return { state: "loading" };
  if (params.preview === null) return { state: "idle" };
  return { state: "counts", cells: clubSegmentPreviewCells(params.preview) };
}

/**
 * Bramka wysyłki. Cztery warunki, wszystkie konieczne: reguła kompletna, podgląd
 * POLICZONY, liczba odbiorców większa od zera, wysyłka nie trwa. Brak
 * któregokolwiek znaczy „przycisk nieaktywny”, a nie „wyślij i zobaczymy”.
 */
export function canSendClubSegment(params: {
  complete: boolean;
  preview: ClubSegmentPreview | null;
  isPending: boolean;
}): boolean {
  const { complete, preview, isPending } = params;
  return complete && preview !== null && preview.will_send > 0 && !isPending;
}

/** Etykieta przycisku: z licznikiem, gdy podgląd zna zasięg; inaczej ogólna. */
export interface ClubSegmentSendLabel {
  key: string;
  /** `null` = klucz bez licznika (nie ma czego potwierdzać liczbą). */
  count: number | null;
}

export function clubSegmentSendLabel(preview: ClubSegmentPreview | null): ClubSegmentSendLabel {
  if (preview !== null && preview.will_send > 0) {
    return { key: "adminClubs.segment.sendCount", count: preview.will_send };
  }
  return { key: "adminClubs.segment.send", count: null };
}

/** Argumenty mutacji zaproszenia segmentowego. */
export interface ClubSegmentSendVars {
  rule: ClubSegmentRule;
  role: ClubMemberRole;
  message: string | null;
  saveRule: boolean;
}

/**
 * Payload wysyłki. Puste okienko wiadomości jedzie jako `null`, a nie jako pusty
 * napis - inaczej zaproszenie miałoby treść składającą się z niczego. Kampania
 * ZAWSZE zapisuje regułę (`club_segment_rules`): tabela istnieje po to, żeby dało
 * się ją powtórzyć, a reguła zapisana wybiórczo nie mówi nic o historii.
 */
export function clubSegmentSendVars(params: {
  rule: ClubSegmentRule;
  role: ClubSegmentCampaignRole;
  message: string;
}): ClubSegmentSendVars {
  return {
    rule: params.rule,
    role: params.role,
    message: params.message.trim() || null,
    saveRule: true,
  };
}
