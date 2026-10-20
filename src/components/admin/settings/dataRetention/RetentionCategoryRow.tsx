// Molekuła: wiersz kategorii retencji - nazwa z dymkiem (podstawa prawna
// i standard), okres (wspólny atom listy w zakresie kategorii), przełącznik,
// ostatni przebieg i podgląd najbliższego. Kategoria ustawowa jest wyraźnie
// oznaczona i nie ma kontrolek (minimum ustawowe - tylko do odczytu).
//
// Wyłączenie kategorii idzie przez potwierdzenie z ostrzeżeniem o zasadzie
// ograniczenia przechowywania; włączenie i zmiana okresu - od razu (obie
// skracają albo przywracają usuwanie, a podgląd pokazuje skutek).
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { HintTooltip } from "@/components/admin/pricing/atoms/HintTooltip";
import { FormSelect } from "@/components/atoms/FormSelect";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { isEditableCategory, retentionPeriodOptions } from "@/lib/privacy/dataRetention";
import type {
  DataRetentionCategoryDto,
  DataRetentionPreviewItem,
} from "@/lib/privacy/dataRetentionParse";
import { formatDate, formatDateTime } from "@/lib/i18n/format";

export interface RetentionCategoryRowProps {
  category: DataRetentionCategoryDto;
  preview: DataRetentionPreviewItem | null;
  previewState: "loading" | "error" | "ready";
  cap: number;
  busy: boolean;
  onPeriodChange: (months: number) => void;
  onEnabledChange: (enabled: boolean) => void;
}

export function RetentionCategoryRow({
  category,
  preview,
  previewState,
  cap,
  busy,
  onPeriodChange,
  onEnabledChange,
}: RetentionCategoryRowProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const base = `adminDataRetention.categories.${category.key}`;
  const name = t(`${base}.name`);
  // Klucz zawężony do kategorii edytowalnej (null = ustawowa): lista okresów
  // istnieje tylko dla kategorii z zakresem w `DATA_RETENTION_PERIODS`.
  const editableKey = category.editable && isEditableCategory(category.key) ? category.key : null;
  const editable = editableKey !== null;
  const hint = t("adminDataRetention.hintBody", {
    after: t(`${base}.after`),
    basis: t(`${base}.basis`),
    standard: t(`${base}.standard`),
  });

  return (
    <li
      className="grid gap-3 border-b border-border/60 py-4 last:border-b-0 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.6fr)]"
      aria-labelledby={`${id}-name`}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex items-start gap-1">
          <h3 id={`${id}-name`} className="text-sm font-medium">
            {name}
          </h3>
          <HintTooltip
            id={`${id}-hint`}
            text={hint}
            label={t("adminDataRetention.hint", { name })}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t(`${base}.what`)}</p>
        {!editable && (
          <Badge variant="secondary" className="font-normal">
            {t("adminDataRetention.statutory")}
          </Badge>
        )}
      </div>

      <div className="min-w-0 space-y-2">
        {editableKey !== null ? (
          <>
            <FormSelect
              id={`${id}-period`}
              aria-label={t("adminDataRetention.period.aria", { name })}
              value={category.periodMonths === null ? "" : String(category.periodMonths)}
              disabled={busy}
              onValueChange={(value) => onPeriodChange(Number(value))}
              options={retentionPeriodOptions(editableKey).map((months) => {
                const label = t("adminDataRetention.period.months", { count: months });
                return {
                  value: String(months),
                  label:
                    months === category.defaultMonths
                      ? t("adminDataRetention.period.defaultMark", { label })
                      : label,
                };
              })}
            />
            <div className="flex items-center gap-2">
              <Switch
                id={`${id}-enabled`}
                checked={category.enabled}
                disabled={busy}
                aria-describedby={`${id}-hint`}
                onCheckedChange={(next) => onEnabledChange(next)}
              />
              <Label htmlFor={`${id}-enabled`} className="text-xs font-normal">
                {t("adminDataRetention.toggle.label", { name })}
              </Label>
            </div>
          </>
        ) : (
          <p className="text-xs">{t(`${base}.rule`)}</p>
        )}
      </div>

      <div className="min-w-0 space-y-1 text-xs" aria-live="polite">
        <div>
          <span className="font-medium">{t("adminDataRetention.columns.lastRun")}: </span>
          <LastRun category={category} lang={i18n.language} />
        </div>
        <div>
          <span className="font-medium">{t("adminDataRetention.columns.preview")}: </span>
          {previewState === "loading" ? (
            <span role="status">{t("adminDataRetention.preview.loading")}</span>
          ) : previewState === "error" || preview === null ? (
            <span>{t("adminDataRetention.preview.error")}</span>
          ) : preview.count === null ? (
            <span>{t("adminDataRetention.preview.off")}</span>
          ) : (
            <span>
              {preview.capped
                ? t("adminDataRetention.preview.capped", {
                    cap,
                    date: preview.cutoff ? formatDate(preview.cutoff, i18n.language) : "-",
                  })
                : t("adminDataRetention.preview.count", {
                    count: preview.count,
                    date: preview.cutoff ? formatDate(preview.cutoff, i18n.language) : "-",
                  })}{" "}
              <Badge
                variant={preview.mode === "execute" ? "destructive" : "outline"}
                className="font-normal"
              >
                {preview.mode === "execute"
                  ? t("adminDataRetention.preview.modeExecute")
                  : t("adminDataRetention.preview.modePreview")}
              </Badge>
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function LastRun({ category, lang }: { category: DataRetentionCategoryDto; lang: string }) {
  const { t } = useTranslation();
  const run = category.lastRun;
  if (run === null) return <span>{t("adminDataRetention.lastRun.none")}</span>;
  const when = formatDateTime(run.startedAt, lang);
  if (run.errorCode !== null) {
    return (
      <span>
        {t("adminDataRetention.lastRun.error", { code: run.errorCode })} · {when}
      </span>
    );
  }
  const summary =
    run.mode === "execute"
      ? t("adminDataRetention.lastRun.execute", { count: run.affected })
      : t("adminDataRetention.lastRun.preview", { count: run.affected });
  return (
    <span>
      {summary} · {when}
      {run.trigger === "manual" ? ` (${t("adminDataRetention.lastRun.manual")})` : ""}
      {run.backlog ? ` - ${t("adminDataRetention.lastRun.backlog")}` : ""}
    </span>
  );
}
