// Organizm: interaktywna lista otwartych ról z filtrem działów.
// Stan filtra jest lokalny, natomiast wybór roli wędruje w górę (formularz
// aplikacyjny preselekcjonuje dział i stanowisko).
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  CAREER_DEPARTMENTS,
  CAREER_ROLES,
  countRolesByDepartment,
  filterRolesByDepartment,
  type CareerDepartmentId,
} from "@/lib/careers/roles";
import { CareerFilterChip } from "../atoms/CareerFilterChip";
import { CareerRoleCard } from "../molecules/CareerRoleCard";

export function CareersRoles({
  id,
  selectedRoleId,
  onApply,
}: {
  id: string;
  selectedRoleId: string | null;
  onApply: (roleId: string) => void;
}) {
  const { t } = useTranslation();
  const [department, setDepartment] = useState<CareerDepartmentId | "all">("all");

  const counts = useMemo(() => countRolesByDepartment(CAREER_ROLES), []);
  const roles = useMemo(() => filterRolesByDepartment(CAREER_ROLES, department), [department]);

  return (
    <section id={id} aria-labelledby="careers-roles" className="mt-14 scroll-mt-28">
      <h2
        id="careers-roles"
        className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
      >
        {t("careers.roles.title")}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
        {t("careers.roles.subtitle")}
      </p>

      <div
        role="group"
        aria-label={t("careers.departments.all")}
        className="tabs-scroller mt-5 flex gap-2 overflow-x-auto pb-1"
      >
        <CareerFilterChip
          label={t("careers.roles.all")}
          count={CAREER_ROLES.length}
          active={department === "all"}
          onClick={() => setDepartment("all")}
        />
        {CAREER_DEPARTMENTS.map((dept) => (
          <CareerFilterChip
            key={dept}
            label={t(`careers.departments.${dept}`)}
            count={counts[dept]}
            active={department === dept}
            onClick={() => setDepartment(dept)}
          />
        ))}
      </div>

      {roles.length === 0 ? (
        <p className="mt-6 rounded-[6px] border border-dashed border-border/70 bg-card/40 p-6 text-sm text-muted-foreground">
          {t("careers.roles.empty")}
        </p>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {roles.map((role) => (
            <CareerRoleCard
              key={role.id}
              role={role}
              selected={role.id === selectedRoleId}
              onApply={onApply}
            />
          ))}
        </div>
      )}
    </section>
  );
}
