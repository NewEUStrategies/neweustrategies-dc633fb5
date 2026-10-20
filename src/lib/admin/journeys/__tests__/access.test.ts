// Uprawnienia i MFA w UI ścieżek (S8) - lustro bramek serwera.
//
// CO TEN PLIK DOWODZI.
//   1. Zdolności liczone z DOKŁADNYCH ról: admin wszystko, redaktor szkic
//      i test, sam `super_admin` (bez wiersza admin/editor) - nic, bo polityki
//      ścieżek go nie wpuszczają.
//   2. `mfa_required` rozpoznajemy po dosłownym tokenie middleware, odmowę
//      roli po jej komunikacie, a awaria weryfikacji roli NIE jest odmową.
import { describe, expect, it } from "vitest";

import {
  isMfaRequiredError,
  isRoleDeniedError,
  journeyAccessDenial,
  journeyCapabilities,
} from "../access";

const MFA = new Error(
  "Forbidden: mfa_required - verify your second factor (aal2) to perform CRM staff role (admin/editor) actions",
);
const ROLE = new Error("Forbidden: CRM staff role (admin/editor) required");
const ADMIN_ROLE = new Error("Forbidden: admin role required");
const VERIFY = new Error("Forbidden: could not verify CRM staff role (admin/editor) (timeout)");

describe("journeyCapabilities", () => {
  it("admin ma wszystkie zdolności", () => {
    expect(journeyCapabilities(["admin"])).toEqual({
      canEdit: true,
      canPublish: true,
      canManageEngine: true,
      canSkipWait: true,
      canTest: true,
    });
  });

  it("redaktor edytuje i testuje na sobie, ale nie publikuje i nie zmienia silnika", () => {
    expect(journeyCapabilities(["editor"])).toEqual({
      canEdit: true,
      canPublish: false,
      canManageEngine: false,
      canSkipWait: false,
      canTest: true,
    });
  });

  it.each([[["author"]], [["super_admin"]], [["user"]], [[]]])(
    "rola %j nie daje żadnej zdolności (baza zostawiłaby ekran pusty)",
    (roles) => {
      expect(Object.values(journeyCapabilities(roles)).every((value) => value === false)).toBe(
        true,
      );
    },
  );

  it("super_admin z wierszem admin to admin", () => {
    expect(journeyCapabilities(["super_admin", "admin"]).canPublish).toBe(true);
  });
});

describe("rozpoznanie odmów middleware", () => {
  it("mfa_required: Error, napis i obiekt z message", () => {
    expect(isMfaRequiredError(MFA)).toBe(true);
    expect(isMfaRequiredError(MFA.message)).toBe(true);
    expect(isMfaRequiredError({ message: MFA.message })).toBe(true);
    expect(isMfaRequiredError(ROLE)).toBe(false);
    expect(isMfaRequiredError(null)).toBe(false);
    expect(isMfaRequiredError(42)).toBe(false);
  });

  it("odmowa roli - tak; awaria weryfikacji i mfa - nie", () => {
    expect(isRoleDeniedError(ROLE)).toBe(true);
    expect(isRoleDeniedError(ADMIN_ROLE)).toBe(true);
    expect(isRoleDeniedError(VERIFY)).toBe(false);
    expect(isRoleDeniedError(MFA)).toBe(false);
    expect(isRoleDeniedError(new Error("network down"))).toBe(false);
  });

  it("journeyAccessDenial: jedno rozstrzygnięcie dla ekranu", () => {
    expect(journeyAccessDenial(MFA)).toBe("mfa_required");
    expect(journeyAccessDenial(ROLE)).toBe("role");
    expect(journeyAccessDenial(VERIFY)).toBeNull();
    expect(journeyAccessDenial(null)).toBeNull();
    expect(journeyAccessDenial(undefined)).toBeNull();
  });
});
