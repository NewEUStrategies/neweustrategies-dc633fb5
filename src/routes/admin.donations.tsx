// Panel darowizn: lista wpłat mecenatu + sumy (całość / bieżący miesiąc).
// Odczyt pod RLS "donations admin read" (admin własnego tenanta); zapisy robi
// wyłącznie webhook Stripe / tryb mock przez service role.
import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { HandHeart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/admin/donations")({
  component: AdminDonationsPage,
});

interface DonationRow {
  id: string;
  amount_cents: number;
  currency: string;
  donor_email: string | null;
  message: string | null;
  provider: string;
  status: string;
  created_at: string;
}

function AdminDonationsPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);

  const donationsQ = useQuery({
    queryKey: ["admin", "donations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("donations")
        .select("id,amount_cents,currency,donor_email,message,provider,status,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as DonationRow[];
    },
  });

  const rows = donationsQ.data ?? [];
  const { totalPaid, monthPaid } = useMemo(() => {
    const now = new Date();
    let total = 0;
    let month = 0;
    for (const d of rows) {
      if (d.status !== "paid") continue;
      total += d.amount_cents;
      const created = new Date(d.created_at);
      if (created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth()) {
        month += d.amount_cents;
      }
    }
    return { totalPaid: total, monthPaid: month };
  }, [rows]);

  const money = (cents: number, currency = "PLN") =>
    new Intl.NumberFormat(lang === "pl" ? "pl-PL" : "en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(cents / 100);

  const when = (iso: string) =>
    new Date(iso).toLocaleString(lang === "pl" ? "pl-PL" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    });

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <HandHeart className="h-6 w-6" aria-hidden="true" />
          {L("Darowizny", "Donations")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {L(
            "Wpłaty mecenatu obywatelskiego ze strony /support. Zapisuje je webhook Stripe.",
            "Citizen-patronage payments from /support. Recorded by the Stripe webhook.",
          )}
        </p>
        <p className="mt-2 max-w-3xl rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {L(
            "Te same sumy zasilają widget Darowizny / Mecenat w CMS Builderze (kategoria Formularze, 6 wariantów) - dane są zsynchronizowane w czasie rzeczywistym (Stripe -> webhook -> tabela donations -> widget).",
            "The same totals power the Donations / Patronage widget in the CMS Builder (Forms category, 6 variants) - data is synchronised in real time (Stripe -> webhook -> donations table -> widget).",
          )}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {L("Suma (opłacone)", "Total (paid)")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold tabular-nums">{money(totalPaid)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {L("Bieżący miesiąc", "This month")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold tabular-nums">{money(monthPaid)}</CardContent>
        </Card>
      </div>

      {donationsQ.isLoading ? (
        <p className="text-sm text-muted-foreground">{L("Wczytywanie...", "Loading...")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{L("Brak darowizn.", "No donations yet.")}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums">
                    {money(d.amount_cents, d.currency)}
                  </span>
                  {d.status === "refunded" && (
                    <Badge variant="destructive">{L("zwrócona", "refunded")}</Badge>
                  )}
                  {d.provider === "mock" && <Badge variant="outline">mock</Badge>}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {d.donor_email ?? L("(bez e-maila)", "(no email)")}
                  {d.message ? ` · „${d.message}"` : ""}
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{when(d.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
