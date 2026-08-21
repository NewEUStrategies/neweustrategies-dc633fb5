// Kampania segmentowa - BUDOWA SEGMENTU i BRAMKA WYSYŁKI jako reguły.
//
// CO TO DOWODZI. Cztery rzeczy, które przed wyprowadzeniem żyły w JSX-ie
// kampanii - w `useMemo`, w atrybutach `disabled` i w drabince ternary - a każda
// z nich decyduje o tym, do KOGO pójdzie nieodwracalne zaproszenie:
//
//   1. RODZAJ WYBIERA DOKŁADNIE JEDNO POLE REGUŁY. `ClubSegmentRule` odpowiada
//      gałęziom `club_segment_candidate_ids`: `badge` czyta `badge`,
//      `specialization` czyta `value`, `other_club` czyta `club_id`,
//      `policy_follow` czyta `item_id`, a `event_rsvp` - `event_id`. Wartość
//      wpisana pod niewłaściwym kluczem nie jest błędem składni, tylko PUSTYM
//      zbiorem odbiorców z komunikatem o sukcesie.
//   2. KOTWICA JEST WSPÓŁDZIELONA PRZEZ DWA RODZAJE O RÓŻNYCH TYPACH ENCJI, więc
//      deskryptor pola musi podać typ (`eu_policy_item` kontra `event`)
//      - podpowiedź spoza typu daje regułę rozwiązującą się na zbiór pusty.
//   3. PODGLĄD JEST OBOWIĄZKOWY: pięć stanów tego, co stoi między regułą
//      a przyciskiem, i CZTERY warunki bramki wysyłki. Reguła niedokończona,
//      podgląd w locie, awaria podglądu, zero odbiorców i trwająca wysyłka -
//      każdy z nich osobno wystarcza, żeby przycisk był nieaktywny.
//   4. LICZBA W PRZYCISKU JEST TREŚCIĄ POTWIERDZENIA - dopóki zasięg nie jest
//      policzony, etykieta NIE obiecuje liczby.
//
// Plus: `lead` nie jest rolą kampanii (prowadzącego wyznacza się imiennie),
// klub kampanii wypada z listy „innego klubu”, a puste okienko wiadomości jedzie
// jako `null`, nie jako pusty napis.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Słownika rodzajów i predykatu kompletności
// reguły (`CLUB_SEGMENT_KINDS`, `isClubSegmentRuleComplete`) - mają test
// w `clubTypes.test.ts`; tutaj sprawdzamy, że budowa segmentu ich UŻYWA i co
// z tego wychodzi. (2) Tego, kogo RPC realnie policzy - to
// `admin_club_segment_preview` i pgTAP. (3) Renderu kampanii -
// `ClubSegmentCampaign.test.tsx` dowodzi SKLEJENIA.
import { describe, expect, it } from "vitest";
import {
  CLUB_SEGMENT_CAMPAIGN_ROLES,
  canSendClubSegment,
  clubSegmentAnchorField,
  clubSegmentField,
  clubSegmentOtherClubs,
  clubSegmentPreviewCells,
  clubSegmentPreviewView,
  clubSegmentRule,
  clubSegmentSendLabel,
  clubSegmentSendVars,
  isClubSegmentDraftComplete,
  type ClubSegmentDraft,
} from "@/lib/clubs/adminSegment";
import {
  CLUB_SEGMENT_KINDS,
  type ClubSegmentKind,
  type ClubSegmentPreview,
} from "@/lib/clubs/types";
import { CLUB_IDS, adminClubRow } from "@/test/clubs/fixtures";

function draft(overrides: Partial<ClubSegmentDraft> = {}): ClubSegmentDraft {
  return {
    kind: "badge",
    badge: "expert",
    specialization: "",
    otherClubId: "",
    anchorId: "",
    ...overrides,
  };
}

function preview(overrides: Partial<ClubSegmentPreview> = {}): ClubSegmentPreview {
  return { matched: 40, already_member: 6, blocked: 4, will_send: 30, ...overrides };
}

describe("budowa reguły: rodzaj wybiera JEDNO pole", () => {
  it("odznaka jedzie pod kluczem `badge`", () => {
    expect(clubSegmentRule(draft({ kind: "badge", badge: "verified" }))).toEqual({
      kind: "badge",
      badge: "verified",
    });
  });

  it("specjalizacja jedzie pod kluczem `value` i jest PRZYCIĘTA", () => {
    expect(
      clubSegmentRule(draft({ kind: "specialization", specialization: "  energetyka  " })),
    ).toEqual({ kind: "specialization", value: "energetyka" });
  });

  it("inny klub jedzie pod kluczem `club_id`", () => {
    expect(clubSegmentRule(draft({ kind: "other_club", otherClubId: CLUB_IDS.club }))).toEqual({
      kind: "other_club",
      club_id: CLUB_IDS.club,
    });
  });

  it("akt prawny jedzie pod kluczem `item_id`, wydarzenie pod `event_id`", () => {
    // To jest dokładnie ta pomyłka, której nie widać na ekranie: ta sama kotwica
    // pod dwoma różnymi kluczami, bo to dwa różne typy encji w bazie.
    expect(clubSegmentRule(draft({ kind: "policy_follow", anchorId: "item-1" }))).toEqual({
      kind: "policy_follow",
      item_id: "item-1",
    });
    expect(clubSegmentRule(draft({ kind: "event_rsvp", anchorId: "event-1" }))).toEqual({
      kind: "event_rsvp",
      event_id: "event-1",
    });
  });

  it("reguła nie niesie pól OBCYCH dla swojego rodzaju", () => {
    const rule = clubSegmentRule(
      draft({ kind: "badge", specialization: "energetyka", otherClubId: "x", anchorId: "y" }),
    );

    expect(Object.keys(rule).sort()).toEqual(["badge", "kind"]);
  });

  it("każdy rodzaj ze słownika ma swoją gałąź - żaden nie wypada", () => {
    for (const kind of CLUB_SEGMENT_KINDS) {
      expect(clubSegmentRule(draft({ kind })).kind).toBe(kind);
    }
  });
});

describe("kompletność wersji roboczej", () => {
  const PUSTE: readonly ClubSegmentKind[] = CLUB_SEGMENT_KINDS;

  it.each(PUSTE)("rodzaj %s bez swojej wartości jest NIEKOMPLETNY", (kind) => {
    expect(isClubSegmentDraftComplete(draft({ kind, badge: "" }))).toBe(false);
  });

  it("specjalizacja z samych spacji też jest niekompletna", () => {
    expect(
      isClubSegmentDraftComplete(draft({ kind: "specialization", specialization: "   " })),
    ).toBe(false);
  });

  it("wypełniona wartość domyka regułę", () => {
    expect(isClubSegmentDraftComplete(draft({ kind: "badge", badge: "expert" }))).toBe(true);
    expect(isClubSegmentDraftComplete(draft({ kind: "event_rsvp", anchorId: "event-1" }))).toBe(
      true,
    );
  });
});

describe("pole formularza dla rodzaju", () => {
  const CASES: readonly [ClubSegmentKind, string][] = [
    ["badge", "badge"],
    ["specialization", "specialization"],
    ["other_club", "other_club"],
    ["policy_follow", "anchor"],
    ["event_rsvp", "anchor"],
  ];

  it.each(CASES)("rodzaj %s obsługuje pole %s", (kind, field) => {
    expect(clubSegmentField(kind)).toBe(field);
  });

  it("kotwica zna TYP encji i etykietę, a pozostałe rodzaje jej nie mają", () => {
    expect(clubSegmentAnchorField("policy_follow")).toEqual({
      anchorType: "eu_policy_item",
      labelKey: "adminClubs.segment.policyLabel",
    });
    expect(clubSegmentAnchorField("event_rsvp")).toEqual({
      anchorType: "event",
      labelKey: "adminClubs.segment.eventLabel",
    });
    expect(clubSegmentAnchorField("badge")).toBeNull();
    expect(clubSegmentAnchorField("specialization")).toBeNull();
    expect(clubSegmentAnchorField("other_club")).toBeNull();
  });
});

describe("lista innych klubów", () => {
  it("klub kampanii wypada z listy", () => {
    const rows = [
      adminClubRow({ id: CLUB_IDS.club }),
      adminClubRow({ id: "inny-1" }),
      adminClubRow({ id: "inny-2" }),
    ];

    expect(clubSegmentOtherClubs(rows, CLUB_IDS.club).map((row) => row.id)).toEqual([
      "inny-1",
      "inny-2",
    ]);
  });

  it("pusta odpowiedź daje pustą listę, a nie wyjątek", () => {
    expect(clubSegmentOtherClubs([], CLUB_IDS.club)).toEqual([]);
  });
});

describe("cztery liczby podglądu", () => {
  it("kolejność i etykiety są stałe, a wyróżniona jest TYLKO liczba wysyłki", () => {
    const cells = clubSegmentPreviewCells(preview());

    expect(cells.map((cell) => cell.id)).toEqual([
      "matched",
      "already_member",
      "blocked",
      "will_send",
    ]);
    expect(cells.map((cell) => cell.value)).toEqual([40, 6, 4, 30]);
    expect(cells.filter((cell) => cell.emphasis).map((cell) => cell.id)).toEqual(["will_send"]);
    expect(cells.map((cell) => cell.labelKey)).toEqual([
      "adminClubs.segment.matched",
      "adminClubs.segment.alreadyMember",
      "adminClubs.segment.blocked",
      "adminClubs.segment.willSend",
    ]);
  });

  it("zerowy odsiew nadal daje CZTERY liczby - brak liczby to nie zero", () => {
    const cells = clubSegmentPreviewCells(
      preview({ matched: 0, already_member: 0, blocked: 0, will_send: 0 }),
    );

    expect(cells).toHaveLength(4);
    expect(cells.every((cell) => cell.value === 0)).toBe(true);
  });
});

describe("pięć stanów podglądu", () => {
  it("niedokończona reguła nie pyta bazy i mówi o sobie", () => {
    expect(
      clubSegmentPreviewView({ complete: false, isError: false, isPending: true, preview: null }),
    ).toEqual({ state: "incomplete" });
  });

  it("awaria podglądu bije zapytanie w locie", () => {
    expect(
      clubSegmentPreviewView({ complete: true, isError: true, isPending: true, preview: null }),
    ).toEqual({ state: "failed" });
  });

  it("zapytanie W LOCIE ma własny stan, nie pustkę", () => {
    expect(
      clubSegmentPreviewView({ complete: true, isError: false, isPending: true, preview: null }),
    ).toEqual({ state: "loading" });
  });

  it("cisza po zapytaniu (brak danych, nic się nie liczy) nie rysuje liczb", () => {
    expect(
      clubSegmentPreviewView({ complete: true, isError: false, isPending: false, preview: null }),
    ).toEqual({ state: "idle" });
  });

  it("policzony zasięg niesie GOTOWE komórki", () => {
    const view = clubSegmentPreviewView({
      complete: true,
      isError: false,
      isPending: false,
      preview: preview(),
    });

    expect(view.state).toBe("counts");
    expect(view.state === "counts" ? view.cells.map((cell) => cell.value) : []).toEqual([
      40, 6, 4, 30,
    ]);
  });
});

describe("bramka wysyłki - cztery warunki, wszystkie konieczne", () => {
  const CASES: readonly [string, Parameters<typeof canSendClubSegment>[0], boolean][] = [
    [
      "reguła kompletna, zasięg policzony, nic nie trwa",
      { complete: true, preview: preview(), isPending: false },
      true,
    ],
    [
      "NIEDOKOŃCZONA reguła blokuje, choć podgląd ma liczby",
      { complete: false, preview: preview(), isPending: false },
      false,
    ],
    [
      "BRAK podglądu blokuje - liczby nikt nie zobaczył",
      { complete: true, preview: null, isPending: false },
      false,
    ],
    [
      "ZERO odbiorców blokuje - wysyłka do nikogo raportowałaby sukces",
      { complete: true, preview: preview({ will_send: 0 }), isPending: false },
      false,
    ],
    [
      "TRWAJĄCA wysyłka blokuje - kampania nie ma pójść dwa razy",
      { complete: true, preview: preview(), isPending: true },
      false,
    ],
  ];

  it.each(CASES)("%s", (_opis, params, expected) => {
    expect(canSendClubSegment(params)).toBe(expected);
  });
});

describe("etykieta przycisku obiecuje liczbę tylko wtedy, gdy ją zna", () => {
  it("policzony zasięg jedzie z licznikiem", () => {
    expect(clubSegmentSendLabel(preview({ will_send: 137 }))).toEqual({
      key: "adminClubs.segment.sendCount",
      count: 137,
    });
  });

  it("brak podglądu i zero odbiorców dają etykietę BEZ liczby", () => {
    expect(clubSegmentSendLabel(null)).toEqual({ key: "adminClubs.segment.send", count: null });
    expect(clubSegmentSendLabel(preview({ will_send: 0 }))).toEqual({
      key: "adminClubs.segment.send",
      count: null,
    });
  });
});

describe("payload wysyłki", () => {
  it("wiadomość jedzie PRZYCIĘTA, a reguła zostaje zapisana", () => {
    const vars = clubSegmentSendVars({
      rule: { kind: "badge", badge: "expert" },
      role: "moderator",
      message: "  Zapraszamy  ",
    });

    expect(vars).toEqual({
      rule: { kind: "badge", badge: "expert" },
      role: "moderator",
      message: "Zapraszamy",
      saveRule: true,
    });
  });

  it("puste okienko wiadomości jedzie jako `null`, nie jako pusty napis", () => {
    expect(
      clubSegmentSendVars({ rule: { kind: "badge", badge: "expert" }, role: "member", message: "" })
        .message,
    ).toBeNull();
    expect(
      clubSegmentSendVars({
        rule: { kind: "badge", badge: "expert" },
        role: "member",
        message: "   ",
      }).message,
    ).toBeNull();
  });
});

describe("role kampanii", () => {
  it("prowadzącego NIE nadaje się masowo", () => {
    expect(CLUB_SEGMENT_CAMPAIGN_ROLES).toEqual(["moderator", "member", "observer"]);
    expect(CLUB_SEGMENT_CAMPAIGN_ROLES).not.toContain("lead");
  });
});
