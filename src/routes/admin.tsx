import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { AdminShell } from "@/components/admin/AdminShell";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { loading, session, isStaff } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && (!session || !isStaff)) navigate({ to: "/login" });
  }, [loading, session, isStaff, navigate]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">…</div>;
  }
  if (!session || !isStaff) return null;

  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
