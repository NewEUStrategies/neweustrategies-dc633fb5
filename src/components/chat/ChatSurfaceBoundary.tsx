// Molecule: containment for the message surface. A render fault inside the
// thread (exotic payload, missing UI provider, broken attachment metadata) must
// stay INSIDE the panel - a panel-sized notice with a retry, not the global
// error page swallowing the whole /messages route. The reaction-chip crash was
// exactly that failure mode.
//
// Reuses the shared ErrorBoundary (reporting + reset) and only supplies the
// chat-flavoured fallback, so there is one boundary implementation in the app.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

function SurfaceFallback({ reset }: { reset: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center"
    >
      <span
        className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive"
        aria-hidden
      >
        <AlertTriangle className="h-5 w-5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{t("chat.surfaceError.title")}</p>
        <p className="max-w-[280px] text-xs leading-relaxed text-muted-foreground">
          {t("chat.surfaceError.body")}
        </p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-background px-3.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        {t("chat.surfaceError.retry")}
      </button>
    </div>
  );
}

export function ChatSurfaceBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      name="chat_surface_boundary"
      fallback={(_error, reset) => <SurfaceFallback reset={reset} />}
    >
      {children}
    </ErrorBoundary>
  );
}
