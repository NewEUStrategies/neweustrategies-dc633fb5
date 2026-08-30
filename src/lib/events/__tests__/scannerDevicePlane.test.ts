// Płaszczyzna URZĄDZENIA: pięć RPC bramki, ich ładunki i parsery odpowiedzi.
//
// PO CO TEN PLIK ISTNIEJE. `scannerApi.ts` jest jedyną warstwą, przez którą
// telefon przy bramce rozmawia z bazą - i jedyną, która NIE MA nagłówka
// z najemcą ani z wydarzeniem. Najemca, wydarzenie, zakres i przypięty punkt
// są WYNIKIEM odszukania poświadczenia po haszu tokenu, a nie argumentem
// wywołania (`_event_scanner_device_auth`, patrz `50_onsite.sql`). Skutki
// błędu w tej warstwie są nieodwracalne w dniu wydarzenia:
//
//   1. ZGUBIONY KLUCZ IDEMPOTENCJI zamienia powtórną wysyłkę kolejki offline
//      w drugą odprawę tej samej osoby;
//   2. PARSER, KTÓRY PRZY BRAKU POLA `admit` MÓWI „wpuść", otwiera bramkę na
//      odpowiedź, której baza nie potwierdziła;
//   3. PARSER LEADU, KTÓRY UDAJE TOŻSAMOŚĆ przy braku zgody, oddaje partnerowi
//      dane osobowe wbrew RODO - a to jest dokładnie ta jedna rzecz, dla której
//      baza w ogóle rozróżnia `consent`;
//   4. NIEROZPOZNANA ODPOWIEDŹ, która przechodzi jako sukces, zamienia awarię
//      w ciszę: operator widzi „zapisano", a w dzienniku nie ma wiersza.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) `publicEventApi.test.ts` sprawdza już
// ładunek udanej odprawy, brak klucza idempotencji w podglądzie decyzji, skan
// leadu BEZ zgody i pomijanie wiersza bez `lead_id` - te przypadki tu NIE
// wracają. Ten plik dokłada to, czego tam nie ma: udane poświadczenie, odmowy
// każdego z pięciu wywołań, `wrong_event`, ODWROTNĄ stronę zgody (skan ZE
// zgodą) i wydruk identyfikatora z płaszczyzny urządzenia. (2) Reguł sesji,
// zakresów i kolejki - to `scannerPlane.test.ts`. (3) Środowiska uruchomieniowego
// skanera - to `useScanner.test.tsx`.
//
// RODO: wszystkie dane są wymyślone, adresy wyłącznie `example.org`. Tokeny są
// ZMYŚLONE i mają kształt 24 bajtów base64url, tak jak wynik `_event_new_qr_token()`.
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

const api = await import("@/lib/events/scannerApi");

/** Zmyślone poświadczenia w kształcie 24 bajtów base64url. */
const TOKEN_BRAMKI = "Qk1fY2hlY2tpbl90ZXN0MDAwMDAwMDA";
const TOKEN_STOISKA = "TEVBRF9zdG9pc2tvX3Rlc3QwMDAwMDA";
const KOD = "cXJfemFwaXNfdGVzdG93eV8wMDAwMDAx";

const PUNKT = "22222222-2222-4222-8222-222222222222";

function rpc(): ReturnType<typeof supabaseRpcStub> {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

/** Ładunek `p_payload` ostatniego wywołania - to jest testowany kontrakt. */
function payloadOf(name: string): Record<string, unknown> {
  const value = rpc().lastCall(name)?.arg("p_payload");
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`test: "${name}" nie dostalo obiektu p_payload`);
  }
  return { ...value };
}

const SESJA = {
  device_id: "44444444-4444-4444-8444-444444444444",
  label: "Brama - telefon 1",
  scopes: ["checkin", "badge_print"],
  expires_at: "2026-09-02T18:00:00.000Z",
  pinned_checkpoint_id: PUNKT,
  sponsor_id: null,
  event: {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "onsite-a",
    title_pl: "Kongres na miejscu",
    title_en: "Onsite congress",
  },
  checkpoints: [
    {
      id: PUNKT,
      name_pl: "Brama glowna",
      name_en: "Main gate",
      kind: "event_entry",
      direction_mode: "in_out",
      access_mode: "control",
      dedupe_window_seconds: 60,
      sort_order: 1,
    },
  ],
};

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

/* ------------------------------------------------------- poświadczenie --- */

describe("scannerApi - poświadczenie urządzenia", () => {
  it("UDANE poświadczenie oddaje sesję, a token jedzie WYŁĄCZNIE w ciele żądania", async () => {
    rpc().setData("event_scanner_bootstrap", SESJA);

    const sesja = await api.bootstrapScanner(TOKEN_BRAMKI);

    // Najemca i wydarzenie są WYNIKIEM odszukania po haszu tokenu - ładunek
    // nie ma i nie może mieć argumentu z najemcą (patrz `50_onsite.sql`).
    expect(payloadOf("event_scanner_bootstrap")).toEqual({ device_token: TOKEN_BRAMKI });
    expect(sesja.deviceId).toBe(SESJA.device_id);
    expect(sesja.event.id).toBe(SESJA.event.id);
    expect(sesja.pinnedCheckpointId).toBe(PUNKT);
    expect(sesja.checkpoints).toHaveLength(1);
  });

  it.each([
    ["invalid_device_token: unknown token", "token nieznany"],
    ["device_revoked: revoked in admin panel", "poświadczenie unieważnione"],
    ["device_expired: past expiry", "poświadczenie po terminie"],
    ["device_inactive: paused", "poświadczenie zapauzowane"],
    ["device_locked: cooling down", "urządzenie zablokowane po serii pomyłek"],
  ])("odmowa „%s” (%s) wychodzi wyjątkiem z ZACHOWANYM kluczem bazy", async (komunikat) => {
    // Klucz odmowy jest jedyną rzeczą, po której ekran wybiera zdanie dla
    // operatora („oddaj telefon koordynatorowi" kontra „odczekaj").
    rpc().setError("event_scanner_bootstrap", komunikat);

    await expect(api.bootstrapScanner(TOKEN_BRAMKI)).rejects.toThrow(komunikat.split(":")[0]);
  });
});

/* ------------------------------------------------------------- odprawa --- */

describe("scannerApi - odprawa przy bramce", () => {
  it("NIECZYTELNA odpowiedź nie udaje decyzji - `outcome` to `unknown`, a `admit` to `false`", async () => {
    // Brak pola `admit` NIE JEST zgodą na wejście. To jest ta jedna wartość,
    // dla której cała ta warstwa istnieje.
    rpc().setData("event_checkin_record", { checkin_id: 12 });

    const wynik = await api.recordCheckinScan({ deviceToken: TOKEN_BRAMKI, code: KOD });

    expect(wynik.outcome).toBe("unknown");
    expect(wynik.admit).toBe(false);
    expect(wynik.result).toBeNull();
    expect(wynik.checkinId).toBeNull();
    expect(wynik.direction).toBeNull();
    expect(wynik.repeatCount).toBe(0);
    expect(wynik.person).toBeNull();
  });

  it("odpowiedź, która NIE JEST obiektem, też nie wpuszcza nikogo", async () => {
    rpc().setData("event_checkin_record", ["granted", true]);

    const wynik = await api.recordCheckinScan({ deviceToken: TOKEN_BRAMKI, code: KOD });

    expect(wynik.admit).toBe(false);
    expect(wynik.outcome).toBe("unknown");
    expect(wynik.checkpoint.id).toBeNull();
  });

  it("kierunek spoza słownika bazy jest ODRZUCANY, a nie przepuszczany na ekran", async () => {
    rpc().setData("event_checkin_record", {
      outcome: "granted",
      admit: true,
      direction: "sideways",
    });

    const wynik = await api.recordCheckinScan({ deviceToken: TOKEN_BRAMKI, code: KOD });

    expect(wynik.direction).toBeNull();
  });

  it("kod CUDZEGO WYDARZENIA niesie nazwę tamtego kongresu w OBU językach", async () => {
    // `wrong_event` to POPRAWNA odpowiedź bazy, nie awaria: bilet jest prawdziwy,
    // tylko z innego wydarzenia tego samego najemcy. Operator musi móc powiedzieć
    // uczestnikowi, DOKĄD ma pójść.
    rpc().setData("event_checkin_record", {
      outcome: "wrong_event",
      admit: false,
      result: "denied_wrong_event",
      other_event: { title_pl: "Warsztat jesienny", title_en: "Autumn workshop" },
    });

    const wynik = await api.recordCheckinScan({ deviceToken: TOKEN_BRAMKI, code: KOD });

    expect(wynik.outcome).toBe("wrong_event");
    expect(wynik.admit).toBe(false);
    expect(wynik.otherEventTitlePl).toBe("Warsztat jesienny");
    expect(wynik.otherEventTitleEn).toBe("Autumn workshop");
  });

  it("odpowiedź BEZ `other_event` nie zmyśla nazwy sąsiedniego wydarzenia", async () => {
    rpc().setData("event_checkin_record", { outcome: "unknown_code", admit: false });

    const wynik = await api.recordCheckinScan({ deviceToken: TOKEN_BRAMKI, code: KOD });

    expect(wynik.otherEventTitlePl).toBeNull();
    expect(wynik.otherEventTitleEn).toBeNull();
  });

  it("PUSTY obiekt osoby to BRAK osoby, a nie osoba o pustym imieniu", async () => {
    rpc().setData("event_checkin_record", { outcome: "unknown_code", admit: false, person: {} });

    const wynik = await api.recordCheckinScan({ deviceToken: TOKEN_BRAMKI, code: KOD });

    expect(wynik.person).toBeNull();
  });

  it("SAME BIAŁE ZNAKI w polach osoby są traktowane jak brak wartości", async () => {
    rpc().setData("event_checkin_record", {
      outcome: "granted",
      admit: true,
      person: { person_id: "p1", first_name: "   ", company: "", job_title: "CTO" },
    });

    const wynik = await api.recordCheckinScan({ deviceToken: TOKEN_BRAMKI, code: KOD });

    expect(wynik.person?.firstName).toBeNull();
    expect(wynik.person?.company).toBeNull();
    expect(wynik.person?.jobTitle).toBe("CTO");
  });

  it("wersja identyfikatora spoza liczb jest `null`, a nie zerem", async () => {
    rpc().setData("event_checkin_record", {
      outcome: "granted",
      admit: true,
      person: { person_id: "p1", badge_printed: "tak", badge_printed_version: "3" },
    });

    const wynik = await api.recordCheckinScan({ deviceToken: TOKEN_BRAMKI, code: KOD });

    // `"tak"` to nie `true` - identyfikator jest wydrukowany albo nie jest.
    expect(wynik.person?.badgePrinted).toBe(false);
    expect(wynik.person?.badgePrintedVersion).toBeNull();
  });

  it("URZĄDZENIE ZABLOKOWANE po serii pomyłek dochodzi do ekranu jako flaga odpowiedzi", async () => {
    rpc().setData("event_checkin_record", {
      outcome: "unknown_code",
      admit: false,
      device_locked: true,
    });

    const wynik = await api.recordCheckinScan({ deviceToken: TOKEN_BRAMKI, code: KOD });

    expect(wynik.deviceLocked).toBe(true);
  });

  it("KLUCZ IDEMPOTENCJI i PUNKT o wartości `null` wypadają z ładunku", async () => {
    // `payload()` tej warstwy usuwa `undefined` ORAZ `null` - baza ma wtedy
    // użyć punktu PRZYPIĘTEGO do poświadczenia, a nie dostać jawne „bez punktu".
    rpc().setData("event_checkin_record", { outcome: "granted", admit: true });

    await api.recordCheckinScan({
      deviceToken: TOKEN_BRAMKI,
      code: KOD,
      checkpointId: null,
      clientScanUid: undefined,
    });

    expect(Object.keys(payloadOf("event_checkin_record")).sort()).toEqual(["code", "device_token"]);
  });

  it("odmowa POŚWIADCZENIA przy zapisie odprawy wychodzi wyjątkiem, a nie decyzją", async () => {
    rpc().setError("event_checkin_record", "device_scope_missing: checkin scope required");

    await expect(api.recordCheckinScan({ deviceToken: TOKEN_STOISKA, code: KOD })).rejects.toThrow(
      /device_scope_missing/,
    );
  });

  it("odmowa POŚWIADCZENIA przy PODGLĄDZIE decyzji też wychodzi wyjątkiem", async () => {
    rpc().setError("event_checkin_resolve", "device_checkpoint_mismatch: pinned elsewhere");

    await expect(
      api.resolveCheckinScan({ deviceToken: TOKEN_BRAMKI, code: KOD, checkpointId: PUNKT }),
    ).rejects.toThrow(/device_checkpoint_mismatch/);
  });

  it("podgląd decyzji oddaje TĘ SAMĄ strukturę co zapis - ekran ma jeden parser", async () => {
    rpc().setData("event_checkin_resolve", {
      outcome: "repeat",
      admit: false,
      result: "repeat",
      repeat_count: 2,
      previous_checkin_at: "2026-09-01T08:00:00.000Z",
      checkpoint: { id: PUNKT, name_pl: "Brama glowna", capacity: 500, occupancy: 288 },
    });

    const wynik = await api.resolveCheckinScan({ deviceToken: TOKEN_BRAMKI, code: KOD });

    expect(wynik.repeatCount).toBe(2);
    expect(wynik.previousCheckinAt).toBe("2026-09-01T08:00:00.000Z");
    expect(wynik.checkpoint.occupancy).toBe(288);
    expect(wynik.checkpoint.capacity).toBe(500);
  });

  // ---------------------------------------------------------------------------
  // REGRESJA NA MIGRACJE 20260828206000 I 20260830090000.
  //
  // Po tamtej naprawie zgłoszenie z `payment_status = 'unpaid'` NIE MA kodu QR
  // (kod wydaje się dopiero przy opłaconym i zatwierdzonym zapisie). Przy bramce
  // taki kod NIE ISTNIEJE, więc baza oddaje `unknown_code` - a warstwa dostępu
  // ma to przenieść BEZ ZMIAN i bez śladu tokenu w odpowiedzi.
  // ---------------------------------------------------------------------------
  it("REGRESJA (20260828206000 + 20260830090000): zgłoszenie `unpaid` NIE MA kodu - bramka oddaje `unknown_code` i NIE wpuszcza", async () => {
    rpc().setData("event_checkin_record", {
      outcome: "unknown_code",
      admit: false,
      result: null,
      checkin_id: null,
      person: null,
    });

    const wynik = await api.recordCheckinScan({ deviceToken: TOKEN_BRAMKI, code: KOD });

    expect(wynik.outcome).toBe("unknown_code");
    expect(wynik.admit).toBe(false);
    // Nie ma wiersza dziennika - kod nieznany go nie zakłada (`50_onsite.sql`).
    expect(wynik.checkinId).toBeNull();
    // Nie ma też tożsamości: bramka nie dostaje osoby, której nie rozpoznała.
    expect(wynik.person).toBeNull();
    expect(JSON.stringify(wynik)).not.toContain("qr_token");
  });
});

/* ----------------------------------------------------------------- lead --- */

describe("scannerApi - skan leadu i prywatność uczestnika", () => {
  it("skan ZE ZGODĄ oddaje komplet danych kontaktowych partnerowi", async () => {
    rpc().setData("event_lead_scan_record", {
      outcome: "saved",
      lead_id: "aaaaaaaa-1111-4111-8111-111111111111",
      scan_count: 1,
      consent: true,
      person: {
        first_name: "Zofia",
        last_name: "Zgoda",
        company: "Alfa Sp. z o.o.",
        job_title: "CTO",
        email: "zofia.zgoda@example.org",
        phone: "+48111111111",
      },
    });

    const wynik = await api.recordLeadScan({
      deviceToken: TOKEN_STOISKA,
      code: KOD,
      note: "Rozmowa o wdrozeniu",
      interestRating: 5,
    });

    expect(wynik.consent).toBe(true);
    expect(wynik.person?.email).toBe("zofia.zgoda@example.org");
    expect(wynik.person?.phone).toBe("+48111111111");
    expect(payloadOf("event_lead_scan_record")).toEqual({
      device_token: TOKEN_STOISKA,
      code: KOD,
      note: "Rozmowa o wdrozeniu",
      interest_rating: 5,
    });
  });

  it("PUSTA notatka i brak oceny NIE jadą do bazy - powtórny skan nie wyciera pierwszej rozmowy", async () => {
    // `50_onsite.sql`: „pusta notatka powtornego skanu NIE wyciera notatki
    // pierwszej rozmowy". Warstwa dostępu realizuje to, nie wysyłając klucza.
    rpc().setData("event_lead_scan_record", { outcome: "saved", scan_count: 2, consent: false });

    await api.recordLeadScan({
      deviceToken: TOKEN_STOISKA,
      code: KOD,
      note: null,
      interestRating: null,
    });

    expect(Object.keys(payloadOf("event_lead_scan_record")).sort()).toEqual([
      "code",
      "device_token",
    ]);
  });

  it("PUSTY obiekt osoby przy skanie leadu to BRAK tożsamości, nie osoba bez imienia", async () => {
    rpc().setData("event_lead_scan_record", {
      outcome: "saved",
      lead_id: "l1",
      scan_count: 1,
      consent: false,
      person: {},
    });

    const wynik = await api.recordLeadScan({ deviceToken: TOKEN_STOISKA, code: KOD });

    expect(wynik.person).toBeNull();
  });

  it("nieczytelna odpowiedź skanu leadu nie udaje zapisu", async () => {
    rpc().setData("event_lead_scan_record", "zapisano");

    const wynik = await api.recordLeadScan({ deviceToken: TOKEN_STOISKA, code: KOD });

    expect(wynik.outcome).toBe("unknown");
    expect(wynik.leadId).toBeNull();
    expect(wynik.scanCount).toBe(0);
    expect(wynik.consent).toBe(false);
    expect(wynik.deviceLocked).toBe(false);
  });

  it("odmowa skanu leadu wychodzi wyjątkiem z zachowanym kluczem", async () => {
    rpc().setError("event_lead_scan_record", "device_scope_missing: lead scope required");

    await expect(api.recordLeadScan({ deviceToken: TOKEN_BRAMKI, code: KOD })).rejects.toThrow(
      /device_scope_missing/,
    );
  });
});

/* ----------------------------------------------------- lista leadów --- */

describe("scannerApi - lista leadów urządzenia stoiskowego", () => {
  it("wiersz PO WYCOFANIU ZGODY zostaje na liście, ale bez danych osobowych", async () => {
    // `50_onsite.sql`: wycofanie zgody DZIAŁA WSTECZ - lead nadal się liczy,
    // dane znikają. Parser ma to przenieść, a nie „naprawić" pustym napisem.
    rpc().setData("event_lead_scans_list", {
      total_count: 3,
      with_consent_count: 1,
      rows: [
        {
          lead_id: "aaaaaaaa-1111-4111-8111-111111111111",
          first_scanned_at: "2026-09-01T09:00:00.000Z",
          last_scanned_at: "2026-09-01T11:00:00.000Z",
          scan_count: 2,
          note: "Rozmowa o wdrozeniu",
          interest_rating: 4,
          consent: false,
          first_name: null,
          last_name: null,
          email: null,
          phone: null,
        },
      ],
    });

    const strona = await api.fetchDeviceLeads({
      deviceToken: TOKEN_STOISKA,
      limit: 50,
      offset: 0,
    });

    expect(strona.totalCount).toBe(3);
    expect(strona.withConsentCount).toBe(1);
    expect(strona.rows[0].consent).toBe(false);
    expect(strona.rows[0].email).toBeNull();
    expect(strona.rows[0].firstName).toBeNull();
    // Lead nadal JEST wierszem - partner ma prawo zmierzyć ruch przy stoisku.
    expect(strona.rows[0].scanCount).toBe(2);
    expect(payloadOf("event_lead_scans_list")).toEqual({
      device_token: TOKEN_STOISKA,
      limit: 50,
      offset: 0,
    });
  });

  it("odpowiedź BEZ tablicy wierszy to pusta strona, a nie wyjątek na ekranie stoiska", async () => {
    rpc().setData("event_lead_scans_list", { total_count: "trzy", rows: "brak" });

    const strona = await api.fetchDeviceLeads({
      deviceToken: TOKEN_STOISKA,
      limit: 20,
      offset: 0,
    });

    expect(strona.rows).toEqual([]);
    expect(strona.totalCount).toBe(0);
    expect(strona.withConsentCount).toBe(0);
  });

  it("licznik skanów spoza liczb spada do zera, a nie do `NaN` na ekranie", async () => {
    rpc().setData("event_lead_scans_list", {
      total_count: 1,
      with_consent_count: 0,
      rows: [{ lead_id: "l1", scan_count: "dwa", interest_rating: "pięć" }],
    });

    const strona = await api.fetchDeviceLeads({
      deviceToken: TOKEN_STOISKA,
      limit: 20,
      offset: 0,
    });

    expect(strona.rows[0].scanCount).toBe(0);
    expect(strona.rows[0].interestRating).toBeNull();
  });

  it("odmowa listy leadów wychodzi wyjątkiem - poświadczenie bez zakresu nie czyta cudzych danych", async () => {
    rpc().setError("event_lead_scans_list", "invalid_device_token: no lead scope");

    await expect(
      api.fetchDeviceLeads({ deviceToken: TOKEN_BRAMKI, limit: 50, offset: 0 }),
    ).rejects.toThrow(/invalid_device_token/);
  });
});

/* --------------------------------------------------- wydruk identyfikatora --- */

describe("scannerApi - wydruk identyfikatora z płaszczyzny urządzenia", () => {
  it("udany wydruk oddaje komplet pól i liczbę POPRZEDNICH wydruków", async () => {
    // Liczba poprzednich wydruków jest jedynym sygnałem, że ktoś drukuje
    // identyfikator po raz trzeci - stanowisko druku musi ją zobaczyć.
    rpc().setData("event_badge_print_record", {
      outcome: "printed",
      print_id: "bbbbbbbb-1111-4111-8111-111111111111",
      template_id: "cccccccc-1111-4111-8111-111111111111",
      template_version: 3,
      copies: 2,
      reason: "reprint",
      previous_prints: 1,
      person: { person_id: "p1", first_name: "Zofia", badge_printed: true },
    });

    const wynik = await api.recordBadgePrintScan({
      deviceToken: TOKEN_BRAMKI,
      code: KOD,
      templateId: "cccccccc-1111-4111-8111-111111111111",
      copies: 2,
      reason: "reprint",
    });

    expect(wynik.outcome).toBe("printed");
    expect(wynik.templateVersion).toBe(3);
    expect(wynik.copies).toBe(2);
    expect(wynik.previousPrints).toBe(1);
    expect(wynik.person?.firstName).toBe("Zofia");
    expect(payloadOf("event_badge_print_record")).toEqual({
      device_token: TOKEN_BRAMKI,
      code: KOD,
      template_id: "cccccccc-1111-4111-8111-111111111111",
      copies: 2,
      reason: "reprint",
    });
  });

  it("brak liczby kopii w odpowiedzi to JEDNA kopia, nie zero", async () => {
    // Zero kopii znaczyłoby „nic nie wydrukowano" - a wydruk się odbył.
    rpc().setData("event_badge_print_record", { outcome: "printed", print_id: "b1" });

    const wynik = await api.recordBadgePrintScan({ deviceToken: TOKEN_BRAMKI, code: KOD });

    expect(wynik.copies).toBe(1);
    expect(wynik.previousPrints).toBe(0);
    expect(wynik.templateVersion).toBeNull();
    expect(wynik.person).toBeNull();
  });

  it("nieczytelna odpowiedź wydruku nie udaje sukcesu", async () => {
    rpc().setData("event_badge_print_record", null);

    const wynik = await api.recordBadgePrintScan({ deviceToken: TOKEN_BRAMKI, code: KOD });

    expect(wynik.outcome).toBe("unknown");
    expect(wynik.printId).toBeNull();
  });

  it("BLOKADA urządzenia dochodzi także ze ścieżki wydruku", async () => {
    rpc().setData("event_badge_print_record", { outcome: "unknown_code", device_locked: true });

    const wynik = await api.recordBadgePrintScan({ deviceToken: TOKEN_BRAMKI, code: KOD });

    expect(wynik.deviceLocked).toBe(true);
  });
});
