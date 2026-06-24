import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Inline gate - renders sign-in CTA when there is no session, instead of redirecting.
 * Public route stays public (good for SSR/share/back navigation), but content is gated.
 */
export function AuthGate({ children, fallbackTitle, fallbackBody }: {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackBody?: string;
}) {
  const { t } = useTranslation();
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-label="loading" />
      </div>
    );
  }
  if (!session) {
    return (
      <div className="container mx-auto max-w-md py-16">
        <Card>
          <CardHeader>
            <CardTitle>{fallbackTitle ?? t("auth.required")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{fallbackBody ?? t("auth.requiredBody")}</p>
            <div className="flex gap-2">
              <Button asChild>
                <Link to="/login" search={{ mode: "signin" }}>{t("auth.signIn")}</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/login" search={{ mode: "signup" }}>{t("auth.signUp")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
  return <>{children}</>;
}
