// Friendly error screen for 401 / session expiry / network failures and other
// loader/runtime errors. Renders outside the normal page chrome so it never
// depends on the same data that just failed. Uses the emergency copy layer
// (errorCopy) which is i18n-aware without requiring the i18next provider.
import { useEffect, useMemo } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowLeft,
  Clock,
  HelpCircle,
  Home,
  LogIn,
  RefreshCw,
  ShieldAlert,
  WifiOff,
} from "lucide-react";

import { currentLang } from "@/lib/i18n/localeRuntime";
import { errorCopy, classifyError, type ErrorKind } from "@/lib/errorCopy";
import { reportLovableError } from "@/lib/lovable-error-reporting";
import { cn } from "@/lib/utils";

interface FriendlyErrorPageProps {
  /** The raw error from TanStack Router / server function / fetch. */
  error?: unknown;
  /** TanStack error boundary reset callback. */
  reset?: () => void;
  /**
   * "page" = full-screen centered card (default).
   * "compact" = padded panel for use inside an existing layout (e.g. admin).
   */
  variant?: "page" | "compact";
  /** Optional contextual title override. */
  title?: string;
  /** Optional extra context shown below the steps. */
  footer?: string;
}

const ICONS: Record<ErrorKind, React.ComponentType<{ className?: string; size?: number }>> = {
  unauthorized: ShieldAlert,
  sessionExpired: Clock,
  network: WifiOff,
  generic: AlertCircle,
};

const CODE_LABEL: Record<ErrorKind, string> = {
  unauthorized: "401",
  sessionExpired: "302",
  network: "NET",
  generic: "ERR",
};

export function FriendlyErrorPage({
  error,
  reset,
  variant = "page",
  title,
  footer,
}: FriendlyErrorPageProps) {
  const router = useRouter();
  const copy = errorCopy();
  const kind = useMemo(() => classifyError(error), [error]);
  const scenario = copy[kind];
  const Icon = ICONS[kind];
  const code = CODE_LABEL[kind];
  const lang = currentLang();

  useEffect(() => {
    if (error) {
      reportLovableError(error instanceof Error ? error : new Error(String(error)), {
        boundary: "friendly_error_page",
        kind,
      });
    }
  }, [error, kind]);

  const handleRetry = () => {
    void router.invalidate();
    reset?.();
  };

  const handleGoHome = () => {
    void router.navigate({ to: "/" });
  };

  const primaryIsLogin = kind === "unauthorized" || kind === "sessionExpired";
  const PrimaryIcon = primaryIsLogin ? LogIn : RefreshCw;
  const primaryLabel = primaryIsLogin ? scenario.primaryAction : scenario.primaryAction;
  const primaryAction = primaryIsLogin ? () => void router.navigate({ to: "/login" }) : handleRetry;

  const content = (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-sm",
        variant === "page" ? "w-full max-w-lg p-8 sm:p-10" : "p-6",
      )}
    >
      {/* subtle brand glow */}
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-brand/10 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
            <Icon size={28} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {code}
              </span>
              <span className="h-1 w-1 rounded-full bg-muted-foreground/60" />
              <span className="text-xs text-muted-foreground">{copy.errorTitle}</span>
            </div>
            <h1 className="mt-1 font-display text-xl font-semibold leading-tight text-foreground sm:text-2xl">
              {title ?? scenario.title}
            </h1>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{scenario.body}</p>

        <div className="mt-6 rounded-md bg-muted/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground">
            {scenario.stepsTitle}
          </p>
          <ol className="mt-3 space-y-2">
            {scenario.steps.map((step, idx) => (
              <li key={idx} className="flex gap-3 text-sm text-muted-foreground">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-medium text-brand">
                  {idx + 1}
                </span>
                <span className="leading-snug">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        {footer ? <p className="mt-4 text-xs text-muted-foreground">{footer}</p> : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={handleGoHome}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Home size={16} />
            {scenario.secondaryAction}
          </button>

          {primaryIsLogin ? (
            <Link
              to="/login"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <PrimaryIcon size={16} />
              {primaryLabel}
            </Link>
          ) : (
            <button
              type="button"
              onClick={primaryAction}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <PrimaryIcon size={16} />
              {primaryLabel}
            </button>
          )}
        </div>

        <div className="mt-5 flex items-center justify-center gap-1 text-xs text-muted-foreground">
          <HelpCircle size={14} />
          <span>{lang === "pl" ? "Potrzebujesz pomocy? " : "Need help? "}</span>
          <Link to="/support" className="text-brand hover:underline">
            {lang === "pl" ? "Skontaktuj się z nami" : "Contact support"}
          </Link>
        </div>
      </div>
    </div>
  );

  if (variant === "compact") {
    return content;
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center bg-background px-4 py-12">
      <button
        type="button"
        onClick={() =>
          window.history.length > 1 ? router.history.back() : void router.navigate({ to: "/" })
        }
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={16} />
        {lang === "pl" ? "Wróć" : "Go back"}
      </button>
      {content}
    </div>
  );
}
