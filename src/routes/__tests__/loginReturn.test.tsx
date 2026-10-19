// Trasa `/login` w lejku czytelnika (S3, P15): `next`, `intent` i `plan`
// przechodzą walidator WYŁĄCZNIE kształtem (napis z limitem długości), a pełna
// sanitizacja ścieżki powrotu dzieje się w `AuthPortal`
// (`paywallLinks.parseLoginSearch`). Walidator zostaje w chunku wejściowym
// trasy, więc nie importuje modułu lejka - tego pilnuje ostatni test.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type * as AuthPortalModule from "@/components/auth/AuthPortal";

const h = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));

vi.mock("@/components/auth/AuthPortal", () => {
  const AuthPortal: typeof AuthPortalModule.AuthPortal = (props) => {
    h.props.push(props as Record<string, unknown>);
    return <div data-testid="auth-portal-stub" />;
  };
  return { AuthPortal };
});

import { renderRoute, routeSearchValidator } from "@/test/routeHarness";
import { Route as LoginRoute } from "@/routes/login";

const PLAN = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.props = [];
});
afterEach(() => cleanup());

describe("/login - kontrakt parametrów lejka", () => {
  const validate = routeSearchValidator(LoginRoute);

  it("next / intent / plan przechodzą jako napisy obok trybu", () => {
    expect(
      validate({ mode: "signup", next: "/analizy/x?ref=1", intent: "paywall", plan: PLAN }),
    ).toEqual({ mode: "signup", next: "/analizy/x?ref=1", intent: "paywall", plan: PLAN });
  });

  it("nie-napisy i wartości ponad limit odpadają, reszta zostaje", () => {
    expect(validate({ next: 42, intent: "x".repeat(17), plan: ["a"], mode: "signin" })).toEqual({
      mode: "signin",
    });
    expect(validate({ next: `/${"a".repeat(2048)}` })).toEqual({});
  });

  it("portal dostaje parametry z adresu (sanitizuje je sam)", async () => {
    await renderRoute({
      route: LoginRoute,
      path: "/login",
      initialEntry: `/login?mode=signup&next=${encodeURIComponent("/analizy/x")}&intent=meter&plan=${PLAN}`,
    });
    expect(screen.getByTestId("auth-portal-stub")).toBeInTheDocument();
    expect(h.props.at(-1)).toMatchObject({
      initialMode: "signup",
      next: "/analizy/x",
      intent: "meter",
      planId: PLAN,
    });
  });

  it("walidator nie importuje modułu lejka (chunk wejściowy bez paywallLinks)", () => {
    const source = readFileSync(join(process.cwd(), "src/routes/login.tsx"), "utf8");
    expect(source).not.toMatch(/from "@\/lib\/access\/paywallLinks"/);
  });
});
