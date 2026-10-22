// Pasek zdrowia silnika ścieżek nad listą (S8, SPEC §6.3) - czy silnik działa,
// ile kontaktów czeka, kiedy wykonał się ostatni krok i czy były błędy.
//
// PO CO NAD LISTĄ. Ścieżka „aktywna” przy wyłączonym silniku, wyłączniku
// awaryjnym albo niepodpiętym harmonogramie wygląda na liście tak samo jak
// działająca - a nie wysyła niczego. Pasek mówi to JEDNYM komunikatem
// (`engineHealthNotice`, od najważniejszego), zanim admin zacznie szukać
// błędu w samej ścieżce.
//
// Z-S5-03 (zamknięte w I9). Runner ścieżek jest krokiem `jobs-tick` (co
// minutę), więc włączony silnik z kontaktami „do wykonania” i bez żadnego
// wykonanego kroku znaczy „tick jeszcze nie przyszedł albo harmonogram stoi”
// - komunikat odsyła do panelu zdrowia harmonogramu. Odczyt odświeża się co minutę
// (`JOURNEY_HEALTH_REFETCH_MS`), a poprzednia liczba „do wykonania” pozwala
// odróżnić kolejkę rosnącą od opróżnianej.
//
// KOLOR NIGDY SAM: stan silnika to ikona + słowo, komunikat to `role="status"`
// z treścią. Wejście w ustawienia: admin edytuje, redaktor widzi podgląd.
import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  JOURNEY_ENGINE_NOTICE_KEY,
  engineHealthNotice,
  type JourneyEngineNotice,
} from "@/lib/admin/journeys/summaries";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n } from "@/lib/i18n-admin-journeys-list";
import type { JourneyEngineHealthDto } from "@/lib/journeys/dto";
import { journeyLabelKey } from "@/lib/journeys/labels";
import { journeyEngineHealthQueryOptions } from "@/lib/journeys/queries";

const LOCALE = { pl: "pl-PL", en: "en-GB" } as const;

export interface JourneyEngineHealthStripProps {
  tenantId: string | null;
  /** Admin - ustawienia do edycji; redaktor - podgląd. */
  canManageEngine: boolean;
  onOpenSettings: () => void;
}

export function JourneyEngineHealthStrip({
  tenantId,
  canManageEngine,
  onOpenSettings,
}: JourneyEngineHealthStripProps) {
  ensureJourneysI18n();
  ensureI18n();
  const { t } = useTranslation();
  const headingId = useId();
  const query = useQuery(journeyEngineHealthQueryOptions(tenantId));
  const health = query.data?.state === "ready" ? query.data.data : null;

  return (
    <section
      aria-labelledby={headingId}
      data-tour="journeys-engine"
      data-testid="journey-engine-health"
      className="space-y-3 rounded-[6px] border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={headingId} className="text-base font-semibold">
            {t("adminJourneys.health.title")}
          </h2>
          {health ? <EngineStatePill health={health} /> : null}
        </div>
        {query.data?.state === "unavailable" ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7"
            onClick={onOpenSettings}
          >
            {t(
              canManageEngine
                ? "adminJourneys.engineStrip.settings"
                : "adminJourneys.engineStrip.preview",
            )}
          </Button>
        )}
      </div>
      {query.isLoading ? (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {t("adminJourneys.engineStrip.loading")}
        </p>
      ) : query.isError ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <p className="text-destructive">{t("adminJourneys.engineStrip.loadError")}</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => void query.refetch()}
          >
            {t("adminJourneys.common.retry")}
          </Button>
        </div>
      ) : query.data?.state === "unavailable" ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("adminJourneys.engineStrip.unavailable")}
        </p>
      ) : health ? (
        <HealthBody health={health} dataUpdatedAt={query.dataUpdatedAt} />
      ) : null}
    </section>
  );
}

function EngineStatePill({ health }: { health: JourneyEngineHealthDto }) {
  const { t } = useTranslation();
  const [Icon, key] = health.killSwitch
    ? [AlertTriangle, "adminJourneys.engineStrip.killSwitch"]
    : health.enabled
      ? [CheckCircle2, "adminJourneys.engineStrip.enabled"]
      : [XCircle, "adminJourneys.engineStrip.disabled"];
  return (
    <span
      data-engine-state={
        health.killSwitch ? "kill_switch" : health.enabled ? "enabled" : "disabled"
      }
      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {t(key)}
    </span>
  );
}

function HealthBody({
  health,
  dataUpdatedAt,
}: {
  health: JourneyEngineHealthDto;
  dataUpdatedAt: number;
}) {
  const { t, i18n } = useTranslation();
  const locale = LOCALE[chartLangFrom(i18n.language)];
  // Poprzedni odczyt „do wykonania” - rosnąca kolejka bez kroków to Z-S5-03.
  const [trend, setTrend] = useState<{ at: number; due: number; previous: number | null } | null>(
    null,
  );
  useEffect(() => {
    setTrend((current) =>
      current?.at === dataUpdatedAt
        ? current
        : { at: dataUpdatedAt, due: health.dueNow, previous: current?.due ?? null },
    );
  }, [dataUpdatedAt, health.dueNow]);

  const notice: JourneyEngineNotice = engineHealthNotice(
    health,
    Date.now(),
    trend?.previous ?? null,
  );
  const formatTime = (iso: string | null) =>
    iso === null
      ? t("adminJourneys.engineStrip.never")
      : new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(
          new Date(iso),
        );
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);

  const metrics: readonly { key: string; label: string; value: string }[] = [
    {
      key: "journeysActive",
      label: t("adminJourneys.health.journeysActive"),
      value: number(health.journeysActive),
    },
    {
      key: "inboxPending",
      label: t("adminJourneys.health.inboxPending"),
      value: number(health.inboxPending),
    },
    { key: "dueNow", label: t("adminJourneys.health.dueNow"), value: number(health.dueNow) },
    {
      key: "lastStepAt",
      label: t("adminJourneys.health.lastStepAt"),
      value: formatTime(health.lastStepAt),
    },
    {
      key: "messages24h",
      label: t("adminJourneys.health.messages24h"),
      value: number(health.messages24h),
    },
    {
      key: "failed24h",
      label: t("adminJourneys.health.failed24h"),
      value: number(health.failed24h),
    },
  ];

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
        {metrics.map((metric) => (
          <div key={metric.key} data-metric={metric.key} className="min-w-0 space-y-0.5">
            <dt className="text-muted-foreground">{metric.label}</dt>
            <dd className="font-medium tabular-nums text-foreground">{metric.value}</dd>
          </div>
        ))}
      </dl>
      {notice !== null ? (
        <p
          role="status"
          data-notice={notice}
          className="flex items-start gap-2 rounded-[6px] border border-border bg-muted/30 p-2 text-xs text-foreground"
        >
          {notice === "kill_switch" || notice === "stalled" || notice === "errors" ? (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>{t(JOURNEY_ENGINE_NOTICE_KEY[notice])}</span>
        </p>
      ) : null}
      {health.lastErrors.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">
            {t("adminJourneys.health.lastErrors")} ({health.lastErrors.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {health.lastErrors.map((entry, index) => (
              <li key={`${entry.createdAt}-${index}`} className="text-muted-foreground">
                <span className="font-medium text-foreground">
                  {t(journeyLabelKey("enginePhase", entry.phase))}
                </span>{" "}
                · {formatTime(entry.createdAt)} · {entry.error}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
