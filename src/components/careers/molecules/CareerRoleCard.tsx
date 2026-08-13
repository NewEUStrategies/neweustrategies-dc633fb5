// Molekuła: karta otwartej roli. Pełna oferta (opis, zakres obowiązków,
// wymagania) otwiera się w popupie; CTA przekazuje id roli do formularza.
import { useTranslation } from "react-i18next";
import { MapPin, Clock3, ArrowRight, FileText } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { roleSummaryKey, roleTitleKey, type CareerRole } from "@/lib/careers/roles";

export function CareerRoleCard({
  role,
  selected,
  onApply,
  onDetails,
}: {
  role: CareerRole;
  selected: boolean;
  onApply: (roleId: string) => void;
  onDetails: (roleId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <article
      className={cn(
        "group relative isolate overflow-hidden rounded-[6px] border bg-card p-5",
        "transition-[transform,border-color,box-shadow] duration-300 ease-out",
        "hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-28px_color-mix(in_oklab,var(--primary)_60%,transparent)]",
        selected ? "border-primary/60" : "border-border/70 hover:border-primary/45",
      )}
      aria-current={selected ? "true" : undefined}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />

      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
        <span>{t(`careers.departments.${role.department}`)}</span>
        <span aria-hidden className="text-border">
          /
        </span>
        <span className="text-muted-foreground">{t(`careers.seniority.${role.seniority}`)}</span>
      </div>

      <h3 className="mt-2 text-lg font-semibold leading-snug text-foreground">
        {t(roleTitleKey(role.id))}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {t(roleSummaryKey(role.id))}
      </p>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="inline-flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-primary" aria-hidden />
          {t(`careers.location.${role.location}`)}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5 text-primary" aria-hidden />
          {t(`careers.engagement.${role.engagement}`)}
        </li>
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => onApply(role.id)}
          className="group/cta h-9 gap-2 rounded-[6px] px-4 text-xs font-semibold shadow-[0_12px_26px_-18px_color-mix(in_oklab,var(--primary)_85%,transparent)] transition-transform duration-200 hover:-translate-y-0.5"
        >
          {t("careers.roles.apply")}
          <ArrowRight
            className="h-4 w-4 transition-transform duration-200 group-hover/cta:translate-x-0.5"
            aria-hidden
          />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-1.5 rounded-[6px] border-border/70 px-3 text-xs font-medium hover:border-primary/50 hover:bg-primary/5"
          onClick={() => onDetails(role.id)}
        >
          <FileText className="h-4 w-4" aria-hidden />
          {t("careers.roles.details")}
        </Button>
      </div>
    </article>
  );
}
