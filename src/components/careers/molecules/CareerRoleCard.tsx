// Molekuła: karta otwartej roli. Rozwijany zakres obowiązków (bez zewnętrznej
// biblioteki - `hidden` + aria-expanded) oraz CTA, które przekazuje id roli
// do formularza aplikacyjnego.
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, MapPin, Clock3, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  roleBulletKeys,
  roleSummaryKey,
  roleTitleKey,
  type CareerRole,
} from "@/lib/careers/roles";

export function CareerRoleCard({
  role,
  selected,
  onApply,
}: {
  role: CareerRole;
  selected: boolean;
  onApply: (roleId: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const detailsId = useId();

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
        <Button size="sm" className="gap-2" onClick={() => onApply(role.id)}>
          {t("careers.roles.apply")}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((v) => !v)}
        >
          {t("careers.roles.details")}
          <ChevronDown
            className={cn("h-4 w-4 transition-transform duration-200", open && "rotate-180")}
            aria-hidden
          />
        </Button>
      </div>

      <div id={detailsId} hidden={!open} className="mt-4 border-t border-border/60 pt-3">
        <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
          {roleBulletKeys(role).map((key) => (
            <li key={key} className="flex gap-2">
              <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
