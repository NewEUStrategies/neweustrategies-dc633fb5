// Odmowy bazy agendy muszą docierać do organizatora jako zdanie, nie SQLSTATE.
//
// DLACZEGO TEN TEST ISTNIEJE. Klucz błędu podróżuje w GŁOWIE komunikatu
// plpgsql, więc jedyne, co spina SQL ze słownikiem, to nazwa - a nazwa jest
// tekstem w dwóch niezależnych plikach. Nowy `RAISE EXCEPTION` bez wpisu w
// słowniku pokazałby użytkownikowi surowy klucz albo pusty toast.
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { adminAgendaErrorMessage, adminAgendaFailure } from "@/lib/events/adminAgendaErrors";
import {
  adminEventAgendaEn,
  adminEventAgendaPl,
  ensureAgendaI18n,
} from "@/lib/i18n-admin-event-agenda";

/**
 * Klucze podnoszone przez migrację 20260823140000, w postaci z SQL-a, plus
 * `session_has_checkpoints` z 20261012140100 (usunięcie sesji z punktem
 * kontrolnym - klucz obcy punktu jest NO ACTION od 20261012110000).
 * `session_has_signups` od 20261012180000 liczy zapisy całego poddrzewa.
 */
const SQL_KEYS = [
  "not_found",
  "session_before_event",
  "session_after_event",
  "capacity_over_room",
  "parent_depth",
  "invalid_names",
  "invalid_event",
  "invalid_key",
  "track_in_use",
  "invalid_name",
  "invalid_capacity",
  "capacity_below_sessions",
  "room_in_use",
  "event_immutable",
  "invalid_titles",
  "invalid_times",
  "invalid_format",
  "invalid_status",
  "capacity_requires_signup",
  "invalid_tier_rank",
  "invalid_stream_url",
  "invalid_recording_url",
  "track_not_found",
  "room_not_found",
  "parent_self",
  "parent_not_found",
  "room_conflict",
  "session_has_signups",
  "session_has_checkpoints",
  "invalid_payload",
  "invalid_role",
  "speaker_not_found",
  "speaker_overlap",
  "signup_disabled",
  "session_full",
  "tier_required",
  "overlap_conflict",
  "person_not_found",
] as const;

function camel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_all, chr: string) => chr.toUpperCase());
}

function flatten(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatten(value, prefix === "" ? key : `${prefix}.${key}`),
  );
}

describe("adminEventAgenda - słownik", () => {
  it("każdy klucz błędu z SQL-a ma tłumaczenie PL i EN", () => {
    ensureAgendaI18n();
    for (const key of SQL_KEYS) {
      const path = `adminEventAgenda.errors.${camel(key)}`;
      expect(i18n.exists(path, { lng: "pl" }), `brak PL: ${path}`).toBe(true);
      expect(i18n.exists(path, { lng: "en" }), `brak EN: ${path}`).toBe(true);
    }
  });

  it("PL i EN mają identyczny zbiór kluczy", () => {
    const pl = flatten(adminEventAgendaPl).sort();
    const en = flatten(adminEventAgendaEn).sort();
    expect(en).toEqual(pl);
  });
});

describe("adminAgendaFailure", () => {
  it("rozpoznaje klucz z głowy komunikatu i wyciąga liczby z ogona", () => {
    const failure = adminAgendaFailure(
      new Error("capacity_over_room: seat limit 200 exceeds room capacity 120"),
    );
    expect(failure.key).toBe("adminEventAgenda.errors.capacityOverRoom");
    expect(failure.params).toEqual({ count: 200, total: 120 });
  });

  it("punkt kontrolny sesji: kod z 20261012140100 daje zdanie z liczbą punktów", () => {
    const error = new Error(
      "session_has_checkpoints: 2 checkpoint(s) are bound to this session or its sub-sessions - change their kind or delete them first",
    );
    const failure = adminAgendaFailure(error);
    expect(failure.key).toBe("adminEventAgenda.errors.sessionHasCheckpoints");
    expect(failure.params).toEqual({ count: 2 });
    const pl = i18n.t(failure.key, { ...failure.params, lng: "pl" });
    const en = i18n.t(failure.key, { ...failure.params, lng: "en" });
    expect(pl).toContain("(2)");
    expect(pl).toContain("punkty kontrolne");
    expect(en).toContain("2 checkpoint(s)");
  });

  it("zapisy poddrzewa: kod z 20261012180000 mówi o sesji ALBO jej podsesjach", () => {
    // Blok bez własnych zapisów odmawia zapisami podsesji (F11) - zdanie
    // „Sesja ma N zapisów" byłoby nieprawdą o samym bloku.
    const error = new Error(
      "session_has_signups: 2 active signup(s) on this session or its sub-sessions - cancel the session instead",
    );
    const failure = adminAgendaFailure(error);
    expect(failure.key).toBe("adminEventAgenda.errors.sessionHasSignups");
    expect(failure.params).toEqual({ count: 2 });
    const pl = i18n.t(failure.key, { ...failure.params, lng: "pl" });
    const en = i18n.t(failure.key, { ...failure.params, lng: "en" });
    expect(pl).toContain("podsesje");
    expect(pl).toContain("(2)");
    expect(en).toContain("sub-sessions");
    expect(en).toContain("2 active signup(s)");
  });

  it('„Failed to fetch" nie udaje klucza bazy', () => {
    expect(adminAgendaFailure(new Error("Failed to fetch")).key).toBe(
      "adminEventAgenda.errors.unknown",
    );
  });

  it("nieznany klucz spada do komunikatu zapasowego, nie do SQLSTATE", () => {
    expect(adminAgendaFailure(new Error("brand_new_key: whatever")).key).toBe(
      "adminEventAgenda.errors.unknown",
    );
  });

  it("oddaje gotowe zdanie, nie klucz", () => {
    const message = adminAgendaErrorMessage(new Error("room_conflict: overlap"));
    expect(message).not.toContain("adminEventAgenda.");
    expect(message.length).toBeGreaterThan(3);
  });
});
