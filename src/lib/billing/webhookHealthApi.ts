// Zdrowie webhooków - odczyt metryk przez RPC `admin_payment_webhook_health`.
//
// RPC, NIE ZAPYTANIE Z PRZEGLĄDARKI. Dziennik zdarzeń operatora jest zamknięty
// (RLS + brak grantów odczytu), a metryka to agregat po całej tabeli - liczenie
// jej po stronie klienta wymagałoby otwarcia wierszy z ładunkami płatności.
// Funkcja bazy sprawdza rolę `admin` i oddaje wyłącznie liczby.
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type HealthEnv = "sandbox" | "live";

export interface WebhookTypeStat {
  eventType: string;
  total: number;
  failed: number;
  avgDurationMs: number | null;
}

export interface WebhookFailureRow {
  id: string;
  eventType: string;
  error: string | null;
  occurredAt: string | null;
  retryCount: number;
}

export interface WebhookHealth {
  environment: HealthEnv;
  since: string | null;
  total: number;
  processed: number;
  skipped: number;
  failed: number;
  pending: number;
  retries: number;
  failureRate: number;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  avgLagSeconds: number | null;
  byType: WebhookTypeStat[];
  recentFailures: WebhookFailureRow[];
}

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Bag)
    : null;
}

function num(source: Bag, key: string): number {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function maybeNum(source: Bag, key: string): number | null {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function text(source: Bag, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export async function fetchWebhookHealth(
  environment: HealthEnv,
  sinceHours: number,
): Promise<WebhookHealth> {
  const { data, error } = await supabase.rpc("admin_payment_webhook_health", {
    p_payload: { environment, since_hours: sinceHours } as Json,
  });
  if (error) throw error;
  const root = bag(data);
  if (root === null) throw new Error("invalid_response");

  const byType: WebhookTypeStat[] = [];
  const rawTypes = root["by_type"];
  if (Array.isArray(rawTypes)) {
    for (const raw of rawTypes) {
      const row = bag(raw);
      const eventType = row === null ? null : text(row, "event_type");
      if (row === null || eventType === null) continue;
      byType.push({
        eventType,
        total: num(row, "total"),
        failed: num(row, "failed"),
        avgDurationMs: maybeNum(row, "avg_duration_ms"),
      });
    }
  }

  const recentFailures: WebhookFailureRow[] = [];
  const rawFailures = root["recent_failures"];
  if (Array.isArray(rawFailures)) {
    for (const raw of rawFailures) {
      const row = bag(raw);
      const id = row === null ? null : text(row, "id");
      if (row === null || id === null) continue;
      recentFailures.push({
        id,
        eventType: text(row, "event_type") ?? "unknown",
        error: text(row, "error"),
        occurredAt: text(row, "occurred_at"),
        retryCount: num(row, "retry_count"),
      });
    }
  }

  return {
    environment,
    since: text(root, "since"),
    total: num(root, "total"),
    processed: num(root, "processed"),
    skipped: num(root, "skipped"),
    failed: num(root, "failed"),
    pending: num(root, "pending"),
    retries: num(root, "retries"),
    failureRate: maybeNum(root, "failure_rate") ?? 0,
    avgDurationMs: maybeNum(root, "avg_duration_ms"),
    p95DurationMs: maybeNum(root, "p95_duration_ms"),
    avgLagSeconds: maybeNum(root, "avg_lag_seconds"),
    byType,
    recentFailures,
  };
}
