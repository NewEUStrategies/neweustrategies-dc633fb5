// Kontrakt osi czasu leada (getCrmLeadTimeline) + budowa dokumentu do wydruku.
//
// Serwer zwraca `{ lead, events }` jako string JSON - obie powierzchnie (drawer
// na liście CRM i karta /admin/crm/$id) parsują ten sam kształt przez
// `parseLeadTimelinePayload`, żeby konsument nie mógł się rozjechać z handlerem.
//
// `buildLeadTimelineHtml` produkuje dokument wstawiany przez `document.write`
// do nowego okna w kontekście sesji admina. Imię, nazwisko, e-mail, tytuły i
// treści zdarzeń pochodzą z PUBLICZNYCH formularzy, więc KAŻDA interpolacja
// danych musi przejść przez `escapeHtml` - inaczej lead wstrzykuje skrypt
// wykonywany z uprawnieniami admina.
//
// TYP „event" to aktywność z modułu Wydarzeń (wiersze `audit_log` z akcją
// `event.*`, kontrakt metadanych w `./eventActivity`). Jedyne źródło unii typów:
// `TimelineEvent` serwera (`crm.functions.ts`) jest tym samym typem.
//
// TYP „journey" (SPEC §2.7, Integrator S8) to zapis kontaktu do ścieżki
// komunikacji: wejście i - gdy zapis się skończył - koniec z wynikiem. Dane
// z RPC S5 `admin_journey_lead_enrollments` (najemca i rola z sesji), więc oś
// nie dostaje własnego SQL. Kontrakt metadanych jak przy „event": `summary_pl`
// / `summary_en` (zdanie w obu językach; `title` = wersja polska dla druku
// i CSV) plus identyfikatory, z których widok buduje odnośnik do edytora.
import { eventActivitySummary, isEventActivityAction } from "@/lib/crm/eventActivity";
import type { JourneyLeadEnrollment } from "@/lib/journeys/dto";
import type { JourneyEnrollmentStatus, JourneyExitReason } from "@/lib/journeys/limits";

export type LeadTimelineEventType =
  "submit" | "consent" | "note" | "stage_change" | "webhook" | "newsletter" | "event" | "journey";

export type LeadTimelineEvent = {
  id: string;
  type: LeadTimelineEventType;
  at: string;
  title: string;
  detail: string | null;
  meta: Record<string, unknown> | null;
};

export type LeadTimelineLead = {
  email: string;
  first_name: string | null;
  last_name: string | null;
};

export type LeadTimelinePayload = {
  lead: LeadTimelineLead;
  events: LeadTimelineEvent[];
};

/** Wiersz `audit_log` w kształcie, który czyta oś czasu leada. */
export type LeadTimelineAuditRow = {
  id: string;
  action: string;
  actor_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Typ wpisu osi czasu dla wiersza audytu. Aktywność z Wydarzeń ma PIERWSZEŃSTWO
 * przed heurystyką „webhook" - akcja `event.integration.webhook_sent` jest
 * zdarzeniem wydarzenia, a nie dostawą webhooka CRM.
 */
export function auditTimelineEventType(action: string): LeadTimelineEventType {
  if (isEventActivityAction(action)) return "event";
  return action.includes("webhook") ? "webhook" : "stage_change";
}

/**
 * Wiersz audytu -> wpis osi czasu. Dla typu „event" tytułem jest polskie zdanie
 * z metadanych (druk i CSV), a `meta` niesie cały kontrakt (`summary_en`,
 * `event_id`), z którego widok bierze zdanie w swoim języku i odnośnik do studia.
 */
export function leadTimelineEventFromAudit(row: LeadTimelineAuditRow): LeadTimelineEvent {
  const type = auditTimelineEventType(row.action);
  return {
    id: `au:${row.id}`,
    type,
    at: row.created_at,
    title: type === "event" ? eventActivitySummary(row.metadata, "pl", row.action) : row.action,
    detail: null,
    meta: row.metadata ?? null,
  };
}

// Nazwy statusów i powodów wyjścia w zdaniu osi czasu. Kopia etykiet S5
// (`adminJourneys.enrollmentStatus` / `exitReason`), bo oś buduje SERWER
// (`getCrmLeadTimeline`) i widoki CRM bez nakładki i18n ścieżek (słownik
// z 14 szablonami nie ma czego szukać w chunku CRM). Zgodność słowo w słowo
// z S5 przypina `leadTimeline.test.ts` - zmiana etykiety w jednym miejscu
// oblewa test, zamiast rozjechać nazwy między kartą ścieżek a osią.
const JOURNEY_STATUS_LABEL: Readonly<Record<JourneyEnrollmentStatus, readonly [string, string]>> = {
  active: ["W toku", "In progress"],
  waiting: ["Czeka", "Waiting"],
  completed: ["Ukończona", "Completed"],
  goal_reached: ["Cel osiągnięty", "Goal reached"],
  exited: ["Wyszedł", "Left"],
  failed: ["Błąd", "Error"],
};

const JOURNEY_EXIT_LABEL: Readonly<Record<JourneyExitReason, readonly [string, string]>> = {
  completed: ["Koniec ścieżki", "End of journey"],
  goal: ["Osiągnięty cel", "Goal reached"],
  exit_event: ["Zdarzenie wyjścia", "Exit event"],
  consent: ["Brak zgody marketingowej", "No marketing consent"],
  unsubscribed: ["Wypis", "Unsubscribed"],
  suppressed: ["Adres zablokowany (odbicie, skarga)", "Address blocked (bounce, complaint)"],
  manual: ["Wyjęty ręcznie", "Removed by staff"],
  journey_archived: ["Ścieżka zarchiwizowana", "Journey archived"],
  error: ["Błąd kroku po 8 próbach", "Step error after 8 attempts"],
  entry_filter: ["Nie spełnia filtra wejścia", "Does not meet the entry filter"],
  account_deleted: ["Konto usunięte (RODO)", "Account deleted (GDPR)"],
};

/** Etykiety PL/EN użyte w zdaniach - eksport dla testu zgodności z S5. */
export const LEAD_JOURNEY_TIMELINE_LABELS = {
  status: JOURNEY_STATUS_LABEL,
  exitReason: JOURNEY_EXIT_LABEL,
} as const;

function journeySentences(
  row: JourneyLeadEnrollment,
  phase: "in" | "out",
): { pl: string; en: string } {
  // „(test)" to to samo słowo w obu językach - zapis z „Testuj na sobie".
  const test = row.isTest ? " (test)" : "";
  if (phase === "in") {
    return {
      pl: `Ścieżka „${row.journeyName}”${test}: wejście (wersja ${row.version})`,
      en: `Journey “${row.journeyName}”${test}: entered (version ${row.version})`,
    };
  }
  const [statusPl, statusEn] = JOURNEY_STATUS_LABEL[row.status];
  const reason = row.exitReason ? JOURNEY_EXIT_LABEL[row.exitReason] : null;
  return {
    pl: `Ścieżka „${row.journeyName}”${test}: ${statusPl}${reason ? ` - ${reason[0]}` : ""}`,
    en: `Journey “${row.journeyName}”${test}: ${statusEn}${reason ? ` - ${reason[1]}` : ""}`,
  };
}

/**
 * Zapisy kontaktu do ścieżek -> wpisy osi czasu: wejście (`jr:<zapis>:in`,
 * `enteredAt`) i, gdy zapis ma `finishedAt`, koniec (`jr:<zapis>:out`).
 * Zapis w toku daje jeden wpis - jego bieżący krok niesie `meta`, z którego
 * widok otwiera edytor na tym kroku (zakładka „Kontakty").
 */
export function leadTimelineEventsFromJourneys(
  rows: readonly JourneyLeadEnrollment[],
): LeadTimelineEvent[] {
  const events: LeadTimelineEvent[] = [];
  for (const row of rows) {
    const base = {
      journey_id: row.journeyId,
      journey_name: row.journeyName,
      enrollment_id: row.enrollmentId,
      status: row.status,
      exit_reason: row.exitReason,
      version: row.version,
      is_test: row.isTest,
      current_node_id: row.currentNodeId,
    };
    const entered = journeySentences(row, "in");
    events.push({
      id: `jr:${row.enrollmentId}:in`,
      type: "journey",
      at: row.enteredAt,
      title: entered.pl,
      detail: null,
      meta: { ...base, phase: "in", summary_pl: entered.pl, summary_en: entered.en },
    });
    if (row.finishedAt) {
      const finished = journeySentences(row, "out");
      events.push({
        id: `jr:${row.enrollmentId}:out`,
        type: "journey",
        at: row.finishedAt,
        title: finished.pl,
        detail: null,
        meta: { ...base, phase: "out", summary_pl: finished.pl, summary_en: finished.en },
      });
    }
  }
  return events;
}

/** Kształt `journey_definitions.id` (uuid) - inny napis nie jest adresem edytora. */
const JOURNEY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ten sam kształt węzła, który przyjmuje walidator adresu edytora. */
const JOURNEY_NODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Cel odnośnika wpisu „journey": identyfikator ścieżki i - dla zapisu w toku -
 * bieżący krok. Metadane spoza kontraktu (wpis z innego kodu, ręczny) dają
 * `null`: brak odnośnika zamiast adresu „w ciemno".
 */
export function leadJourneyTimelineTarget(
  meta: unknown,
): { journeyId: string; nodeId: string | null } | null {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return null;
  const record = meta as Record<string, unknown>;
  const journeyId = record.journey_id;
  if (typeof journeyId !== "string" || !JOURNEY_ID_PATTERN.test(journeyId)) return null;
  const node = record.current_node_id;
  const nodeId = typeof node === "string" && JOURNEY_NODE_PATTERN.test(node) ? node : null;
  return { journeyId, nodeId };
}

export function parseLeadTimelinePayload(json: string): LeadTimelinePayload {
  const raw = JSON.parse(json) as Partial<LeadTimelinePayload> | null;
  const lead = raw?.lead;
  return {
    lead: {
      email: lead?.email ?? "",
      first_name: lead?.first_name ?? null,
      last_name: lead?.last_name ?? null,
    },
    events: Array.isArray(raw?.events) ? raw.events : [],
  };
}

export function leadTimelineDisplayName(lead: LeadTimelineLead): string {
  return [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email;
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

const PRINT_CSS = `body{font:13px/1.45 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#111;padding:24px;max-width:780px;margin:0 auto}h1{font-size:18px;margin:0 0 4px}h2{font-size:12px;color:#666;font-weight:500;margin:0 0 18px}.ev{border-left:2px solid #e5e7eb;padding:6px 0 14px 14px;margin-left:6px;position:relative}.ev:before{content:"";position:absolute;left:-5px;top:9px;width:8px;height:8px;border-radius:50%;background:#FA9346}.t{font-weight:600;font-size:13px}.tm{font-size:11px;color:#666;margin-bottom:4px}.tg{display:inline-block;font-size:10px;background:#f3f4f6;border-radius:3px;padding:1px 6px;margin-right:6px;text-transform:uppercase;letter-spacing:.03em}.d{white-space:pre-wrap;color:#333;margin-top:2px}.m{font-size:11px;color:#666;font-family:ui-monospace,Menlo,monospace;margin-top:2px}@media print{body{padding:0}}`;

export function buildLeadTimelineHtml(input: {
  lead: LeadTimelineLead;
  events: readonly LeadTimelineEvent[];
  typeLabels: Record<string, string>;
  now?: Date;
}): string {
  const name = escapeHtml(leadTimelineDisplayName(input.lead));
  const email = escapeHtml(input.lead.email);
  const generatedAt = escapeHtml((input.now ?? new Date()).toLocaleString());
  const rows = input.events
    .map((e) => {
      const label = escapeHtml(input.typeLabels[e.type] ?? e.type);
      const at = escapeHtml(new Date(e.at).toLocaleString());
      const detail = e.detail ? `<div class="d">${escapeHtml(e.detail)}</div>` : "";
      const meta = e.meta ? `<div class="m">${escapeHtml(JSON.stringify(e.meta))}</div>` : "";
      return `<div class="ev"><div class="tm">${at}</div><div><span class="tg">${label}</span><span class="t">${escapeHtml(e.title)}</span></div>${detail}${meta}</div>`;
    })
    .join("");
  return `<!doctype html><meta charset="utf-8"><title>${name} - timeline</title><style>${PRINT_CSS}</style>
<h1>${name}</h1><h2>${email} - ${generatedAt}</h2>
${rows}
<script>window.onload=()=>setTimeout(()=>window.print(),250);</script>`;
}
