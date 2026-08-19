import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeFixture = vi.hoisted(() => ({
  path: "",
  component: null as unknown,
  auth: { isSuperAdmin: true, loading: false },
  panel: vi.fn(() => null),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (options: { component: unknown }) => {
    routeFixture.path = path;
    routeFixture.component = options.component;
    return { path, options };
  },
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => routeFixture.auth }));
vi.mock("@/components/admin/loginSettings/organisms/LoginSettingsPanel", () => ({
  LoginSettingsPanel: routeFixture.panel,
}));

const routeModule = await import("@/routes/admin.login-settings");
const Component = routeFixture.component as ComponentType;

describe("trasa ustawień logowania", () => {
  beforeEach(() => {
    routeFixture.auth = { isSuperAdmin: true, loading: false };
    routeFixture.panel.mockClear();
  });

  afterEach(cleanup);

  it("pozostaje cienką kompozycją organizmu", () => {
    expect(routeFixture.path).toBe("/admin/login-settings");
    expect(routeFixture.component).toBeTypeOf("function");
    expect(routeModule.Route).toEqual(
      expect.objectContaining({
        path: "/admin/login-settings",
        options: { component: routeFixture.component },
      }),
    );
  });

  it("nie ujawnia panelu podczas ładowania uprawnień", () => {
    routeFixture.auth.loading = true;
    const { container } = render(<Component />);

    expect(container).toBeEmptyDOMElement();
    expect(routeFixture.panel).not.toHaveBeenCalled();
  });

  it("przekierowuje użytkownika bez roli superadministratora", () => {
    routeFixture.auth.isSuperAdmin = false;
    render(<Component />);

    expect(screen.getByTestId("navigate")).toHaveTextContent("/admin");
    expect(routeFixture.panel).not.toHaveBeenCalled();
  });

  it("renderuje organizm dopiero dla superadministratora", () => {
    render(<Component />);

    expect(routeFixture.panel).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("navigate")).not.toBeInTheDocument();
  });
});
