// Layout sekcji osób: katalog (/people) i profil członka (/people/<slug>).
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/people")({
  component: PeopleLayout,
});

function PeopleLayout() {
  return <Outlet />;
}
