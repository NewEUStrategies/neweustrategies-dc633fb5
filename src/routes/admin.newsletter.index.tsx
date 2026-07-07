// /admin/newsletter -> redirect na Overview (nowy default).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/newsletter/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/newsletter/overview" });
  },
});
