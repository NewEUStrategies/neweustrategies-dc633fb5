// Panel rozliczeń: aktywne subskrypcje tenanta + historia zdarzeń od operatora
// płatności. Odczyt idzie przez RLS (polityki "Admins read tenant subscriptions"
// i "payment_webhook_events admin read") - komponent nie ma żadnych uprawnień
// ponad to, co baza przyzna zalogowanemu adminowi.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, BellRing, CreditCard, RefreshCcw, Users } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";

import { runBillingRemindersNow } from "@/lib/billing/reminders.functions";
import { getJobRunnerSettings } from "@/lib/newsletter-admin.functions";
import { Link } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { billingKeys } from "@/lib/billing/keys";
import { catalogEntryByPriceId } from "@/lib/billing/paddleCatalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SubscriptionRow {
  id: string;
  user_id: string;
  paddle_subscription_id: string;
  price_id: string;
  status: string;
  quantity: number;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  payment_failure_count: number;
  last_payment_failed_at: string | null;
  environment: string;
  created_at: string;
}

interface WebhookRow {
  id: string;
  event_id: string;
  event_type: string;
  status: string;
  environment: string;
  error: string | null;
  subscription_id: string | null;
  occurred_at: string | null;
  created_at: string;
}

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  trialing: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  past_due: "bg-amber-500/14 text-amber-700 dark:text-amber-300",
  paused: "bg-muted text-muted-foreground",
  canceled: "bg-destructive/10 text-destructive",
  processed: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  received: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  skipped: "bg-muted text-muted-foreground",
  failed: "bg-destructive/10 text-destructive",
};

function StatusBadge({ value }: { value: string }) {
  return (
    <Badge variant="outline" className={`border-0 text-[0.75rem] ${STATUS_TONE[value] ?? "bg-muted text-muted-foreground"}`}>
      {value}
    </Badge>
  );
}

export function AdminBillingPanel() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const [tab, setTab] = useState("subscriptions");

  const subsQ = useQuery({
    queryKey: billingKeys.admin.paddleSubscriptions(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select(
          "id,user_id,paddle_subscription_id,price_id,status,quantity,current_period_end,cancel_at_period_end,payment_failure_count,last_payment_failed_at,environment,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as SubscriptionRow[];
    },
  });

  const eventsQ = useQuery({
    queryKey: billingKeys.admin.paymentWebhookEvents(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_webhook_events")
        .select("id,event_id,event_type,status,environment,error,subscription_id,occurred_at,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as WebhookRow[];
    },
  });

  const loadRunner = useServerFn(getJobRunnerSettings);
  const runnerQ = useQuery({
    queryKey: ["admin", "billing", "job-runner"],
    queryFn: () => loadRunner(),
    staleTime: 60_000,
  });

  const runReminders = useServerFn(runBillingRemindersNow);
  const remindersM = useMutation({
    mutationFn: () => runReminders({ data: {} }),
    onSuccess: (r) =>
      toast.success(
        L(
          `Przypomnienia: ${r.renewal} odnowień, ${r.expiring} wygaśnięć`,
          `Reminders: ${r.renewal} renewals, ${r.expiring} expirations`,
        ),
      ),
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => subsQ.data ?? [], [subsQ.data]);
  const stats = useMemo(() => {
    const active = rows.filter((r) => ["active", "trialing"].includes(r.status)).length;
    const dunning = rows.filter((r) => (r.payment_failure_count ?? 0) > 0).length;
    const canceling = rows.filter((r) => r.cancel_at_period_end).length;
    return { active, dunning, canceling };
  }, [rows]);

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(lang === "pl" ? "pl-PL" : "en-GB") : "-";

  const planLabel = (priceId: string) => {
    const entry = catalogEntryByPriceId(priceId);
    if (!entry) return priceId;
    return `${entry.tierKey} · ${entry.interval === "year" ? L("rocznie", "yearly") : L("miesięcznie", "monthly")}`;
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground">
              <Users className="h-4 w-4" /> {L("Aktywne subskrypcje", "Active subscriptions")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{stats.active}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground">
              <AlertTriangle className="h-4 w-4" /> {L("Nieudane płatności", "Failed payments")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{stats.dunning}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground">
              <CreditCard className="h-4 w-4" /> {L("Zaplanowane anulowania", "Scheduled cancellations")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{stats.canceling}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground">
            <BellRing className="h-4 w-4" />
            {L("Automatyczne przypomnienia", "Automated reminders")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-[0.8125rem]">
          <p className="text-muted-foreground">
            {L(
              "Harmonogram bazy uruchamia przypomnienia o odnowieniu i wygaśnięciu dostępu codziennie o 7:10 (3 dni wyprzedzenia).",
              "The database scheduler sends renewal and access-expiry reminders daily at 07:10 (3-day lead time).",
            )}
          </p>
          {runnerQ.data ? (
            runnerQ.data.enabled && runnerQ.data.base_url ? (
              <p className="text-emerald-700 dark:text-emerald-300">
                {L("Harmonogram aktywny:", "Scheduler active:")} {runnerQ.data.base_url}
              </p>
            ) : (
              <p className="text-amber-700 dark:text-amber-300">
                {L(
                  "Harmonogram nieaktywny - włącz „Job runner” (adres i sekret) w",
                  "Scheduler inactive - enable the job runner (URL and secret) in",
                )}{" "}
                <Link to="/admin/newsletter/campaigns" className="underline">
                  /admin/newsletter/campaigns
                </Link>
                .
              </p>
            )
          ) : null}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="subscriptions">{L("Subskrypcje", "Subscriptions")}</TabsTrigger>
            <TabsTrigger value="events">{L("Historia webhooków", "Webhook history")}</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-[6px]"
              disabled={remindersM.isPending}
              onClick={() => remindersM.mutate()}
            >
              <BellRing className="mr-2 h-4 w-4" />
              {L("Wyślij przypomnienia", "Send reminders")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-[6px]"
              onClick={() => {
                void subsQ.refetch();
                void eventsQ.refetch();
              }}
            >
              <RefreshCcw className="mr-2 h-4 w-4" /> {L("Odśwież", "Refresh")}
            </Button>
          </div>

        </div>

        <TabsContent value="subscriptions" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {subsQ.isLoading ? (
                <div className="space-y-2 p-4">
                  <div className="h-8 w-full animate-pulse rounded-[6px] bg-muted" />
                  <div className="h-8 w-full animate-pulse rounded-[6px] bg-muted" />
                </div>
              ) : rows.length === 0 ? (
                <p className="p-6 text-[0.8125rem] text-muted-foreground">
                  {L("Brak subskrypcji.", "No subscriptions yet.")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[0.8125rem]">
                    <thead className="border-b bg-muted/40 text-left text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 font-medium">{L("Plan", "Plan")}</th>
                        <th className="px-4 py-2 font-medium">{L("Status", "Status")}</th>
                        <th className="px-4 py-2 font-medium">{L("Okres do", "Period ends")}</th>
                        <th className="px-4 py-2 font-medium">{L("Nieudane próby", "Failed attempts")}</th>
                        <th className="px-4 py-2 font-medium">{L("Środowisko", "Environment")}</th>
                        <th className="px-4 py-2 font-medium">ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="px-4 py-2">
                            {planLabel(r.price_id)}
                            {r.quantity > 1 ? ` × ${r.quantity}` : ""}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <StatusBadge value={r.status} />
                              {r.cancel_at_period_end ? (
                                <span className="text-[0.75rem] text-muted-foreground">
                                  {L("anulowanie", "canceling")}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-2">{fmtDate(r.current_period_end)}</td>
                          <td className="px-4 py-2">
                            {r.payment_failure_count > 0 ? (
                              <span className="text-destructive">
                                {r.payment_failure_count} · {fmtDate(r.last_payment_failed_at)}
                              </span>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{r.environment}</td>
                          <td className="px-4 py-2 font-mono text-[0.75rem] text-muted-foreground">
                            {r.paddle_subscription_id}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {eventsQ.isLoading ? (
                <div className="space-y-2 p-4">
                  <div className="h-8 w-full animate-pulse rounded-[6px] bg-muted" />
                  <div className="h-8 w-full animate-pulse rounded-[6px] bg-muted" />
                </div>
              ) : (eventsQ.data ?? []).length === 0 ? (
                <p className="p-6 text-[0.8125rem] text-muted-foreground">
                  {L("Brak zdarzeń.", "No events yet.")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[0.8125rem]">
                    <thead className="border-b bg-muted/40 text-left text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 font-medium">{L("Zdarzenie", "Event")}</th>
                        <th className="px-4 py-2 font-medium">{L("Status", "Status")}</th>
                        <th className="px-4 py-2 font-medium">{L("Kiedy", "When")}</th>
                        <th className="px-4 py-2 font-medium">{L("Subskrypcja", "Subscription")}</th>
                        <th className="px-4 py-2 font-medium">{L("Błąd", "Error")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(eventsQ.data ?? []).map((e) => (
                        <tr key={e.id} className="border-b last:border-0">
                          <td className="px-4 py-2">{e.event_type}</td>
                          <td className="px-4 py-2">
                            <StatusBadge value={e.status} />
                          </td>
                          <td className="px-4 py-2">{fmtDate(e.occurred_at ?? e.created_at)}</td>
                          <td className="px-4 py-2 font-mono text-[0.75rem] text-muted-foreground">
                            {e.subscription_id ?? "-"}
                          </td>
                          <td className="px-4 py-2 text-destructive">{e.error ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default AdminBillingPanel;
