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

describe("careers: słownik sekcji interaktywnych (hero / wartości / benefity / kreator)", () => {
  // Kontrakt gałęzi używanych dynamicznie w komponentach - literówka w kluczu
  // renderowałaby użytkownikowi goły klucz zamiast tekstu.
  const ROTATING = ["research", "policy", "marketing", "advisory", "editorial"];
  const VALUE_ITEMS = ["evidence", "ownership", "craft", "europe"];
  const BENEFIT_ITEMS = ["contract", "remote", "offices", "budget", "byline", "network"];
  const PROCESS_ITEMS = ["apply", "screening", "task", "decision"];
  const FORM_STEPS = ["about", "fit", "message"];
  const SUCCESS_POINTS = ["review", "reply", "call"];

  const LEAVES = [
    "careers.hero.badge",
    "careers.hero.titleTop",
    "careers.hero.titleAccent",
    "careers.hero.rotatePrefix",
    "careers.hero.deptTitle",
    "careers.hero.deptHint",
    ...ROTATING.map((k) => `careers.hero.rotating.${k}`),
    "careers.values.hint",
    "careers.values.proofLabel",
    ...VALUE_ITEMS.flatMap((k) => [
      `careers.values.items.${k}.title`,
      `careers.values.items.${k}.body`,
      `careers.values.items.${k}.proof`,
    ]),
    "careers.benefits.subtitle",
    ...BENEFIT_ITEMS.flatMap((k) => [
      `careers.benefits.items.${k}.title`,
      `careers.benefits.items.${k}.body`,
    ]),
    ...PROCESS_ITEMS.map((k) => `careers.process.items.${k}.duration`),
    "careers.roles.showing",
    ...FORM_STEPS.flatMap((k) => [`careers.form.steps.${k}.title`, `careers.form.steps.${k}.hint`]),
    "careers.form.stepLabel",
    "careers.form.back",
    "careers.form.next",
    "careers.form.fitOptional",
    "careers.form.requiredAbout",
    "careers.form.requiredMessage",
    "careers.form.success.title",
    "careers.form.success.body",
    ...SUCCESS_POINTS.map((k) => `careers.form.success.points.${k}`),
    "careers.form.success.again",
  ];

  for (const lang of ["pl", "en"] as const) {
    it(`ma komplet tekstów (${lang})`, () => {
      const dict = careersResources[lang] as unknown as Dict;
      for (const key of LEAVES) {
        expect(get(dict, key), key).toBeTruthy();
      }
    });
  }

  it("interpolacje trzymają te same zmienne w PL i EN", () => {
    const INTERPOLATED = [
      ["careers.hero.badge", ["value"]],
      ["careers.roles.showing", ["value", "total"]],
      ["careers.form.stepLabel", ["current", "total"]],
      ["careers.form.success.body", ["email"]],
    ] as const;
    for (const lang of ["pl", "en"] as const) {
      const dict = careersResources[lang] as unknown as Dict;
      for (const [key, vars] of INTERPOLATED) {
        const text = String(get(dict, key));
        for (const v of vars) {
          expect(text, `${lang}:${key}`).toContain(`{{${v}}}`);
        }
      }
    }
  });
});
