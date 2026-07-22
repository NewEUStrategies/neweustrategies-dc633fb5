import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Wspólny layout sekcji firm. Osobny indeks listy jest konieczny, aby
 * dynamiczna karta `/admin/companies/$id` mogła zamontować się w Outlet.
 */
export const Route = createFileRoute("/admin/companies")({
  component: CompaniesLayout,
});

function CompaniesLayout() {
  return <Outlet />;
}
