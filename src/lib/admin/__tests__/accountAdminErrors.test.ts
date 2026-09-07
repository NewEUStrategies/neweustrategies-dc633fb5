import { describe, it, expect } from "vitest";
import { ADMIN_ACCOUNT_ERROR } from "../accountAdmin.functions";
import { accountAdminErrorKey } from "../accountAdminErrors";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-users";

describe("accountAdminErrorKey", () => {
  it("mapuje kody serwerowe na klucze i18n", () => {
    expect(accountAdminErrorKey(new Error(ADMIN_ACCOUNT_ERROR.outsideTenant))).toBe(
      "adminUsers.accountErrOutsideTenant",
    );
    expect(accountAdminErrorKey(new Error(ADMIN_ACCOUNT_ERROR.selfDelete))).toBe(
      "adminUsers.accountErrSelfDelete",
    );
    expect(accountAdminErrorKey(new Error(ADMIN_ACCOUNT_ERROR.confirmMismatch))).toBe(
      "adminUsers.accountErrConfirmMismatch",
    );
    expect(accountAdminErrorKey(new Error(ADMIN_ACCOUNT_ERROR.deleteFailed))).toBe(
      "adminUsers.accountErrDeleteFailed",
    );
  });

  it("tłumaczy stare techniczne komunikaty", () => {
    expect(accountAdminErrorKey(new Error("Forbidden: user outside tenant"))).toBe(
      "adminUsers.accountErrOutsideTenant",
    );
  });

  it("ma bezpieczny wariant domyślny", () => {
    expect(accountAdminErrorKey(new Error("boom"))).toBe("adminUsers.accountErrGeneric");
    expect(accountAdminErrorKey(null)).toBe("adminUsers.accountErrGeneric");
  });

  it("każdy klucz istnieje w PL i EN", () => {
    const keys = [
      "accountErrOutsideTenant",
      "accountErrSelfDelete",
      "accountErrConfirmMismatch",
      "accountErrLookupFailed",
      "accountErrDeleteFailed",
      "accountErrGeneric",
    ] as const;
    for (const key of keys) {
      expect(typeof i18n.getResource("pl", "translation", `adminUsers.${key}`)).toBe("string");
      expect(typeof i18n.getResource("en", "translation", `adminUsers.${key}`)).toBe("string");
    }
  });
});
