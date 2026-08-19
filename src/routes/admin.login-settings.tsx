import { Navigate, createFileRoute } from "@tanstack/react-router";
import { LoginSettingsPanel } from "@/components/admin/loginSettings/organisms/LoginSettingsPanel";
import { useAuth } from "@/hooks/useAuth";

function LoginSettingsRoute() {
  const { isSuperAdmin, loading } = useAuth();
  if (loading) return null;
  if (!isSuperAdmin) return <Navigate to="/admin" />;
  return <LoginSettingsPanel />;
}

export const Route = createFileRoute("/admin/login-settings")({
  component: LoginSettingsRoute,
});
