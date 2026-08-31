// Organizm: cala strona kampanii kuponowych. Trasa
// `src/routes/admin.coupons.campaigns.tsx` jest juz cienkim opakowaniem.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ensureI18n as ensureAdminCouponsI18n } from "@/lib/i18n-admin-coupons";
import { Plus, Loader2, Send, Archive, Download } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { CampaignCreateDialog } from "./CampaignCreateDialog";

export interface CampaignRow {
  id: string;
  name: string;
  prefix: string;
  code_count: number;
  generated_count: number;
  discount_kind: "percent" | "fixed";
  discount_percent: number | null;
  discount_cents: number | null;
  currency: string | null;
  valid_until: string | null;
  grants_tier_key: string | null;
  grants_duration_days: number | null;
  newsletter_segment: string | null;
  newsletter_campaign_id: string | null;
  status: "draft" | "generated" | "sent" | "archived";
  created_at: string;
}

// KLUCZE i18n, nie gotowe napisy - ten sam wzorzec, co `AD_POSITION_LABEL_KEYS`
// w module reklam. Typ `Record<CampaignRow["status"], string>` wymusza
// kompletnosc: nowy stan kampanii bez etykiety sie nie skompiluje.
const CAMPAIGN_STATUS_LABEL_KEYS: Record<CampaignRow["status"], string> = {
  draft: "adminCoupons.campaignStatus.draft",
  generated: "adminCoupons.campaignStatus.generated",
  sent: "adminCoupons.campaignStatus.sent",
  archived: "adminCoupons.campaignStatus.archived",
};

export function CampaignsPage() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-admin-coupons.ts.
  ensureAdminCouponsI18n();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const campaignsQ = useQuery({
    queryKey: ["admin", "b2b-coupon-campaigns"],
    queryFn: async (): Promise<CampaignRow[]> => {
      const { data, error } = await supabase
        .from("b2b_coupon_campaigns")
        .select(
          "id, name, prefix, code_count, generated_count, discount_kind, discount_percent, discount_cents, currency, valid_until, grants_tier_key, grants_duration_days, newsletter_segment, newsletter_campaign_id, status, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as CampaignRow[];
    },
  });

  const tiersQ = useQuery({
    queryKey: ["admin", "b2b-coupons", "tiers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("membership_tiers")
        .select("key, name_pl, name_en")
        .eq("active", true)
        .order("rank", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const generate = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("bulk_generate_coupons_for_campaign", {
        _campaign_id: id,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      // Liczebnik przez `count`, nie przez szew z literału: polski ma trzy
      // formy (1 kod / 2 kody / 5 kodów), których „${n} kodów" nie odda.
      toast.success(t("adminCoupons.codesGenerated", { count: n }));
      void qc.invalidateQueries({ queryKey: ["admin", "b2b-coupon-campaigns"] });
      void qc.invalidateQueries({ queryKey: ["admin", "b2b-coupons"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("b2b_coupon_campaigns")
        .update({ status: "archived" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "b2b-coupon-campaigns"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const exportCodes = async (campaignId: string, campaignName: string) => {
    const { data, error } = await supabase
      .from("b2b_coupons")
      .select("code, name, active, valid_until, max_redemptions, redemptions_count")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: true })
      .limit(10000);
    if (error) {
      toast.error(error.message);
      return;
    }
    const rows = data ?? [];
    const header = "code;name;active;valid_until;max_redemptions;redemptions_count";
    const body = rows
      .map(
        (r) =>
          `${r.code};${r.name ?? ""};${r.active};${r.valid_until ?? ""};${
            r.max_redemptions ?? ""
          };${r.redemptions_count}`,
      )
      .join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `coupons-${campaignName.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("adminCoupons.csvExported"));
  };

  const sendNewsletter = useMutation({
    mutationFn: async (campaign: CampaignRow) => {
      // Utwórz kampanię newslettera przypiętą do segmentu.
      // Kody przekażemy przez merge tag {{coupon_code}} - subscriber gets a unique code.
      const { data: nl, error } = await supabase
        .from("newsletter_campaigns")
        .insert({
          name: `Kupony: ${campaign.name}`,
          subject_pl: `Twój kod rabatowy - ${campaign.name}`,
          subject_en: `Your discount code - ${campaign.name}`,
          html_pl: `<p>Twój kod: <strong>{{coupon_code}}</strong></p><p>Ważny do: ${
            campaign.valid_until ?? "bezterminowo"
          }.</p>`,
          html_en: `<p>Your code: <strong>{{coupon_code}}</strong></p><p>Valid until: ${
            campaign.valid_until ?? "unlimited"
          }.</p>`,
          audience_filter: campaign.newsletter_segment
            ? { segment: campaign.newsletter_segment }
            : {},
        })
        .select("id")
        .single();
      if (error) throw error;
      if (!nl) throw new Error("Newsletter campaign not created");
      // Odmowa TEGO zapisu przechodzila wczesniej bez sladu: kampania
      // newslettera juz istniala, a kampania kuponowa zostawala w stanie
      // „generated" bez `newsletter_campaign_id`. Panel pokazywal wiec dalej
      // przycisk „Wyslij" pod komunikatem o sukcesie - i drugie klikniecie
      // wysylalo DRUGI mail z kodem do tych samych odbiorcow.
      const { error: linkError } = await supabase
        .from("b2b_coupon_campaigns")
        .update({ newsletter_campaign_id: nl.id, status: "sent" })
        .eq("id", campaign.id);
      if (linkError) throw linkError;
      return nl.id;
    },
    onSuccess: () => {
      toast.success(t("adminCoupons.newsletterCampaignCreated"));
      void qc.invalidateQueries({ queryKey: ["admin", "b2b-coupon-campaigns"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {t("adminCoupons.createBulkCampaignsGenerateUnique")}
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="h-10 rounded-[6px]">
              <Plus className="h-4 w-4 mr-2" />
              {t("adminCoupons.newCampaign")}
            </Button>
          </DialogTrigger>
          <CampaignCreateDialog
            tiers={tiersQ.data ?? []}
            onCreated={() => {
              setOpen(false);
              void qc.invalidateQueries({ queryKey: ["admin", "b2b-coupon-campaigns"] });
            }}
          />
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("adminCoupons.campaigns")}</CardTitle>
        </CardHeader>
        <CardContent>
          {campaignsQ.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("adminCoupons.loading")}
            </div>
          ) : (campaignsQ.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">{t("adminCoupons.campaignsYet")}</p>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase">
                  <tr className="border-b border-border/60">
                    <th className="text-left py-2 pr-3">{t("adminCoupons.name")}</th>
                    <th className="text-left py-2 pr-3">{t("adminCoupons.discount")}</th>
                    <th className="text-left py-2 pr-3">{t("adminCoupons.codes")}</th>
                    <th className="text-left py-2 pr-3">{t("adminCoupons.subscription")}</th>
                    <th className="text-left py-2 pr-3">{t("adminCoupons.segment")}</th>
                    <th className="text-left py-2 pr-3">{t("adminCoupons.status")}</th>
                    <th className="text-right py-2">{t("adminCoupons.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(campaignsQ.data ?? []).map((c) => (
                    <tr key={c.id} className="border-b border-border/40">
                      <td className="py-3 pr-3">
                        <div className="font-medium">{c.name}</div>
                        {c.prefix && (
                          <div className="text-xs text-muted-foreground font-mono">
                            {c.prefix}***
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        {c.discount_kind === "percent"
                          ? `${c.discount_percent}%`
                          : `${((c.discount_cents ?? 0) / 100).toFixed(2)} ${c.currency ?? ""}`}
                      </td>
                      <td className="py-3 pr-3">
                        {c.generated_count} / {c.code_count}
                      </td>
                      <td className="py-3 pr-3 text-xs">
                        {c.grants_tier_key ? (
                          <Badge variant="outline">
                            {c.grants_tier_key}
                            {c.grants_duration_days && ` · ${c.grants_duration_days}d`}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-xs">
                        {c.newsletter_segment ?? <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="py-3 pr-3">
                        <Badge variant={c.status === "sent" ? "default" : "secondary"}>
                          {t(CAMPAIGN_STATUS_LABEL_KEYS[c.status])}
                        </Badge>
                      </td>
                      <td className="py-3 text-right">
                        <div className="inline-flex items-center gap-1 flex-wrap justify-end">
                          {c.status === "draft" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 rounded-[6px]"
                              onClick={() => generate.mutate(c.id)}
                              disabled={generate.isPending}
                            >
                              {t("adminCoupons.generate")}
                            </Button>
                          )}
                          {c.status === "generated" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-[6px]"
                                onClick={() => exportCodes(c.id, c.name)}
                              >
                                <Download className="h-3.5 w-3.5 mr-1" />
                                CSV
                              </Button>
                              <Button
                                size="sm"
                                className="h-8 rounded-[6px]"
                                onClick={() => sendNewsletter.mutate(c)}
                                disabled={sendNewsletter.isPending}
                              >
                                <Send className="h-3.5 w-3.5 mr-1" />
                                {t("adminCoupons.send")}
                              </Button>
                            </>
                          )}
                          {c.status !== "archived" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => archive.mutate(c.id)}
                              aria-label={t("adminCoupons.archiveAction")}
                            >
                              <Archive className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
