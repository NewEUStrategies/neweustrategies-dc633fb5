// Organizm: „Lejek Google Ads” jednego wydarzenia - okres, podsumowanie,
// lejek, tabela kampanii, mapowanie kampanii i koszty, eksporty, prywatnosc.
//
// LICZBY Z BAZY, NIGDY DEMONSTRACYJNE. Raport liczy `admin_event_ads_funnel`
// (jedno zapytanie na okres), a ekran niczego nie dolicza poza wskaznikami
// z `adsFunnel.ts`. Brak danych to kreska, nie zero.
//
// POPULACJE SIE NIE MIESZAJA. Lejek (paski) pokazuje wylacznie przegladarki ze
// zgoda na pomiar: wizyty, rozpoczecia, zgloszenia i oplacone Z ATRYBUCJA.
// Zgloszenia bez atrybucji sa w tabeli osobnym wierszem z wyjasnieniem, a kafle
// podsumowania mowia wprost, co licza.
//
// ZEGAR PO HYDRATACJI. Okres "ostatnie N dni" zalezy od teraz, wiec liczymy go
// z `useNowMs` zamrozonego do minuty (klucz zapytania nie drga co render);
// do pierwszego tyku zapytanie czeka.
//
// ZAPIS JAWNY. Mapowanie i koszty zapisuja okna dialogowe przyciskiem, eksport
// pobiera dane na klikniecie - identyfikatory klikniec nie leza w cache.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { AdCampaignDialog } from "@/components/admin/events/molecules/AdCampaignDialog";
import { AdCampaignList } from "@/components/admin/events/molecules/AdCampaignList";
import { AdsFunnelBars } from "@/components/admin/events/molecules/AdsFunnelBars";
import { AdsFunnelCampaignTable } from "@/components/admin/events/molecules/AdsFunnelCampaignTable";
import { AdCampaignCostsDialog } from "@/components/admin/events/organisms/AdCampaignCostsDialog";
import { EventStudioRow } from "@/components/admin/events/studio/EventStudioSection";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { AdminMetricTile } from "@/components/admin/molecules/AdminMetricTile";
import { SegmentedControl } from "@/components/atoms/SegmentedControl";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/lib/appDialogs";
import { downloadLeadExport } from "@/lib/events/leadExport";
import type { AdminEventDetailRow } from "@/lib/events/eventDetailApi";
import type { AdCampaign, AdCampaignInput } from "@/lib/events/adsFunnelApi";
import {
  ADS_FUNNEL_WINDOW_PRESETS,
  adsFunnelWindow,
  returnOnAdSpend,
  type AdsFunnelReport,
  type AdsFunnelWindowPreset,
  type CostAmount,
} from "@/lib/events/adsFunnel";
import { buildAdsFunnelCsv } from "@/lib/events/adsFunnelCsv";
import { formatAmounts, formatCosts, formatRoas } from "@/lib/events/adsFunnelFormat";
import {
  buildOfflineConversionsCsv,
  isValidConversionName,
  OFFLINE_CONVERSIONS_MIME,
  offlineConversionsFileName,
} from "@/lib/events/adsOfflineConversions";
import { adminAdsFunnelErrorMessage } from "@/lib/events/adminAdsFunnelErrors";
import {
  useAdCampaigns,
  useAdsConversionsExport,
  useAdsFunnelReport,
  useDeleteAdCampaign,
  useSaveAdCampaign,
} from "@/lib/events/useEventAdsFunnel";
import { uiLang } from "@/lib/i18n/format";
import { ensureAdsFunnelI18n } from "@/lib/i18n-admin-event-ads-funnel";
import {
  CreditCard,
  Download,
  Eye,
  Megaphone,
  Plus,
  TrendingUp,
  UserPlus,
} from "@/lib/lucide-shim";
import { useNowMs } from "@/lib/time/useNowMs";

const WINDOW_LABEL_KEYS: Record<AdsFunnelWindowPreset, string> = {
  "7d": "adminEventAdsFunnel.window.presets.7d",
  "28d": "adminEventAdsFunnel.window.presets.28d",
  "90d": "adminEventAdsFunnel.window.presets.90d",
  all: "adminEventAdsFunnel.window.presets.all",
};

const MINUTE_MS = 60_000;

/** Koszt raportu jako jedna liczba ROAS - przychod kampanii zmapowanych na ich koszt. */
function mappedRoas(report: AdsFunnelReport): number | null {
  const mapped = report.groups.filter((group) => group.kind === "campaign");
  const cost = new Map<string, number>();
  for (const group of mapped) {
    for (const item of group.cost)
      cost.set(item.currency, (cost.get(item.currency) ?? 0) + item.micros);
  }
  const costs: CostAmount[] = [...cost].map(([currency, micros]) => ({ currency, micros }));
  return returnOnAdSpend(
    mapped.flatMap((group) => group.revenue),
    costs,
  );
}

export function EventAdsFunnelPanel({ row }: { row: AdminEventDetailRow }) {
  ensureAdsFunnelI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const eventId = row.id;

  const [preset, setPreset] = useState<AdsFunnelWindowPreset>("28d");
  const nowMs = useNowMs(MINUTE_MS);
  const minute = nowMs === null ? null : Math.floor(nowMs / MINUTE_MS) * MINUTE_MS;
  const range = minute === null ? null : adsFunnelWindow(preset, minute);

  const reportQ = useAdsFunnelReport(range === null ? null : { eventId, ...range });
  const campaignsQ = useAdCampaigns(eventId);
  const saveCampaign = useSaveAdCampaign(eventId);
  const deleteCampaign = useDeleteAdCampaign(eventId);
  const exportConversions = useAdsConversionsExport();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdCampaign | null>(null);
  const [costsFor, setCostsFor] = useState<AdCampaign | null>(null);
  const [defaultConversion, setDefaultConversion] = useState("");
  const [exportNote, setExportNote] = useState<string[]>([]);

  // Do pierwszego tyku zegara (tuz po montazu) okres nie jest jeszcze znany -
  // zapytanie raportu czeka, a ekran mowi, ze wczytuje.
  if (range === null || minute === null) {
    return <p className="text-sm text-muted-foreground">{t("adminEventAdsFunnel.loading")}</p>;
  }
  // Dzien w nazwie pliku - z minuty zegara, liczony dopiero przy eksporcie.
  const todayIso = (): string => new Date(minute).toISOString();

  const report = reportQ.data ?? null;
  const campaigns = campaignsQ.data ?? [];
  const defaultConversionValid =
    defaultConversion.trim() === "" || isValidConversionName(defaultConversion.trim());

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (campaign: AdCampaign) => {
    setEditing(campaign);
    setDialogOpen(true);
  };

  const submitCampaign = (input: AdCampaignInput) => {
    saveCampaign.mutate(input, {
      onSuccess: () => {
        toast.success(t("adminEventAdsFunnel.toasts.campaignSaved"));
        setDialogOpen(false);
      },
      onError: (error) => toast.error(adminAdsFunnelErrorMessage(error)),
    });
  };

  const removeCampaign = async (campaign: AdCampaign) => {
    const confirmed = await confirmDialog({
      title: t("adminEventAdsFunnel.campaigns.deleteTitle"),
      description: t("adminEventAdsFunnel.campaigns.deleteBody"),
      confirmLabel: t("adminEventAdsFunnel.campaigns.deleteConfirm"),
      cancelLabel: t("adminEventAdsFunnel.campaigns.cancel"),
      destructive: true,
    });
    if (!confirmed) return;
    deleteCampaign.mutate(campaign.id, {
      onSuccess: () => toast.success(t("adminEventAdsFunnel.toasts.campaignDeleted")),
      onError: (error) => toast.error(adminAdsFunnelErrorMessage(error)),
    });
  };

  const exportFunnel = (current: AdsFunnelReport) => {
    const csv = buildAdsFunnelCsv(current, {
      campaign: t("adminEventAdsFunnel.table.campaign"),
      source: t("adminEventAdsFunnel.table.source"),
      medium: t("adminEventAdsFunnel.table.medium"),
      visits: t("adminEventAdsFunnel.table.visits"),
      registrationStarts: t("adminEventAdsFunnel.table.registrationStarts"),
      registrations: t("adminEventAdsFunnel.table.registrations"),
      checkoutStarts: t("adminEventAdsFunnel.table.checkoutStarts"),
      paid: t("adminEventAdsFunnel.table.paid"),
      revenue: t("adminEventAdsFunnel.table.revenue"),
      cost: t("adminEventAdsFunnel.table.cost"),
      cpa: t("adminEventAdsFunnel.table.cpa"),
      roas: t("adminEventAdsFunnel.table.roas"),
      noCampaign: t("adminEventAdsFunnel.table.noCampaign"),
      unattributed: t("adminEventAdsFunnel.table.unattributed"),
    });
    downloadLeadExport({
      fileName: `ads-funnel-${row.slug}-${todayIso().slice(0, 10)}.csv`,
      mimeType: "text/csv;charset=utf-8",
      data: `\uFEFF${csv}`,
    });
  };

  const exportAds = () => {
    exportConversions.mutate(
      { eventId, ...range },
      {
        onSuccess: (data) => {
          const file = buildOfflineConversionsCsv(data, defaultConversion);
          const notes = [
            t("adminEventAdsFunnel.export.skipped", {
              unattributed: data.skipped.unattributed,
              noClick: data.skipped.noClick,
              expired: data.skipped.expired,
              beforeClick: data.skipped.beforeClick,
            }),
          ];
          if (file.missingName > 0) {
            notes.unshift(t("adminEventAdsFunnel.export.missingName", { count: file.missingName }));
          }
          if (file.rejected > 0) {
            notes.unshift(t("adminEventAdsFunnel.export.rejected", { count: file.rejected }));
          }
          if (file.included === 0) {
            setExportNote([t("adminEventAdsFunnel.export.noRows"), ...notes]);
            return;
          }
          setExportNote([
            t("adminEventAdsFunnel.export.exported", { count: file.included }),
            ...notes,
          ]);
          downloadLeadExport({
            fileName: offlineConversionsFileName(row.slug, todayIso()),
            mimeType: OFFLINE_CONVERSIONS_MIME,
            data: file.csv,
          });
        },
        onError: (error) => toast.error(adminAdsFunnelErrorMessage(error)),
      },
    );
  };

  const attributedPaid = report === null ? 0 : report.totals.paid - report.unattributed.paid;

  return (
    <>
      <EventStudioRow
        label={t("adminEventAdsFunnel.summary.label")}
        description={t("adminEventAdsFunnel.summary.description")}
      >
        <SegmentedControl<AdsFunnelWindowPreset>
          value={preset}
          options={ADS_FUNNEL_WINDOW_PRESETS.map((value) => ({
            value,
            label: t(WINDOW_LABEL_KEYS[value]),
          }))}
          onChange={setPreset}
          ariaLabel={t("adminEventAdsFunnel.window.label")}
          size="md"
        />
        <AdminCatalogListState
          isLoading={report === null && !reportQ.isError}
          loadingLabel={t("adminEventAdsFunnel.loading")}
          errorMessage={reportQ.isError ? adminAdsFunnelErrorMessage(reportQ.error) : null}
          isEmpty={false}
          emptyLabel=""
        >
          {report === null ? null : (
            <div className="grid gap-3 sm:grid-cols-3">
              <AdminMetricTile
                icon={Eye}
                label={t("adminEventAdsFunnel.summary.visits")}
                value={report.totals.visits}
              />
              <AdminMetricTile
                icon={UserPlus}
                label={t("adminEventAdsFunnel.summary.registrations")}
                value={report.totals.registrations}
              />
              <AdminMetricTile
                icon={CreditCard}
                label={t("adminEventAdsFunnel.summary.paid")}
                value={report.totals.paid}
              />
              <AdminMetricTile
                icon={TrendingUp}
                label={t("adminEventAdsFunnel.summary.revenue")}
                value={formatAmounts(report.totals.revenue, lang)}
              />
              <AdminMetricTile
                icon={Megaphone}
                label={t("adminEventAdsFunnel.summary.cost")}
                value={formatCosts(report.totals.cost, lang)}
              />
              <AdminMetricTile
                icon={TrendingUp}
                label={t("adminEventAdsFunnel.summary.roas")}
                value={formatRoas(mappedRoas(report))}
                hint={t("adminEventAdsFunnel.summary.roasHint")}
              />
            </div>
          )}
        </AdminCatalogListState>
      </EventStudioRow>

      {report === null ? null : (
        <>
          <EventStudioRow
            label={t("adminEventAdsFunnel.funnel.label")}
            description={t("adminEventAdsFunnel.funnel.description")}
          >
            <AdsFunnelBars
              steps={[
                {
                  key: "visit",
                  label: t("adminEventAdsFunnel.steps.visit"),
                  value: report.totals.visits,
                },
                {
                  key: "registration_start",
                  label: t("adminEventAdsFunnel.steps.registrationStart"),
                  value: report.totals.registrationStarts,
                },
                {
                  key: "registration",
                  label: t("adminEventAdsFunnel.steps.registration"),
                  value: report.totals.attributedRegistrations,
                },
                {
                  key: "checkout_start",
                  label: t("adminEventAdsFunnel.steps.checkoutStart"),
                  value: report.totals.checkoutStarts,
                },
                {
                  key: "paid",
                  label: t("adminEventAdsFunnel.steps.paid"),
                  value: attributedPaid,
                },
              ]}
            />
          </EventStudioRow>

          <EventStudioRow
            label={t("adminEventAdsFunnel.table.label")}
            description={t("adminEventAdsFunnel.table.description")}
          >
            <AdsFunnelCampaignTable report={report} lang={lang} />
          </EventStudioRow>
        </>
      )}

      <EventStudioRow
        label={t("adminEventAdsFunnel.campaigns.label")}
        description={t("adminEventAdsFunnel.campaigns.description")}
      >
        <Button size="sm" className="w-fit" onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {t("adminEventAdsFunnel.campaigns.add")}
        </Button>
        <AdminCatalogListState
          isLoading={campaignsQ.isPending}
          loadingLabel={t("adminEventAdsFunnel.loading")}
          errorMessage={campaignsQ.isError ? adminAdsFunnelErrorMessage(campaignsQ.error) : null}
          isEmpty={campaigns.length === 0}
          emptyLabel={t("adminEventAdsFunnel.campaigns.empty")}
        >
          <AdCampaignList
            campaigns={campaigns}
            lang={lang}
            disabled={deleteCampaign.isPending}
            onEdit={openEdit}
            onDelete={(campaign) => void removeCampaign(campaign)}
            onCosts={setCostsFor}
          />
        </AdminCatalogListState>
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEventAdsFunnel.export.label")}
        description={t("adminEventAdsFunnel.export.description")}
        hint={
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            {t("adminEventAdsFunnel.export.templateNote")}
          </p>
        }
      >
        {report === null ? null : (
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={() => exportFunnel(report)}
          >
            <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t("adminEventAdsFunnel.export.funnelCsv")}
          </Button>
        )}
        <AdminFormTextRow
          id="ads-default-conversion"
          label={t("adminEventAdsFunnel.export.defaultConversion")}
          value={defaultConversion}
          onValueChange={setDefaultConversion}
          hint={t("adminEventAdsFunnel.export.defaultConversionHint")}
          maxLength={100}
          error={
            defaultConversionValid
              ? null
              : t("adminEventAdsFunnel.validation.conversionNameInvalid")
          }
        />
        <Button
          size="sm"
          className="w-fit"
          disabled={!defaultConversionValid || exportConversions.isPending}
          onClick={exportAds}
        >
          <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {t("adminEventAdsFunnel.export.adsCsv")}
        </Button>
        <p className="text-[12px] text-muted-foreground">
          {t("adminEventAdsFunnel.export.consentNote")}
        </p>
        {exportNote.length === 0 ? null : (
          <ul role="status" className="space-y-1 text-sm">
            {exportNote.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </EventStudioRow>

      <EventStudioRow
        label={t("adminEventAdsFunnel.privacy.label")}
        description={t("adminEventAdsFunnel.privacy.description")}
      >
        <p className="text-sm text-muted-foreground">
          {t("adminEventAdsFunnel.privacy.retention")}
        </p>
      </EventStudioRow>

      <AdCampaignDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        campaign={editing}
        eventId={eventId}
        saving={saveCampaign.isPending}
        onSubmit={submitCampaign}
      />
      <AdCampaignCostsDialog
        eventId={eventId}
        campaign={costsFor}
        defaultCurrency={row.ticket_currency}
        lang={lang}
        onClose={() => setCostsFor(null)}
      />
    </>
  );
}
