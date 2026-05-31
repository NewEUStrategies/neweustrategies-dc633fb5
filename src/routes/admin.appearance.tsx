// Appearance layout: routes show only their own editor (header / footer / menu).
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/appearance")({
  component: AppearanceLayout,
  beforeLoad: ({ location }) => {
    if (location.pathname === "/admin/appearance") {
      throw redirect({ to: "/admin/appearance/header" });
    }
  },
});

function AppearanceLayout() {
  return <Outlet />;
}

