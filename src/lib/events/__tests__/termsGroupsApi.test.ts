// Warstwa danych GRUP UCZESTNIKOW i REGULAMINOW - kontrakt z funkcjami bazy.
//
// PO CO TEN PLIK ISTNIEJE. Obie powierzchnie sa RPC-only i obie decyduja
// o UPRAWNIENIACH: grupa mowi, kto kogo widzi i kto moze sie z kim spotkac,
// regulamin jest DOWODEM zgody. Funkcje bazy czytaja `p_payload` PO NAZWIE
// i nie odrzucaja klucza, ktorego nie znaja - `is_defualt` zamiast `is_default`
// przechodzi przez `tsc`, przez przeglad i przez interfejs, a konczy sie grupa
// bez uprawnien, ktore organizator wlasnie jej nadal.
//
// CO TEN PLIK DOWODZI.
//   1. PARA „MOZE / NIE MOZE" NA KAZDYM ODCZYCIE I KAZDYM ZAPISIE. Redakcja
//      dostaje wiersze, a wolajacy bez roli dostaje `forbidden: editor role
//      required` z `assert_editor_tenant()`. Warstwa danych MUSI wtedy rzucic,
//      a nie oddac pusta liste: „nie ma zadnych grup" po odmowie to nieprawda
//      o stanie uprawnien, po ktorej ktos zaklada grupy drugi raz.
//   2. KLUCZ POMINIETY TO NIE JEST KLUCZ PUSTY. SQL czyta `p_payload ? 'color'`
//      (i tak samo `external_url`), wiec brak klucza znaczy „zostaw jak bylo",
//      a jawny `null` znaczy „wyczysc". Sklejenie obu odebraloby mozliwosc
//      zdjecia koloru grupy i odnosnika regulaminu.
//   3. KLUCZ TECHNICZNY JEST ZAMROZONY PO ZAPISIE. RPC edycji w ogole go nie
//      czyta, wiec wyslanie go bylo by obietnica zmiany, ktora nigdy nie
//      nastapi. Tu dowodzimy, ze warstwa danych GO NIE WYSYLA.
//   4. WERSJA REGULAMINU ROSNIE WYLACZNIE NA ZADANIE. `bump_version` unlewaznia
//      wszystkie dotychczasowe akceptacje jako aktualne - nie moze byc skutkiem
//      ubocznym poprawki literowki, wiec przy tworzeniu klucza nie ma wcale.
//   5. ZADEN WYSLANY KLUCZ NIE WYCHODZI POZA KONTRAKT funkcji bazy.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Regul szkicu (`termsGroupsDraft`) - maja
// wlasny plik. (2) Slownika odmow (`adminTermsErrors`). (3) Parytetu stalych
// z CHECK-ami bazy - `termsGroupsDbEnumParity.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

const api = await import("@/lib/events/termsGroupsApi");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_ID = "22222222-2222-4222-8222-222222222222";
const TERM_ID = "33333333-3333-4333-8333-333333333333";
const PERSON_ID = "44444444-4444-4444-8444-444444444444";

/** Odmowa `assert_editor_tenant()` - dokladnie ta, ktora oddaje baza. */
const ODMOWA_ROLI = "forbidden: editor role required";

/**
 * Klucze, ktore funkcje bazy REALNIE czytaja (stan migracji 20260824091615).
 * Klucz spoza tej listy jest po cichu ignorowany przez SQL, wiec bramka na
 * ksztalcie ladunku jest jedynym miejscem, gdzie literowke widac.
 */
const KONTRAKT: Record<string, readonly string[]> = {
  admin_event_group_upsert: [
    "attendee_visibility",
    "can_chat",
    "can_lead_retrieval",
    "can_meet",
    "can_see_attendees",
    "can_see_recording",
    "color",
    "description_en",
    "description_pl",
    "event_id",
    "id",
    "is_default",
    "key",
    "min_tier_rank",
    "name_en",
    "name_pl",
    "sort_order",
  ],
  admin_event_term_upsert: [
    "body_en",
    "body_pl",
    "bump_version",
    "display",
    "event_id",
    "external_url",
    "id",
    "is_active",
    "is_required",
    "key",
    "label_en",
    "label_pl",
    "sort_order",
  ],
  admin_event_group_member_set: ["group_id", "is_member", "person_id"],
};

/** Ladunek `p_payload` ostatniego wywolania danej funkcji. */
function payloadOf(name: string): Record<string, unknown> {
  const call = h.rpc?.lastCall(name);
  expect(call, `brak wywolania RPC ${name}`).toBeDefined();
  const payload = call?.arg("p_payload");
  expect(
    payload !== null && typeof payload === "object",
    `${name}: ladunek nie jest obiektem`,
  ).toBe(true);
  return payload as Record<string, unknown>;
}

/** Kompletny szkic grupy - tyle, ile panel wysyla przy tworzeniu. */
function groupInput(overrides: Partial<import("@/lib/events/termsGroupsApi").GroupInput> = {}) {
  return {
    eventId: EVENT_ID,
    key: "vip",
    namePl: "Goscie honorowi",
    nameEn: "VIP guests",
    descriptionPl: "",
    descriptionEn: "",
    color: "#FA9346",
    attendeeVisibility: "own_group" as const,
    canSeeAttendees: true,
    canMeet: true,
    canChat: false,
    canLeadRetrieval: false,
    canSeeRecording: true,
    minTierRank: 0,
    sortOrder: 10,
    isDefault: false,
    ...overrides,
  };
}

/** Kompletny szkic regulaminu. */
function termInput(overrides: Partial<import("@/lib/events/termsGroupsApi").TermInput> = {}) {
  return {
    eventId: EVENT_ID,
    key: "rodo",
    labelPl: "Zgoda na przetwarzanie danych",
    labelEn: "Data processing consent",
    bodyPl: "Tresc zgody.",
    bodyEn: "Consent body.",
    externalUrl: "https://example.org/regulamin",
    display: "registration" as const,
    isRequired: true,
    sortOrder: 10,
    isActive: true,
    ...overrides,
  };
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("odczyt grup - para „redakcja moze / bez roli nie moze”", () => {
  it("redakcja dostaje wiersze grup z funkcji listujacej", async () => {
    h.rpc?.setData("admin_event_groups_list", [{ id: GROUP_ID, key: "attendees" }]);
    const rows = await api.fetchEventGroups(EVENT_ID);
    expect(rows).toHaveLength(1);
    expect(h.rpc?.lastCall("admin_event_groups_list")?.arg("p_event_id")).toBe(EVENT_ID);
  });

  // ODMOWA NIE MOZE UDAWAC PUSTKI. Ekran grup rysuje wtedy „brak grup", a
  // organizator zaklada je od nowa - w wydarzeniu, ktore ma juz komplet.
  it("wolajacy bez roli redakcyjnej dostaje WYJATEK, nie pusta liste", async () => {
    h.rpc?.setError("admin_event_groups_list", ODMOWA_ROLI);
    await expect(api.fetchEventGroups(EVENT_ID)).rejects.toThrow(ODMOWA_ROLI);
  });

  // BRAK WIERSZY TO CO INNEGO NIZ BRAK DOSTEPU: wydarzenie bez grup jest
  // legalnym stanem i ma sie czytac jako pusta lista.
  it("brak wierszy przy udanym odczycie to pusta lista", async () => {
    h.rpc?.setData("admin_event_groups_list", null);
    await expect(api.fetchEventGroups(EVENT_ID)).resolves.toEqual([]);
  });
});

describe("odczyt regulaminow - ta sama para", () => {
  it("redakcja dostaje wiersze regulaminow", async () => {
    h.rpc?.setData("admin_event_terms_list", [{ id: TERM_ID, key: "rodo", version: 3 }]);
    const rows = await api.fetchEventTerms(EVENT_ID);
    expect(rows).toHaveLength(1);
    expect(h.rpc?.lastCall("admin_event_terms_list")?.arg("p_event_id")).toBe(EVENT_ID);
  });

  it("wolajacy bez roli redakcyjnej dostaje WYJATEK, nie pusta liste", async () => {
    h.rpc?.setError("admin_event_terms_list", ODMOWA_ROLI);
    await expect(api.fetchEventTerms(EVENT_ID)).rejects.toThrow(ODMOWA_ROLI);
  });

  it("brak wierszy przy udanym odczycie to pusta lista", async () => {
    h.rpc?.setData("admin_event_terms_list", null);
    await expect(api.fetchEventTerms(EVENT_ID)).resolves.toEqual([]);
  });
});

describe("zapis grupy - ksztalt ladunku", () => {
  beforeEach(() => {
    h.rpc?.setData("admin_event_group_upsert", GROUP_ID);
  });

  it("nowa grupa niesie wydarzenie, klucz i komplet uprawnien", async () => {
    await api.saveEventGroup(groupInput());
    expect(payloadOf("admin_event_group_upsert")).toEqual({
      event_id: EVENT_ID,
      key: "vip",
      name_pl: "Goscie honorowi",
      name_en: "VIP guests",
      description_pl: "",
      description_en: "",
      color: "#FA9346",
      attendee_visibility: "own_group",
      can_see_attendees: true,
      can_meet: true,
      can_chat: false,
      can_lead_retrieval: false,
      can_see_recording: true,
      min_tier_rank: 0,
      sort_order: 10,
      is_default: false,
    });
  });

  // UPRAWNIENIE WYLACZONE MUSI POJECHAC JAKO `false`, a nie zniknac z ladunku:
  // SQL czyta `COALESCE((p_payload->>'can_meet')::boolean, g.can_meet)`, wiec
  // pominiety klucz ZOSTAWIA stare uprawnienie. Zdjecie prawa do spotkan
  // wygladaloby na ekranie na udane i nie zmienialoby niczego w bazie.
  it("wylaczone uprawnienie jedzie jako `false`, a nie jako brak klucza", async () => {
    await api.saveEventGroup(
      groupInput({ canMeet: false, canChat: false, canSeeRecording: false }),
    );
    const payload = payloadOf("admin_event_group_upsert");
    expect(payload.can_meet).toBe(false);
    expect(payload.can_chat).toBe(false);
    expect(payload.can_see_recording).toBe(false);
  });

  // EDYCJA NIE RUSZA KLUCZA. RPC edycji w ogole go nie czyta - wyslanie go
  // obiecywalo by zmiane identyfikatora, ktora nigdy sie nie stanie.
  it("edycja wysyla identyfikator i NIE wysyla klucza ani wydarzenia", async () => {
    await api.saveEventGroup(groupInput({ id: GROUP_ID, eventId: undefined, key: undefined }));
    const payload = payloadOf("admin_event_group_upsert");
    expect(payload.id).toBe(GROUP_ID);
    expect("key" in payload).toBe(false);
    expect("event_id" in payload).toBe(false);
  });

  // KOLOR: `null` KASUJE, brak klucza ZOSTAWIA. SQL rozroznia te dwa przypadki
  // wprost (`WHEN p_payload ? 'color'`), wiec warstwa danych nie moze ich zlac.
  it("jawny `null` koloru zostaje w ladunku (kasuje kolor)", async () => {
    await api.saveEventGroup(groupInput({ color: null }));
    const payload = payloadOf("admin_event_group_upsert");
    expect("color" in payload).toBe(true);
    expect(payload.color).toBeNull();
  });

  it("pominiety kolor NIE wchodzi do ladunku (zostawia kolor bez zmian)", async () => {
    await api.saveEventGroup(groupInput({ color: undefined }));
    expect("color" in payloadOf("admin_event_group_upsert")).toBe(false);
  });

  // GRUPA DOMYSLNA NIE DA SIE ZDUPLIKOWAC. Klient wysyla JEDNO zadanie
  // z `is_default: true`; odebranie flagi poprzedniej grupie robi ta sama
  // funkcja bazy w jednej operacji (i pilnuje tego unikalny indeks
  // `event_groups_default_uniq`). Drugie zadanie z klienta byloby wyscigiem,
  // po ktorym wydarzenie moze zostac z zerem albo dwiema grupami domyslnymi.
  it("ustawienie grupy domyslnej to JEDNO zadanie z `is_default: true`", async () => {
    await api.saveEventGroup(groupInput({ id: GROUP_ID, isDefault: true }));
    expect(h.rpc?.callsFor("admin_event_group_upsert")).toHaveLength(1);
    expect(payloadOf("admin_event_group_upsert").is_default).toBe(true);
  });

  it("zapis oddaje identyfikator grupy jako napis", async () => {
    await expect(api.saveEventGroup(groupInput())).resolves.toBe(GROUP_ID);
  });

  it("odmowa bazy przy zapisie grupy leci dalej jako wyjatek", async () => {
    h.rpc?.setError(
      "admin_event_group_upsert",
      "invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$",
    );
    await expect(api.saveEventGroup(groupInput({ key: "VIP!" }))).rejects.toThrow("invalid_key");
  });

  it("zaden wyslany klucz nie wychodzi poza kontrakt funkcji bazy", async () => {
    await api.saveEventGroup(groupInput({ id: GROUP_ID }));
    const known = new Set(KONTRAKT.admin_event_group_upsert);
    expect(Object.keys(payloadOf("admin_event_group_upsert")).filter((k) => !known.has(k))).toEqual(
      [],
    );
  });
});

describe("usuniecie grupy - para „zwykla mozna / systemowej nie”", () => {
  it("zwykla grupa bez uzyc daje potwierdzenie usuniecia", async () => {
    h.rpc?.setData("admin_event_group_delete", true);
    await expect(api.deleteEventGroup(GROUP_ID)).resolves.toBe(true);
    expect(h.rpc?.lastCall("admin_event_group_delete")?.arg("_id")).toBe(GROUP_ID);
  });

  // GRUPA SYSTEMOWA JEST NIEUSUWALNA W BAZIE - skasowana zabralaby etykiete
  // z archiwum zapisow. Warstwa danych ma te odmowe PRZEPUSCIC, zeby ekran
  // pokazal powod, a nie ciche „udalo sie".
  it("grupa systemowa konczy sie odmowa `group_system`, nie cichym `false`", async () => {
    h.rpc?.setError("admin_event_group_delete", "group_system: system groups cannot be deleted");
    await expect(api.deleteEventGroup(GROUP_ID)).rejects.toThrow("group_system");
  });

  it("grupa uzywana przez zapisy konczy sie odmowa `group_in_use`", async () => {
    h.rpc?.setError(
      "admin_event_group_delete",
      "group_in_use: 12 registration(s), ticket(s) or membership(s) use this group",
    );
    await expect(api.deleteEventGroup(GROUP_ID)).rejects.toThrow("group_in_use");
  });

  // ODPOWIEDZ INNA NIZ `true` TO NIE JEST SUKCES. Funkcja bazy zwraca `true`
  // tylko po faktycznym skasowaniu wiersza.
  it("odpowiedz inna niz `true` nie jest potwierdzeniem", async () => {
    h.rpc?.setData("admin_event_group_delete", null);
    await expect(api.deleteEventGroup(GROUP_ID)).resolves.toBe(false);
  });
});

describe("czlonkostwo dodatkowe - para „dodaj / odejmij”", () => {
  beforeEach(() => {
    h.rpc?.setData("admin_event_group_member_set", true);
  });

  it("dodanie do grupy niesie grupe, osobe i `is_member: true`", async () => {
    await api.setEventGroupMember({ groupId: GROUP_ID, personId: PERSON_ID, isMember: true });
    expect(payloadOf("admin_event_group_member_set")).toEqual({
      group_id: GROUP_ID,
      person_id: PERSON_ID,
      is_member: true,
    });
  });

  // ODJECIE TO TA SAMA FUNKCJA Z `false`. Gdyby `false` wypadalo z ladunku,
  // SQL przyjmowalby domyslne `true` (`COALESCE(..., true)`) i „odejmij"
  // DODAWALOBY uprawnienia zamiast je zabierac.
  it("odjecie z grupy niesie `is_member: false`, a nie brak klucza", async () => {
    await api.setEventGroupMember({ groupId: GROUP_ID, personId: PERSON_ID, isMember: false });
    const payload = payloadOf("admin_event_group_member_set");
    expect("is_member" in payload).toBe(true);
    expect(payload.is_member).toBe(false);
  });

  it("odmowa roli przy zmianie czlonkostwa leci dalej jako wyjatek", async () => {
    h.rpc?.setError("admin_event_group_member_set", ODMOWA_ROLI);
    await expect(
      api.setEventGroupMember({ groupId: GROUP_ID, personId: PERSON_ID, isMember: true }),
    ).rejects.toThrow(ODMOWA_ROLI);
  });

  it("zaden wyslany klucz nie wychodzi poza kontrakt funkcji bazy", async () => {
    await api.setEventGroupMember({ groupId: GROUP_ID, personId: PERSON_ID, isMember: true });
    const known = new Set(KONTRAKT.admin_event_group_member_set);
    expect(
      Object.keys(payloadOf("admin_event_group_member_set")).filter((k) => !known.has(k)),
    ).toEqual([]);
  });
});

describe("zapis regulaminu - wersja, wymagalnosc i miejsce wyswietlenia", () => {
  beforeEach(() => {
    h.rpc?.setData("admin_event_term_upsert", TERM_ID);
  });

  it("nowy regulamin niesie komplet pol kontraktu", async () => {
    await api.saveEventTerm(termInput());
    expect(payloadOf("admin_event_term_upsert")).toEqual({
      event_id: EVENT_ID,
      key: "rodo",
      label_pl: "Zgoda na przetwarzanie danych",
      label_en: "Data processing consent",
      body_pl: "Tresc zgody.",
      body_en: "Consent body.",
      external_url: "https://example.org/regulamin",
      display: "registration",
      is_required: true,
      sort_order: 10,
      is_active: true,
    });
  });

  // WERSJA JEST DOWODEM. Podniesienie uniewaznia WSZYSTKIE dotychczasowe
  // akceptacje jako aktualne, wiec `bump_version` nie moze byc skutkiem
  // ubocznym poprawki literowki: przy tworzeniu klucza nie ma wcale, a przy
  // edycji jedzie DOKLADNIE ta wartosc, ktora ustawil redaktor.
  it("nowy regulamin NIE niesie `bump_version` (wersja startowa to 1)", async () => {
    await api.saveEventTerm(termInput({ bumpVersion: undefined }));
    expect("bump_version" in payloadOf("admin_event_term_upsert")).toBe(false);
  });

  it("edycja bez podniesienia wersji wysyla `bump_version: false`", async () => {
    await api.saveEventTerm(termInput({ id: TERM_ID, key: undefined, bumpVersion: false }));
    expect(payloadOf("admin_event_term_upsert").bump_version).toBe(false);
  });

  it("edycja z podniesieniem wersji wysyla `bump_version: true`", async () => {
    await api.saveEventTerm(termInput({ id: TERM_ID, key: undefined, bumpVersion: true }));
    expect(payloadOf("admin_event_term_upsert").bump_version).toBe(true);
  });

  // REGULAMIN WYMAGANY I OPCJONALNY TO DWA ROZNE ZOBOWIAZANIA. `false` musi
  // dojechac jawnie, inaczej SQL zostawia poprzednia wymagalnosc i „zdjecie
  // obowiazku" nie dzieje sie wcale.
  it("wymagany i opcjonalny jada jako jawne `true`/`false`", async () => {
    await api.saveEventTerm(termInput({ id: TERM_ID, key: undefined, isRequired: true }));
    expect(payloadOf("admin_event_term_upsert").is_required).toBe(true);
    await api.saveEventTerm(termInput({ id: TERM_ID, key: undefined, isRequired: false }));
    expect(payloadOf("admin_event_term_upsert").is_required).toBe(false);
  });

  it.each(["registration", "access", "registration_and_access"] as const)(
    "miejsce wyswietlenia `%s` jedzie do bazy bez zmian",
    async (display) => {
      await api.saveEventTerm(termInput({ display }));
      expect(payloadOf("admin_event_term_upsert").display).toBe(display);
    },
  );

  // ODNOSNIK ZEWNETRZNY: `null` KASUJE, brak klucza ZOSTAWIA - dokladnie ta
  // sama mechanika co kolor grupy (`WHEN p_payload ? 'external_url'`).
  it("jawny `null` odnosnika zostaje w ladunku, a pominiety znika", async () => {
    await api.saveEventTerm(termInput({ id: TERM_ID, key: undefined, externalUrl: null }));
    expect(payloadOf("admin_event_term_upsert").external_url).toBeNull();
    await api.saveEventTerm(termInput({ id: TERM_ID, key: undefined, externalUrl: undefined }));
    expect("external_url" in payloadOf("admin_event_term_upsert")).toBe(false);
  });

  it("edycja nie wysyla klucza technicznego ani wydarzenia", async () => {
    await api.saveEventTerm(termInput({ id: TERM_ID, eventId: undefined, key: undefined }));
    const payload = payloadOf("admin_event_term_upsert");
    expect(payload.id).toBe(TERM_ID);
    expect("key" in payload).toBe(false);
    expect("event_id" in payload).toBe(false);
  });

  it("zapis oddaje identyfikator regulaminu jako napis", async () => {
    await expect(api.saveEventTerm(termInput())).resolves.toBe(TERM_ID);
  });

  it("odmowa roli przy zapisie regulaminu leci dalej jako wyjatek", async () => {
    h.rpc?.setError("admin_event_term_upsert", ODMOWA_ROLI);
    await expect(api.saveEventTerm(termInput())).rejects.toThrow(ODMOWA_ROLI);
  });

  it("zaden wyslany klucz nie wychodzi poza kontrakt funkcji bazy", async () => {
    await api.saveEventTerm(termInput({ id: TERM_ID, bumpVersion: true }));
    const known = new Set(KONTRAKT.admin_event_term_upsert);
    expect(Object.keys(payloadOf("admin_event_term_upsert")).filter((k) => !known.has(k))).toEqual(
      [],
    );
  });
});

describe("usuniecie regulaminu - para „bez akceptacji mozna / z akceptacjami nie”", () => {
  it("regulamin bez akceptacji daje potwierdzenie usuniecia", async () => {
    h.rpc?.setData("admin_event_term_delete", true);
    await expect(api.deleteEventTerm(TERM_ID)).resolves.toBe(true);
    expect(h.rpc?.lastCall("admin_event_term_delete")?.arg("_id")).toBe(TERM_ID);
  });

  // AKCEPTACJA JEST DOWODEM, a dowodu sie nie kasuje. Baza odmawia
  // `term_in_use` i podaje LICZBE akceptacji - odmowa musi dojsc do ekranu
  // razem z ta liczba, bo to ona tlumaczy, dlaczego usuniecie nie przejdzie.
  it("regulamin z akceptacjami konczy sie odmowa `term_in_use`", async () => {
    h.rpc?.setError(
      "admin_event_term_delete",
      "term_in_use: 41 acceptance(s) recorded - deactivate instead",
    );
    await expect(api.deleteEventTerm(TERM_ID)).rejects.toThrow(
      "term_in_use: 41 acceptance(s) recorded - deactivate instead",
    );
  });

  it("odpowiedz inna niz `true` nie jest potwierdzeniem", async () => {
    h.rpc?.setData("admin_event_term_delete", false);
    await expect(api.deleteEventTerm(TERM_ID)).resolves.toBe(false);
  });
});
