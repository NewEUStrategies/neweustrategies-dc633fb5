import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Wspólny layout sekcji CRM (leadów). Osobny indeks listy pozwala,
 * aby dynamiczna karta `/admin/crm/$id` zamontowała się w Outlet
 * bez konfliktu ze ścieżką listy.
 */
export const Route = createFileRoute("/admin/crm")({
  component: CrmLayout,
});

function CrmLayout() {
  return <Outlet />;
}
