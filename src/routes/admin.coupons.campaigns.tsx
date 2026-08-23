// Zakładka Kampanie kuponowe - bulk generator + integracja z newsletterem.
//
// Trasa jest KOMPOZYCJĄ: reguły mieszkają w `@/lib/billing/couponCampaignForm`,
// `couponCsv` i `couponNewsletterDraft`, widok w
// `@/components/admin/coupons/**`. Tutaj zostaje wyłącznie rozmowa z bazą
// (dwa odczyty, trzy mutacje, jeden eksport) i sklejenie ich z widokiem.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ensureI18n as ensureAdminCouponsI18n } from "@/lib/i18n-admin-coupons";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { CampaignCreateDialog } from "@/components/admin/coupons/organisms/CampaignCreateDialog";
import {
  CampaignsTable,
  type CampaignTableRow,
} from "@/components/admin/coupons/organisms/CampaignsTable";
import { campaignCodesCsv, campaignCodesCsvFileName } from "@/lib/billing/couponCsv";
import { buildNewsletterDraft } from "@/lib/billing/couponNewsletterDraft";

export const Route = createFileRoute("/admin/coupons/campaigns")({
  component: CampaignsPage,
});

/** Wiersz odczytu - tabela rysuje podzbiór, reszta zasila szkic newslettera. */
interface CampaignRow extends CampaignTableRow {
  readonly valid_until: string | null;
  readonly newsletter_campaign_id: string | null;
  readonly created_at: string;
}

function CampaignsPage() {
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
    const blob = new Blob([campaignCodesCsv(data ?? [])], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = campaignCodesCsvFileName(campaignName);
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
        .insert(buildNewsletterDraft(campaign))
        .select("id")
        .single();
      if (error) throw error;
      if (!nl) throw new Error("Newsletter campaign not created");
      await supabase
        .from("b2b_coupon_campaigns")
        .update({ newsletter_campaign_id: nl.id, status: "sent" })
        .eq("id", campaign.id);
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

      <CampaignsTable
        rows={campaignsQ.data ?? []}
        loading={campaignsQ.isLoading}
        generating={generate.isPending}
        sending={sendNewsletter.isPending}
        onGenerate={(c) => generate.mutate(c.id)}
        onExport={(c) => void exportCodes(c.id, c.name)}
        onSend={(c) => sendNewsletter.mutate(c)}
        onArchive={(c) => archive.mutate(c.id)}
        labels={{
          title: t("adminCoupons.campaigns"),
          loading: t("adminCoupons.loading"),
          empty: t("adminCoupons.campaignsYet"),
          name: t("adminCoupons.name"),
          discount: t("adminCoupons.discount"),
          codes: t("adminCoupons.codes"),
          subscription: t("adminCoupons.subscription"),
          segment: t("adminCoupons.segment"),
          status: t("adminCoupons.status"),
          actions: t("adminCoupons.actions"),
          generate: t("adminCoupons.generate"),
          csv: "CSV",
          send: t("adminCoupons.send"),
          archive: "archive",
          // Plakietka statusu pokazuje SUROWY enum bazy - tak było przed
          // ekstrakcją i tak zostaje. Miejsce na klucz i18n jest teraz jednak
          // widoczne (prop `statusLabel`), a nie schowane w środku tabeli.
          statusLabel: (status) => status,
        }}
      />
    </div>
  );
}
