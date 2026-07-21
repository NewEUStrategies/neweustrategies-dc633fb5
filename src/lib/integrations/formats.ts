// Adaptery formatów outboxu integracji (zamiast jednego generycznego POST).
//
// Dispatcher (dispatch.functions.ts) dostaje z outboxu kopertę zdarzenia
// domenowego i - zależnie od rodzaju endpointu (integration_endpoints.integration)
// - buduje żądanie w formacie natywnym odbiorcy:
//   - webhook (i nieobsłużone rodzaje): dotychczasowa koperta JSON + HMAC,
//   - slack:   Slack Block Kit (incoming webhook; bez podpisu HMAC),
//   - hubspot: upsert kontaktu przez CRM v3 batch API (Bearer = sekret z Vault).
//
// Moduł jest CZYSTY (bez importów serwerowych) - formatery testuje vitest bez
// sieci, a dispatcher pozostaje jedynym miejscem wykonującym HTTP.
import type { Json } from "@/integrations/supabase/types";

export const INTEGRATION_KINDS = ["webhook", "slack", "hubspot", "gcal", "confluence"] as const;

export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

/** Rodzaje z dedykowanym adapterem payloadu (reszta idzie generyczną kopertą). */
export const ADAPTER_KINDS: readonly IntegrationKind[] = ["slack", "hubspot"] as const;

export function normalizeIntegrationKind(raw: string | null | undefined): IntegrationKind {
  const value = (raw ?? "").trim().toLowerCase();
  return (INTEGRATION_KINDS as readonly string[]).includes(value)
    ? (value as IntegrationKind)
    : "webhook";
}

/** Koperta dostawy - kształt budowany przez tg_route_domain_event_to_integrations. */
export interface DeliveryEnvelope {
  id: string | null;
  event_type: string;
  aggregate_type: string | null;
  aggregate_id: string | null;
  payload: Record<string, unknown>;
  correlation_id: string | null;
  created_at: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Defensywny parser koperty - outbox przechowuje jsonb, kształt traktujemy jako niezaufany. */
export function parseDeliveryEnvelope(raw: Json, eventType: string): DeliveryEnvelope {
  const root = asRecord(raw);
  return {
    id: asText(root.id) || null,
    event_type: asText(root.event_type) || eventType,
    aggregate_type: asText(root.aggregate_type) || null,
    aggregate_id: asText(root.aggregate_id) || null,
    payload: asRecord(root.payload),
    correlation_id: asText(root.correlation_id) || null,
    created_at: asText(root.created_at) || null,
  };
}

export interface FormattedRequest {
  /** Finalny URL (HubSpot dokleja ścieżkę API do bazy z konfiguracji endpointu). */
  url: string;
  body: string;
  headers: Record<string, string>;
  /** Czy dispatcher ma doliczyć podpis HMAC x-nes-signature (tylko generyczny webhook). */
  sign: boolean;
}

export type FormatDeliveryResult =
  | { kind: "send"; request: FormattedRequest }
  /** Zdarzenie nie mapuje się na format odbiorcy - dostawa kończy się sukcesem bez HTTP. */
  | { kind: "skip"; reason: string }
  /** Błąd konfiguracji endpointu - dostawa ma się nie udać (retry po naprawie konfiguracji). */
  | { kind: "fail"; reason: string };

export interface FormatDeliveryOptions {
  kind: IntegrationKind;
  endpointUrl: string;
  envelope: DeliveryEnvelope;
  /** Surowa koperta jsonb z outboxu - generyczny webhook wysyła ją 1:1 (stabilny kontrakt). */
  raw: Json;
  /** Sekret endpointu z Vault: klucz HMAC (webhook) lub token Bearer (HubSpot). */
  secret: string | null;
}

// ----------------------------------------------------------------------------
// Slack Block Kit
// ----------------------------------------------------------------------------

interface SlackTextObject {
  type: "mrkdwn" | "plain_text";
  text: string;
  emoji?: boolean;
}

interface SlackHeaderBlock {
  type: "header";
  text: SlackTextObject;
}

interface SlackSectionBlock {
  type: "section";
  text?: SlackTextObject;
  fields?: SlackTextObject[];
}

interface SlackContextBlock {
  type: "context";
  elements: SlackTextObject[];
}

export type SlackBlock = SlackHeaderBlock | SlackSectionBlock | SlackContextBlock;

export interface SlackMessage {
  text: string;
  blocks: SlackBlock[];
}

interface EventLabel {
  emoji: string;
  pl: string;
  en: string;
}

/**
 * Etykiety zdarzeń dwujęzycznie (platforma jest PL/EN; kanał Slack nie zna
 * języka odbiorcy, więc nagłówek niesie obie wersje: "PL - EN").
 */
const EVENT_LABELS: Readonly<Record<string, EventLabel>> = {
  "post.created.v1": { emoji: "📝", pl: "Nowy wpis", en: "New post" },
  "post.published.v1": { emoji: "🚀", pl: "Wpis opublikowany", en: "Post published" },
  "post.status_changed.v1": { emoji: "🔄", pl: "Zmiana statusu wpisu", en: "Post status changed" },
  "post.deleted.v1": { emoji: "🗑️", pl: "Wpis usunięty", en: "Post deleted" },
  "comment.created.v1": { emoji: "💬", pl: "Nowy komentarz", en: "New comment" },
  "comment.status_changed.v1": {
    emoji: "🛡️",
    pl: "Moderacja komentarza",
    en: "Comment moderated",
  },
  "message.sent.v1": { emoji: "✉️", pl: "Nowa wiadomość", en: "New message" },
  "crm_lead.created.v1": { emoji: "🧲", pl: "Nowy lead CRM", en: "New CRM lead" },
  "crm_lead.stage_changed.v1": {
    emoji: "📈",
    pl: "Zmiana etapu leada",
    en: "Lead stage changed",
  },
  "crm_lead.updated.v1": { emoji: "🧲", pl: "Aktualizacja leada", en: "Lead updated" },
  "crm_note.created.v1": { emoji: "🗒️", pl: "Notatka CRM", en: "CRM note" },
  "crm_task.created.v1": { emoji: "📌", pl: "Nowe zadanie CRM", en: "New CRM task" },
  "crm_task.completed.v1": { emoji: "✅", pl: "Zadanie wykonane", en: "Task completed" },
  "crm_task.due.v1": { emoji: "⏰", pl: "Follow-up do zrobienia", en: "Follow-up due" },
  "newsletter_subscriber.subscribed.v1": {
    emoji: "📬",
    pl: "Zapis do newslettera",
    en: "Newsletter signup",
  },
  "newsletter_subscriber.confirmed.v1": {
    emoji: "✅",
    pl: "Subskrypcja potwierdzona",
    en: "Subscription confirmed",
  },
  "newsletter_subscriber.unsubscribed.v1": {
    emoji: "👋",
    pl: "Wypis z newslettera",
    en: "Unsubscribed",
  },
  "event.published.v1": { emoji: "📅", pl: "Wydarzenie opublikowane", en: "Event published" },
  "event.cancelled.v1": { emoji: "🚫", pl: "Wydarzenie odwołane", en: "Event cancelled" },
  "mention.created.v1": { emoji: "🔔", pl: "Wzmianka", en: "Mention" },
  "policy.updated.v1": { emoji: "🏛️", pl: "Aktualizacja dossier", en: "Policy update" },
};

const GENERIC_LABEL: EventLabel = { emoji: "📡", pl: "Zdarzenie platformy", en: "Platform event" };

/** Escapowanie mrkdwn wg wymogów Slacka (tylko &, <, > wymagają encji). */
export function escapeSlackText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

interface SlackField {
  label: string;
  value: string;
}

/** Pola sekcji: wyciągamy z payloadu tylko znane, bezpieczne do pokazania klucze. */
function slackFields(payload: Record<string, unknown>): SlackField[] {
  const fields: SlackField[] = [];
  const push = (label: string, raw: unknown) => {
    const value = asText(raw).trim();
    if (value) fields.push({ label, value: truncate(value, 160) });
  };

  const title = asText(payload.title_pl).trim() || asText(payload.title_en).trim();
  if (title) fields.push({ label: "Tytuł / Title", value: truncate(title, 160) });
  push("Email", payload.email);
  const oldStage = asText(payload.old_stage).trim();
  const newStage = asText(payload.new_stage).trim();
  if (oldStage && newStage) {
    fields.push({ label: "Etap / Stage", value: `${oldStage} → ${newStage}` });
  } else {
    push("Etap / Stage", payload.stage);
  }
  const oldStatus = asText(payload.old_status).trim();
  const newStatus = asText(payload.new_status).trim();
  if (oldStatus && newStatus) {
    fields.push({ label: "Status", value: `${oldStatus} → ${newStatus}` });
  } else {
    push("Status", payload.status);
  }
  push("Slug", payload.slug);
  push("Źródło / Source", payload.source);
  push("Termin / Due", payload.due_at);
  push("Zadanie / Task", payload.title);
  return fields.slice(0, 8);
}

/** Wiadomość Slack (Block Kit) dla koperty zdarzenia domenowego. */
export function slackMessageForEvent(envelope: DeliveryEnvelope): SlackMessage {
  const label = EVENT_LABELS[envelope.event_type] ?? GENERIC_LABEL;
  const heading = `${label.emoji} ${label.pl} - ${label.en}`;
  const fields = slackFields(envelope.payload);
  const primary = fields[0]?.value ?? envelope.aggregate_id ?? "";

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: truncate(heading, 150), emoji: true },
    },
  ];
  if (fields.length > 0) {
    blocks.push({
      type: "section",
      fields: fields.map((f) => ({
        type: "mrkdwn",
        text: `*${escapeSlackText(f.label)}*\n${escapeSlackText(f.value)}`,
      })),
    });
  }
  const contextParts = [envelope.event_type];
  if (envelope.created_at) contextParts.push(envelope.created_at);
  if (envelope.correlation_id) contextParts.push(`corr: ${envelope.correlation_id}`);
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: escapeSlackText(truncate(contextParts.join(" · "), 240)) }],
  });

  const fallback = primary ? `${heading}: ${primary}` : heading;
  return { text: truncate(fallback, 300), blocks };
}

// ----------------------------------------------------------------------------
// HubSpot (CRM v3 - upsert kontaktu po e-mailu)
// ----------------------------------------------------------------------------

/** Zdarzenia mapowane na kontakt HubSpot; reszta jest świadomie pomijana. */
export const HUBSPOT_CONTACT_EVENT_TYPES: readonly string[] = [
  "crm_lead.created.v1",
  "crm_lead.updated.v1",
  "crm_lead.stage_changed.v1",
  "newsletter_subscriber.subscribed.v1",
  "newsletter_subscriber.confirmed.v1",
] as const;

export const HUBSPOT_UPSERT_PATH = "/crm/v3/objects/contacts/batch/upsert";

/**
 * URL bazowy z konfiguracji endpointu (zwykle https://api.hubapi.com) + ścieżka
 * batch upsert. Jeśli admin wkleił już pełną ścieżkę /crm/v3/, używamy jej wprost.
 */
export function hubspotRequestUrl(endpointUrl: string): string {
  const base = endpointUrl.trim().replace(/\/+$/, "");
  return base.includes("/crm/v3/") ? base : `${base}${HUBSPOT_UPSERT_PATH}`;
}

export interface HubSpotContactProperties {
  email: string;
  firstname?: string;
  lastname?: string;
}

export interface HubSpotBatchUpsertBody {
  inputs: Array<{
    idProperty: "email";
    id: string;
    properties: HubSpotContactProperties;
  }>;
}

/** Body upsertu kontaktu; null, gdy payload nie niesie poprawnego e-maila. */
export function hubspotContactBody(envelope: DeliveryEnvelope): HubSpotBatchUpsertBody | null {
  const email = asText(envelope.payload.email).trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  const properties: HubSpotContactProperties = { email };
  const firstName = asText(envelope.payload.first_name).trim();
  const lastName = asText(envelope.payload.last_name).trim();
  if (firstName) properties.firstname = firstName;
  if (lastName) properties.lastname = lastName;
  return { inputs: [{ idProperty: "email", id: email, properties }] };
}

// ----------------------------------------------------------------------------
// Wspólny punkt wejścia dla dispatchera
// ----------------------------------------------------------------------------

const EVENT_HEADER = "x-nes-event";

export function formatDelivery(options: FormatDeliveryOptions): FormatDeliveryResult {
  const { kind, endpointUrl, envelope, raw, secret } = options;

  if (kind === "slack") {
    const message = slackMessageForEvent(envelope);
    return {
      kind: "send",
      request: {
        url: endpointUrl,
        body: JSON.stringify(message),
        // Slack incoming webhook autoryzuje URL-em; podpis HMAC nie ma odbiorcy.
        headers: { "content-type": "application/json", [EVENT_HEADER]: envelope.event_type },
        sign: false,
      },
    };
  }

  if (kind === "hubspot") {
    if (!HUBSPOT_CONTACT_EVENT_TYPES.includes(envelope.event_type)) {
      return { kind: "skip", reason: `event ${envelope.event_type} not mapped for hubspot` };
    }
    const body = hubspotContactBody(envelope);
    if (!body) {
      return { kind: "skip", reason: "payload has no contact email" };
    }
    if (!secret) {
      // Brak tokenu to błąd konfiguracji - dostawa ma być widoczna jako failed
      // i ponowiona po ustawieniu sekretu (private app token) w panelu.
      return { kind: "fail", reason: "hubspot access token missing (set endpoint secret)" };
    }
    return {
      kind: "send",
      request: {
        url: hubspotRequestUrl(endpointUrl),
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret}`,
          [EVENT_HEADER]: envelope.event_type,
        },
        sign: false,
      },
    };
  }

  // webhook + rodzaje bez dedykowanego adaptera (gcal, confluence): surowa
  // koperta 1:1 - identyczny kontrakt (i podpis HMAC) jak przed adapterami.
  return {
    kind: "send",
    request: {
      url: endpointUrl,
      body: JSON.stringify(raw),
      headers: { "content-type": "application/json", [EVENT_HEADER]: envelope.event_type },
      sign: true,
    },
  };
}
