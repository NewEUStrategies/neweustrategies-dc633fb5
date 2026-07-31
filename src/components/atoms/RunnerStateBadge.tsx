// Atom: stan automatu wysyłki (runner zadań tła).
//
// „Włączony" to nie to samo co „działa": runner bywa włączony bez adresu
// aplikacji, albo z adresem, do którego cron nie potrafi zapukać. Ten atom
// niesie JEDEN, rozstrzygnięty stan, żeby operator nie musiał go składać z
// trzech pól konfiguracji.
//
// Kolor nigdy nie jest jedynym nośnikiem informacji (WCAG 1.4.1): obok kropki
// zawsze stoi zlokalizowana etykieta.
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { RunnerState } from "@/lib/email/runnerHealth";
import "@/lib/i18n-newsletter-runner";

const DOT: Record<RunnerState, string> = {
  running: "bg-emerald-500",
  idle: "bg-amber-500",
  misconfigured: "bg-amber-500",
  disabled: "bg-muted-foreground/50",
  error: "bg-destructive",
};

const TEXT: Record<RunnerState, string> = {
  running: "text-emerald-600 dark:text-emerald-400",
  idle: "text-amber-600 dark:text-amber-400",
  misconfigured: "text-amber-600 dark:text-amber-400",
  disabled: "text-muted-foreground",
  error: "text-destructive",
};

const SURFACE: Record<RunnerState, string> = {
  running: "bg-emerald-500/10",
  idle: "bg-amber-500/10",
  misconfigured: "bg-amber-500/10",
  disabled: "bg-muted",
  error: "bg-destructive/10",
};

interface RunnerStateBadgeProps {
  state: RunnerState;
  className?: string;
}

export function RunnerStateBadge({ state, className }: RunnerStateBadgeProps) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap",
        SURFACE[state],
        TEXT[state],
        className,
      )}
      title={t(`adminRunner.stateHint.${state}`)}
    >
      <span
        aria-hidden="true"
        className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOT[state])}
      />
      {t(`adminRunner.state.${state}`)}
    </span>
  );
}
