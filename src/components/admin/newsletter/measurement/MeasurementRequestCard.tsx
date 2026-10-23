// Organizm: „Poproś o zgodę na pomiar" i wspólny przełącznik pomiaru
// w panelu newslettera (I9d-Y2, decyzja właściciela 2026-10-20 pkt 3 -
// opcjonalne, ręcznie z panelu; Z-I9c-09; I9d-Y2b - prośba dotyczy OSOBNEJ
// zgody na pomiar, wersja treści pola pomiaru).
//
// PRZEBIEG. Admin widzi liczby (aktywni, ze zgodą, do prośby, na liście
// wyłączeń) i stan próśb z PANELU bieżącej wersji treści pomiaru, potwierdza
// start z liczbą z podglądu (`expected`) - baza odrzuca start, gdy
// kandydatów przybyło (`conflict`), więc mail nigdy nie pójdzie do większej
// grupy, niż admin zatwierdził. Wysyłkę robi krok `jobs-tick` w oknie dnia
// i w dziennym limicie wspólnym z prośbami wygaszania (Y1). Brak reakcji =
// bez zmian. Prośby po zapisie bez double opt-in (`origin = 'signup'`,
// stała treść, własny limit) nie wchodzą do liczników karty - mówi to
// notka `request.originNote`.
//
// PRZEŁĄCZNIK (Z-I9c-09). Jeden przełącznik najemcy dla ścieżek i kampanii
// (`journey_settings.open_tracking_enabled`) - ten sam co w ustawieniach
// silnika ścieżek i w karcie „Retencja danych", zapis wspólnym mutatorem
// `useSaveOpenTracking` z tokenem CAS ustawień silnika.
//
// KTO WIDZI: wyłącznie administrator (bramki `requireAdmin` podglądu
// i startu oraz zapisu ustawień silnika) - sekcja wejściowa nie montuje
// karty innym rolom.
import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MailQuestion } from "lucide-react";

import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { SectionCard } from "@/components/admin/membership/atoms/SectionCard";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ensureI18n } from "@/lib/i18n-admin-newsletter-measurement";
import { formatDate, formatNumber } from "@/lib/i18n/format";
import { journeySettingsQueryOptions } from "@/lib/journeys/queries";
import { useSaveOpenTracking } from "@/lib/privacy/dataRetentionQueries";
import { MEASUREMENT_CONFIRM_LINK_DAYS } from "@/lib/privacy/measurement";
import type { NewsletterMeasurementPreviewDto } from "@/lib/privacy/measurementParse";
import {
  newsletterMeasurementPreviewQueryOptions,
  useRequestNewsletterMeasurement,
} from "@/lib/privacy/measurementQueries";
import { NEWSLETTER_MEASUREMENT_COPY_ANCHOR } from "./consentTextRules";

/** Liczby podglądu - klucze etykiet wypisane literalnie (bramka pokrycia kluczy). */
const STAT_KEYS = [
  ["subscribers", "adminNewsletterMeasurement.request.stats.subscribers"],
  ["withConsent", "adminNewsletterMeasurement.request.stats.withConsent"],
  ["candidates", "adminNewsletterMeasurement.request.stats.candidates"],
  ["suppressed", "adminNewsletterMeasurement.request.stats.suppressed"],
] as const satisfies readonly (readonly [keyof NewsletterMeasurementPreviewDto, string])[];

/** Stan próśb bieżącej wersji w kolejności przebiegu. */
const PROGRESS_KEYS = [
  ["requested", "adminNewsletterMeasurement.request.progress.requested"],
  ["pending", "adminNewsletterMeasurement.request.progress.pending"],
  ["mailed", "adminNewsletterMeasurement.request.progress.mailed"],
  ["blocked", "adminNewsletterMeasurement.request.progress.blocked"],
  ["skipped", "adminNewsletterMeasurement.request.progress.skipped"],
  ["failed", "adminNewsletterMeasurement.request.progress.failed"],
  ["confirmed", "adminNewsletterMeasurement.request.progress.confirmed"],
] as const satisfies readonly (readonly [keyof NewsletterMeasurementPreviewDto, string])[];

export function MeasurementRequestCard({ tenantId }: { tenantId: string }) {
  ensureI18n();
  const { t } = useTranslation();
  const previewQ = useQuery(newsletterMeasurementPreviewQueryOptions());
  const read = previewQ.data;

  return (
    <SectionCard
      icon={MailQuestion}
      title={t("adminNewsletterMeasurement.request.title")}
      description={t("adminNewsletterMeasurement.request.subtitle")}
    >
      {previewQ.isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("adminNewsletterMeasurement.request.loading")}
        </p>
      ) : previewQ.isError || read === undefined ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          {t("adminNewsletterMeasurement.request.readError")}
          <Button size="sm" variant="outline" onClick={() => void previewQ.refetch()}>
            {t("adminNewsletterMeasurement.retry")}
          </Button>
        </div>
      ) : read.state === "forbidden" ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("adminNewsletterMeasurement.request.forbidden")}
        </p>
      ) : read.state === "unavailable" ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("adminNewsletterMeasurement.request.unavailable")}
        </p>
      ) : (
        <RequestBody tenantId={tenantId} preview={read.data} />
      )}
    </SectionCard>
  );
}

function RequestBody({
  tenantId,
  preview,
}: {
  tenantId: string;
  preview: NewsletterMeasurementPreviewDto;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const requestM = useRequestNewsletterMeasurement();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const number = (value: number) => formatNumber(value, i18n.language);

  const start = async (expected: number) => {
    const result = await requestM.mutateAsync({ expected });
    if (result.ok) {
      if (result.data.requested > 0) {
        toast.success(
          t("adminNewsletterMeasurement.request.started", { count: result.data.requested }),
        );
      } else {
        toast.info(t("adminNewsletterMeasurement.request.startedNone"));
      }
    } else if (result.error === "conflict") {
      toast.error(t("adminNewsletterMeasurement.request.conflict"));
    } else if (result.error === "forbidden") {
      toast.error(t("adminNewsletterMeasurement.request.forbidden"));
    } else if (result.error === "unavailable") {
      toast.error(t("adminNewsletterMeasurement.request.unavailable"));
    } else {
      toast.error(t("adminNewsletterMeasurement.request.error"));
    }
  };

  const askStart = () => {
    // Liczba w oknie = liczba wysłana do bazy: admin zatwierdza dokładnie ją.
    const expected = preview.candidates;
    setConfirm({
      title: t("adminNewsletterMeasurement.request.confirmTitle"),
      description: t("adminNewsletterMeasurement.request.confirmBody", {
        count: expected,
        cap: preview.dailyCap,
        days: MEASUREMENT_CONFIRM_LINK_DAYS,
      }),
      confirmLabel: t("adminNewsletterMeasurement.request.confirm"),
      cancelLabel: t("adminNewsletterMeasurement.request.cancel"),
      onConfirm: () => start(expected),
    });
  };

  return (
    <div className="space-y-4">
      <TrackingSwitch tenantId={tenantId} fallback={preview.enabled} />
      {!preview.enabled ? (
        <p role="note" className="text-xs text-muted-foreground">
          {t("adminNewsletterMeasurement.request.disabledNote")}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STAT_KEYS.map(([key, labelKey]) => (
          <div key={key} className="rounded-md border border-border/60 p-3" data-stat={key}>
            <dt className="text-xs text-muted-foreground">{t(labelKey)}</dt>
            <dd className="m-0 text-lg font-semibold tabular-nums">{number(preview[key])}</dd>
          </div>
        ))}
      </dl>

      {preview.requested > 0 ? (
        <div role="region" aria-labelledby={`${id}-progress`} className="space-y-2">
          <h3 id={`${id}-progress`} className="text-sm font-semibold">
            {t("adminNewsletterMeasurement.request.progressTitle", { version: preview.version })}
          </h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            {PROGRESS_KEYS.map(([key, labelKey]) => (
              <div key={key} className="flex items-baseline gap-1.5 min-w-0" data-progress={key}>
                <dt className="text-muted-foreground">{t(labelKey)}</dt>
                <dd className="m-0 font-medium tabular-nums">{number(preview[key])}</dd>
              </div>
            ))}
          </dl>
          {preview.lastRequestedAt ? (
            <p className="text-xs text-muted-foreground">
              {t("adminNewsletterMeasurement.request.lastRequested", {
                date: formatDate(preview.lastRequestedAt, i18n.language),
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={preview.candidates === 0 || requestM.isPending}
          onClick={askStart}
        >
          {t("adminNewsletterMeasurement.request.button")}
        </Button>
        <Link
          to="/admin/newsletter/email-content"
          hash={NEWSLETTER_MEASUREMENT_COPY_ANCHOR}
          className="text-xs underline underline-offset-2 hover:text-foreground"
        >
          {t("adminNewsletterMeasurement.request.copyLink")}
        </Link>
      </div>
      {preview.candidates === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("adminNewsletterMeasurement.request.none")}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground" data-request-note="origin">
        {t("adminNewsletterMeasurement.request.originNote")}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("adminNewsletterMeasurement.request.sunsetNote")}
      </p>

      <ConfirmDialog
        state={confirm}
        onOpenChange={(open) => (open ? undefined : setConfirm(null))}
      />
    </div>
  );
}

/**
 * Wspólny przełącznik pomiaru (Z-I9c-09). Stan i token CAS z ustawień silnika
 * ścieżek; dopóki odczyt nie przyjdzie, przełącznik pokazuje stan z podglądu
 * i jest zablokowany (zapis bez tokenu zderzyłby się z cudzą zmianą).
 */
function TrackingSwitch({ tenantId, fallback }: { tenantId: string; fallback: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const settingsQ = useQuery(journeySettingsQueryOptions(tenantId));
  const saveM = useSaveOpenTracking(tenantId);
  const settings = settingsQ.data?.state === "ready" ? settingsQ.data.data : null;

  const onChange = async (enabled: boolean) => {
    if (!settings) return;
    const result = await saveM.mutateAsync({
      enabled,
      expectedUpdatedAt: settings.exists ? settings.updatedAt : null,
    });
    if (result.ok) {
      toast.success(t("adminNewsletterMeasurement.request.switchSaved"));
    } else if (result.error === "conflict") {
      await queryClient.invalidateQueries({
        queryKey: journeySettingsQueryOptions(tenantId).queryKey,
      });
      toast.error(t("adminNewsletterMeasurement.request.switchConflict"));
    } else {
      toast.error(t("adminNewsletterMeasurement.request.switchError"));
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Switch
          id={`${id}-switch`}
          checked={settings ? settings.openTrackingEnabled : fallback}
          disabled={!settings || saveM.isPending}
          aria-describedby={`${id}-hint`}
          onCheckedChange={(next) => void onChange(next)}
        />
        <Label htmlFor={`${id}-switch`}>
          {t("adminNewsletterMeasurement.request.switchLabel")}
        </Label>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {t("adminNewsletterMeasurement.request.switchHint")}
      </p>
    </div>
  );
}
