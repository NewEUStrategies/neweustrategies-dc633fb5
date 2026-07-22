// Dashboard monetyzacji: metered views, użycia kuponów, ustawienia checkoutu,
// filtry po planie i organizacji. Odczyt via monetization_dashboard (RPC, staff-only).
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  TrendingUp,
  ShieldCheck,
  BadgePercent,
  Users,
  Ban,
  LogIn,
  HeartHandshake,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Database } from "@/integrations/supabase/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/admin/monetization")({
  component: AdminMonetizationPage,
});

interface DashboardShape {
  range: { from: string; to: string };
  metered_views: { total: number; members: number; anonymous: number };
  metering_events: { consumed: number; denied: number; reg_wall: number };
  orders: { total: number; paid: number; revenue_cents: number };
  coupons: { total: number; active: number; redemptions: number };
  redemptions: { in_range: number; discount_cents: number };
  checkout_settings: Record<string, unknown>;
}

const ALL = "__all__";

function AdminMonetizationPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);

  const nowIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const monthAgoIso = useMemo(
    () => new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    [],
  );
  const [from, setFrom] = useState(monthAgoIso);
  const [to, setTo] = useState(nowIso);
  const [planId, setPlanId] = useState<string>(ALL);
  const [orgId, setOrgId] = useState<string>(ALL);

  const plansQ = useQuery({
    queryKey: ["admin", "monetization", "plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("access_plans")
        .select("id, name_pl, name_en")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const orgsQ = useQuery({
    queryKey: ["admin", "monetization", "orgs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("member_organizations")
        .select("id, name")
        .order("name")
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const dashQ = useQuery({
    queryKey: ["admin", "monetization", from, to, planId, orgId],
    queryFn: async (): Promise<DashboardShape> => {
      const { data, error } = await supabase.rpc("monetization_dashboard", {
        _from: new Date(from).toISOString(),
        _to: new Date(new Date(to).getTime() + 24 * 3600 * 1000 - 1).toISOString(),
        _plan_id: planId === ALL ? "00000000-0000-0000-0000-000000000000" : planId,
        _organization_id: orgId === ALL ? "00000000-0000-0000-0000-000000000000" : orgId,
      });
      if (error) throw error;
      return data as unknown as DashboardShape;
    },
  });

  const fmt = new Intl.NumberFormat(lang === "pl" ? "pl-PL" : "en-US");
  const fmtMoney = (cents: number, currency = "PLN") =>
    new Intl.NumberFormat(lang === "pl" ? "pl-PL" : "en-US", {
      style: "currency",
      currency,
    }).format(cents / 100);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          {L("Dashboard monetyzacji", "Monetization dashboard")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {L(
            "Widoki mierzone, użycia kuponów, przychody i status checkoutu — z filtrami po organizacji i planie.",
            "Metered views, coupon usage, revenue and checkout status — filtered by organisation and plan.",
          )}
        </p>
      </header>

      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">{L("Od", "From")}</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{L("Do", "To")}</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{L("Plan", "Plan")}</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{L("Wszystkie plany", "All plans")}</SelectItem>
                  {(plansQ.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {(lang === "pl" ? p.name_pl : p.name_en) || p.name_pl || p.name_en || p.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{L("Organizacja", "Organisation")}</Label>
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{L("Wszystkie", "All")}</SelectItem>
                  {(orgsQ.data ?? []).map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard
          icon={<Users className="h-4 w-4" />}
          label={L("Widoki mierzone", "Metered views")}
          value={fmt.format(dashQ.data?.metered_views.total ?? 0)}
          hint={L(
            `${dashQ.data?.metered_views.members ?? 0} członków · ${dashQ.data?.metered_views.anonymous ?? 0} anon`,
            `${dashQ.data?.metered_views.members ?? 0} members · ${dashQ.data?.metered_views.anonymous ?? 0} anon`,
          )}
        />
        <MetricCard
          icon={<Ban className="h-4 w-4" />}
          label={L("Odmowy paywalla", "Paywall denials")}
          value={fmt.format(dashQ.data?.metering_events.denied ?? 0)}
        />
        <MetricCard
          icon={<LogIn className="h-4 w-4" />}
          label={L("Ściana rejestracji", "Register wall")}
          value={fmt.format(dashQ.data?.metering_events.reg_wall ?? 0)}
        />
        <MetricCard
          icon={<BadgePercent className="h-4 w-4" />}
          label={L("Aktywne kupony", "Active coupons")}
          value={`${dashQ.data?.coupons.active ?? 0} / ${dashQ.data?.coupons.total ?? 0}`}
        />
        <MetricCard
          icon={<BadgePercent className="h-4 w-4" />}
          label={L("Użycia kuponów", "Coupon redemptions")}
          value={fmt.format(dashQ.data?.redemptions.in_range ?? 0)}
          hint={fmtMoney(dashQ.data?.redemptions.discount_cents ?? 0)}
        />
        <MetricCard
          icon={<TrendingUp className="h-4 w-4" />}
          label={L("Przychód (opłacone)", "Revenue (paid)")}
          value={fmtMoney(dashQ.data?.orders.revenue_cents ?? 0)}
          hint={L(
            `${dashQ.data?.orders.paid ?? 0} / ${dashQ.data?.orders.total ?? 0} zamówień`,
            `${dashQ.data?.orders.paid ?? 0} / ${dashQ.data?.orders.total ?? 0} orders`,
          )}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            {L("Ustawienia checkoutu", "Checkout settings")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            {[
              ["allow_promotion_codes", L("Kody Stripe", "Stripe codes")],
              ["automatic_tax", L("Automatyczny VAT", "Automatic tax")],
              ["tax_id_collection", L("Zbieranie NIP", "Tax ID collection")],
              ["invoice_creation", L("Faktury", "Invoices")],
            ].map(([key, label]) => {
              const v = dashQ.data?.checkout_settings?.[key];
              const on = v === true;
              return (
                <div
                  key={key}
                  className="rounded-md border border-border/60 px-3 py-2 flex items-center justify-between"
                >
                  <span>{label}</span>
                  <span
                    className={
                      on
                        ? "text-xs font-semibold text-emerald-600"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {on ? L("Włączone", "On") : L("Wyłączone", "Off")}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <RetentionSummarySection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Retencja odchodzących: skrót z retention_feedback (90 dni) - odpowiedzi,
// przyjęte kontrofertki i najczęstsze powody; konfiguracja w /admin/pricing.
// ---------------------------------------------------------------------------
type RetentionFeedbackRow = Database["public"]["Tables"]["retention_feedback"]["Row"];

function RetentionSummarySection() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);

  const feedbackQ = useQuery({
    queryKey: ["admin", "retention-feedback"],
    queryFn: async (): Promise<RetentionFeedbackRow[]> => {
      const { data, error } = await supabase
        .from("retention_feedback")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const stats = useMemo(() => {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const recent = (feedbackQ.data ?? []).filter(
      (row) => new Date(row.created_at).getTime() >= cutoff,
    );
    const shown = recent.filter((row) => row.offer_shown);
    const accepted = recent.filter((row) => row.offer_accepted);
    const byReason = new Map<string, number>();
    for (const row of recent) {
      byReason.set(row.reason_label, (byReason.get(row.reason_label) ?? 0) + 1);
    }
    const topReasons = [...byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return {
      total: recent.length,
      accepted: accepted.length,
      acceptRate: shown.length > 0 ? Math.round((accepted.length / shown.length) * 100) : null,
      topReasons,
    };
  }, [feedbackQ.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <HeartHandshake className="h-4 w-4" aria-hidden="true" />
            {L("Retencja odchodzących (90 dni)", "Churn retention (90 days)")}
          </span>
          <Button asChild size="sm" variant="outline" className="h-7">
            <Link to="/admin/pricing">{L("Konfiguruj w Cenniku", "Configure in Pricing")}</Link>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border/60 px-3 py-2">
            <div className="text-xs text-muted-foreground">
              {L("Odpowiedzi ankiety", "Survey responses")}
            </div>
            <div className="text-xl font-bold">{stats.total}</div>
          </div>
          <div className="rounded-md border border-border/60 px-3 py-2">
            <div className="text-xs text-muted-foreground">
              {L("Przyjęte kontrofertki", "Accepted counter-offers")}
            </div>
            <div className="text-xl font-bold">
              {stats.accepted}
              {stats.acceptRate !== null && (
                <span className="ml-2 text-sm font-medium text-muted-foreground">
                  ({stats.acceptRate}%)
                </span>
              )}
            </div>
          </div>
          <div className="rounded-md border border-border/60 px-3 py-2">
            <div className="text-xs text-muted-foreground">
              {L("Najczęstsze powody", "Top reasons")}
            </div>
            {stats.topReasons.length === 0 ? (
              <div className="text-sm text-muted-foreground">-</div>
            ) : (
              <ul className="mt-0.5 space-y-0.5 text-sm">
                {stats.topReasons.map(([label, count]) => (
                  <li key={label} className="flex items-center justify-between gap-2">
                    <span className="truncate">{label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between text-xs uppercase text-muted-foreground">
          <span>{label}</span>
          <span className="text-foreground/60">{icon}</span>
        </div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}
