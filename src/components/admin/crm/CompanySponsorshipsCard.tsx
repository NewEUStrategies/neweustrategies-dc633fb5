// Karta „Sponsoring wydarzeń" na stronie firmy w CRM (`/admin/companies/$id`).
//
// SKĄD DANE. Sponsor wydarzenia JEST firmą z kartoteki (`event_sponsors
// .company_id`), więc historia sponsoringu to lista przypięć tej firmy na
// wydarzeniach najemcy z metrykami raportu: wyświetlenia, kliknięcia, kontakty
// ze stoiska (także ze zgodą na przekazanie), spotkania i aktywne linki.
// Każdy wiersz prowadzi do raportu sponsora w studiu wydarzenia, z filtrem
// tego sponsora (`?sponsor=`).
//
// REDAKTOR CRM NIE WIDZI KARTY. Dane modułu Wydarzeń są tylko dla admina
// (`assert_event_admin_tenant()` w `admin_event_company_sponsorships`), a CRM
// wpuszcza też redaktora. Odmowa `forbidden` chowa kartę całkowicie - pusta
// karta z komunikatem o uprawnieniach byłaby szumem na każdej stronie firmy.
// Inny błąd mówi zdaniem, że historii nie udało się wczytać.
//
// Karta ma własną nakładkę i18n (`i18n-admin-event-sponsor-report`), bo strona
// firmy ma lokalny słownik z progiem zakodowanych tekstów, którego nie wolno
// podnosić.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Handshake } from "@/lib/lucide-shim";
import { adminSponsorReportFailure } from "@/lib/events/adminSponsorReportErrors";
import { adminSponsorRoleLabelKey } from "@/lib/events/sponsorReportLabels";
import { formatEventDate } from "@/lib/events/timezone";
import { useCompanySponsorships } from "@/lib/events/useSponsorReport";
import { formatNumber, uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureSponsorReportI18n } from "@/lib/i18n-admin-event-sponsor-report";

const FORBIDDEN_KEY = "adminEventSponsorReport.errors.forbidden";

export function CompanySponsorshipsCard({ companyId }: { companyId: string }) {
  ensureSponsorReportI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const query = useCompanySponsorships(companyId);

  if (query.isPending) return null;
  if (query.isError && adminSponsorReportFailure(query.error).key === FORBIDDEN_KEY) return null;

  const rows = query.data ?? [];
  const count = (value: number) => formatNumber(value, lang);

  return (
    <section className="rounded-md border bg-card" aria-labelledby="company-sponsorships-title">
      <header className="flex items-center justify-between border-b px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span id="company-sponsorships-title" className="inline-flex items-center gap-1.5">
          <Handshake className="h-3.5 w-3.5" aria-hidden />
          {t("adminEventSponsorReport.company.title")}
        </span>
        {query.isError ? null : (
          <span className="rounded bg-muted px-1.5 py-0 text-[10px] tabular-nums text-foreground">
            {rows.length}
          </span>
        )}
      </header>
      {query.isError ? (
        <p className="px-3 py-4 text-[12px] text-destructive">
          {t("adminEventSponsorReport.company.loadError")}
        </p>
      ) : rows.length === 0 ? (
        <p className="px-3 py-4 text-[12px] text-muted-foreground">
          {t("adminEventSponsorReport.company.empty")}
        </p>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => {
            const title = pickLocalized(
              { title_pl: row.event_title_pl, title_en: row.event_title_en },
              "title",
              lang,
              row.event_slug,
            );
            const tier = pickLocalized(
              { name_pl: row.tier_name_pl, name_en: row.tier_name_en },
              "name",
              lang,
            );
            return (
              <li key={row.sponsor_id} className="space-y-1 px-2.5 py-2">
                <Link
                  to="/admin/events/$eventId/sponsor-report"
                  params={{ eventId: row.event_id }}
                  search={{ sponsor: row.sponsor_id }}
                  aria-label={t("adminEventSponsorReport.company.openReport", { title })}
                  className="block truncate text-[12px] font-medium text-foreground hover:underline"
                >
                  {title}
                </Link>
                <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                  <span>{formatEventDate(row.event_starts_at, null, lang)}</span>
                  <span aria-hidden>·</span>
                  <span>{t(adminSponsorRoleLabelKey(row.role))}</span>
                  {tier === "" ? null : (
                    <>
                      <span aria-hidden>·</span>
                      <span>{tier}</span>
                    </>
                  )}
                  {row.is_published ? null : (
                    <Badge variant="outline" className="px-1 py-0 text-[10px]">
                      {t("adminEventSponsorReport.company.unpublished")}
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {t("adminEventSponsorReport.company.metrics", {
                    views: count(row.views_unique),
                    clicks: count(row.clicks_unique),
                    leads: count(row.leads_total),
                    consented: count(row.leads_consented),
                    meetings: count(row.meetings_held),
                  })}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
