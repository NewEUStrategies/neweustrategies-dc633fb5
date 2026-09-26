// Molekuła: filtry raportu dla sponsorów - zakres dni, sponsor, miejsce.
//
// DZIEŃ TO DZIEŃ W STREFIE WYDARZENIA. Pola `date` dają napis YYYY-MM-DD bez
// strefy, a baza porównuje go z dniem zapisanym w strefie wydarzenia - więc
// „od 12 marca" znaczy dokładnie to, co organizator widzi w programie.
//
// ODWRÓCONY ZAKRES NIE IDZIE DO BAZY. `sponsorReportQuery` pomija wtedy dni,
// a tutaj pod polami stoi zdanie, co jest nie tak (`aria-invalid` +
// `aria-describedby`, żeby czytnik ekranu przeczytał je razem z polem).
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { FormSelect } from "@/components/atoms/FormSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SPONSOR_PLACEMENTS } from "@/lib/events/sponsorExposure";
import {
  ALL,
  EMPTY_SPONSOR_REPORT_FILTERS,
  isInvalidRange,
  type SponsorReportFilters,
} from "@/lib/events/sponsorReportDraft";
import { ADMIN_PLACEMENT_LABEL_KEYS } from "@/lib/events/sponsorReportLabels";
import { ensureSponsorReportI18n } from "@/lib/i18n-admin-event-sponsor-report";

export interface SponsorOption {
  id: string;
  name: string;
}

export function SponsorReportFiltersBar({
  filters,
  sponsors,
  onChange,
}: {
  filters: SponsorReportFilters;
  sponsors: readonly SponsorOption[];
  onChange: (next: SponsorReportFilters) => void;
}) {
  ensureSponsorReportI18n();
  const { t } = useTranslation();
  const baseId = useId();
  const invalid = isInvalidRange(filters);
  const errorId = `${baseId}-range`;

  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">{t("adminEventSponsorReport.filters.label")}</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor={`${baseId}-from`}>{t("adminEventSponsorReport.filters.from")}</Label>
          <Input
            id={`${baseId}-from`}
            type="date"
            value={filters.from}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            onChange={(event) => onChange({ ...filters, from: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${baseId}-to`}>{t("adminEventSponsorReport.filters.to")}</Label>
          <Input
            id={`${baseId}-to`}
            type="date"
            value={filters.to}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            onChange={(event) => onChange({ ...filters, to: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${baseId}-sponsor`}>
            {t("adminEventSponsorReport.filters.sponsor")}
          </Label>
          <FormSelect
            id={`${baseId}-sponsor`}
            value={filters.sponsorId}
            onValueChange={(sponsorId) => onChange({ ...filters, sponsorId })}
            options={[
              { value: ALL, label: t("adminEventSponsorReport.filters.allSponsors") },
              ...sponsors.map((sponsor) => ({ value: sponsor.id, label: sponsor.name })),
            ]}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${baseId}-placement`}>
            {t("adminEventSponsorReport.filters.placement")}
          </Label>
          <FormSelect
            id={`${baseId}-placement`}
            value={filters.placement}
            onValueChange={(placement) => onChange({ ...filters, placement })}
            options={[
              { value: ALL, label: t("adminEventSponsorReport.filters.allPlacements") },
              ...SPONSOR_PLACEMENTS.map((placement) => ({
                value: placement,
                label: t(ADMIN_PLACEMENT_LABEL_KEYS[placement]),
              })),
            ]}
          />
        </div>
      </div>
      {invalid ? (
        <p id={errorId} className="text-xs text-destructive">
          {t("adminEventSponsorReport.filters.invalidRange")}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t("adminEventSponsorReport.filters.placementHint")}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(EMPTY_SPONSOR_REPORT_FILTERS)}
        >
          {t("adminEventSponsorReport.filters.reset")}
        </Button>
      </div>
    </fieldset>
  );
}
