// Warstwa dostepu modulu ON-SITE: kontrakt payloadow i parsery decyzji odprawy.
//
// PO CO TEN PLIK ISTNIEJE. Kazda funkcja tego modulu wola JEDNA funkcje bazy
// z jednym argumentem `p_payload jsonb` (albo z nazwanymi `p_*`). Postgres NIE
// ODRZUCA pola, ktorego nie zna - po prostu je pomija. Literowka w nazwie
// klucza (`checkpointId` zamiast `checkpoint_id`) przechodzi przez `tsc`,
// przez przeglad i przez interfejs: panel pokazuje toast sukcesu, a baza
// zapisala wiersz bez punktu kontrolnego. Dlatego testujemy NAZWY KLUCZY -
// wartosci sprawdza baza, nazwa jest jedyna rzecza, ktorej nikt po drodze nie
// sprawdza.
//
// CO PSUJE SIE BEZ TEGO PLIKU:
//   1. `args()` gubiace roznice miedzy `undefined` („nie dotykaj”) a `null`
//      („wyczysc”) - filtr dziennika odpraw zaczyna klamac, a zapis punktu
//      kontrolnego kasuje przypisana sale;
//   2. parser decyzji, ktory przy braku pola `admit` wpuszcza czlowieka -
//      to jest dokladnie ta jedna wartosc, dla ktorej ten modul istnieje;
//   3. parser statystyk, ktory przy brakujacej metryce oddaje pusty pulpit
//      zamiast zera - koordynator w dniu wydarzenia czyta wtedy nic;
//   4. `parseScannerCredential` gubiacy jawny token, ktory baza oddaje
//      DOKLADNIE RAZ i ktorego nie da sie pokazac powtornie.
//
// RODO: wszystkie dane w fixture'ach sa wymyslone, adresy wylacznie
// `example.org`. Ten modul nie hashuje adresow IP, wiec nie ma tu czego
// sprawdzac pod tym katem.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok, supabaseRpcStub } from "@/test/supabase";

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

const api = await import("@/lib/events/onsiteApi");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const CHECKPOINT_ID = "22222222-2222-4222-8222-222222222222";
const PERSON_ID = "33333333-3333-4333-8333-333333333333";
const DEVICE_ID = "44444444-4444-4444-8444-444444444444";

function rpc(): ReturnType<typeof supabaseRpcStub> {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

/** Argumenty ostatniego wywolania danej funkcji bazy, jako zwykly obiekt. */
function lastArgs(name: string): Record<string, unknown> {
  const call = rpc().lastCall(name);
  if (call === undefined) throw new Error(`test: funkcja "${name}" nie zostala wywolana`);
  return call.args ?? {};
}

/** Klucze `p_payload` ostatniego wywolania - to jest testowany kontrakt. */
function payloadKeys(name: string): string[] {
  const value = lastArgs(name).p_payload;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`test: "${name}" nie dostalo obiektu p_payload`);
  }
  return Object.keys(value).sort();
}

function payloadOf(name: string): Record<string, unknown> {
  const value = lastArgs(name).p_payload;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`test: "${name}" nie dostalo obiektu p_payload`);
  }
  return { ...value };
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

/* ------------------------------------------------------------ kontrakt --- */

describe("onsiteApi - kontrakt wywolan bazy", () => {
  it("zapis punktu kontrolnego niesie KOMPLET nazw czytanych przez baze", async () => {
    rpc().setData("admin_event_checkpoint_save", CHECKPOINT_ID);

    await api.saveCheckpoint({
      id: CHECKPOINT_ID,
      eventId: EVENT_ID,
      namePl: "Wejscie glowne",
      nameEn: "Main entrance",
      kind: "event_entry",
      sessionId: null,
      roomId: null,
      sponsorId: null,
      directionMode: "in_out",
      accessMode: "control",
      capacity: 200,
      dedupeWindowSeconds: 30,
      isActive: true,
      sortOrder: 1,
    });

    expect(payloadKeys("admin_event_checkpoint_save")).toEqual([
      "access_mode",
      "capacity",
      "dedupe_window_seconds",
      "direction_mode",
      "event_id",
      "id",
      "is_active",
      "kind",
      "name_en",
      "name_pl",
      "room_id",
      "session_id",
      "sort_order",
      "sponsor_id",
    ]);
  });

  it("`undefined` znaczy „nie dotykaj”, a jawny `null` jedzie do bazy jako „wyczysc”", async () => {
    // Ta roznica jest cala konwencja modulu. Gdyby `payload()` przepuszczalo
    // `undefined`, zapis punktu bez podanej sali skasowalby przypisanie sali,
    // ktore ktos ustawil pol godziny wczesniej.
    rpc().setData("admin_event_checkpoint_save", CHECKPOINT_ID);

    await api.saveCheckpoint({
      id: CHECKPOINT_ID,
      namePl: "Sala B",
      nameEn: "Room B",
      kind: "room",
      roomId: null,
      capacity: null,
    });

    const sent = payloadOf("admin_event_checkpoint_save");
    expect(sent).toMatchObject({ room_id: null, capacity: null });
    expect(Object.keys(sent)).not.toContain("session_id");
    expect(Object.keys(sent)).not.toContain("sponsor_id");
    expect(Object.keys(sent)).not.toContain("event_id");
  });

  it("reczna odprawa niesie klucz idempotencji - powtorzone klikniecie to nie druga odprawa", async () => {
    rpc().setData("admin_event_checkin_manual", { outcome: "granted", admit: true });

    await api.recordManualCheckin({
      eventId: EVENT_ID,
      checkpointId: CHECKPOINT_ID,
      personId: PERSON_ID,
      direction: "in",
      source: "name_search",
      note: null,
      clientScanUid: "scan-uid-1",
    });

    expect(payloadKeys("admin_event_checkin_manual")).toEqual([
      "checkpoint_id",
      "client_scan_uid",
      "direction",
      "event_id",
      "note",
      "person_id",
      "source",
    ]);
    expect(payloadOf("admin_event_checkin_manual").client_scan_uid).toBe("scan-uid-1");
  });

  it("panel zapisuje TYLKO dwa zrodla odprawy - reszta nalezy do urzadzenia", () => {
    expect(api.MANUAL_CHECKIN_SOURCES).toEqual(["manual_entry", "name_search"]);
  });

  it("filtr dziennika nie wysyla pustej frazy - baza dostalaby warunek na nic", async () => {
    rpc().setData("admin_event_checkins_list", []);

    await api.fetchCheckins({ eventId: EVENT_ID, q: "   ", limit: 50 });
    const emptyQuery = lastArgs("admin_event_checkins_list");
    expect(Object.keys(emptyQuery)).not.toContain("p_q");
    expect(emptyQuery).toMatchObject({ p_event_id: EVENT_ID, p_limit: 50 });

    await api.fetchCheckins({ eventId: EVENT_ID, q: "kowal", result: "granted" });
    expect(lastArgs("admin_event_checkins_list")).toMatchObject({
      p_q: "kowal",
      p_result: "granted",
    });
  });

  it("wydanie identyfikatorow wysyla ZWYKLA tablice, nie obiekt tylko-do-odczytu", async () => {
    // `person_ids` jedzie do `jsonb_array_elements_text`. Zamrozona tablica
    // przechodzi przez JSON tak samo, ale kopia jest tu swiadoma: wywolujacy
    // podaje `readonly string[]`, a payload nie moze wskazywac na jego stan.
    rpc().setData("admin_event_badge_batch", { event_id: EVENT_ID, badges: [] });
    const ids: readonly string[] = Object.freeze([PERSON_ID]);

    await api.issueBadgeBatch({ eventId: EVENT_ID, personIds: ids });

    const sent = payloadOf("admin_event_badge_batch");
    expect(sent.person_ids).toEqual([PERSON_ID]);
    expect(sent.person_ids).not.toBe(ids);
  });

  it("eksport leadow idzie WLASNA funkcja bazy, nie petla po liscie", async () => {
    // Kontakt wychodzi wylacznie przy zapisanej zgodzie, a decyzje podejmuje
    // baza. Gdyby panel skladal eksport z `admin_event_lead_scans_list`,
    // filtr zgody wladowalby sie do przegladarki.
    rpc().setData("admin_event_lead_scans_export", []);

    await api.fetchLeadScansExport(EVENT_ID);
    expect(Object.keys(lastArgs("admin_event_lead_scans_export"))).not.toContain("p_sponsor_id");

    await api.fetchLeadScansExport(EVENT_ID, DEVICE_ID);
    expect(lastArgs("admin_event_lead_scans_export")).toEqual({
      p_event_id: EVENT_ID,
      p_sponsor_id: DEVICE_ID,
    });
    expect(rpc().names()).not.toContain("admin_event_lead_scans_list");
  });

  it("odmowa bazy wychodzi jako wyjatek z jej wlasnym komunikatem", async () => {
    rpc().setError("admin_event_checkpoints_list", "insufficient_privilege: brak roli");
    await expect(api.fetchCheckpoints(EVENT_ID)).rejects.toThrow("insufficient_privilege");

    rpc().setError("admin_event_checkpoint_save", "invalid_payload: name_pl is required");
    await expect(
      api.saveCheckpoint({ namePl: "", nameEn: "", kind: "event_entry" }),
    ).rejects.toThrow("invalid_payload");
  });

  it("pusta odpowiedz listy to pusta tablica, a nie `null` na ekranie", async () => {
    rpc().setResponse("admin_event_checkins_list", ok(null));
    await expect(api.fetchCheckins({ eventId: EVENT_ID })).resolves.toEqual([]);

    rpc().setResponse("admin_event_scanner_devices_list", ok(null));
    await expect(api.fetchScannerDevices(EVENT_ID)).resolves.toEqual([]);
  });

  it("przelaczniki urzadzenia czytaja TYLKO twarde `true` z bazy", async () => {
    // `data === true`, nie `Boolean(data)`. Odpowiedz `"t"` albo `1` z innego
    // sterownika nie ma prawa wygladac jak potwierdzone uniewaznienie.
    rpc().setData("admin_event_scanner_device_revoke", true);
    await expect(api.revokeScannerDevice(DEVICE_ID)).resolves.toBe(true);

    rpc().setData("admin_event_scanner_device_revoke", "t");
    await expect(api.revokeScannerDevice(DEVICE_ID)).resolves.toBe(false);

    rpc().setData("admin_event_scanner_device_set_active", true);
    await expect(api.setScannerDeviceActive(DEVICE_ID, false)).resolves.toBe(true);
    expect(payloadOf("admin_event_scanner_device_set_active")).toEqual({
      device_id: DEVICE_ID,
      is_active: false,
    });
  });

  it("formaty papieru sa lustrem CHECK-a bazy - `cr80` juz tam nie ma", () => {
    // Regresja opisana w naglowku modulu: `cr80` nie istnieje w ograniczeniu
    // `event_badge_templates_paper_format_values`, wiec wybor tego formatu
    // konczyl sie naruszeniem CHECK-a przy zapisie szablonu.
    expect(api.BADGE_PAPER_FORMATS).not.toContain("cr80");
    expect(api.BADGE_PAPER_FORMATS).toContain("badge_90x54");
    expect(api.BADGE_PAPER_FORMATS).toEqual([
      "a4",
      "a5",
      "a6",
      "a7",
      "badge_90x54",
      "badge_100x150",
      "custom",
    ]);
  });
});

/* ---------------------------------------------------- decyzja o odprawie --- */

describe("onsiteApi - decyzja odprawy", () => {
  it("brak pola `admit` NIE jest zgoda na wejscie", async () => {
    // Jedyna wartosc, dla ktorej ten modul istnieje. Gdyby parser oddawal
    // `admit: true` przy odpowiedzi bez tego pola (albo przy `"true"` jako
    // napisie), awaria bazy zamienialaby sie w otwarta bramke.
    expect(api.parseCheckinOutcome({}).admit).toBe(false);
    expect(api.parseCheckinOutcome({ admit: "true" }).admit).toBe(false);
    expect(api.parseCheckinOutcome({ admit: 1 }).admit).toBe(false);
    expect(api.parseCheckinOutcome(null).admit).toBe(false);
    expect(api.parseCheckinOutcome({ admit: true }).admit).toBe(true);
  });

  it("nieczytelna odpowiedz nie udaje decyzji - `outcome` i `result` to `unknown`", () => {
    const parsed = api.parseCheckinOutcome("nie-obiekt");
    expect(parsed.outcome).toBe("unknown");
    expect(parsed.result).toBe("unknown");
    expect(parsed.checkinId).toBeNull();
    expect(parsed.direction).toBe("in");
    expect(parsed.repeatCount).toBe(0);
    expect(parsed.checkpoint).toEqual({});
    expect(parsed.person).toEqual({});
  });

  it("KOD JUZ UZYTY: powtorzenie niesie licznik i chwile poprzedniej odprawy", async () => {
    // Drugie pikniecie tego samego biletu ma pokazac operatorowi, KIEDY ta
    // osoba weszla. Bez `previous_checkin_at` wolontariusz widzi „odmowa”
    // i zaczyna szukac winnego w kolejce zamiast wpuscic wracajacego gosca.
    rpc().setData("admin_event_checkin_manual", {
      outcome: "granted",
      admit: true,
      result: "granted",
      checkin_id: "55555555-5555-4555-8555-555555555555",
      direction: "in",
      occurred_at: "2026-09-01T08:20:00.000Z",
      repeat_count: 2,
      previous_checkin_at: "2026-09-01T08:00:00.000Z",
      checkpoint: { id: CHECKPOINT_ID, occupancy: 41 },
      person: { person_id: PERSON_ID, first_name: "Anna" },
    });

    const outcome = await api.recordManualCheckin({
      eventId: EVENT_ID,
      checkpointId: CHECKPOINT_ID,
      personId: PERSON_ID,
      clientScanUid: "scan-uid-powtorka",
    });

    expect(outcome.repeatCount).toBe(2);
    expect(outcome.previousCheckinAt).toBe("2026-09-01T08:00:00.000Z");
    expect(outcome.admit).toBe(true);
    expect(outcome.checkinId).toBe("55555555-5555-4555-8555-555555555555");
  });

  // -------------------------------------------------------------------------
  // REGRESJA NA MIGRACJE 20260828206000 I 20260830090000.
  //
  // Przed tamta naprawa `event_register` nie sprawdzalo ceny wejsciowki:
  // platny bilet wychodzil za darmo, RAZEM Z DZIALAJACYM KODEM QR. Po
  // naprawie zgloszenie z `payment_status = 'unpaid'` NIE dostaje kodu QR
  // (`qr_token_hash` zostaje puste) i nie moze byc `approved`.
  //
  // Dla bramki znaczy to dwie rzeczy i obie sa tu sprawdzone:
  //   * takiego kodu NIE MA jak zeskanowac - patrz test skanera
  //     (`useScanner.test.tsx`), bo baza nie znajdzie haszu i odda
  //     `unknown_code`;
  //   * odprawa RECZNA (z wyszukiwarki nazwisk) takiej osoby konczy sie
  //     `denied_registration_status`, bo zgloszenie nie jest `approved`.
  // Warstwa danych ma te odmowe PRZENIESC BEZ ZMIAN. Gdyby `admit` gdziekolwiek
  // po drodze zmienil sie w `true`, na kongres wchodzilby ktos, kto nie zaplacil.
  // -------------------------------------------------------------------------
  it("REGRESJA (20260828206000 + 20260830090000): zgloszenie `unpaid` NIE MA kodu QR, a reczna odprawa konczy sie `denied_registration_status`", async () => {
    rpc().setData("admin_event_checkin_manual", {
      outcome: "denied_registration_status",
      admit: false,
      result: "denied_registration_status",
      checkin_id: "66666666-6666-4666-8666-666666666666",
      direction: "in",
      occurred_at: "2026-09-01T08:05:00.000Z",
      repeat_count: 0,
      previous_checkin_at: null,
      checkpoint: { id: CHECKPOINT_ID, access_mode: "control" },
      // Karta osoby niesie status zgloszenia - operator ma zobaczyc POWOD,
      // a nie samo „odmowa”. Kodu QR w tej odpowiedzi nie ma i miec nie moze.
      person: {
        person_id: PERSON_ID,
        first_name: "Jan",
        registration_status: "pending",
        payment_status: "unpaid",
      },
    });

    const outcome = await api.recordManualCheckin({
      eventId: EVENT_ID,
      checkpointId: CHECKPOINT_ID,
      personId: PERSON_ID,
      source: "name_search",
      clientScanUid: "scan-uid-unpaid",
    });

    expect(outcome.admit).toBe(false);
    expect(outcome.outcome).toBe("denied_registration_status");
    expect(outcome.result).toBe("denied_registration_status");
    expect(outcome.person).toMatchObject({ registration_status: "pending" });
    // Odmowa nadal jest ZDARZENIEM w dzienniku - inaczej organizator nie ma
    // jak policzyc, ilu ludzi odbilo sie od bramki na nieoplaconym bilecie.
    expect(outcome.checkinId).not.toBeNull();
    // Zadne pole odpowiedzi nie niesie kodu QR - po naprawie nie ma czego niesc.
    expect(JSON.stringify(outcome)).not.toContain("qr_token");
  });

  it("odprawa w trybie `track` liczy wejscie, ale odmowa zostaje odmowa", async () => {
    rpc().setData("admin_event_checkin_manual", {
      outcome: "denied_not_registered",
      admit: true,
      result: "denied_not_registered",
      checkin_id: "77777777-7777-4777-8777-777777777777",
      direction: "in",
      checkpoint: { access_mode: "track" },
    });

    const outcome = await api.recordManualCheckin({
      eventId: EVENT_ID,
      checkpointId: CHECKPOINT_ID,
      personId: PERSON_ID,
    });

    // `admit` i `result` to DWIE rozne rzeczy: punkt liczacy wpuszcza, ale
    // dziennik zapamietuje, ze ta osoba nie miala zgloszenia.
    expect(outcome.admit).toBe(true);
    expect(outcome.result).toBe("denied_not_registered");
  });
});

/* --------------------------------------------------------- poswiadczenie --- */

describe("onsiteApi - poswiadczenie urzadzenia", () => {
  it("jawny token wraca DOKLADNIE RAZ i w calosci", async () => {
    // Nie istnieje funkcja bazy, ktora pokaze go powtornie. Gubiac go tutaj,
    // panel wydaje urzadzenie, ktorego nie da sie sparowac.
    rpc().setData("admin_event_scanner_device_issue", {
      device_id: DEVICE_ID,
      label: "Recepcja A",
      token: "Xy7-abcdefghijklmnopqrstuvwx",
      token_prefix: "Xy7-abcd",
      scopes: ["checkin", 42, null, "badge_print"],
      expires_at: "2026-09-02T20:00:00.000Z",
    });

    const credential = await api.issueScannerDevice({
      eventId: EVENT_ID,
      label: "Recepcja A",
      scopes: ["checkin", "badge_print"],
      checkpointId: CHECKPOINT_ID,
      sponsorId: null,
      expiresAt: "2026-09-02T20:00:00.000Z",
    });

    expect(credential.token).toBe("Xy7-abcdefghijklmnopqrstuvwx");
    expect(credential.tokenPrefix).toBe("Xy7-abcd");
    // Zakresy z bazy bywaja tablica jsonb - wartosci nie-tekstowe odsiewamy,
    // zeby `includes("lead")` nie porownywalo sie z liczba.
    expect(credential.scopes).toEqual(["checkin", "badge_print"]);
    expect(payloadKeys("admin_event_scanner_device_issue")).toEqual([
      "checkpoint_id",
      "event_id",
      "expires_at",
      "label",
      "scopes",
      "sponsor_id",
    ]);
  });

  it("nieczytelne poswiadczenie nie udaje tokenu - puste napisy zamiast `undefined`", () => {
    const credential = api.parseScannerCredential(null);
    expect(credential).toEqual({
      deviceId: "",
      label: "",
      token: "",
      tokenPrefix: "",
      scopes: [],
      expiresAt: null,
    });
  });
});

/* ------------------------------------------------------------ statystyki --- */

describe("onsiteApi - parsery pulpitu", () => {
  it("brakujaca metryka to ZERO, a nie pusty pulpit", async () => {
    const stats = api.parseOnsiteStats({});
    expect(stats.bucketMinutes).toBe(15);
    expect(stats.registeredTotal).toBe(0);
    expect(stats.arrivedTotal).toBe(0);
    expect(stats.attendanceRate).toBeNull();
    expect(stats.deniedByReason).toEqual({});
    expect(stats.histogram).toEqual([]);
    expect(stats.checkpoints).toEqual([]);
    expect(stats.devices).toEqual({ total: 0, active: 0, locked: 0, revoked: 0, expired: 0 });
  });

  it("histogram, punkty i powody odmow przechodza z bazy w calosci", async () => {
    rpc().setData("admin_event_onsite_stats", {
      bucket_minutes: 30,
      registered_total: 420,
      arrived_total: 310,
      arrived_registered: 300,
      walk_in_total: 10,
      no_show_total: 120,
      attendance_rate: 0.738,
      denied_total: 7,
      denied_by_reason: { denied_registration_status: 5, denied_capacity: "2" },
      repeat_total: 3,
      failed_resolve_total: 1,
      badges_printed_people: 280,
      badges_printed_copies: 291,
      lead_scans_total: 64,
      lead_scans_with_consent: 41,
      histogram: [{ bucket_at: "2026-09-01T08:00:00.000Z", granted_in: 90, granted_out: 4 }],
      checkpoints: [
        {
          checkpoint_id: CHECKPOINT_ID,
          name_pl: "Wejscie glowne",
          name_en: "Main entrance",
          kind: "event_entry",
          access_mode: "control",
          capacity: null,
          occupancy: 288,
          granted: 300,
          denied: 7,
          unique_people: 295,
          last_checkin_at: "2026-09-01T09:12:00.000Z",
        },
      ],
      devices: { total: 6, active: 5, locked: 1, revoked: 0, expired: 0 },
    });

    const stats = await api.fetchOnsiteStats(EVENT_ID, 30);

    expect(lastArgs("admin_event_onsite_stats")).toEqual({
      p_event_id: EVENT_ID,
      p_bucket_minutes: 30,
    });
    expect(stats.attendanceRate).toBeCloseTo(0.738);
    // `"2"` jako napis to nie liczba - licznik odmow ma byc liczba albo zerem,
    // bo ekran robi na nim arytmetyke.
    expect(stats.deniedByReason).toEqual({ denied_registration_status: 5, denied_capacity: 0 });
    expect(stats.histogram).toEqual([
      { bucketAt: "2026-09-01T08:00:00.000Z", grantedIn: 90, grantedOut: 4, denied: 0 },
    ]);
    expect(stats.checkpoints[0]).toMatchObject({ capacity: null, occupancy: 288, granted: 300 });
    expect(stats.devices.locked).toBe(1);
  });

  it("bez podanego kubelka nie wysylamy `p_bucket_minutes` - baza ma wlasna wartosc domyslna", async () => {
    rpc().setData("admin_event_onsite_stats", {});
    await api.fetchOnsiteStats(EVENT_ID);
    expect(Object.keys(lastArgs("admin_event_onsite_stats"))).toEqual(["p_event_id"]);
  });

  it("pulpit na zywo: brak sesji to pusta lista, nie wyjatek", async () => {
    const live = api.parseOnsiteLiveStats({ sessions: "nie-tablica", rooms: null });
    expect(live.sessions).toEqual([]);
    expect(live.rooms).toEqual([]);
    expect(live.windowMinutes).toBe(60);
    expect(live.generatedAt).toBe("");
  });

  it("pulpit na zywo niesie zajetosc sali - to na niej stoi decyzja o wpuszczaniu", async () => {
    rpc().setData("admin_event_onsite_live_stats", {
      generated_at: "2026-09-01T10:00:00.000Z",
      window_minutes: 15,
      sessions: [
        {
          session_id: "88888888-8888-4888-8888-888888888888",
          title_pl: "Panel otwarcia",
          title_en: "Opening panel",
          starts_at: "2026-09-01T10:00:00.000Z",
          ends_at: "",
          room_id: null,
          room_name: "Sala A",
          capacity: 120,
          granted_in: 118,
          granted_out: 4,
          inside: 114,
          recent_in: 22,
        },
      ],
      rooms: [{ room_id: "r1", name: "Sala A", floor: null, capacity: 120, inside: 114 }],
    });

    const live = await api.fetchOnsiteLiveStats(EVENT_ID, 15);

    expect(lastArgs("admin_event_onsite_live_stats")).toEqual({
      p_event_id: EVENT_ID,
      p_window_minutes: 15,
    });
    // Pusty napis z bazy to BRAK terminu, nie termin o pustej nazwie.
    expect(live.sessions[0].endsAt).toBeNull();
    expect(live.sessions[0].roomId).toBeNull();
    expect(live.sessions[0].inside).toBe(114);
    expect(live.rooms[0]).toMatchObject({ roomId: "r1", floor: null, inside: 114 });
  });
});
