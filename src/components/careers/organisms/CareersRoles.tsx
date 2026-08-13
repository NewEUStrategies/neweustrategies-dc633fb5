// Organizm: interaktywna lista otwartych ról z filtrem działów.
// Filtr jest kontrolowany przez trasę (panel działów w hero ustawia go z góry),
// wybór roli wędruje w górę (formularz preselekcjonuje dział i stanowisko).
// Licznik wyników ma aria-live, a zmiana filtra odtwarza wejście kart.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { CAREER_DEPARTMENTS, type CareerDepartmentId } from "@/lib/careers/roles";
import {
  countOffersByDepartment,
  filterOffersByDepartment,
  findOffer,
} from "@/lib/careers/catalog";
import { useCareerOffers, useCareerSection } from "@/lib/careers/useCareerContent";
import { CareerFilterChip } from "../atoms/CareerFilterChip";
import { CareerRoleCard } from "../molecules/CareerRoleCard";
import { CareerRoleDialog } from "./CareerRoleDialog";

export function CareersRoles({
  id,
  department,
  onDepartmentChange,
  selectedRoleId,
  onApply,
}: {
  id: string;
  department: CareerDepartmentId | "all";
  onDepartmentChange: (department: CareerDepartmentId | "all") => void;
  selectedRoleId: string | null;
  onApply: (roleId: string) => void;
}) {
  const { t } = useTranslation();
  const { offers } = useCareerOffers();
  const section = useCareerSection("roles");

  const counts = useMemo(() => countOffersByDepartment(offers), [offers]);
  const roles = useMemo(
    () => filterOffersByDepartment(offers, department),
    [offers, department],
  );
  const [detailsRoleId, setDetailsRoleId] = useState<string | null>(null);
  const detailsRole = useMemo(() => findOffer(offers, detailsRoleId), [offers, detailsRoleId]);


  return (
    <section id={id} aria-labelledby="careers-roles" className="mt-16 scroll-mt-28">
      <header className="border-b border-border/60 pb-10">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <h2
              id="careers-roles"
              className="text-balance text-4xl font-black leading-[1.05] tracking-tight text-foreground md:text-5xl"
            >
              {section.title ?? t("careers.roles.title")}
            </h2>
            <p className="mt-5 text-base font-medium leading-relaxed text-muted-foreground md:text-lg">
              {section.subtitle ?? t("careers.roles.subtitle")}
            </p>

          </div>
          <div className="flex flex-col md:items-end">
            <span className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
              {t("careers.roles.statusLabel")}
            </span>
            <p
              aria-live="polite"
              className="text-2xl font-normal tabular-nums text-foreground md:text-3xl"
            >
              <span className="font-extrabold text-primary">{roles.length}</span>
              <span aria-hidden className="mx-1.5 text-border">
                /
              </span>
              {t("careers.roles.showingShort", { total: offers.length })}
            </p>
          </div>
        </div>
      </header>

      <div
        role="group"
        aria-label={t("careers.departments.all")}
        className="tabs-scroller mt-8 flex gap-2 overflow-x-auto pb-1"
      >
        <CareerFilterChip
          label={t("careers.roles.all")}
          count={offers.length}
          active={department === "all"}
          onClick={() => onDepartmentChange("all")}
        />
        {CAREER_DEPARTMENTS.map((dept) => (
          <CareerFilterChip
            key={dept}
            label={t(`careers.departments.${dept}`)}
            count={counts[dept]}
            active={department === dept}
            onClick={() => onDepartmentChange(dept)}
          />
        ))}
      </div>

      {roles.length === 0 ? (
        <p className="mt-8 rounded-[6px] border border-dashed border-border/70 bg-card/40 p-6 text-sm text-muted-foreground">
          {t("careers.roles.empty")}
        </p>
      ) : (
        <div key={department} className="mt-8 flex flex-col gap-3">

          {roles.map((role, index) => (
            <div
              key={role.id}
              className="crs-pop"
              style={{ animationDelay: `${Math.min(index, 7) * 55}ms` }}
            >
              <CareerRoleCard
                role={role}
                selected={role.id === selectedRoleId}
                onApply={onApply}
                onDetails={setDetailsRoleId}
              />
            </div>
          ))}
        </div>
      )}
      <CareerRoleDialog
        role={detailsRole}
        open={detailsRole !== null}
        onOpenChange={(next) => {
          if (!next) setDetailsRoleId(null);
        }}
        onApply={onApply}
      />
    </section>
  );
}
