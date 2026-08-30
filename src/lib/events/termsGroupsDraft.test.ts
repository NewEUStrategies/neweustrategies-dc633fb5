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

// PUSTE POLE LICZBOWE TO NIE TO SAMO, CO POLE ZEPSUTE.
//
// `intOrNull` rozroznia TRZY stany: pustka (`null`), tekst niebedacy liczba
// calkowita (`false`) i liczba. Formularz grupy i formularz zgody czytaja to
// rozroznienie inaczej niz ekran: pustka MA przejsc (wtedy jedzie wartosc
// domyslna z tabeli), a smiec MA zatrzymac zapis nazwanym bledem. Bez tej pary
// „pusta kolejnosc" i „kolejnosc wpisana slowem" trafialyby w te sama galaz.
describe("liczby w szkicu - para „pustka przechodzi / smiec zatrzymuje”", () => {
  it("pusta kolejnosc i pusta ranga NIE zatrzymuja zapisu grupy", () => {
    const draft = {
      ...emptyGroupDraft(10),
      key: "vip",
      namePl: "VIP",
      nameEn: "VIP",
      minTierRank: "",
      sortOrder: "",
    };
    expect(validateGroupDraft(draft)).toEqual([]);
  });

  it("pusta kolejnosc jedzie do ladunku jako wartosc domyslna tabeli", () => {
    const draft = {
      ...emptyGroupDraft(10),
      key: "vip",
      namePl: "VIP",
      nameEn: "VIP",
      minTierRank: "",
      sortOrder: "",
    };
    const input = groupDraftToInput(draft, "e-1");
    expect(input.minTierRank).toBe(0);
    expect(input.sortOrder).toBe(100);
  });

  it("kolejnosc wpisana slowem ZATRZYMUJE zapis grupy", () => {
    const draft = {
      ...emptyGroupDraft(10),
      key: "vip",
      namePl: "VIP",
      nameEn: "VIP",
      sortOrder: "pierwsza",
    };
    expect(validateGroupDraft(draft).map((error) => error.field)).toContain("minTierRank");
  });

  it("liczba ujemna nie jest liczba calkowita nieujemna - zapis stoi", () => {
    const draft = {
      ...emptyGroupDraft(10),
      key: "vip",
      namePl: "VIP",
      nameEn: "VIP",
      minTierRank: "-1",
    };
    expect(validateGroupDraft(draft).map((error) => error.field)).toContain("minTierRank");
  });

  it("pusta kolejnosc zgody przechodzi, a wpisana slowem zatrzymuje zapis", () => {
    const dobry = {
      ...emptyTermDraft(10),
      key: "rodo",
      labelPl: "Zgoda",
      labelEn: "Consent",
      sortOrder: "",
    };
    expect(validateTermDraft(dobry)).toEqual([]);
    expect(termDraftToInput(dobry, "e-1").sortOrder).toBe(100);

    const zly = { ...dobry, sortOrder: "druga" };
    expect(validateTermDraft(zly).map((error) => error.field)).toContain("sortOrder");
  });
});

// WIERSZ Z BAZY MOZE PRZYJSC Z KOLUMNA, KTOREJ NIE DA SIE ZAMIENIC NA LICZBE
// (starszy wiersz, kolumna dodana pozniej, `NULL` w miejscu liczby). Szkic ma
// wtedy wziac wartosc domyslna, a nie wpisac do pola napis „NaN" - inaczej
// otwarcie formularza po to, zeby zmienic JEDEN przelacznik, konczy sie
// odmowa zapisu na polu, ktorego nikt nie dotykal.
describe("wiersz z nieliczbowa kolumna - szkic bierze wartosc domyslna", () => {
  it("grupa bez rangi i bez kolejnosci dostaje zero i setke, a nie `NaN`", () => {
    const draft = groupDraftFromRow({
      ...groupRow,
      min_tier_rank: undefined,
      sort_order: undefined,
    });
    expect(draft.minTierRank).toBe("0");
    expect(draft.sortOrder).toBe("100");
  });

  it("kolejnosc podana napisem liczbowym jest czytana jako liczba", () => {
    expect(groupDraftFromRow({ ...groupRow, sort_order: "40" }).sortOrder).toBe("40");
  });

  it("zgoda bez numeru wersji dostaje wersje pierwsza, a nie `NaN`", () => {
    const draft = termDraftFromRow({ ...termRow, version: undefined, sort_order: "nie-liczba" });
    expect(draft.version).toBe(1);
    expect(draft.sortOrder).toBe("100");
  });
});
