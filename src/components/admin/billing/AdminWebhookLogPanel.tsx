// Czytelny dziennik zdarzeń od operatora płatności.
//
// Zamiast surowej tabeli: filtry (status/typ/środowisko), człowiecze etykiety,
// czas obsługi, powiązanie z użytkownikiem/subskrypcją i rozwijany podgląd
// ładunku - tyle, żeby diagnoza „dlaczego zakup nie nadał uprawnień" nie
// wymagała wchodzenia do bazy.
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, RefreshCcw, RotateCw, Webhook } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { retryWebhookEvent } from "@/lib/billing/webhookRetry.functions";
import { billingKeys } from "@/lib/billing/keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Kolumny czytane przez ten panel - WYPROWADZONE z wygenerowanych typów, nie
 * przepisane ręcznie.
 *
 * Ręczna kopia tego kształtu już się rozjechała z bazą: deklarowała
 * `retry_count: number | null` przy kolumnie NOT NULL i `payload: unknown`
 * zamiast `Json`. Rozjazd był niewidzialny, bo `as unknown as WebhookLogRow`
 * kasuje dowolną różnicę - przy 760 migracjach forward-only zmiana nazwy
 * kolumny nie oblewa `tsc`, tylko renderuje `undefined` w kolumnie tabeli.
 *
 * `Pick` po `Tables<>` wiąże listę z `select(...)` niżej: skreślenie kolumny
 * w migracji jest teraz błędem KOMPILACJI w tym pliku.
 */
type WebhookLogRow = Pick<
  Tables<"payment_webhook_events">,
  | "id"
  | "event_id"
  | "event_type"
  | "status"
  | "environment"
  | "error"
  | "subscription_id"
  | "customer_id"
  | "user_id"
  | "occurred_at"
  | "created_at"
  | "processed_at"
  | "duration_ms"
  | "retry_count"
  | "last_retried_at"
  | "payload"
>;

const STATUS_TONE: Record<string, string> = {
  processed: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  received: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  skipped: "bg-muted text-muted-foreground",
  failed: "bg-destructive/10 text-destructive",
};

export function AdminWebhookLogPanel() {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);

  const [status, setStatus] = useState("all");
  const [env, setEnv] = useState("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const retryFn = useServerFn(retryWebhookEvent);

  // Ponowienie działa na ładunku z dziennika i przechodzi tą samą, idempotentną
  // ścieżką co zdarzenie przychodzące - powtórka nie zdubluje maili ani uprawnień.
  const retry = useMutation({
    mutationFn: (id: string) => retryFn({ data: { id } }),
    onSuccess: (result) => {
      if (result.status === "failed") {
        toast.error(L("Ponowienie nie powiodło się", "Retry failed"), {
          description: result.error ?? undefined,
        });
      } else {
        toast.success(
          result.status === "processed"
            ? L("Zdarzenie przetworzone ponownie", "Event reprocessed")
            : L("Zdarzenie pominięte (typ poza integracją)", "Event skipped (type not handled)"),
          { description: `${result.eventType} · ${result.durationMs} ms` },
        );
      }
      void queryClient.invalidateQueries({ queryKey: billingKeys.admin.paymentWebhookEvents() });
    },
    onError: (err: unknown) => {
      toast.error(L("Nie udało się ponowić zdarzenia", "Could not retry the event"), {
        description: err instanceof Error ? err.message : undefined,
      });
    },
  });

  const q = useQuery({
    queryKey: billingKeys.admin.paymentWebhookEvents(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_webhook_events")
        .select(
          "id,event_id,event_type,status,environment,error,subscription_id,customer_id,user_id,occurred_at,created_at,processed_at,duration_ms,retry_count,last_retried_at,payload",
        )
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) satisfies WebhookLogRow[];
    },
    staleTime: 15_000,
  });

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (q.data ?? []).filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (env !== "all" && r.environment !== env) return false;
      if (!needle) return true;
      return [r.event_type, r.event_id, r.subscription_id, r.customer_id, r.user_id, r.error]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [q.data, status, env, search]);

  const stats = useMemo(() => {
    const all = q.data ?? [];
    return {
      failed: all.filter((r) => r.status === "failed").length,
      processed: all.filter((r) => r.status === "processed").length,
      stuck: all.filter((r) => r.status === "received").length,
    };
  }, [q.data]);

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(lang === "pl" ? "pl-PL" : "en-GB") : "-";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground">
          <Webhook className="h-4 w-4" aria-hidden="true" />
          {L("Dziennik zdarzeń płatności", "Payment event log")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[0.8125rem] text-muted-foreground">
          {L(
            `Przetworzone: ${stats.processed} · błędy: ${stats.failed} · w toku: ${stats.stuck}`,
            `Processed: ${stats.processed} · errors: ${stats.failed} · in progress: ${stats.stuck}`,
          )}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={L("Szukaj: typ, ID, użytkownik...", "Search: type, ID, user...")}
            className="h-9 max-w-xs rounded-[6px] text-[0.8125rem]"
          />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-40 rounded-[6px] text-[0.8125rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{L("Każdy status", "Any status")}</SelectItem>
              <SelectItem value="processed">{L("Przetworzone", "Processed")}</SelectItem>
              <SelectItem value="skipped">{L("Pominięte", "Skipped")}</SelectItem>
              <SelectItem value="failed">{L("Błędy", "Errors")}</SelectItem>
              <SelectItem value="received">{L("W toku", "In progress")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={env} onValueChange={setEnv}>
            <SelectTrigger className="h-9 w-36 rounded-[6px] text-[0.8125rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{L("Oba środowiska", "Both environments")}</SelectItem>
              <SelectItem value="sandbox">{L("Testowe", "Test")}</SelectItem>
              <SelectItem value="live">{L("Produkcyjne", "Live")}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-[6px]"
            onClick={() => void q.refetch()}
          >
            <RefreshCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {L("Odśwież", "Refresh")}
          </Button>
        </div>

        {q.isLoading && (
          <p className="text-[0.8125rem] text-muted-foreground">{L("Wczytuję...", "Loading...")}</p>
        )}
        {!q.isLoading && rows.length === 0 && (
          <p className="text-[0.8125rem] text-muted-foreground">
            {L("Brak zdarzeń dla tych filtrów.", "No events for these filters.")}
          </p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full text-left text-[0.8125rem]">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="w-8 px-2 py-2" aria-label={L("Szczegóły", "Details")} />
                  <th className="px-3 py-2 font-medium">{L("Zdarzenie", "Event")}</th>
                  <th className="px-3 py-2 font-medium">{L("Status", "Status")}</th>
                  <th className="px-3 py-2 font-medium">{L("Środowisko", "Environment")}</th>
                  <th className="px-3 py-2 font-medium">{L("Czas obsługi", "Handling time")}</th>
                  <th className="px-3 py-2 font-medium">{L("Odebrano", "Received")}</th>
                  <th className="px-3 py-2 text-right font-medium">{L("Ponowienie", "Retry")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const open = openId === row.id;
                  return (
                    <Fragment key={row.id}>
                      <tr className="border-t border-border/60 align-top">
                        <td className="px-2 py-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-expanded={open}
                            aria-label={L("Pokaż ładunek", "Show payload")}
                            onClick={() => setOpenId(open ? null : row.id)}
                          >
                            {open ? (
                              <ChevronDown className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="h-4 w-4" aria-hidden="true" />
                            )}
                          </Button>
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-medium">{row.event_type}</span>
                          <span className="block truncate font-mono text-[0.7rem] text-muted-foreground">
                            {row.subscription_id ?? row.customer_id ?? row.event_id}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <Badge
                            variant="outline"
                            className={`border-0 text-[0.75rem] ${
                              STATUS_TONE[row.status] ?? "bg-muted text-muted-foreground"
                            }`}
                          >
                            {row.status}
                          </Badge>
                          {row.error && (
                            <span className="mt-1 block text-xs text-destructive">{row.error}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.environment === "sandbox"
                            ? L("testowe", "test")
                            : L("produkcja", "live")}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          {row.duration_ms === null ? "-" : `${row.duration_ms} ms`}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          {fmt(row.occurred_at ?? row.created_at)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-[6px]"
                            disabled={retry.isPending}
                            onClick={() => retry.mutate(row.id)}
                          >
                            <RotateCw
                              className={`mr-1.5 h-3.5 w-3.5 ${
                                retry.isPending && retry.variables === row.id ? "animate-spin" : ""
                              }`}
                              aria-hidden="true"
                            />
                            {L("Ponów", "Retry")}
                          </Button>
                          {(row.retry_count ?? 0) > 0 && (
                            <span className="mt-1 block text-[0.7rem] text-muted-foreground">
                              {L("prób", "attempts")}: {row.retry_count} ·{" "}
                              {fmt(row.last_retried_at)}
                            </span>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-t border-border/40 bg-muted/20">
                          <td colSpan={7} className="px-4 py-3">
                            <dl className="mb-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                              <div>
                                <dt className="inline font-medium">
                                  {L("Identyfikator", "Event id")}:{" "}
                                </dt>
                                <dd className="inline font-mono">{row.event_id}</dd>
                              </div>
                              <div>
                                <dt className="inline font-medium">{L("Użytkownik", "User")}: </dt>
                                <dd className="inline font-mono">{row.user_id ?? "-"}</dd>
                              </div>
                              <div>
                                <dt className="inline font-medium">
                                  {L("Domknięto", "Finished")}:{" "}
                                </dt>
                                <dd className="inline">{fmt(row.processed_at)}</dd>
                              </div>
                              <div>
                                <dt className="inline font-medium">
                                  {L("Idempotencja", "Idempotency")}:{" "}
                                </dt>
                                <dd className="inline">
                                  {L("klucz", "key")} {row.event_id.slice(0, 12)}… ·{" "}
                                  {(row.retry_count ?? 0) === 0
                                    ? L("brak ponowień", "no retries")
                                    : L(
                                        `ponowienia: ${row.retry_count}`,
                                        `retries: ${row.retry_count}`,
                                      )}
                                </dd>
                              </div>
                            </dl>
                            <pre className="max-h-72 overflow-auto rounded-[6px] bg-background p-3 text-[0.7rem] leading-relaxed">
                              {JSON.stringify(row.payload, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
