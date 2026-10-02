// Role wprowadzeń: lista klienta ⇄ gałęzie `CASE p_role` w bazie.
//
// PO CO. Generator typuje `p_role` jako `string`, więc kompilator przepuszczał
// `{ p_role: "all" }` - i tak eksport RODO przez cały czas oddawał pustą sekcję
// `network_introductions`. Zawężenie mieszka w `introductionRoles.ts`; ten plik
// pilnuje, żeby się nie poluzowało (`npm run typecheck` obejmuje testy).
// Zgodność z SQL dowodzi pgTAP (`introductions_flow_test.sql`: "all" i NULL to
// błąd 22023).
import { describe, expect, expectTypeOf, it } from "vitest";
import { INTRODUCTION_ROLES, type IntroductionRole } from "../introductionRoles";

describe("INTRODUCTION_ROLES", () => {
  it("to dokładnie trzy gałęzie `CASE p_role` z 20261002100000, w kolejności eksportu", () => {
    expect([...INTRODUCTION_ROLES]).toEqual(["requester", "bridge", "target"]);
    expectTypeOf<IntroductionRole>().toEqualTypeOf<"requester" | "bridge" | "target">();
  });

  it('"all" nie jest rolą - nie da się go wpisać', () => {
    // @ts-expect-error - "all" wpada w bazie w `ELSE FALSE` (od tej zmiany: błąd 22023)
    const all: IntroductionRole = "all";
    expect(INTRODUCTION_ROLES).not.toContain(all);
  });
});
