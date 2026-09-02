// Układ sekcji analityki: sam przegląd żyje w `admin.analytics.index.tsx`,
// a pełny warsztat BI (moduł 17) w `admin.analytics.bi.tsx`. Ten plik jest
// wyłącznie ramką routingu - żadnej treści, tylko <Outlet />.
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/analytics")({
  component: AnalyticsLayout,
});

function AnalyticsLayout() {
  return <Outlet />;
}
