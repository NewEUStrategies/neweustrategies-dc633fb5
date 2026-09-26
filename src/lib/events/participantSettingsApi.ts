// Panel ustawień uczestnika: odczyt, zapis i liczniki dziennika doręczeń.
//
// TRZY RPC, JEDNA BRAMKA. `admin_event_participant_settings_get|save`
// i `admin_event_message_delivery_stats` wpuszczają wyłącznie administratora
// (i super administratora) najemcy wydarzenia - przez
// `assert_event_admin_tenant()`, nigdy `editor`. Odmowy bazy (`forbidden`,
// `not_found`, `invalid_*`) lecą do wołającego jako błąd; zdanie po ludzku
// składa `adminEventStudioErrorKey` (kody są w `KODY_STUDIA` bramki map błędów).
//
// ODPOWIEDŹ ZAPISU TO NOWY STAN. `…_save` zwraca ten sam kształt, co `…_get`,
// więc hook wstawia ją wprost do pamięci podręcznej zamiast drugiego zapytania.
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  isDeliveryChannel,
  isDeliveryKind,
  type DeliveryChannel,
  type DeliveryKind,
} from "@/lib/events/participantDeliveryKinds";
import {
  parseParticipantSettings,
  type ParticipantSettings,
} from "@/lib/events/participantSettings";

export interface MessageDeliveryStatsRow {
  kind: DeliveryKind;
  channel: DeliveryChannel;
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
}

export interface MessageDeliveryStats {
  rows: MessageDeliveryStatsRow[];
  lastSentAt: string | null;
}

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Bag)
    : null;
}

function count(source: Bag, key: string): number {
  const value = source[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function settingsOrThrow(data: unknown): ParticipantSettings {
  const parsed = parseParticipantSettings(data);
  // Nieczytelna odpowiedź NIE jest „wartościami domyślnymi" - formularz
  // z propozycją nadpisałby przy zapisie prawdziwy wiersz organizatora.
  if (parsed === null) throw new Error("unknown: participant settings response is not readable");
  return parsed;
}

/** Ustawienia wydarzenia (bez wiersza = wartości domyślne kolumn, `hasRow: false`). */
export async function fetchParticipantSettings(eventId: string): Promise<ParticipantSettings> {
  const { data, error } = await supabase.rpc("admin_event_participant_settings_get", {
    p_event_id: eventId,
  });
  if (error) throw error;
  return settingsOrThrow(data);
}

/**
 * Zapis - ładunek z `participantSettingsPayload` (tylko klucze jednego ekranu
 * + `event_id`; brak klucza = kolumna bez zmian).
 */
export async function saveParticipantSettings(payload: {
  [key: string]: Json;
}): Promise<ParticipantSettings> {
  const { data, error } = await supabase.rpc("admin_event_participant_settings_save", {
    p_payload: payload,
  });
  if (error) throw error;
  return settingsOrThrow(data);
}

/** Liczniki dziennika doręczeń wydarzenia per rodzaj i kanał. */
export async function fetchMessageDeliveryStats(eventId: string): Promise<MessageDeliveryStats> {
  const { data, error } = await supabase.rpc("admin_event_message_delivery_stats", {
    p_event_id: eventId,
  });
  if (error) throw error;
  const source = bag(data);
  const rawRows = source !== null && Array.isArray(source["rows"]) ? source["rows"] : [];
  const rows: MessageDeliveryStatsRow[] = [];
  for (const raw of rawRows) {
    const row = bag(raw);
    if (row === null || !isDeliveryKind(row["kind"]) || !isDeliveryChannel(row["channel"])) {
      continue;
    }
    rows.push({
      kind: row["kind"],
      channel: row["channel"],
      claimed: count(row, "claimed"),
      sent: count(row, "sent"),
      skipped: count(row, "skipped"),
      failed: count(row, "failed"),
    });
  }
  const last = source === null ? null : source["last_sent_at"];
  return { rows, lastSentAt: typeof last === "string" && last !== "" ? last : null };
}
