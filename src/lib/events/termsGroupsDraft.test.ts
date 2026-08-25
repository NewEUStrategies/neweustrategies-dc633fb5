// Testy warstwy szkicow GRUP i ZGOD: reguly walidacji i granica payloadu RPC.
//
// SPRAWDZAMY TO, CZEGO BAZA NIE WYBACZA: klucz niezmienny po zapisie, CHECK
// „can_see_attendees OR visibility = none", `bump_version` tylko przy edycji i
// pominiete klucze przy tworzeniu.
import { describe, expect, it } from "vitest";
import {
  emptyGroupDraft,
  emptyTermDraft,
  groupDraftFromRow,
  groupDraftToInput,
  staleAcceptances,
  termDraftFromRow,
  termDraftToInput,
  validateGroupDraft,
  validateTermDraft,
} from "@/lib/events/termsGroupsDraft";

const groupRow = {
  id: "g-1",
  key: "vip",
  name_pl: "VIP",
  name_en: "VIP",
  description_pl: "",
  description_en: "",
  color: "#FA9346",
  attendee_visibility: "own_group",
  can_see_attendees: true,
  can_meet: true,
  can_chat: false,
  can_lead_retrieval: true,
  can_see_recording: false,
  min_tier_rank: 3,
  sort_order: 20,
  is_default: false,
  is_system: false,
};

const termRow = {
  id: "t-1",
  key: "chatham",
  label_pl: "Zasada Chatham House",
  label_en: "Chatham House rule",
  body_pl: "tresc",
  body_en: "body",
  external_url: null,
  display: "access",
  is_required: true,
  sort_order: 30,
  is_active: true,
  version: 4,
  acceptances_current: 6,
  acceptances_total: 10,
};

describe("groupDraft", () => {
  it("wymaga klucza tylko dla nowej grupy", () => {
    const fresh = emptyGroupDraft(10);
    expect(validateGroupDraft({ ...fresh, namePl: "A", nameEn: "A" }).map((e) => e.field)).toEqual([
      "key",
    ]);
    const existing = groupDraftFromRow(groupRow);
    expect(validateGroupDraft({ ...existing, key: "" })).toEqual([]);
  });

  it("odrzuca brak nazwy w jednym jezyku, zly kolor i nieliczbe", () => {
    const draft = { ...groupDraftFromRow(groupRow), nameEn: "", color: "orange", sortOrder: "12a" };
    const fields = validateGroupDraft(draft).map((error) => error.field);
    expect(fields).toContain("namePl");
    expect(fields).toContain("color");
    expect(fields).toContain("minTierRank");
  });

  it("pomija klucz i event_id przy edycji, a przy tworzeniu je dokłada", () => {
    const created = groupDraftToInput(
      { ...emptyGroupDraft(10), key: "student", namePl: "Student", nameEn: "Student" },
      "e-1",
    );
    expect(created.eventId).toBe("e-1");
    expect(created.key).toBe("student");
    expect(created.id).toBeUndefined();

    const edited = groupDraftToInput(groupDraftFromRow(groupRow), "e-1");
    expect(edited.id).toBe("g-1");
    expect(edited.eventId).toBeUndefined();
    expect(edited.key).toBeUndefined();
  });

  it("wyłączony wgląd w listę wymusza zasięg none - to warunek tabeli", () => {
    const draft = { ...groupDraftFromRow(groupRow), canSeeAttendees: false };
    expect(groupDraftToInput(draft, "e-1").attendeeVisibility).toBe("none");
  });

  it("puste pole koloru zapisuje null, nie pusty napis", () => {
    const draft = { ...groupDraftFromRow(groupRow), color: "  " };
    expect(groupDraftToInput(draft, "e-1").color).toBeNull();
  });
});

describe("termDraft", () => {
  it("wymaga etykiet w obu jezykach i pelnego adresu https", () => {
    const draft = { ...termDraftFromRow(termRow), labelEn: "", externalUrl: "example.com" };
    const fields = validateTermDraft(draft).map((error) => error.field);
    expect(fields).toEqual(["labelPl", "externalUrl"]);
  });

  it("nie wysyla bump_version przy tworzeniu", () => {
    const draft = { ...emptyTermDraft(10), key: "rodo", labelPl: "RODO", labelEn: "GDPR" };
    expect(termDraftToInput(draft, "e-1").bumpVersion).toBeUndefined();
  });

  it("wysyla bump_version tylko przy jawnym zadaniu edycji", () => {
    const base = termDraftFromRow(termRow);
    expect(base.bumpVersion).toBe(false);
    expect(termDraftToInput(base, "e-1").bumpVersion).toBe(false);
    expect(termDraftToInput({ ...base, bumpVersion: true }, "e-1").bumpVersion).toBe(true);
  });

  it("nieznane wartosci enumow wracaja do domyslnych", () => {
    const draft = termDraftFromRow({ ...termRow, display: "nonsense" });
    expect(draft.display).toBe("registration");
    const group = groupDraftFromRow({ ...groupRow, attendee_visibility: "nonsense" });
    expect(group.attendeeVisibility).toBe("registered");
  });

  it("liczy akceptacje nieaktualne i nigdy nie schodzi ponizej zera", () => {
    expect(staleAcceptances(termRow)).toBe(4);
    expect(staleAcceptances({ acceptances_total: 2, acceptances_current: 5 })).toBe(0);
  });
});
