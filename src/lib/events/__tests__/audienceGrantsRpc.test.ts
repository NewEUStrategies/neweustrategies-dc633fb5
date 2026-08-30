// Warstwa danych NADAN UPRAWNIEN DO STAWEK - kontrakt z funkcjami bazy.
//
// PO CO TEN PLIK ISTNIEJE. `audienceGrantsApi.test.ts` sprawdza funkcje CZYSTE
// (stan wiersza, mapowanie akcji audytu, tekst wartosci diffu). Nie dotyka
// jednak tego, co ta warstwa robi z siecia - a to wlasnie tam mieszkaja bledy,
// ktore zmieniaja CENE i tresc dziennika audytu:
//
//   1. ZAWEZENIE, KTORE NIE JEDZIE DO BAZY, NIE ZAWEZA NICZEGO. Filtry listy
//      sa opcjonalne po stronie SQL-a (`NULLIF(...)` + `IS NULL OR ...`), wiec
//      klucz zgubiony po drodze nie konczy sie bledem - konczy sie lista
//      SZERSZA, niz obiecuje ekran. „Tylko akademickie" pokazywaloby wtedy
//      wszystkie nadania najemcy.
//   2. ZAWEZENIE WYSLANE ZA SZEROKO ODCINA WIERSZE, KTORE MIALY BYC WIDOCZNE.
//      `audience: "all"` wyslane doslownie nie pasuje do zadnej wartosci
//      CHECK-a i oddaje pustke wygladajaca jak „nikt nie ma ulgi".
//   3. ODMOWA, KTORA NIE JEST ODMOWA. Odczyt konczacy sie pusta lista zamiast
//      wyjatku to nieprawda o stanie uprawnien - administrator nadaje wtedy
//      ulge drugi raz, a ksiega ma po tym dwa wpisy dla jednej osoby.
//   4. PUSTA HISTORIA TO „PUSTO", A NIE „NIE UDALO SIE". Nadanie, ktorego
//      jeszcze nikt nie zmienial, ma zero wpisow w dzienniku - i to jest
//      poprawna odpowiedz, a nie awaria.
//
// PARA „MOZE / NIE MOZE" NA KAZDYM WEJSCIU. Obie funkcje czytajace stoja za
// `assert_editor_tenant()`, ktory od `20260824090000` deleguje do
// `assert_event_admin_tenant()` - wiec wolajacy bez roli ADMINISTRACYJNEJ
// (redaktor rowniez) dostaje `forbidden: admin role required`. Kazdy odczyt
// jest tu sprawdzony z obu stron: co dostaje administracja i co dostaje ktos
// bez tej roli.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Funkcji czystych - maja wlasne pliki
// (`audienceGrantsApi.test.ts`, `audienceGrantHistory.test.ts`). (2) Parytetu
// stalych z baza - `termsGroupsDbEnumParity.test.ts`. (3) Ekranu historii -
// `EventAudienceGrantHistoryPanel.test.tsx`.
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

const api = await import("@/lib/events/audienceGrantsApi");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const GRANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const PERSON_ID = "44444444-4444-4444-8444-444444444444";
const COMPANY_ID = "55555555-5555-4555-8555-555555555555";

/**
 * Odmowa, ktora te funkcje REALNIE oddaja.
 *
 * Wszystkie stoja za `assert_editor_tenant()`, ale ta oslona od migracji
 * `20260824090000` jest CIENKIM ALIASEM - jej cale cialo to
 * `SELECT public.assert_event_admin_tenant()`. Redaktora wiec ODRZUCA, a tekst
 * odmowy pochodzi z wersji administracyjnej: `forbidden: admin role required`
 * (dowod wykonawczy: `runtime_test.d/80_admin_only.sql`, punkty 4 i 5 -
 * redaktor dostaje ta odmowe z aliasu I z wersji administracyjnej, a
 * administrator przechodzi). Napis `editor role required` jest kopalina sprzed
 * tamtej migracji i zadna funkcja tego podmodulu juz go nie podnosi; pilnuje
 * tego bramka `termsGroupsAdminOnlyGate.test.ts`.
 */
const ODMOWA_ROLI = "forbidden: admin role required";

/** Klucze czytane przez funkcje bazy (stan migracji 20260828162131). */
const KONTRAKT: Record<string, readonly string[]> = {
  admin_event_audience_grants_list: ["audience", "event_id", "include_revoked", "search"],
  admin_event_audience_grant_save: [
    "audience",
    "company_id",
    "event_id",
    "evidence",
    "person_id",
    "user_id",
    "valid_until",
  ],
  admin_event_audience_grant_history: ["event_id", "grant_id", "limit", "search"],
};

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

function grantsQuery(
  overrides: Partial<import("@/lib/events/audienceGrantsApi").AudienceGrantsQuery> = {},
): import("@/lib/events/audienceGrantsApi").AudienceGrantsQuery {
  return { eventId: EVENT_ID, audience: "all", includeRevoked: false, search: "", ...overrides };
}

function historyQuery(
  overrides: Partial<import("@/lib/events/audienceGrantsApi").AudienceGrantHistoryQuery> = {},
): import("@/lib/events/audienceGrantsApi").AudienceGrantHistoryQuery {
  return { eventId: EVENT_ID, grantId: null, search: "", limit: 50, ...overrides };
}

function grantInput(
  overrides: Partial<import("@/lib/events/audienceGrantsApi").AudienceGrantInput> = {},
): import("@/lib/events/audienceGrantsApi").AudienceGrantInput {
  return {
    audience: "academic",
    userId: USER_ID,
    personId: null,
    companyId: null,
    eventId: EVENT_ID,
    evidence: "Legitymacja studencka 2026",
    validUntil: null,
    ...overrides,
  };
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("lista nadan - para „redakcja moze / bez roli nie moze”", () => {
  it("redakcja dostaje wiersze nadan", async () => {
    h.rpc?.setData("admin_event_audience_grants_list", [{ id: GRANT_ID, state: "active" }]);
    await expect(api.fetchAudienceGrants(grantsQuery())).resolves.toHaveLength(1);
  });

  // ODMOWA NIE MOZE UDAWAC PUSTKI. To jest najdrozsza pomylka tego ekranu:
  // „nikt nie ma ulgi" po nieudanym zapytaniu prowadzi do drugiego nadania
  // dla tej samej osoby - i do dwoch wpisow w ksiedze.
  it("wolajacy bez roli redakcyjnej dostaje WYJATEK, nie pusta liste", async () => {
    h.rpc?.setError("admin_event_audience_grants_list", ODMOWA_ROLI);
    await expect(api.fetchAudienceGrants(grantsQuery())).rejects.toThrow(ODMOWA_ROLI);
  });

  it("brak wierszy przy udanym odczycie to pusta lista", async () => {
    h.rpc?.setData("admin_event_audience_grants_list", null);
    await expect(api.fetchAudienceGrants(grantsQuery())).resolves.toEqual([]);
  });
});

describe("lista nadan - ksztalt zawezenia", () => {
  beforeEach(() => {
    h.rpc?.setData("admin_event_audience_grants_list", []);
  });

  it("zawezenie do wydarzenia niesie jego identyfikator", async () => {
    await api.fetchAudienceGrants(grantsQuery());
    expect(payloadOf("admin_event_audience_grants_list").event_id).toBe(EVENT_ID);
  });

  // ZAKRES „CALY NAJEMCA" TO BRAK KLUCZA, a nie `null`. SQL czyta
  // `NULLIF(p_payload->>'event_id','')::uuid` i porownuje `IS NULL OR ...`,
  // wiec pominiety klucz znaczy „nie zawezaj" - dokladnie ten zamiar.
  it("zakres calego najemcy NIE wysyla klucza wydarzenia", async () => {
    await api.fetchAudienceGrants(grantsQuery({ eventId: null }));
    expect("event_id" in payloadOf("admin_event_audience_grants_list")).toBe(false);
  });

  it.each(["academic", "ngo", "company"] as const)(
    "grupa odbiorcow `%s` jedzie w zawezeniu",
    async (audience) => {
      await api.fetchAudienceGrants(grantsQuery({ audience }));
      expect(payloadOf("admin_event_audience_grants_list").audience).toBe(audience);
    },
  );

  // „WSZYSTKIE GRUPY" NIE JEST GRUPA. Wyslane doslownie `all` nie pasuje do
  // zadnej wartosci CHECK-a i oddaje pustke, ktora czyta sie jak „nikt nie ma
  // ulgi" - najgorsza mozliwa pomylka na ekranie uprawnien.
  it("„wszystkie grupy” NIE wysyla klucza grupy", async () => {
    await api.fetchAudienceGrants(grantsQuery({ audience: "all" }));
    expect("audience" in payloadOf("admin_event_audience_grants_list")).toBe(false);
  });

  // WYCOFANE POKAZUJEMY NA ZADANIE. Klucz jedzie ZAWSZE, takze jako `false`:
  // domyslna wartosc po stronie SQL-a tez jest `false`, ale poleganie na niej
  // znaczyloby, ze zmiana domyslnej w bazie po cichu zmienia widok panelu.
  it("znacznik „pokaz wycofane” jedzie zawsze - i jako `true`, i jako `false`", async () => {
    await api.fetchAudienceGrants(grantsQuery({ includeRevoked: false }));
    expect(payloadOf("admin_event_audience_grants_list").include_revoked).toBe(false);
    await api.fetchAudienceGrants(grantsQuery({ includeRevoked: true }));
    expect(payloadOf("admin_event_audience_grants_list").include_revoked).toBe(true);
  });

  it("fraza jedzie przycieta z bialych znakow", async () => {
    await api.fetchAudienceGrants(grantsQuery({ search: "  Kowalska  " }));
    expect(payloadOf("admin_event_audience_grants_list").search).toBe("Kowalska");
  });

  // FRAZA Z SAMYCH SPACJI TO BRAK FRAZY. Wyslana doslownie zawezalaby liste
  // do wierszy zawierajacych spacje, czyli praktycznie do przypadkowych.
  it("fraza pusta i fraza z samych spacji NIE wchodza do zawezenia", async () => {
    await api.fetchAudienceGrants(grantsQuery({ search: "" }));
    expect("search" in payloadOf("admin_event_audience_grants_list")).toBe(false);
    await api.fetchAudienceGrants(grantsQuery({ search: "   " }));
    expect("search" in payloadOf("admin_event_audience_grants_list")).toBe(false);
  });

  it("zaden wyslany klucz nie wychodzi poza kontrakt funkcji bazy", async () => {
    await api.fetchAudienceGrants(
      grantsQuery({ audience: "ngo", includeRevoked: true, search: "x" }),
    );
    const known = new Set(KONTRAKT.admin_event_audience_grants_list);
    expect(
      Object.keys(payloadOf("admin_event_audience_grants_list")).filter((k) => !known.has(k)),
    ).toEqual([]);
  });
});

describe("nadanie uprawnienia - ksztalt ladunku", () => {
  beforeEach(() => {
    h.rpc?.setData("admin_event_audience_grant_save", GRANT_ID);
  });

  // PODMIOT JEST DOKLADNIE JEDEN. Baza ma na to CHECK
  // (`(user_id IS NOT NULL) <> (person_id IS NOT NULL)`), wiec pozostale
  // kolumny musza pojechac jako jawny `null` - pominiete zostawilyby
  // rozstrzygniecie domyslnym wartosciom SQL-a.
  it("nadanie dla konta niesie komplet pol z JEDNYM wypelnionym podmiotem", async () => {
    await api.saveAudienceGrant(grantInput());
    expect(payloadOf("admin_event_audience_grant_save")).toEqual({
      audience: "academic",
      user_id: USER_ID,
      person_id: null,
      company_id: null,
      event_id: EVENT_ID,
      evidence: "Legitymacja studencka 2026",
      valid_until: null,
    });
  });

  it("nadanie dla osoby z kartoteki wypelnia pole osoby, a konto zostaje puste", async () => {
    await api.saveAudienceGrant(grantInput({ userId: null, personId: PERSON_ID }));
    const payload = payloadOf("admin_event_audience_grant_save");
    expect(payload.user_id).toBeNull();
    expect(payload.person_id).toBe(PERSON_ID);
  });

  it("nadanie firmowe niesie identyfikator firmy", async () => {
    await api.saveAudienceGrant(
      grantInput({ audience: "company", userId: null, personId: PERSON_ID, companyId: COMPANY_ID }),
    );
    expect(payloadOf("admin_event_audience_grant_save").company_id).toBe(COMPANY_ID);
  });

  // PODSTAWA JEST OBOWIAZKOWA PO STRONIE BAZY (`invalid_evidence`). Warstwa
  // danych przycina biale znaki, zeby „   " nie przechodzilo jako uzasadnienie
  // rozliczeniowe - to jest DOKUMENT, nie pole opisowe.
  it("podstawa jedzie przycieta z bialych znakow", async () => {
    await api.saveAudienceGrant(grantInput({ evidence: "  KRS 0000123456  " }));
    expect(payloadOf("admin_event_audience_grant_save").evidence).toBe("KRS 0000123456");
  });

  // NADANIE NA WSZYSTKIE WYDARZENIA TO INNE UPRAWNIENIE niz ulga na jeden
  // kongres - i tylko puste `event_id` odroznia je w bazie.
  it("nadanie bez wydarzenia niesie jawny `null`, a nie brak klucza", async () => {
    await api.saveAudienceGrant(grantInput({ eventId: null }));
    const payload = payloadOf("admin_event_audience_grant_save");
    expect("event_id" in payload).toBe(true);
    expect(payload.event_id).toBeNull();
  });

  it("zapis oddaje identyfikator nadania jako napis", async () => {
    await expect(api.saveAudienceGrant(grantInput())).resolves.toBe(GRANT_ID);
  });

  it("odmowa bazy przy nadaniu leci dalej jako wyjatek", async () => {
    h.rpc?.setError(
      "admin_event_audience_grant_save",
      "invalid_subject: give exactly one of user_id or person_id",
    );
    await expect(api.saveAudienceGrant(grantInput({ personId: PERSON_ID }))).rejects.toThrow(
      "invalid_subject",
    );
  });

  it("zaden wyslany klucz nie wychodzi poza kontrakt funkcji bazy", async () => {
    await api.saveAudienceGrant(grantInput({ validUntil: "2027-06-30T00:00:00.000Z" }));
    const known = new Set(KONTRAKT.admin_event_audience_grant_save);
    expect(
      Object.keys(payloadOf("admin_event_audience_grant_save")).filter((k) => !known.has(k)),
    ).toEqual([]);
  });
});

describe("wycofanie nadania - para „redakcja moze / bez roli nie moze”", () => {
  it("wycofanie idzie z identyfikatorem nadania i potwierdza sie", async () => {
    h.rpc?.setData("admin_event_audience_grant_revoke", null);
    await expect(api.revokeAudienceGrant(GRANT_ID)).resolves.toBe(true);
    expect(h.rpc?.lastCall("admin_event_audience_grant_revoke")?.arg("p_id")).toBe(GRANT_ID);
  });

  it("odmowa roli przy wycofaniu leci dalej jako wyjatek", async () => {
    h.rpc?.setError("admin_event_audience_grant_revoke", ODMOWA_ROLI);
    await expect(api.revokeAudienceGrant(GRANT_ID)).rejects.toThrow(ODMOWA_ROLI);
  });

  // NADANIE JUZ WYCOFANE NIE DA SIE WYCOFAC PONOWNIE - baza odpowiada
  // `not_found`, a ekran ma o tym powiedziec zamiast udawac sukces.
  it("nadanie juz wycofane konczy sie odmowa `not_found`", async () => {
    h.rpc?.setError(
      "admin_event_audience_grant_revoke",
      "not_found: grant does not exist in this tenant or is already revoked",
    );
    await expect(api.revokeAudienceGrant(GRANT_ID)).rejects.toThrow("not_found");
  });
});

describe("dziennik zmian - pusta historia to „pusto”, nie „nie udalo sie”", () => {
  // NADANIE, KTOREGO NIKT JESZCZE NIE ZMIENIAL, MA ZERO WPISOW. To jest
  // poprawna odpowiedz bazy, a nie awaria - i warstwa danych ma ja oddac jako
  // pusta tablice, zeby ekran narysowal „brak wpisow", a nie odmowe.
  it("brak wpisow to pusta lista, a nie wyjatek", async () => {
    h.rpc?.setData("admin_event_audience_grant_history", []);
    await expect(api.fetchAudienceGrantHistory(historyQuery())).resolves.toEqual([]);
  });

  it("odpowiedz `null` tez czyta sie jako pusta lista", async () => {
    h.rpc?.setData("admin_event_audience_grant_history", null);
    await expect(api.fetchAudienceGrantHistory(historyQuery())).resolves.toEqual([]);
  });

  // ...ALE ODMOWA MUSI ZOSTAC ODMOWA. Dziennik audytu, ktory po odmowie
  // pokazuje „brak wpisow", zaswiadcza nieprawde: ze nikt nie ruszal
  // uprawnienia, ktorego wolajacy po prostu nie ma prawa czytac.
  it("odmowa roli przy dzienniku daje WYJATEK, nie pusta historie", async () => {
    h.rpc?.setError("admin_event_audience_grant_history", ODMOWA_ROLI);
    await expect(api.fetchAudienceGrantHistory(historyQuery())).rejects.toThrow(ODMOWA_ROLI);
  });

  it("redakcja dostaje wpisy dziennika", async () => {
    h.rpc?.setData("admin_event_audience_grant_history", [
      { id: "log-1", action: "event_audience_grant.granted" },
    ]);
    await expect(api.fetchAudienceGrantHistory(historyQuery())).resolves.toHaveLength(1);
  });
});

describe("dziennik zmian - ksztalt zawezenia", () => {
  beforeEach(() => {
    h.rpc?.setData("admin_event_audience_grant_history", []);
  });

  it("historia wydarzenia niesie jego identyfikator", async () => {
    await api.fetchAudienceGrantHistory(historyQuery());
    expect(payloadOf("admin_event_audience_grant_history").event_id).toBe(EVENT_ID);
  });

  it("historia calego najemcy NIE wysyla klucza wydarzenia", async () => {
    await api.fetchAudienceGrantHistory(historyQuery({ eventId: null }));
    expect("event_id" in payloadOf("admin_event_audience_grant_history")).toBe(false);
  });

  // SCIEZKA JEDNEGO UPRAWNIENIA. Audyt rozliczen pyta zwykle o konkretna ulge,
  // a nie o caly dziennik - zgubiony klucz oddawalby historie wszystkich nadan
  // pod naglowkiem jednej osoby.
  it("historia jednego nadania niesie jego identyfikator", async () => {
    await api.fetchAudienceGrantHistory(historyQuery({ grantId: GRANT_ID }));
    expect(payloadOf("admin_event_audience_grant_history").grant_id).toBe(GRANT_ID);
  });

  it("historia wszystkich nadan NIE wysyla klucza nadania", async () => {
    await api.fetchAudienceGrantHistory(historyQuery({ grantId: null }));
    expect("grant_id" in payloadOf("admin_event_audience_grant_history")).toBe(false);
  });

  it("fraza jedzie przycieta, a pusta nie jedzie wcale", async () => {
    await api.fetchAudienceGrantHistory(historyQuery({ search: "  nowak  " }));
    expect(payloadOf("admin_event_audience_grant_history").search).toBe("nowak");
    await api.fetchAudienceGrantHistory(historyQuery({ search: "   " }));
    expect("search" in payloadOf("admin_event_audience_grant_history")).toBe(false);
  });

  it("limit jedzie zawsze - to on rozstrzyga, ile dziennika widac", async () => {
    await api.fetchAudienceGrantHistory(historyQuery({ limit: 250 }));
    expect(payloadOf("admin_event_audience_grant_history").limit).toBe(250);
  });

  it("zaden wyslany klucz nie wychodzi poza kontrakt funkcji bazy", async () => {
    await api.fetchAudienceGrantHistory(historyQuery({ grantId: GRANT_ID, search: "nowak" }));
    const known = new Set(KONTRAKT.admin_event_audience_grant_history);
    expect(
      Object.keys(payloadOf("admin_event_audience_grant_history")).filter((k) => !known.has(k)),
    ).toEqual([]);
  });
});
