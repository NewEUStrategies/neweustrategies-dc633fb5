// Organizm: interaktywna lista otwartych ról z filtrem działów.
// Filtr jest kontrolowany przez trasę (panel działów w hero ustawia go z góry),
// wybór roli wędruje w górę (formularz preselekcjonuje dział i stanowisko).
// Licznik wyników ma aria-live, a zmiana filtra odtwarza wejście kart.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  CAREER_DEPARTMENTS,
  CAREER_ROLES,
  countRolesByDepartment,
  filterRolesByDepartment,
  findRole,
  type CareerDepartmentId,
} from "@/lib/careers/roles";
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

  const counts = useMemo(() => countRolesByDepartment(CAREER_ROLES), []);
  const roles = useMemo(() => filterRolesByDepartment(CAREER_ROLES, department), [department]);
  const [detailsRoleId, setDetailsRoleId] = useState<string | null>(null);
  const detailsRole = useMemo(() => findRole(detailsRoleId), [detailsRoleId]);

  return (
    <section id={id} aria-labelledby="careers-roles" className="mt-14 scroll-mt-28">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h2
            id="careers-roles"
            className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
          >
            {t("careers.roles.title")}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {t("careers.roles.subtitle")}
          </p>
        </div>
        <p aria-live="polite" className="text-xs font-medium tabular-nums text-muted-foreground">
          {t("careers.roles.showing", { value: roles.length, total: CAREER_ROLES.length })}
        </p>
      </div>

      <div
        role="group"
        aria-label={t("careers.departments.all")}
        className="tabs-scroller mt-5 flex gap-2 overflow-x-auto pb-1"
      >
        <CareerFilterChip
          label={t("careers.roles.all")}
          count={CAREER_ROLES.length}
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
        <p className="mt-6 rounded-[6px] border border-dashed border-border/70 bg-card/40 p-6 text-sm text-muted-foreground">
          {t("careers.roles.empty")}
        </p>
      ) : (
        <div key={department} className="mt-6 grid gap-4 lg:grid-cols-2">
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
