// Bramka katalogu ról: filtrowanie, liczniki i parzystość kluczy i18n PL/EN.
import { describe, it, expect } from "vitest";
import {
  CAREER_DEPARTMENTS,
  CAREER_ROLES,
  countRolesByDepartment,
  filterRolesByDepartment,
  findRole,
  roleBulletKeys,
} from "@/lib/careers/roles";
import { careersResources } from "@/lib/i18n-careers";

type Dict = Record<string, unknown>;

function get(source: Dict, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Dict)[key];
    return undefined;
  }, source);
}

describe("careers: katalog ról", () => {
  it("ma unikalne identyfikatory", () => {
    const ids = CAREER_ROLES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("filtruje po dziale, 'all' zwraca komplet", () => {
    expect(filterRolesByDepartment(CAREER_ROLES, "all")).toHaveLength(CAREER_ROLES.length);
    expect(filterRolesByDepartment(CAREER_ROLES, null)).toHaveLength(CAREER_ROLES.length);
    const analysis = filterRolesByDepartment(CAREER_ROLES, "analysis");
    expect(analysis.length).toBeGreaterThan(0);
    expect(analysis.every((r) => r.department === "analysis")).toBe(true);
  });

  it("liczniki sumują się do liczby ról", () => {
    const counts = countRolesByDepartment(CAREER_ROLES);
    const total = CAREER_DEPARTMENTS.reduce((sum, d) => sum + counts[d], 0);
    expect(total).toBe(CAREER_ROLES.length);
  });

  it("findRole odsiewa nieznane id", () => {
    expect(findRole(CAREER_ROLES[0].id)?.id).toBe(CAREER_ROLES[0].id);
    expect(findRole("nie-istnieje")).toBeNull();
    expect(findRole(null)).toBeNull();
  });
});

describe("careers: słownik PL/EN", () => {
  for (const lang of ["pl", "en"] as const) {
    it(`ma komplet tekstów ról (${lang})`, () => {
      const dict = careersResources[lang] as unknown as Dict;
      for (const role of CAREER_ROLES) {
        expect(get(dict, `careers.roles.${role.id}.title`), role.id).toBeTruthy();
        expect(get(dict, `careers.roles.${role.id}.summary`), role.id).toBeTruthy();
        for (const key of roleBulletKeys(role)) {
          expect(get(dict, key), key).toBeTruthy();
        }
      }
      for (const dept of CAREER_DEPARTMENTS) {
        expect(get(dict, `careers.departments.${dept}`), dept).toBeTruthy();
      }
    });
  }
});
