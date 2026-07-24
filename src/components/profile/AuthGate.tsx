// Inline gate - renders a friendly, instruction-rich sign-in CTA when there is
// no session, instead of redirecting. Public route stays public (good for
// SSR/share/back navigation), but content is gated. Uses the same emergency
// error surface as route-level errors so the UX is consistent everywhere.
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";

interface AuthGateProps {
  children: ReactNode;
  /** Optional contextual title override. */
  fallbackTitle?: string;
  /** Optional extra context shown below the steps. */
  fallbackBody?: string;
}

export function AuthGate({ children, fallbackTitle, fallbackBody }: AuthGateProps) {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
          aria-label="loading"
        />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto max-w-2xl py-12">
        <FriendlyErrorPage
          error={{ status: 401, message: "unauthorized" }}
          variant="compact"
          title={fallbackTitle}
          footer={fallbackBody}
        />
      </div>
    );
  }

  return <>{children}</>;
}
