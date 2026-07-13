// Layout route for /admin/newsletter/campaigns - lista + /$id renderują się w Outlet.
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/newsletter/campaigns")({
  component: () => <Outlet />,
});
