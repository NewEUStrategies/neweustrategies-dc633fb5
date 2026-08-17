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

export type LeadTimelineEventType =
  "submit" | "consent" | "note" | "stage_change" | "webhook" | "newsletter";

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
