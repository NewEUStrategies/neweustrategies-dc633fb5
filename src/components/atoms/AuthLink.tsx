import { Link } from "@tanstack/react-router";
import { LayoutDashboard, LogIn } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { useHasMounted } from "@/hooks/useHasMounted";

/**
 * Auth-aware link that is hydration-safe.
 * Renders a stable placeholder during SSR + first client paint,
 * then swaps to the correct variant after mount/auth resolves.
 */
export function AuthLink({ className = "" }: { className?: string }) {
  const { i18n } = useTranslation();
  const { session, isStaff } = useAuth();
  const mounted = useHasMounted();
  const lang = (i18n.language ?? "pl").startsWith("pl") ? "pl" : "en";
  const label = lang === "pl" ? "Zaloguj" : "Sign in";

  if (!mounted) {
    return <span className={`inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground opacity-0 ${className}`}>{label}</span>;
  }

  if (session && isStaff) {
    return (
      <Link to="/admin" className={`inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline ${className}`}>
        <LayoutDashboard className="w-3.5 h-3.5" /> Panel
      </Link>
    );
  }
  return (
    <Link to="/login" className={`inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-brand ${className}`}>
      <LogIn className="w-3.5 h-3.5" /> {label}
    </Link>
  );
}
