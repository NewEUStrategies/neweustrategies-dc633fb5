// Friendly error screen for 401 / session expiry / network failures and other
// loader/runtime errors. Renders outside the normal page chrome so it never
// depends on the same data that just failed. Uses the emergency copy layer
// (errorCopy) which is i18n-aware without requiring the i18next provider.
import { useEffect, useMemo } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Clock,
  CloudOff,
  HelpCircle,
  Home,
  LogIn,
  RefreshCw,
  ShieldAlert,
  WifiOff,
} from "lucide-react";

import { currentLang } from "@/lib/i18n/localeRuntime";
import { errorCopy, classifyError, type ErrorKind } from "@/lib/errorCopy";
import { reportPlatformError } from "@/lib/platform-error-reporting";

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
  degraded: CloudOff,
  generic: AlertCircle,
};

/**
 * Kody techniczne (HTTP/NET) są uniwersalne i zostają dosłowne. Wyjątkiem jest
 * błąd ogólny: tam nie ma żadnego kodu do pokazania, więc etykieta jest zwykłym
 * komunikatem do człowieka - i musi iść ze słownika (`genericCode`).
 */
const CODE_LABEL: Record<Exclude<ErrorKind, "generic">, string> = {
  unauthorized: "401",
  sessionExpired: "302",
  network: "NET",
  // Render zdegradowany wychodzi z HTTP 200 - etykieta nie może sugerować awarii.
  degraded: "200",
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
  const code = kind === "generic" ? copy.genericCode : CODE_LABEL[kind];
  const lang = currentLang();

  useEffect(() => {
    // Degradacja nie jest awarią klienta: serwer zalogował ją już przy zasiewie
    // fallbacku (`[ssr-resilient]`), więc raport z przeglądarki tylko dublowałby
    // ten sam incydent - raz na każdą odsłonę zdegradowanej strony.
    if (error && kind !== "degraded") {
      reportPlatformError(error instanceof Error ? error : new Error(String(error)), {
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

  const eyebrow = kind === "degraded" ? copy.degradedEyebrow : copy.errorTitle;
  const contactHref = lang === "en" ? "/en/kontakt" : "/kontakt";

  // Skróty ratunkowe - te same trasy, co na 404, żeby „ślepy zaułek" zawsze
  // kończył się realnym wyjściem, a nie samym przyciskiem odświeżenia.
  const prefix = lang === "en" ? "/en" : "";
  const shortcuts = [
    { label: copy.notFoundLinks.analyses, href: `${prefix}/analizy` },
    { label: copy.notFoundLinks.pricing, href: `${prefix}/pricing` },
    { label: copy.notFoundLinks.quiz, href: "/quiz" },
    { label: copy.notFoundLinks.contact, href: contactHref },
  ];

  const stepsCard = (
    <div className="rounded-[6px] border border-border bg-muted/40 p-5">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-foreground">
        {scenario.stepsTitle}
      </p>
      <ol className="mt-4 space-y-3">
        {scenario.steps.map((step, idx) => (
          <li key={idx} className="flex gap-3 text-sm text-muted-foreground">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-brand/30 bg-brand/10 font-mono text-xs font-semibold text-brand">
              {idx + 1}
            </span>
            <span className="pt-0.5 leading-snug">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );

  const actions = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={handleGoHome}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-[6px] border border-input bg-background px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
      >
        <Home size={16} />
        {scenario.secondaryAction}
      </button>

      {primaryIsLogin ? (
        <Link
          to="/login"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-[6px] bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <PrimaryIcon size={16} />
          {primaryLabel}
        </Link>
      ) : (
        <button
          type="button"
          onClick={primaryAction}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-[6px] bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <PrimaryIcon size={16} />
          {primaryLabel}
        </button>
      )}
    </div>
  );

  const helpLine = (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <HelpCircle size={14} />
      <span>{copy.needHelp}</span>
      {/* Strona kontaktu jest treścią CMS (trasa catch-all), więc zwykły
          anchor - Link nie zna tej ścieżki w typach routera. */}
      <a href={contactHref} className="font-medium text-brand hover:underline">
        {copy.contactLink}
      </a>
    </div>
  );

  if (variant === "compact") {
    return (
      <div className="relative overflow-hidden rounded-[6px] border border-border bg-card p-6 text-card-foreground shadow-sm">
        <div
          className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-brand/10 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[6px] bg-brand/10 text-brand">
              <Icon size={24} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {code}
                </span>
                <span className="h-1 w-1 rounded-full bg-muted-foreground/60" />
                <span className="text-xs text-muted-foreground">{eyebrow}</span>
              </div>
              <h2 className="mt-1 font-display text-lg font-semibold leading-tight text-foreground">
                {title ?? scenario.title}
              </h2>
            </div>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{scenario.body}</p>
          <div className="mt-5">{stepsCard}</div>
          {footer ? <p className="mt-4 text-xs text-muted-foreground">{footer}</p> : null}
          <div className="mt-6">{actions}</div>
          <div className="mt-5">{helpLine}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[calc(100vh-4rem)] flex-col justify-center overflow-hidden bg-background px-4 py-12">
      {/* Tło: delikatna siatka + poświata marki. Dekoracja, nie treść. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(to_right,color-mix(in_oklab,var(--color-border)_70%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--color-border)_70%,transparent)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-brand/10 blur-3xl"
      />

      <div className="relative mx-auto w-full max-w-5xl">
        <button
          type="button"
          onClick={() =>
            window.history.length > 1 ? router.history.back() : void router.navigate({ to: "/" })
          }
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={16} />
          {copy.goBack}
        </button>

        <div className="overflow-hidden rounded-[6px] border border-border bg-card/80 shadow-sm backdrop-blur-sm">
          {/* Pasek statusu - jak nagłówek raportu technicznego. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/40 px-5 py-2.5 sm:px-8">
            <span className="inline-flex items-center font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-brand">
              {code}
            </span>
            <span className="h-1 w-1 rounded-full bg-muted-foreground/50" aria-hidden="true" />
            <span className="text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground">
              {eyebrow}
            </span>
          </div>

          <div className="grid gap-8 p-5 sm:p-8 lg:grid-cols-[1.15fr_1fr] lg:gap-12 lg:p-10">
            <div className="min-w-0">
              <div className="relative">
                {/* Wielka cyfra/kod jako znak wodny - nadaje stronie skalę.
                    Dłuższa etykieta („UPSSS...") dostaje mniejszy stopień, żeby
                    nie wyjechała poza kolumnę na wąskich ekranach. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute -left-1 -top-8 select-none whitespace-nowrap font-display font-bold leading-none tracking-tight text-brand/10",
                    code.length > 4 ? "text-[3.5rem] sm:text-[5rem]" : "text-[6rem] sm:text-[8rem]",
                  )}
                >
                  {code}
                </span>
                <div className="relative flex h-14 w-14 items-center justify-center rounded-[6px] border border-brand/25 bg-brand/10 text-brand">
                  <Icon size={28} />
                </div>
              </div>

              <h1 className="mt-6 font-display text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
                {title ?? scenario.title}
              </h1>
              <p className="mt-4 max-w-prose text-base leading-relaxed text-muted-foreground">
                {scenario.body}
              </p>

              {footer ? <p className="mt-4 text-xs text-muted-foreground">{footer}</p> : null}

              <div className="mt-8">{actions}</div>
              <div className="mt-5">{helpLine}</div>
            </div>

            <div className="min-w-0 space-y-5">
              {stepsCard}

              <div className="rounded-[6px] border border-border p-5">
                <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {copy.keepGoing}
                </p>
                <ul className="mt-2 divide-y divide-border">
                  {shortcuts.map((s) => (
                    <li key={s.href}>
                      <a
                        href={s.href}
                        className="group flex items-center justify-between gap-3 py-2.5 text-sm text-foreground transition-colors hover:text-brand"
                      >
                        <span>{s.label}</span>
                        <ArrowRight
                          aria-hidden="true"
                          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
