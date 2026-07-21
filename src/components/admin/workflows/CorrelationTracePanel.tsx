// Ślad korelacji: pełny łańcuch „co się wydarzyło po moim kliknięciu".
// Wejściem jest correlation_id (uuid nadawany przez frontend nagłówkiem
// x-correlation-id); wyjściem oś czasu zdarzeń domenowych z podpiętymi
// przebiegami automatyzacji i dostawami webhooków outboxu.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-workflows";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ChevronDown,
  Loader2,
  Route as RouteIcon,
  SearchCode,
  Webhook,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { eventPayload } from "@/lib/realtime/domainEvents";
import {
  fetchCorrelationTrace,
  isUuid,
  type CorrelationTrace,
  type CorrelationTraceDelivery,
  type WorkflowRunWithDefinition,
} from "@/lib/admin/workflows";
import { DateTimeText, EventTypeChip, RunStatusBadge } from "./atoms";

interface CorrelationTracePanelProps {
  correlationId: string | null;
  onCorrelationIdChange: (id: string | null) => void;
}

export function CorrelationTracePanel({
  correlationId,
  onCorrelationIdChange,
}: CorrelationTracePanelProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState(correlationId ?? "");
  const [invalid, setInvalid] = useState(false);

  const traceQuery = useQuery({
    queryKey: ["admin", "correlation-trace", correlationId],
    queryFn: () => fetchCorrelationTrace(correlationId ?? ""),
    enabled: correlationId !== null && isUuid(correlationId),
    staleTime: 30_000,
  });

  const submit = () => {
    const trimmed = input.trim();
    if (!isUuid(trimmed)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onCorrelationIdChange(trimmed);
  };

  // Deep-link (klik „Ślad" w historii / parametr URL) nadpisuje lokalny input.
  // Wzorzec „adjust state during render": reagujemy na ZMIANĘ propa, nie na
  // każdy render, więc ręczna edycja inputu nie jest nadpisywana.
  const [lastPropId, setLastPropId] = useState(correlationId);
  if (correlationId !== lastPropId) {
    setLastPropId(correlationId);
    if (correlationId) {
      setInput(correlationId);
      setInvalid(false);
    }
  }

  const trace = traceQuery.data;

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("adminWorkflows.trace.intro")}</p>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="trace-correlation">{t("adminWorkflows.trace.inputLabel")}</Label>
          <Input
            id="trace-correlation"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setInvalid(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={t("adminWorkflows.trace.inputPlaceholder")}
            className="font-mono text-xs"
            aria-invalid={invalid}
          />
          {invalid && (
            <p className="text-xs text-destructive">{t("adminWorkflows.trace.invalidUuid")}</p>
          )}
        </div>
        <Button onClick={submit} disabled={traceQuery.isFetching}>
          {traceQuery.isFetching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <SearchCode className="mr-2 h-4 w-4" aria-hidden />
          )}
          {t("adminWorkflows.trace.load")}
        </Button>
      </div>

      {traceQuery.isError && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {t("adminWorkflows.common.loadError")}
          </CardContent>
        </Card>
      )}

      {trace && trace.events.length === 0 && !traceQuery.isFetching && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("adminWorkflows.trace.empty")}
          </CardContent>
        </Card>
      )}

      {trace && trace.events.length > 0 && <TraceTimeline trace={trace} />}
    </div>
  );
}

function TraceTimeline({ trace }: { trace: CorrelationTrace }) {
  const { t } = useTranslation();
  const firstTs = new Date(trace.events[0].created_at).getTime();

  const runsByEvent = new Map<string, WorkflowRunWithDefinition[]>();
  const orphanRuns: WorkflowRunWithDefinition[] = [];
  for (const run of trace.runs) {
    if (run.event_id) {
      const list = runsByEvent.get(run.event_id) ?? [];
      list.push(run);
      runsByEvent.set(run.event_id, list);
    } else {
      orphanRuns.push(run);
    }
  }
  const deliveriesByEvent = new Map<string, CorrelationTraceDelivery[]>();
  for (const delivery of trace.deliveries) {
    if (!delivery.event_id) continue;
    const list = deliveriesByEvent.get(delivery.event_id) ?? [];
    list.push(delivery);
    deliveriesByEvent.set(delivery.event_id, list);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Activity className="h-3.5 w-3.5" aria-hidden />
          {t("adminWorkflows.trace.eventsTitle", { count: trace.events.length })}
        </span>
        <span className="inline-flex items-center gap-1">
          <WorkflowIcon className="h-3.5 w-3.5" aria-hidden />
          {t("adminWorkflows.trace.runsTitle", { count: trace.runs.length })}
        </span>
        <span className="inline-flex items-center gap-1">
          <Webhook className="h-3.5 w-3.5" aria-hidden />
          {t("adminWorkflows.trace.deliveriesTitle", { count: trace.deliveries.length })}
        </span>
      </div>

      <ol className="relative space-y-4 border-l border-border/70 pl-5">
        {trace.events.map((event) => {
          const offsetMs = new Date(event.created_at).getTime() - firstTs;
          const runs = runsByEvent.get(event.id) ?? [];
          const deliveries = deliveriesByEvent.get(event.id) ?? [];
          return (
            <li key={event.id} className="relative">
              <span
                className="absolute -left-[26px] top-1.5 h-3 w-3 rounded-full border-2 border-background bg-brand"
                aria-hidden
              />
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <EventTypeChip type={event.event_type} />
                    <span className="text-xs text-muted-foreground">
                      <DateTimeText iso={event.created_at} />
                      {offsetMs > 0 && (
                        <span className="ml-1 tabular-nums">
                          {t("adminWorkflows.trace.startOffset", {
                            ms: offsetMs.toLocaleString(),
                          })}
                        </span>
                      )}
                    </span>
                  </div>
                  <dl className="grid gap-1 text-xs sm:grid-cols-2">
                    <div className="flex gap-1.5">
                      <dt className="text-muted-foreground">
                        {t("adminWorkflows.trace.aggregate")}:
                      </dt>
                      <dd className="font-mono">
                        {event.aggregate_type}/{event.aggregate_id.slice(0, 12)}
                        {event.aggregate_id.length > 12 ? "…" : ""}
                      </dd>
                    </div>
                    {event.actor_id && (
                      <div className="flex gap-1.5">
                        <dt className="text-muted-foreground">
                          {t("adminWorkflows.trace.actor")}:
                        </dt>
                        <dd className="font-mono">{event.actor_id.slice(0, 12)}…</dd>
                      </div>
                    )}
                  </dl>

                  <PayloadDisclosure payload={eventPayload(event)} />

                  {runs.length > 0 && (
                    <div className="space-y-1.5 border-t border-border/60 pt-2">
                      {runs.map((run) => (
                        <div key={run.id} className="flex flex-wrap items-center gap-2 text-xs">
                          <WorkflowIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                          <span className="font-medium">
                            {run.workflow_definitions?.name ??
                              t("adminWorkflows.runs.deletedWorkflow")}
                          </span>
                          <RunStatusBadge status={run.status} />
                          <span className="text-muted-foreground">
                            {t("adminWorkflows.trace.stepsCompleted", {
                              count: run.steps_completed,
                            })}
                          </span>
                          {run.error && (
                            <span className="w-full truncate text-destructive" title={run.error}>
                              {run.error}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {deliveries.length > 0 && (
                    <div className="space-y-1.5 border-t border-border/60 pt-2">
                      {deliveries.map((delivery) => (
                        <div
                          key={delivery.id}
                          className="flex flex-wrap items-center gap-2 text-xs"
                        >
                          <Webhook className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                          <span className="font-medium">
                            {delivery.integration_endpoints?.name ?? delivery.event_type}
                          </span>
                          <RunStatusBadge status={delivery.status} />
                          <span className="text-muted-foreground">
                            {t("adminWorkflows.trace.attempts", { count: delivery.attempts })}
                          </span>
                          {delivery.delivered_at && (
                            <span className="text-muted-foreground">
                              {t("adminWorkflows.trace.deliveredAt")}{" "}
                              <DateTimeText iso={delivery.delivered_at} />
                            </span>
                          )}
                          {delivery.last_error && (
                            <span
                              className="w-full truncate text-destructive"
                              title={delivery.last_error}
                            >
                              {delivery.last_error}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>

      {orphanRuns.length > 0 && (
        <Card>
          <CardContent className="space-y-1.5 p-4">
            {orphanRuns.map((run) => (
              <div key={run.id} className="flex flex-wrap items-center gap-2 text-xs">
                <RouteIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <span className="font-medium">
                  {run.workflow_definitions?.name ?? t("adminWorkflows.runs.deletedWorkflow")}
                </span>
                <RunStatusBadge status={run.status} />
                <DateTimeText iso={run.created_at} className="text-muted-foreground" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {trace.runs.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("adminWorkflows.trace.noRuns")}</p>
      )}
      {trace.deliveries.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("adminWorkflows.trace.noDeliveries")}</p>
      )}
    </div>
  );
}

/** Payload zdarzenia jako zwijany blok JSON (domyślnie schowany). */
function PayloadDisclosure({ payload }: { payload: Record<string, unknown> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const keys = Object.keys(payload);
  if (keys.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
        aria-expanded={open}
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        {t("adminWorkflows.trace.payload")} ({keys.length})
      </button>
      {open && (
        <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}
