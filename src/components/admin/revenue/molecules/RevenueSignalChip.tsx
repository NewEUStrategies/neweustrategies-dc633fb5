// Molekuła: sygnał Diagnostyki na ekranie modułu (SPEC §2.7, §6.1
// `RevenueSignalChip`) - „2 otwarte diagnozy · Zobacz w Diagnostyce" nad
// cennikiem, paywallem, kuponami, CRM… Mapę „ekran → obszary" trzyma
// `SIGNAL_SURFACES` (`lib/revenue/diagnostics/surfaces.ts`); montaż w modułach
// robi integracja (I9).
//
// ZERO DODATKOWYCH ZAPYTAŃ. Chip czyta TEN SAM klucz i `queryFn` co
// Diagnostyka (`revenueFactsQueryOptions`) z `select` zawężającym fakty do
// jego obszarów: przy ciepłym cache (admin przyszedł z huba albo inny chip
// już je pobrał) nie wysyła żadnego żądania, a współdzielenie struktury
// sprawia, że renderuje się ponownie tylko wtedy, gdy zmienił się któryś
// z JEGO obszarów (test z licznikiem wywołań `queryFn`).
//
// NIGDY CICHA ZIELEŃ. Obszar, którego reguł nie da się ocenić, daje
// „Diagnostyka: brak danych", nie „bez problemów". Odmowa roli albo MFA nic
// nie rysuje - ekran modułu nie jest miejscem na powiadomienie o hubie.
//
// `useHydrated()` przed sesją: ekrany modułów renderuje serwer, który nie
// zna sesji jak klient - do hydratacji chip nie istnieje, więc znacznik
// serwera i pierwszego renderu klienta jest ten sam.
import { useMemo } from "react";
import { Link, useHydrated } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info, ShieldCheck, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/hooks/useAuth";
import type { RevenueArea } from "@/lib/admin/revenue/hubTabs";
import { ensureI18n } from "@/lib/i18n-admin-revenue-diagnostics";
import {
  evaluateAreaFindings,
  revenueFactsQueryOptions,
  revenueSnoozesQueryOptions,
  selectFactsForAreas,
} from "@/lib/revenue/diagnostics/queries";
import {
  findingsForAreas,
  signalSummary,
  type SignalSummary,
} from "@/lib/revenue/diagnostics/surfaces";
import { cn } from "@/lib/utils";

export interface RevenueSignalChipProps {
  /** Obszary diagnostyki tego ekranu - zwykle `SIGNAL_SURFACES.<ekran>`. */
  areas: readonly RevenueArea[];
  /** `bar` - pasek nad treścią modułu; `chip` - zwarta pigułka w nagłówku. */
  variant?: "bar" | "chip";
  className?: string;
}

export function RevenueSignalChip(props: RevenueSignalChipProps) {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  return <SignalChipBody {...props} />;
}

type Tone = "critical" | "warning" | "info" | "ok" | "unknown";

const TONE_CLASS: Readonly<Record<Tone, string>> = {
  critical: "border-destructive/40 text-destructive",
  warning: "border-border text-brand-ink dark:text-brand",
  info: "border-border text-foreground",
  ok: "border-border text-muted-foreground",
  unknown: "border-border text-muted-foreground",
};

function toneOf(summary: SignalSummary): Tone {
  if (summary.worst) return summary.worst;
  return summary.unknown > 0 ? "unknown" : "ok";
}

/**
 * Ikony z zestawu huba (SPEC §6.8) - te same co `SeverityLabel` dla wag;
 * „nie wiadomo" dzieli ikonę z informacją, a różni się słowem.
 */
function ToneIcon({ tone }: { tone: Tone }) {
  const className = "h-3.5 w-3.5 shrink-0";
  if (tone === "critical") return <XCircle className={className} aria-hidden="true" />;
  if (tone === "warning") return <AlertTriangle className={className} aria-hidden="true" />;
  if (tone === "ok") return <ShieldCheck className={className} aria-hidden="true" />;
  return <Info className={className} aria-hidden="true" />;
}

function SignalChipBody({ areas, variant = "chip", className }: RevenueSignalChipProps) {
  ensureI18n();
  const { t } = useTranslation();
  const { roles, tenantId } = useAuth();
  const roleOk = roles.includes("admin") || roles.includes("editor");
  const tenant = tenantId ?? null;
  const areaKey = areas.join(",");
  // `select` stabilny między renderami - nowa funkcja co render liczyłaby
  // wybór od nowa przy każdym renderze rodzica.
  const select = useMemo(() => selectFactsForAreas(areaKey.split(",") as RevenueArea[]), [areaKey]);
  const facts = useQuery({ ...revenueFactsQueryOptions(tenant, { roleOk }), select });
  const snoozes = useQuery(revenueSnoozesQueryOptions(tenant, { roleOk }));

  const findings = useMemo(() => {
    if (facts.data?.state !== "ready") return null;
    const active = snoozes.data?.state === "ready" ? snoozes.data.snoozes : [];
    return evaluateAreaFindings(facts.data.facts, active, areaKey.split(",") as RevenueArea[]);
  }, [facts.data, snoozes.data, areaKey]);

  if (!roleOk || !tenant) return null;
  const denied = facts.data?.state === "forbidden" || facts.data?.state === "mfa_required";
  if (denied || (facts.isPending && !facts.isError)) return null;

  const summary: SignalSummary =
    findings === null
      ? { open: 0, critical: 0, warning: 0, info: 0, worst: null, unknown: 1 }
      : signalSummary(findings, areas);
  const tone = toneOf(summary);
  const top = findings ? findingsForAreas(findings, areas)[0] : undefined;
  // Odnośnik prowadzi do obszaru najpoważniejszej otwartej diagnozy (adres
  // przyjmuje jeden obszar), a bez otwartych - do pierwszego obszaru ekranu.
  const targetArea = top?.area ?? areas[0];
  const headline =
    summary.open > 0
      ? t("adminRevenue.signal.open", { count: summary.open })
      : tone === "unknown"
        ? t("adminRevenue.signal.unknown")
        : t("adminRevenue.signal.ok");
  const details =
    summary.open > 0
      ? t("adminRevenue.signal.details", {
          critical: summary.critical,
          warning: summary.warning,
          info: summary.info,
        })
      : null;

  const link = (
    <Link
      to="/admin/revenue/$tab"
      params={{ tab: "diagnostics" }}
      search={targetArea ? { area: targetArea } : {}}
      className="font-medium underline underline-offset-2 hover:no-underline"
    >
      {t("adminRevenue.signal.action")}
    </Link>
  );

  if (variant === "bar") {
    return (
      <div
        role="status"
        aria-label={t("adminRevenue.signal.label")}
        data-testid="revenue-signal"
        data-variant="bar"
        data-tone={tone}
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[6px] border bg-card px-3 py-2 text-sm",
          TONE_CLASS[tone],
          className,
        )}
      >
        <span className="inline-flex items-center gap-1.5">
          <ToneIcon tone={tone} />
          <span>{headline}</span>
        </span>
        {details ? <span className="text-xs text-muted-foreground">{details}</span> : null}
        <span className="ml-auto text-xs">{link}</span>
      </div>
    );
  }

  return (
    <span
      role="status"
      aria-label={t("adminRevenue.signal.label")}
      data-testid="revenue-signal"
      data-variant="chip"
      data-tone={tone}
      className={cn(
        "inline-flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs",
        TONE_CLASS[tone],
        className,
      )}
    >
      <ToneIcon tone={tone} />
      <span>{headline}</span>
      {/* Liczby per waga w pigułce tylko dla czytnika - wizualnie mieszczą się w pasku. */}
      {details ? <span className="sr-only">{details}</span> : null}
      <span aria-hidden="true">·</span>
      {link}
    </span>
  );
}
