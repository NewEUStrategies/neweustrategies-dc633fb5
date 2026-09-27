// Odpowiedź `event_sponsor_report_for_token` -> model strony raportu dla sponsora.
//
// PARSER Z WARTOŚCIAMI AWARYJNYMI, NIE RZUTOWANIE. Odpowiedź przychodzi jako
// jsonb przez funkcję serwerową (`{ json }` - serializator TanStack nie lubi
// jsonb), więc jej kształt nie jest sprawdzony przez kompilator. Każde pole
// czytamy defensywnie: brakujące liczby to zero, brakujący tekst to `null`,
// a nieznany powód odmowy to `error` - strona ma się narysować także dla
// odpowiedzi ze starszej wersji funkcji. Ta sama doktryna, co `meetingExchange.ts`.
//
// KONTAKTY TYLKO GDY LINK JE OBEJMUJE. `leads === null` znaczy „organizator
// udostępnił raport bez listy", a pusta tablica - „lista jest, ale pusta".
// To dwie różne odpowiedzi i strona mówi każdą osobno.
import { isSponsorPlacement, type SponsorPlacement } from "@/lib/events/sponsorExposure";
import type { SponsorDailyPoint } from "@/lib/events/sponsorReportModel";

export const SPONSOR_REPORT_FAILURES = ["not_found", "expired", "rate_limited", "error"] as const;
export type SponsorReportFailure = (typeof SPONSOR_REPORT_FAILURES)[number];

export interface PublicSponsorPlacement {
  placement: SponsorPlacement;
  viewsUnique: number;
  viewsTotal: number;
  clicksUnique: number;
  clicksTotal: number;
  materialOpens: number;
}

/** Wiersz kontaktu - te same nazwy pól, co eksport kontaktów w panelu. */
export interface PublicSponsorLead {
  sponsor_name: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  consent: boolean | null;
  consent_snapshot_at: string | null;
  interest_rating: number | null;
  note: string | null;
  scan_count: number | null;
  first_scanned_at: string | null;
  last_scanned_at: string | null;
  device_label: string | null;
}

export interface PublicSponsorReport {
  ok: true;
  generatedAt: string | null;
  event: {
    slug: string;
    titlePl: string | null;
    titleEn: string | null;
    timezone: string | null;
    startsAt: string | null;
    endsAt: string | null;
  };
  sponsor: {
    name: string;
    logoUrl: string | null;
    role: string | null;
    tierNamePl: string | null;
    tierNameEn: string | null;
  };
  link: { label: string | null; expiresAt: string | null; includeLeads: boolean };
  totals: {
    viewsUnique: number;
    viewsTotal: number;
    clicksUnique: number;
    clicksTotal: number;
    materialOpens: number;
    leadsTotal: number;
    leadsConsented: number;
    /** Umówione (`meetings_accepted`), jak w raporcie w studiu. */
    meetingsScheduled: number;
    meetingsHeld: number;
  };
  placements: PublicSponsorPlacement[];
  series: SponsorDailyPoint[];
  leads: PublicSponsorLead[] | null;
}

export type PublicSponsorReportResult =
  PublicSponsorReport | { ok: false; reason: SponsorReportFailure };

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function failure(reason: unknown): { ok: false; reason: SponsorReportFailure } {
  return {
    ok: false,
    reason: (SPONSOR_REPORT_FAILURES as readonly unknown[]).includes(reason)
      ? (reason as SponsorReportFailure)
      : "error",
  };
}

function parseLead(value: unknown): PublicSponsorLead {
  const row = obj(value);
  return {
    sponsor_name: text(row.sponsor_name),
    first_name: text(row.first_name),
    last_name: text(row.last_name),
    company: text(row.company),
    job_title: text(row.job_title),
    email: text(row.email),
    phone: text(row.phone),
    consent: typeof row.consent === "boolean" ? row.consent : null,
    consent_snapshot_at: text(row.consent_snapshot_at),
    interest_rating: numOrNull(row.interest_rating),
    note: text(row.note),
    scan_count: numOrNull(row.scan_count),
    first_scanned_at: text(row.first_scanned_at),
    last_scanned_at: text(row.last_scanned_at),
    device_label: text(row.device_label),
  };
}

function parsePlacements(value: unknown): PublicSponsorPlacement[] {
  const out: PublicSponsorPlacement[] = [];
  for (const item of list(value)) {
    const row = obj(item);
    if (!isSponsorPlacement(row.placement)) continue;
    out.push({
      placement: row.placement,
      viewsUnique: num(row.views_unique),
      viewsTotal: num(row.views_total),
      clicksUnique: num(row.clicks_unique),
      clicksTotal: num(row.clicks_total),
      materialOpens: num(row.material_opens),
    });
  }
  return out;
}

function parseSeries(value: unknown): SponsorDailyPoint[] {
  const out: SponsorDailyPoint[] = [];
  for (const item of list(value)) {
    const row = obj(item);
    const day = text(row.day);
    if (day === null) continue;
    out.push({
      day: day.slice(0, 10),
      viewsUnique: num(row.views_unique),
      clicksUnique: num(row.clicks_unique),
      materialOpens: num(row.material_opens),
      leadsNew: num(row.leads_new),
    });
  }
  return out;
}

export function parseSponsorReportPayload(raw: unknown): PublicSponsorReportResult {
  const root = obj(raw);
  if (root.ok !== true) return failure(root.reason);
  const event = obj(root.event);
  const sponsor = obj(root.sponsor);
  const link = obj(root.link);
  const totals = obj(root.totals);
  return {
    ok: true,
    generatedAt: text(root.generated_at),
    event: {
      slug: text(event.slug) ?? "",
      titlePl: text(event.title_pl),
      titleEn: text(event.title_en),
      timezone: text(event.timezone),
      startsAt: text(event.starts_at),
      endsAt: text(event.ends_at),
    },
    sponsor: {
      name: text(sponsor.name) ?? "",
      logoUrl: text(sponsor.logo_url),
      role: text(sponsor.role),
      tierNamePl: text(sponsor.tier_name_pl),
      tierNameEn: text(sponsor.tier_name_en),
    },
    link: {
      label: text(link.label),
      expiresAt: text(link.expires_at),
      includeLeads: link.include_leads === true,
    },
    totals: {
      viewsUnique: num(totals.views_unique),
      viewsTotal: num(totals.views_total),
      clicksUnique: num(totals.clicks_unique),
      clicksTotal: num(totals.clicks_total),
      materialOpens: num(totals.material_opens),
      leadsTotal: num(totals.leads_total),
      leadsConsented: num(totals.leads_consented),
      meetingsScheduled: num(totals.meetings_accepted),
      meetingsHeld: num(totals.meetings_held),
    },
    placements: parsePlacements(root.placements),
    series: parseSeries(root.series),
    leads: Array.isArray(root.leads) ? root.leads.map(parseLead) : null,
  };
}

/** Tekst JSON z funkcji serwerowej -> model; zepsuty JSON to `error`. */
export function parseSponsorReportJson(json: string): PublicSponsorReportResult {
  try {
    return parseSponsorReportPayload(JSON.parse(json));
  } catch {
    return failure("error");
  }
}
