// Dostarczenie jednego webhooka sygnału (serwer). Bez dostępu do bazy - wynik
// klasyfikuje dyspozytor i raportuje `report_notification_signal_jobs`.
//
// Bezpieczeństwo wysyłki pod adres wpisany przez użytkownika:
//   1. kształt adresu (`checkWebhookUrl`): https, nazwa hosta, bez danych
//      logowania i portów spoza listy,
//   2. bramka SSRF `assertPublicHttpUrl`: KAŻDA odpowiedź DNS musi być
//      publicznym adresem (sprawdzane przed każdą wysyłką, nie tylko przy
//      zapisie),
//   3. `redirect: "manual"` - przekierowanie nie przeniesie żądania na adres
//      wewnętrzny po sprawdzeniu,
//   4. limit czasu 8 s i brak odczytu treści odpowiedzi (nic z niej nie
//      wraca do użytkownika ani do logów).
import {
  buildWebhookBody,
  checkWebhookUrl,
  webhookEventType,
  type SignalEvent,
  type WebhookFormat,
} from "./signals";
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  signWebhookBody,
} from "./webhookSignature";

export type WebhookOutcome = "sent" | "retry" | "dead" | "gone";

export interface WebhookDeliveryResult {
  outcome: WebhookOutcome;
  status: number | null;
  error: string | null;
}

export const WEBHOOK_TIMEOUT_MS = 8000;
const USER_AGENT = "NES-Webhooks/1.0 (+https://neweuropeanstrategies.com)";

/**
 * 2xx = dostarczone; 404/410 = adres nie istnieje (Slack i Discord tak
 * odpowiadają na usunięty webhook) - webhook zostaje wyłączony; 408/425/429
 * i 5xx = chwilowe, ponowienie z backoffem; pozostałe 4xx i 3xx = żądanie
 * nigdy nie przejdzie (zły format, przekierowanie, brak uprawnień).
 */
export function classifyWebhookStatus(status: number): WebhookOutcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "gone";
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "retry";
  return "dead";
}

export interface WebhookTarget {
  url: string;
  secret: string;
  format: WebhookFormat;
}

export interface DeliverOptions {
  deliveryId: string;
  nowSec?: number;
  fetchImpl?: typeof fetch;
  /** Bramka SSRF - domyślnie `assertPublicHttpUrl` (wstrzykiwana w testach). */
  assertPublicUrl?: (url: string) => Promise<unknown>;
  timeoutMs?: number;
}

/** Powody odmowy bramki, które znaczą "nie dało się sprawdzić" - nie atak. */
const TRANSIENT_GUARD_REASONS = new Set(["dns", "dns_empty"]);

function guardReason(err: unknown): string | null {
  if (err && typeof err === "object" && "reason" in err) {
    const reason = (err as { reason: unknown }).reason;
    return typeof reason === "string" ? reason : null;
  }
  return null;
}

async function defaultAssertPublicUrl(url: string): Promise<unknown> {
  const { assertPublicHttpUrl } = await import("@/lib/http/egressGuard.server");
  return assertPublicHttpUrl(url);
}

export async function deliverSignalWebhook(
  target: WebhookTarget,
  event: SignalEvent,
  options: DeliverOptions,
): Promise<WebhookDeliveryResult> {
  const shape = checkWebhookUrl(target.url);
  if (!shape.ok) return { outcome: "dead", status: null, error: `invalid_url:${shape.issue}` };

  try {
    await (options.assertPublicUrl ?? defaultAssertPublicUrl)(shape.url);
  } catch (err) {
    const reason = guardReason(err) ?? "blocked";
    return {
      outcome: TRANSIENT_GUARD_REASONS.has(reason) ? "retry" : "dead",
      status: null,
      error: `blocked_url:${reason}`,
    };
  }

  const body = buildWebhookBody(target.format, event);
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "user-agent": USER_AGENT,
    [WEBHOOK_EVENT_HEADER]: webhookEventType(event.signal),
    [WEBHOOK_DELIVERY_HEADER]: options.deliveryId,
    [WEBHOOK_SIGNATURE_HEADER]: await signWebhookBody(target.secret, body, nowSec),
  };

  try {
    const response = await (options.fetchImpl ?? fetch)(shape.url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? WEBHOOK_TIMEOUT_MS),
    });
    // Treść odpowiedzi nie jest potrzebna - zamykamy strumień bez odczytu.
    await response.body?.cancel().catch(() => undefined);
    const outcome = classifyWebhookStatus(response.status);
    return {
      outcome,
      status: response.status,
      error: outcome === "sent" ? null : `http_${response.status}`,
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : "error";
    return {
      outcome: "retry",
      status: null,
      error: name === "TimeoutError" ? "timeout" : "network",
    };
  }
}
