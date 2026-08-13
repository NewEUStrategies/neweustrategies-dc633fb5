// Organizm: popup z pełną ofertą pracy - opis roli, zakres obowiązków i wymagania.
// Dane pochodzą wyłącznie ze słownika i18n (`careers.roles.<id>.*`), więc popup
// jest dwujęzyczny bez dodatkowej logiki. CTA przekazuje id roli do formularza.
import { useTranslation } from "react-i18next";
import { ArrowRight, Briefcase, Clock3, MapPin, Layers } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  roleBulletKeys,
  roleRequirementKeys,
  roleSummaryKey,
  roleTitleKey,
  type CareerRole,
} from "@/lib/careers/roles";

function MetaChip({ icon: Icon, label }: { icon: typeof MapPin; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[6px] border border-border/70 bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
      {label}
    </span>
  );
}

function OfferList({ title, keys }: { title: string; keys: readonly string[] }) {
  const { t } = useTranslation();
  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
        {title}
      </h3>
      <ul className="mt-2.5 space-y-2 text-sm leading-relaxed text-muted-foreground">
        {keys.map((key) => (
          <li key={key} className="flex gap-2.5">
            <span aria-hidden className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-primary" />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CareerRoleDialog({
  role,
  open,
  onOpenChange,
  onApply,
}: {
  role: CareerRole | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (roleId: string) => void;
}) {
  const { t } = useTranslation();
  if (!role) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden rounded-[6px] p-0">
        <DialogHeader className="space-y-2 border-b border-border/60 px-6 pb-4 pt-6 text-left">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            {t(`careers.departments.${role.department}`)}
          </p>
          <DialogTitle className="text-xl font-bold leading-snug text-foreground sm:text-2xl">
            {t(roleTitleKey(role.id))}
          </DialogTitle>
          <DialogDescription className="sr-only">{t("careers.roles.dialog.meta")}</DialogDescription>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <MetaChip icon={MapPin} label={t(`careers.location.${role.location}`)} />
            <MetaChip icon={Clock3} label={t(`careers.engagement.${role.engagement}`)} />
            <MetaChip icon={Layers} label={t(`careers.seniority.${role.seniority}`)} />
            <MetaChip icon={Briefcase} label={t(`careers.departments.${role.department}`)} />
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[55vh]">
          <div className="space-y-5 px-6 py-5">
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                {t("careers.roles.dialog.overview")}
              </h3>
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                {t(roleSummaryKey(role.id))}
              </p>
            </section>
            <OfferList
              title={t("careers.roles.dialog.responsibilities")}
              keys={roleBulletKeys(role)}
            />
            <OfferList
              title={t("careers.roles.dialog.requirements")}
              keys={roleRequirementKeys(role)}
            />
          </div>
        </ScrollArea>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 bg-muted/30 px-6 py-4">
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-[6px] px-4 text-xs font-medium"
            onClick={() => onOpenChange(false)}
          >
            {t("careers.roles.dialog.close")}
          </Button>
          <Button
            size="sm"
            className="group/cta h-9 gap-2 rounded-[6px] px-4 text-xs font-semibold"
            onClick={() => {
              onOpenChange(false);
              onApply(role.id);
            }}
          >
            {t("careers.roles.apply")}
            <ArrowRight
              className="h-4 w-4 transition-transform duration-200 group-hover/cta:translate-x-0.5"
              aria-hidden
            />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
