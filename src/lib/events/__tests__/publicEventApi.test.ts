// Kontrakt wywolan RPC powierzchni uczestnika i plaszczyzny urzadzenia.
//
// TU PILNUJEMY KSZTALTU LADUNKU, NIE LOGIKI. Reguly maja wlasne testy czyste;
// ten plik odpowiada na inne pytanie: czy do bazy jedzie DOKLADNIE to, czego
// oczekuje sygnatura funkcji plpgsql. Rozjazd jednej nazwy klucza konczy sie
// odmowa dopiero na produkcji, bo `jsonb` nie sprawdza sie przy kompilacji.
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

const publicApi = await import("@/lib/events/publicEventApi");
const scannerApi = await import("@/lib/events/scannerApi");

const TOKEN = "a".repeat(32);

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("publicEventApi - powierzchnia uczestnika", () => {
  it("zapis na sesje jedzie jako `p_payload` z sesja i stanem", async () => {
    h.rpc?.setData("event_session_signup", {
      status: "waitlist",
      promoted: false,
      registered: 30,
      seats_left: 0,
    });
    const result = await publicApi.submitSessionSignup({
      sessionId: "s1",
      status: "registered",
    });
    expect(result.status).toBe("waitlist");
    expect(result.seatsLeft).toBe(0);
    const payload = h.rpc?.lastCall("event_session_signup")?.arg("p_payload");
    expect(payload).toEqual({ session_id: "s1", status: "registered" });
  });

  it("nieznany stan odpowiedzi czyta sie jako rezygnacja, a nie jako miejsce", async () => {
    h.rpc?.setData("event_session_signup", { status: "kosmos" });
    const result = await publicApi.submitSessionSignup({ sessionId: "s1", status: "registered" });
    expect(result.status).toBe("cancelled");
  });

  it("dostep do sesji nie wnosi adresu transmisji, gdy baza go nie oddala", async () => {
    h.rpc?.setData("event_session_access", {
      can_stream: false,
      can_watch: true,
      reason: "signup_required",
    });
    const access = await publicApi.fetchSessionAccess("s1");
    expect(access.streamUrl).toBeNull();
    expect(access.reason).toBe("signup_required");
    expect(h.rpc?.lastCall("event_session_access")?.arg("_session_id")).toBe("s1");
  });

  it("przelaczenie zakladki BEZ pola `state` zostawia decyzje bazie", async () => {
    h.rpc?.setData("event_bookmark_toggle", { event_id: "e1", bookmarked: true });
    await publicApi.toggleEventBookmark({ eventSlug: "kongres" });
    expect(h.rpc?.lastCall("event_bookmark_toggle")?.arg("p_payload")).toEqual({
      event_slug: "kongres",
    });
  });

  it("licznik calosci bierze sie z okna analitycznego, nie z dlugosci strony", async () => {
    h.rpc?.setData("event_bookmarks_mine", [
      { event_id: "e1", total_count: 42 },
      { event_id: "e2", total_count: 42 },
    ]);
    const page = await publicApi.fetchMyBookmarks({ scope: "upcoming", limit: 24, offset: 0 });
    expect(page.totalCount).toBe(42);
    expect(page.rows).toHaveLength(2);
  });
});

describe("scannerApi - plaszczyzna urzadzenia", () => {
  it("odprawa niesie klucz idempotencji i chwile SKANU", async () => {
    h.rpc?.setData("event_checkin_record", {
      outcome: "granted",
      admit: true,
      result: "granted",
      checkin_id: "k1",
      direction: "in",
      occurred_at: "2026-09-01T08:00:01Z",
      repeat_count: 0,
      checkpoint: { id: "c1", occupancy: 12 },
      person: { person_id: "p1", first_name: "Anna", badge_printed: true },
    });
    const result = await scannerApi.recordCheckinScan({
      deviceToken: TOKEN,
      code: "QR",
      checkpointId: "c1",
      direction: "in",
      clientScanUid: "uid-1",
      deviceScannedAt: "2026-09-01T08:00:00Z",
    });
    expect(result.admit).toBe(true);
    expect(result.person?.badgePrinted).toBe(true);
    expect(h.rpc?.lastCall("event_checkin_record")?.arg("p_payload")).toEqual({
      device_token: TOKEN,
      code: "QR",
      checkpoint_id: "c1",
      direction: "in",
      client_scan_uid: "uid-1",
      device_scanned_at: "2026-09-01T08:00:00Z",
    });
  });

  it("podglad decyzji NIE wysyla klucza idempotencji - nie zapisuje sie w dzienniku", async () => {
    h.rpc?.setData("event_checkin_resolve", { outcome: "unknown_code", admit: false });
    await scannerApi.resolveCheckinScan({ deviceToken: TOKEN, code: "QR", checkpointId: "c1" });
    const payload = h.rpc?.lastCall("event_checkin_resolve")?.arg("p_payload") as Record<
      string,
      unknown
    >;
    expect(Object.keys(payload).sort()).toEqual(["checkpoint_id", "code", "device_token"]);
  });

  it("bez zgody uczestnika skan leadu nie przynosi danych kontaktowych", async () => {
    h.rpc?.setData("event_lead_scan_record", {
      outcome: "saved",
      lead_id: "l1",
      scan_count: 2,
      consent: false,
      person: null,
    });
    const result = await scannerApi.recordLeadScan({ deviceToken: TOKEN, code: "QR" });
    expect(result.consent).toBe(false);
    expect(result.person).toBeNull();
    expect(result.scanCount).toBe(2);
  });

  it("odpowiedz `bootstrap` bez wydarzenia jest odmowa, a nie pusta sesja", async () => {
    h.rpc?.setData("event_scanner_bootstrap", { device_id: "d1" });
    await expect(scannerApi.bootstrapScanner(TOKEN)).rejects.toThrow(/invalid_device_token/);
  });

  it("lista leadow oddaje liczniki i pomija wiersz bez identyfikatora", async () => {
    h.rpc?.setData("event_lead_scans_list", {
      total_count: 3,
      with_consent_count: 1,
      rows: [{ lead_id: "l1", scan_count: 1, consent: true }, { scan_count: 9 }],
    });
    const page = await scannerApi.fetchDeviceLeads({ deviceToken: TOKEN, limit: 50, offset: 0 });
    expect(page.totalCount).toBe(3);
    expect(page.withConsentCount).toBe(1);
    expect(page.rows).toHaveLength(1);
  });

  it("odmowa bazy wychodzi jako blad z zachowanym kluczem", async () => {
    h.rpc?.setError("event_badge_print_record", "template_missing: no default template");
    await expect(
      scannerApi.recordBadgePrintScan({ deviceToken: TOKEN, code: "QR" }),
    ).rejects.toThrow(/template_missing/);
  });
});
