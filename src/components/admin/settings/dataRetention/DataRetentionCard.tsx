// Organizm: karta „Retencja danych" w /admin/settings/privacy (I9c-X2,
// Z-I9b-10 - decyzja administratora danych z 2026-10-20).
//
// CO POKAZUJE. Stan bezpiecznego startu (tryb podglądu do `enforce_after`,
// „włącz teraz", przesunięcie terminu), harmonogram (ostatni przebieg zadania
// dziennego), kategorie z okresem i przełącznikiem, kategorie ustawowe tylko
// do odczytu, piksel otwarć (ustawienie silnika ścieżek), kontakty CRM „do
// anonimizacji" z przedłużeniem, okresy ustalone w innych modułach i ręczne
// uruchomienie przebiegu z potwierdzeniem.
//
// LENIWY CHUNK: trasa ładuje kartę przez `lazy()`, więc słownik, zapytania
// i molekuły nie trafiają do chunku wejściowego panelu ani do bundla
// czytelnika. Wszystkie zapisy idą wspólnymi mutatorami
// (`dataRetentionQueries.ts`) z tokenem współbieżności (40001 = konflikt).
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { addDays, format } from "date-fns";
import { Archive } from "lucide-react";

import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { SectionCard } from "@/components/admin/membership/atoms/SectionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatDateOnly, formatDateTime } from "@/lib/i18n/format";
import { ensureI18n } from "@/lib/i18n-admin-data-retention";
import {
  DATA_RETENTION_EXISTING,
  DATA_RETENTION_RULES,
  isEditableCategory,
} from "@/lib/privacy/dataRetention";
import type { DataRetentionMutation } from "@/lib/privacy/dataRetention.functions";
import type {
  DataRetentionCategoryDto,
  DataRetentionStateDto,
} from "@/lib/privacy/dataRetentionParse";
import {
  dataRetentionPreviewQueryOptions,
  dataRetentionQueryOptions,
  useDataRetentionEnforcement,
  useRunDataRetentionNow,
  useSaveDataRetentionCategory,
  useSaveOpenTracking,
} from "@/lib/privacy/dataRetentionQueries";
import { CrmDueList } from "./CrmDueList";
import { RetentionCategoryRow } from "./RetentionCategoryRow";

/** Lokalny dzień natywnego pola daty (bez UTC - dzień się nie przesuwa). */
function localDay(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export default function DataRetentionCard({ tenantId }: { tenantId: string | null }) {
  ensureI18n();
  const { t } = useTranslation();
  const stateQ = useQuery(dataRetentionQueryOptions(tenantId));
  const read = stateQ.data;

  return (
    <SectionCard
      icon={Archive}
      title={t("adminDataRetention.title")}
      description={t("adminDataRetention.subtitle")}
    >
      {stateQ.isLoading || (tenantId === null && read === undefined) ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("adminDataRetention.loading")}
        </p>
      ) : stateQ.isError || read === undefined ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          {t("adminDataRetention.readError")}
          <Button size="sm" variant="outline" onClick={() => void stateQ.refetch()}>
            {t("adminDataRetention.retry")}
          </Button>
        </div>
      ) : read.state === "unavailable" ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("adminDataRetention.unavailable")}
        </p>
      ) : read.state === "forbidden" ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("adminDataRetention.forbidden")}
        </p>
      ) : tenantId === null ? null : (
        <RetentionBody tenantId={tenantId} state={read.data} />
      )}
    </SectionCard>
  );
}

function RetentionBody({ tenantId, state }: { tenantId: string; state: DataRetentionStateDto }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const previewQ = useQuery(dataRetentionPreviewQueryOptions(tenantId));
  const saveM = useSaveDataRetentionCategory(tenantId);
  const enforcementM = useDataRetentionEnforcement(tenantId);
  const runM = useRunDataRetentionNow(tenantId);
  const pixelM = useSaveOpenTracking(tenantId);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [postpone, setPostpone] = useState<string | null>(null);
  const lang = i18n.language;

  const preview = previewQ.data?.state === "ready" ? previewQ.data.data : null;
  const previewState: "loading" | "error" | "ready" = previewQ.isLoading
    ? "loading"
    : preview === null
      ? "error"
      : "ready";

  const today = new Date();
  const minDay = localDay(addDays(today, 1));
  const maxDay = localDay(addDays(today, DATA_RETENTION_RULES.postponeMaxDays));
  const postponeValid = postpone !== null && postpone >= minDay && postpone <= maxDay;

  const report = (result: DataRetentionMutation<unknown>, okMessage: string) => {
    if (result.ok) {
      toast.success(okMessage);
      return;
    }
    if (result.error === "conflict") toast.error(t("adminDataRetention.conflict"));
    else if (result.error === "invalid") toast.error(t("adminDataRetention.invalid"));
    else toast.error(t("adminDataRetention.saveError"));
  };

  const save = async (
    category: DataRetentionCategoryDto,
    periodMonths: number,
    enabled: boolean,
  ) => {
    if (!isEditableCategory(category.key)) return;
    const result = await saveM.mutateAsync({
      category: category.key,
      periodMonths,
      enabled,
      expectedUpdatedAt: category.stored ? category.updatedAt : null,
    });
    report(result, t("adminDataRetention.saved"));
  };

  const askDisable = (category: DataRetentionCategoryDto) => {
    const name = t(`adminDataRetention.categories.${category.key}.name`);
    setConfirm({
      title: t("adminDataRetention.toggle.disableTitle", { name }),
      description: t("adminDataRetention.toggle.disableBody"),
      confirmLabel: t("adminDataRetention.toggle.disableConfirm"),
      cancelLabel: t("adminDataRetention.toggle.cancel"),
      destructive: true,
      onConfirm: () => save(category, category.periodMonths ?? 0, false),
    });
  };

  const askEnableNow = () =>
    setConfirm({
      title: t("adminDataRetention.grace.enableNowTitle"),
      description: t("adminDataRetention.grace.enableNowBody"),
      confirmLabel: t("adminDataRetention.grace.enableNow"),
      cancelLabel: t("adminDataRetention.toggle.cancel"),
      destructive: true,
      onConfirm: async () => {
        report(
          await enforcementM.mutateAsync({ action: "enable_now" }),
          t("adminDataRetention.grace.saved"),
        );
      },
    });

  const askRun = () =>
    setConfirm({
      title: t("adminDataRetention.run.title"),
      description: state.grace.anyPreview
        ? t("adminDataRetention.run.bodyPreview")
        : t("adminDataRetention.run.bodyExecute"),
      confirmLabel: t("adminDataRetention.run.confirm"),
      cancelLabel: t("adminDataRetention.toggle.cancel"),
      destructive: !state.grace.anyPreview,
      onConfirm: async () => {
        const result = await runM.mutateAsync();
        if (result.ok && result.data.busy) toast.error(t("adminDataRetention.run.busy"));
        else if (result.ok) toast.success(t("adminDataRetention.run.done"));
        else toast.error(t("adminDataRetention.run.error"));
      },
    });

  const savePostpone = async () => {
    if (!postponeValid || postpone === null) return;
    const result = await enforcementM.mutateAsync({ action: "postpone", until: postpone });
    report(result, t("adminDataRetention.grace.saved"));
    if (result.ok) setPostpone(null);
  };

  const savePixel = async (enabled: boolean) => {
    const result = await pixelM.mutateAsync({
      enabled,
      expectedUpdatedAt: state.journeySettingsUpdatedAt,
    });
    if (result.ok) toast.success(t("adminDataRetention.pixel.saved"));
    else if (result.error === "conflict") toast.error(t("adminDataRetention.conflict"));
    else toast.error(t("adminDataRetention.pixel.error"));
  };

  const busy = saveM.isPending || enforcementM.isPending;

  return (
    <div className="space-y-6">
      {/* Bezpieczny start i harmonogram. */}
      <div
        role="region"
        aria-labelledby={`${id}-grace`}
        className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-4"
      >
        <h3 id={`${id}-grace`} className="text-sm font-semibold">
          {state.grace.anyPreview
            ? t("adminDataRetention.grace.previewTitle", {
                date: state.grace.enforceAfter
                  ? formatDateTime(state.grace.enforceAfter, lang)
                  : "-",
              })
            : t("adminDataRetention.grace.enforcedTitle")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {state.grace.anyPreview
            ? t("adminDataRetention.grace.previewBody")
            : t("adminDataRetention.grace.enforcedBody")}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          {state.grace.anyPreview && (
            <Button size="sm" variant="destructive" disabled={busy} onClick={askEnableNow}>
              {t("adminDataRetention.grace.enableNow")}
            </Button>
          )}
          {postpone === null ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setPostpone(minDay)}>
              {t("adminDataRetention.grace.postpone")}
            </Button>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor={`${id}-postpone`}>
                  {t("adminDataRetention.grace.postponeLabel")}
                </Label>
                <DateInput
                  id={`${id}-postpone`}
                  type="date"
                  value={postpone}
                  min={minDay}
                  max={maxDay}
                  aria-invalid={postponeValid ? undefined : true}
                  aria-describedby={`${id}-postpone-hint`}
                  onChange={(event) => setPostpone(event.target.value)}
                />
              </div>
              <Button
                size="sm"
                disabled={!postponeValid || busy}
                onClick={() => void savePostpone()}
              >
                {t("adminDataRetention.grace.postponeSave")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPostpone(null)}>
                {t("adminDataRetention.toggle.cancel")}
              </Button>
              <p id={`${id}-postpone-hint`} className="w-full text-xs text-muted-foreground">
                {postponeValid
                  ? t("adminDataRetention.grace.postponeHint", {
                      max: DATA_RETENTION_RULES.postponeMaxDays,
                    })
                  : t("adminDataRetention.grace.postponeInvalid", {
                      max: DATA_RETENTION_RULES.postponeMaxDays,
                    })}
              </p>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {state.lastScheduledRunAt
            ? t("adminDataRetention.schedule.lastRun", {
                date: formatDateTime(state.lastScheduledRunAt, lang),
              })
            : t("adminDataRetention.schedule.never")}{" "}
          {t("adminDataRetention.schedule.window")}
        </p>
        <p className="text-xs text-muted-foreground">
          {state.funnelCut === null && state.journeySealed === null
            ? t("adminDataRetention.aggregates.none")
            : [
                state.funnelCut
                  ? t("adminDataRetention.aggregates.funnel", {
                      date: formatDateOnly(state.funnelCut, lang),
                    })
                  : null,
                state.journeySealed
                  ? t("adminDataRetention.aggregates.journeys", {
                      date: formatDateOnly(state.journeySealed, lang),
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(" ")}
        </p>
      </div>

      {/* Kategorie. */}
      <ul aria-label={t("adminDataRetention.columns.category")} className="list-none">
        {state.categories.map((category) => (
          <RetentionCategoryRow
            key={category.key}
            category={category}
            preview={preview?.categories.find((p) => p.key === category.key) ?? null}
            previewState={previewState}
            cap={preview?.cap ?? 0}
            busy={busy}
            onPeriodChange={(months) => void save(category, months, category.enabled)}
            onEnabledChange={(enabled) =>
              enabled ? void save(category, category.periodMonths ?? 0, true) : askDisable(category)
            }
          />
        ))}
      </ul>

      {/* Piksel otwarć - ustawienie silnika ścieżek. */}
      <div role="region" aria-labelledby={`${id}-pixel`} className="space-y-2">
        <h3 id={`${id}-pixel`} className="text-sm font-semibold">
          {t("adminDataRetention.pixel.title")}
        </h3>
        <div className="flex items-center gap-2">
          <Switch
            id={`${id}-pixel-switch`}
            checked={state.openTrackingEnabled}
            disabled={pixelM.isPending}
            aria-describedby={`${id}-pixel-hint`}
            onCheckedChange={(next) => void savePixel(next)}
          />
          <Label htmlFor={`${id}-pixel-switch`}>{t("adminDataRetention.pixel.label")}</Label>
        </div>
        <p id={`${id}-pixel-hint`} className="text-xs text-muted-foreground">
          {t("adminDataRetention.pixel.hint")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("adminDataRetention.pixel.recommendation")}
        </p>
      </div>

      <CrmDueList tenantId={tenantId} />

      {/* Okresy ustalone w innych modułach. */}
      <div role="region" aria-labelledby={`${id}-existing`} className="space-y-2">
        <h3 id={`${id}-existing`} className="text-sm font-semibold">
          {t("adminDataRetention.existing.title")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("adminDataRetention.existing.subtitle")}</p>
        <ul className="list-none divide-y divide-border/60">
          {DATA_RETENTION_EXISTING.map((item) => (
            <li
              key={item.key}
              className="flex flex-wrap items-start justify-between gap-2 py-2 text-xs"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {t(`adminDataRetention.existing.items.${item.key}.name`)}
                </p>
                <p className="text-muted-foreground">
                  {t(`adminDataRetention.existing.items.${item.key}.period`)}
                  {item.mechanism ? ` (${item.mechanism})` : ""}
                </p>
              </div>
              <Badge variant="outline" className="font-normal">
                {t(`adminDataRetention.existing.schedule.${item.schedule}`)}
              </Badge>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={runM.isPending} onClick={askRun}>
          {t("adminDataRetention.run.button")}
        </Button>
        {previewQ.isError ? (
          <span role="alert" className="text-xs">
            {t("adminDataRetention.preview.error")}
          </span>
        ) : null}
      </div>

      <ConfirmDialog
        state={confirm}
        onOpenChange={(open) => (open ? undefined : setConfirm(null))}
      />
    </div>
  );
}
