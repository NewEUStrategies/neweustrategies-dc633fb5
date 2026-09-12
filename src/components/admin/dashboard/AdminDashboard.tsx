// KOKPIT ADMINA - złożenie wszystkich sekcji na jednym oknie czasu.
//
// CO SIĘ ZMIENIŁO I DLACZEGO. Strona startowa panelu pokazywała cztery liczniki
// treści (wpisy, kategorie, tagi, media) i pasek Web Vitals. To jest pulpit
// REDAKTORA, nie osoby prowadzącej organizację: nie ma z niego jak odczytać,
// czy ruch rośnie, skąd przychodzi, czy sprzedaż idzie i ilu jest ludzi na
// platformie. Liczniki treści nie znikły - zeszły do sekcji "Treść", gdzie stoją
// obok pytania, na które naprawdę odpowiadają (co wyszło i czy to czytano).
//
// JEDNO OKNO CZASU NA CAŁY EKRAN - patrz `DashboardPeriodTabs`. Puls na żywo
// jest jedynym wyjątkiem i stoi ponad zakładkami, bo "ilu ludzi jest teraz na
// stronie" nie przestaje być aktualne, gdy patrzy się na rok.
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ensureI18n } from "@/lib/i18n-admin-dashboard";
import { REALTIME_ACTIVE_MINUTES, type DashboardPeriodId } from "@/lib/admin/dashboard/period";
import { DashboardPeriodTabs } from "./DashboardPeriodTabs";
import { DashboardSection } from "./DashboardSection";
import { RealtimeStrip } from "./RealtimeStrip";
import { TrafficPanel } from "./TrafficPanel";
import { GeoPanel } from "./GeoPanel";
import { CrmPanel } from "./CrmPanel";
import { MarketingPanel } from "./MarketingPanel";
import { AudiencePanel } from "./AudiencePanel";
import { ContentPanel } from "./ContentPanel";
import {
  useAudienceQuery,
  useContentQuery,
  useCrmQuery,
  useDashboardRange,
  useMarketingQuery,
  useRealtimeQuery,
  useTrafficQuery,
} from "./useDashboardData";

export function AdminDashboard() {
  ensureI18n();
  const { t } = useTranslation();
  const [period, setPeriod] = useState<DashboardPeriodId>("month");
  const range = useDashboardRange(period);

  const realtime = useRealtimeQuery();
  const traffic = useTrafficQuery(range);
  const crm = useCrmQuery(range);
  const marketing = useMarketingQuery(range);
  const audience = useAudienceQuery(range);
  const content = useContentQuery(range);

  // W ZAKŁADCE „NA ŻYWO" POKAZUJEMY TYLKO TO, CO W PÓŁ GODZINY MA SENS.
  // Lejek sprzedaży, przychód i nowe konta liczone z trzydziestu minut to
  // prawie zawsze zera z dopiskiem „brak odniesienia" - czyli cztery ekrany
  // szumu, przez które trzeba przewinąć do jedynej rzeczy, po którą się tu
  // przyszło. Ruch i mapa zostają, bo one w tym oknie mówią coś realnego.
  const liveOnly = period === "realtime";

  return (
    <div data-theme-typography className="space-y-6">
      <header className="space-y-3">
        <div>
          <h1 className="font-display text-xl font-bold">{t("adminDashboard.title")}</h1>
          <p className="text-xs text-muted-foreground">{t("adminDashboard.subtitle")}</p>
        </div>
        <DashboardPeriodTabs value={period} onChange={setPeriod} />
      </header>

      <DashboardSection
        title={t("adminDashboard.realtime.title")}
        subtitle={t("adminDashboard.realtime.subtitle", { minutes: REALTIME_ACTIVE_MINUTES })}
        isPending={realtime.isPending}
        isError={realtime.isError}
        onRetry={() => void realtime.refetch()}
        unavailable={realtime.data?.available === false}
      >
        {realtime.data ? <RealtimeStrip report={realtime.data.report} expanded={liveOnly} /> : null}
      </DashboardSection>

      <DashboardSection
        title={t("adminDashboard.traffic.title")}
        subtitle={t("adminDashboard.traffic.subtitle")}
        to="/admin/analytics/bi"
        linkLabel={t("adminDashboard.nav.openAnalytics")}
        isPending={traffic.isPending}
        isError={traffic.isError}
        onRetry={() => void traffic.refetch()}
        unavailable={traffic.data?.available === false}
      >
        {traffic.data ? <TrafficPanel report={traffic.data.report} range={range} /> : null}
      </DashboardSection>

      <DashboardSection
        title={t("adminDashboard.geo.title")}
        subtitle={t("adminDashboard.geo.subtitle")}
        isPending={traffic.isPending || crm.isPending}
        isError={traffic.isError}
        onRetry={() => void traffic.refetch()}
      >
        <GeoPanel
          traffic={traffic.data?.report.countries ?? []}
          leads={crm.data?.report.countries ?? []}
        />
      </DashboardSection>

      {liveOnly ? null : (
        <>
          <DashboardSection
            title={t("adminDashboard.crm.title")}
            subtitle={t("adminDashboard.crm.subtitle")}
            to="/admin/crm"
            linkLabel={t("adminDashboard.nav.openCrm")}
            isPending={crm.isPending}
            isError={crm.isError}
            onRetry={() => void crm.refetch()}
            unavailable={crm.data?.available === false}
          >
            {crm.data ? <CrmPanel report={crm.data.report} range={range} /> : null}
          </DashboardSection>

          <DashboardSection
            title={t("adminDashboard.marketing.title")}
            subtitle={t("adminDashboard.marketing.subtitle")}
            to="/admin/newsletter"
            linkLabel={t("adminDashboard.nav.openNewsletter")}
            isPending={marketing.isPending}
            isError={marketing.isError}
            onRetry={() => void marketing.refetch()}
            unavailable={marketing.data?.available === false}
          >
            {marketing.data ? (
              <MarketingPanel report={marketing.data.report} range={range} />
            ) : null}
          </DashboardSection>

          <DashboardSection
            title={t("adminDashboard.audience.title")}
            subtitle={t("adminDashboard.audience.subtitle")}
            to="/admin/users"
            linkLabel={t("adminDashboard.nav.openUsers")}
            isPending={audience.isPending}
            isError={audience.isError}
            onRetry={() => void audience.refetch()}
            unavailable={audience.data?.available === false}
          >
            {audience.data ? <AudiencePanel report={audience.data.report} range={range} /> : null}
          </DashboardSection>

          <DashboardSection
            title={t("adminDashboard.content.title")}
            subtitle={t("adminDashboard.content.subtitle")}
            to="/admin/posts"
            linkLabel={t("adminDashboard.nav.openPosts")}
            isPending={content.isPending}
            isError={content.isError}
            onRetry={() => void content.refetch()}
            unavailable={content.data?.available === false}
          >
            {content.data ? <ContentPanel report={content.data.report} /> : null}
          </DashboardSection>
        </>
      )}
    </div>
  );
}
