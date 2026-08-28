// Organizm: WEJŚCIA NA ŻYWO (sesje i sale).
//
// ZAJĘTOŚĆ TO RÓŻNICA, NIE SUMA. Sala liczy wejścia minus wyjścia - suma
// samych wejść po godzinie pokazałaby komplet w pustej sali, bo nikt nie
// odejmowałby wyjść po zakończonej sesji.
//
// PRZEKROCZENIE POJEMNOŚCI JEST STANEM, KTÓRY MUSI KŁUĆ W OCZY. Koordynator
// stoi przy drzwiach i podejmuje decyzję w sekundę; dlatego pełna i przepełniona
// sala mają odznakę, a nie tylko inny odcień liczby.
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { FormSelect } from "@/components/atoms/FormSelect";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { adminOnsiteErrorMessage } from "@/lib/events/adminOnsiteErrors";
import { useOnsiteLiveStats } from "@/lib/events/useEventOnsite";
import type { OnsiteLiveRoomStat, OnsiteLiveSessionStat } from "@/lib/events/onsiteApi";
import { uiLang } from "@/lib/i18n/format";
import { useState } from "react";

function occupancyState(inside: number, capacity: number | null): "ok" | "full" | "over" {
  if (capacity === null || capacity <= 0) return "ok";
  if (inside > capacity) return "over";
  if (inside >= capacity) return "full";
  return "ok";
}

function timeLabel(value: string | null, lang: string): string {
  if (value === null) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleTimeString(lang === "en" ? "en-GB" : "pl-PL", {
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function OnsiteLiveStatsPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const [windowMinutes, setWindowMinutes] = useState(60);
  const statsQ = useOnsiteLiveStats(eventId, windowMinutes);
  const data = statsQ.data ?? null;

  const sessions = data?.sessions ?? [];
  const rooms = data?.rooms ?? [];

  const metrics = (row: OnsiteLiveSessionStat | OnsiteLiveRoomStat) => (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
      <div>
        <dt>{t("adminEventOnsite.liveStats.grantedIn")}</dt>
        <dd className="font-medium text-foreground">{row.grantedIn}</dd>
      </div>
      <div>
        <dt>{t("adminEventOnsite.liveStats.grantedOut")}</dt>
        <dd className="font-medium text-foreground">{row.grantedOut}</dd>
      </div>
      <div>
        <dt>{t("adminEventOnsite.liveStats.uniquePeople")}</dt>
        <dd className="font-medium text-foreground">{row.uniquePeople}</dd>
      </div>
      <div>
        <dt>{t("adminEventOnsite.liveStats.denied")}</dt>
        <dd className="font-medium text-foreground">{row.denied}</dd>
      </div>
      <div>
        <dt>{t("adminEventOnsite.liveStats.recentIn")}</dt>
        <dd className="font-medium text-foreground">{row.recentIn}</dd>
      </div>
      <div>
        <dt>{t("adminEventOnsite.liveStats.lastCheckin")}</dt>
        <dd className="font-medium text-foreground">{timeLabel(row.lastCheckinAt, lang)}</dd>
      </div>
    </dl>
  );

  const occupancyBadge = (inside: number, capacity: number | null) => {
    const state = occupancyState(inside, capacity);
    return (
      <div className="flex items-center gap-2">
        <span className="font-display text-2xl leading-none">{inside}</span>
        <span className="text-xs text-muted-foreground">
          {capacity === null || capacity <= 0
            ? t("adminEventOnsite.liveStats.inside")
            : `/ ${capacity} ${t("adminEventOnsite.liveStats.capacity").toLowerCase()}`}
        </span>
        {state === "ok" ? null : (
          <Badge variant={state === "over" ? "destructive" : "secondary"} className="rounded-md">
            {state === "over"
              ? t("adminEventOnsite.liveStats.overCapacity")
              : t("adminEventOnsite.liveStats.full")}
          </Badge>
        )}
      </div>
    );
  };

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="font-display text-lg">{t("adminEventOnsite.liveStats.title")}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("adminEventOnsite.liveStats.subtitle")}
        </p>
      </header>

      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="live-stats-window">{t("adminEventOnsite.liveStats.windowLabel")}</Label>
        <FormSelect
          id="live-stats-window"
          value={String(windowMinutes)}
          options={[
            { value: "15", label: t("adminEventOnsite.liveStats.window15") },
            { value: "60", label: t("adminEventOnsite.liveStats.window60") },
            { value: "180", label: t("adminEventOnsite.liveStats.window180") },
          ]}
          onValueChange={(value) => setWindowMinutes(Number(value))}
          aria-label={t("adminEventOnsite.liveStats.windowLabel")}
        />
      </div>

      <AdminCatalogListState
        isLoading={statsQ.isLoading}
        loadingLabel={t("adminEventOnsite.liveStats.loading")}
        errorMessage={
          statsQ.error === null || statsQ.error === undefined
            ? null
            : adminOnsiteErrorMessage(statsQ.error)
        }
        isEmpty={sessions.length === 0 && rooms.length === 0}
        emptyLabel={t("adminEventOnsite.liveStats.empty")}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">
              {t("adminEventOnsite.liveStats.sessionsTitle")}
            </h3>
            {sessions.map((row) => (
              <Card key={row.sessionId} className="rounded-md">
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {lang === "en" ? row.titleEn || row.titlePl : row.titlePl || row.titleEn}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {`${timeLabel(row.startsAt, lang)}-${timeLabel(row.endsAt, lang)} · ${
                          row.roomName ?? t("adminEventOnsite.liveStats.noRoom")
                        }`}
                      </p>
                    </div>
                    {occupancyBadge(row.inside, row.capacity)}
                  </div>
                  {metrics(row)}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">{t("adminEventOnsite.liveStats.roomsTitle")}</h3>
            {rooms.map((row) => (
              <Card key={row.roomId} className="rounded-md">
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      {row.floor === null ? null : (
                        <p className="truncate text-xs text-muted-foreground">{row.floor}</p>
                      )}
                    </div>
                    {occupancyBadge(row.inside, row.capacity)}
                  </div>
                  {metrics(row)}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </AdminCatalogListState>
    </section>
  );
}
