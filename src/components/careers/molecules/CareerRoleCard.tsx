// Molekuła: editorialny wiersz otwartej roli (wariant "Prestige list").
// Trzy kolumny: metadane działu, treść oferty, kolumna akcji. Pełna oferta
// (opis, zakres obowiązków, wymagania) otwiera się w popupie.
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
        "group relative overflow-hidden rounded-[6px] border px-5 py-7 sm:px-8 sm:py-9",
        "transition-[background-color,border-color,box-shadow,transform] duration-300 ease-out",
        "hover:bg-muted/40 hover:shadow-[0_24px_50px_-34px_color-mix(in_oklab,var(--foreground)_45%,transparent)]",
        selected
          ? "border-primary/50 bg-primary/[0.04]"
          : "border-transparent hover:border-border/70",
      )}
      aria-current={selected ? "true" : undefined}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 bg-primary transition-all duration-300 ease-out",
          selected ? "w-1.5" : "w-0 group-hover:w-1.5",
        )}
      />

      <div className="grid items-center gap-6 md:grid-cols-12 md:gap-8">
        <div className="flex flex-col gap-1 md:col-span-3">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.15em] text-primary transition-transform duration-300 group-hover:translate-x-1">
            {t(`careers.departments.${role.department}`)}
          </span>
          <span className="text-sm font-medium text-muted-foreground">
            {t(`careers.seniority.${role.seniority}`)}
          </span>
        </div>

        <div className="md:col-span-6">
          <h3 className="text-2xl font-extrabold leading-tight tracking-tight text-foreground transition-colors duration-300 group-hover:text-primary md:text-[1.7rem]">
            {t(roleTitleKey(role.id))}
          </h3>
          <p className="mt-3 max-w-lg text-sm font-medium leading-relaxed text-muted-foreground">
            {t(roleSummaryKey(role.id))}
          </p>
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-semibold text-muted-foreground">
            <li className="inline-flex items-center gap-2">
              <MapPin className="h-4 w-4 opacity-60" aria-hidden />
              {t(`careers.location.${role.location}`)}
            </li>
            <li className="inline-flex items-center gap-2">
              <Clock3 className="h-4 w-4 opacity-60" aria-hidden />
              {t(`careers.engagement.${role.engagement}`)}
            </li>
          </ul>
        </div>

        <div className="flex flex-col gap-2 md:col-span-3">
          <Button
            onClick={() => onApply(role.id)}
            className="group/cta h-11 w-full justify-center gap-2 rounded-[6px] text-sm font-bold transition-transform duration-200 active:scale-[0.97]"
          >
            {t("careers.roles.apply")}
            <ArrowRight
              className="h-4 w-4 transition-transform duration-200 group-hover/cta:translate-x-0.5"
              aria-hidden
            />
          </Button>
          <Button
            variant="outline"
            onClick={() => onDetails(role.id)}
            className="h-11 w-full justify-center gap-2 rounded-[6px] border-border/70 text-sm font-bold transition-transform duration-200 hover:border-primary/50 hover:bg-primary/5 active:scale-[0.97]"
          >
            <FileText className="h-4 w-4" aria-hidden />
            {t("careers.roles.details")}
          </Button>
        </div>
      </div>
    </article>
  );
}
