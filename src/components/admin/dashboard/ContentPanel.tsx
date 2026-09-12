// SEKCJA "TREŚĆ": co wyszło i co ludzie czytali.
//
// Czytelność liczymy z `post_views` (pomiar własny wpisów), a nie ze ścieżek
// w `analytics_events` - tam odsłona wpisu jest jedną z wielu ścieżek i trzeba
// by ją rozpoznawać po adresie, a tu jest wprost wierszem o wpisie.
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-dashboard";
import { FileText, Eye, PencilLine } from "lucide-react";

import { Card } from "@/components/ui/card";
import { chartLangFrom } from "@/lib/charts/format";
import { computeDelta, formatCount } from "@/lib/admin/dashboard/compare";
import type { ContentReport } from "@/lib/admin/dashboard/types";
import { StatTile } from "./StatTile";
import { RankedList } from "./RankedList";

export interface ContentPanelProps {
  report: ContentReport;
}

export function ContentPanel({ report }: ContentPanelProps) {
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const { current, previous, totals } = report;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
        <StatTile
          label={t("adminDashboard.content.published")}
          value={formatCount(current.published, lang)}
          delta={computeDelta(current.published, previous.published)}
          icon={<PencilLine className="w-4 h-4" aria-hidden="true" />}
          to="/admin/posts"
        />
        <StatTile
          label={t("adminDashboard.content.views")}
          value={formatCount(current.views, lang)}
          delta={computeDelta(current.views, previous.views)}
          icon={<Eye className="w-4 h-4" aria-hidden="true" />}
        />
        <StatTile
          label={t("adminDashboard.content.readers")}
          value={formatCount(current.readers, lang)}
          delta={computeDelta(current.readers, previous.readers)}
        />
        <StatTile
          label={t("adminDashboard.content.posts")}
          value={formatCount(totals.posts, lang)}
          hint={`${formatCount(totals.published, lang)} ${t("adminDashboard.content.published").toLowerCase()}`}
          icon={<FileText className="w-4 h-4" aria-hidden="true" />}
          to="/admin/posts"
        />
        <StatTile
          label={t("adminDashboard.content.drafts")}
          value={formatCount(totals.drafts, lang)}
          hint={
            totals.scheduled > 0
              ? `${formatCount(totals.scheduled, lang)} ${t("adminDashboard.content.scheduled").toLowerCase()}`
              : undefined
          }
        />
      </div>

      <Card className="p-3">
        <h3 className="text-xs font-semibold mb-1.5">{t("adminDashboard.content.topPosts")}</h3>
        <RankedList
          rows={report.topPosts.map((p) => ({
            id: p.slug,
            label: p.title,
            value: p.views,
            secondary: p.readers,
          }))}
          labelHeader={t("adminDashboard.content.colTitle")}
          secondaryHeader={t("adminDashboard.content.colReaders")}
          valueHeader={t("adminDashboard.content.colViews")}
          total={current.views}
          maxRows={10}
        />
      </Card>
    </div>
  );
}
