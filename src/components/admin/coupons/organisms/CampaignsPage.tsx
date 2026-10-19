// Organizm: cala strona kampanii kuponowych. Trasa
// `src/routes/admin.coupons.campaigns.tsx` jest juz cienkim opakowaniem.
//
// P04 (S1). Dawne „Wyslij" robilo w przegladarce dwie rzeczy naraz: wstawialo
// kampanie newslettera i od razu ustawialo kampanii kuponowej status `sent` -
// ZANIM ktokolwiek cos wyslal, a segment (wolny tekst) serwer ignorowal, wiec
// kody szly do calej listy. Teraz:
//   * „Przygotuj wysylke" wola serwer (`createCouponNewsletterCampaign`), ktory
//     zaklada SZKIC kampanii newslettera z kodem per odbiorca i podpina go;
//     panel przenosi do edytora, gdzie widac odbiorcow i wolne kody;
//   * „Wyslana" pochodzi WYLACZNIE ze statusu serwera (ustawia go zakonczona
//     wysylka), a „Podpieta kampania newslettera" to osobny stan z linkiem;
//   * archiwizacja i przywrocenie ida przez RPC `admin_coupon_campaign_set_status`
//     z tokenem `updated_at` (status nie ma juz grantu UPDATE dla panelu).
// Odczyty i klucze z `couponQueries.ts` (fabryki I0), bez literalow.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ensureI18n as ensureAdminCouponsI18n } from "@/lib/i18n-admin-coupons";
import { ensureI18n as ensurePaywallSyncI18n } from "@/lib/i18n-admin-paywall-sync";
import { Plus, Loader2, Send, Archive, ArchiveRestore, Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  couponCampaignsQueryOptions,
  couponKeys,
  couponTiersQueryOptions,
  invalidateCouponQueries,
  useSetCampaignStatus,
  type CouponCampaignPanelStatus,
  type CouponCampaignRow,
} from "@/lib/admin/couponQueries";
import { isStaleWriteError } from "@/lib/billing/planQueries";
import { createCouponNewsletterCampaign } from "@/lib/newsletter-campaigns.functions";
import { newsletterKeys } from "@/lib/newsletter/keys";
import { useNewsletterSettings } from "@/hooks/useNewsletterSettings";
import { useCurrentTenantId } from "@/lib/tenant";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { showSaveError } from "@/components/admin/pricing/saveErrorToast";
import { prepareSendErrorMessage } from "../couponSendErrors";
import { mailingListLabel } from "../mailingLists";
import { CampaignCreateDialog } from "./CampaignCreateDialog";

/** Wiersz listy kampanii (z `updated_at` - token zmiany statusu). */
export type CampaignRow = CouponCampaignRow;

// KLUCZE i18n, nie gotowe napisy - ten sam wzorzec, co `AD_POSITION_LABEL_KEYS`
// w module reklam. Typ `Record<CampaignRow["status"], string>` wymusza
// kompletnosc: nowy stan kampanii bez etykiety sie nie skompiluje.
const CAMPAIGN_STATUS_LABEL_KEYS: Record<CampaignRow["status"], string> = {
  draft: "adminCoupons.campaignStatus.draft",
  generated: "adminCoupons.campaignStatus.generated",
  sent: "adminCoupons.campaignStatus.sent",
  archived: "adminCoupons.campaignStatus.archived",
};

export function CampaignsPage({ highlightId }: { highlightId?: string } = {}) {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-admin-coupons.ts. Komunikat konfliktu
  // zapisu (`adminPaywall.sync.*`) jest wspólny dla edytorów S1.
  ensureAdminCouponsI18n();
  ensurePaywallSyncI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // Najemca do unieważnienia analityki kuponów po hurtowym wygenerowaniu kodów
  // (`invalidateCouponQueries`) - nowe kody od razu stają w jej rankingu.
  const tenantId = useCurrentTenantId();

  const campaignsQ = useQuery(couponCampaignsQueryOptions());
  const tiersQ = useQuery(couponTiersQueryOptions());
  // Etykiety segmentów = listy mailingowe z ustawień newslettera.
  const settingsQ = useNewsletterSettings();
  const lists = settingsQ.data?.popup_mailing_lists;
  const setStatus = useSetCampaignStatus();
  const prepare = useServerFn(createCouponNewsletterCampaign);

  // `?id=` z adresu (hub, edytor kampanii newslettera): wiersz przewinięty do
  // widoku i wyróżniony. Raz na wskazanie - odświeżenie listy nie szarpie
  // ekranem, gdy operator już przewinął gdzie indziej.
  const highlightRef = useRef<HTMLTableRowElement | null>(null);
  const scrolledTo = useRef<string | null>(null);
  const rows = campaignsQ.data;
  useEffect(() => {
    if (!highlightId || scrolledTo.current === highlightId || !highlightRef.current) return;
    scrolledTo.current = highlightId;
    highlightRef.current.scrollIntoView?.({ block: "center" });
  }, [highlightId, rows]);

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
      // Wygenerowane kody to nowe kupony: lista, kampanie (licznik kodów)
      // i analityka kuponów najemcy.
      void invalidateCouponQueries(qc, tenantId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changeStatus = (c: CampaignRow, status: CouponCampaignPanelStatus) =>
    setStatus.mutate(
      { campaignId: c.id, status, expectedUpdatedAt: c.updated_at },
      {
        onSuccess: () =>
          toast.success(
            t(
              status === "archived"
                ? "adminCoupons.campaignsFlow.archived"
                : "adminCoupons.campaignsFlow.restored",
            ),
          ),
        onError: (e: Error) => {
          // Ktoś zmienił kampanię w międzyczasie (token `updated_at`) - lista
          // pokazuje stan sprzed tej zmiany, więc „Wczytaj aktualne" ją odświeża.
          if (isStaleWriteError(e)) {
            showSaveError(e, t, () => {
              void qc.invalidateQueries({ queryKey: couponKeys.campaigns() });
            });
            return;
          }
          toast.error(e.message);
        },
      },
    );

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
    const codes = data ?? [];
    const header = "code;name;active;valid_until;max_redemptions;redemptions_count";
    const body = codes
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

  // SZKIC kampanii newslettera zakłada i podpina SERWER (idempotentnie - druga
  // karta dostaje ten sam szkic); status `sent` ustawi dopiero wysyłka.
  const prepareSend = useMutation({
    mutationFn: (campaign: CampaignRow) => prepare({ data: { couponCampaignId: campaign.id } }),
    onSuccess: async ({ newsletterCampaignId }) => {
      toast.success(t("adminCoupons.campaignsFlow.prepared"));
      await Promise.all([
        qc.invalidateQueries({ queryKey: couponKeys.campaigns() }),
        qc.invalidateQueries({ queryKey: newsletterKeys.campaignsAll() }),
      ]);
      void navigate({
        to: "/admin/newsletter/campaigns/$id",
        params: { id: newsletterCampaignId },
      });
    },
    onError: (e: Error) => toast.error(prepareSendErrorMessage(e.message, t) ?? e.message),
  });

  /** Segment kampanii: nazwa listy, „cała lista" albo jawnie nieznana lista. */
  const segmentText = (segment: string | null): string => {
    if (!segment) return t("adminCoupons.segmentField.wholeList");
    const label = mailingListLabel(segment, lists, lang);
    if (label) return label;
    // Dopóki ustawienia nie doszły, pokazujemy identyfikator - nie „nieznaną".
    return settingsQ.data ? t("adminCoupons.segmentField.unknown", { id: segment }) : segment;
  };

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
              void invalidateCouponQueries(qc, tenantId);
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
          ) : campaignsQ.isError ? (
            // Odmowa odczytu NIE jest pustą listą: komunikat „Utwórz pierwszą"
            // zapraszał do założenia duplikatu kampanii (do 10 000 kodów),
            // która już istnieje - tylko jej nie widać.
            <div
              role="alert"
              className="rounded-[6px] border border-destructive/40 bg-destructive/5 p-4 text-sm"
            >
              <p className="font-medium text-destructive">{t("adminCoupons.loadError.title")}</p>
              <p className="mt-1 text-muted-foreground">{t("adminCoupons.loadError.hint")}</p>
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
                  {(campaignsQ.data ?? []).map((c) => {
                    const highlighted = c.id === highlightId;
                    const linkedId = c.newsletter_campaign_id;
                    return (
                      <tr
                        key={c.id}
                        ref={highlighted ? highlightRef : undefined}
                        aria-current={highlighted ? "true" : undefined}
                        className={
                          highlighted
                            ? "border-b border-border/40 bg-primary/5"
                            : "border-b border-border/40"
                        }
                      >
                        <td className="py-3 pr-3">
                          <div className="font-medium">{c.name}</div>
                          {c.prefix && (
                            <div className="text-xs text-muted-foreground font-mono">
                              {c.prefix}***
                            </div>
                          )}
                          {highlighted && (
                            <span className="sr-only">
                              {t("adminCoupons.campaignsFlow.highlighted")}
                            </span>
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
                              {/* Trójnik, nie `&&`: przy 0 dni `&&` renderował literał „0". */}
                              {c.grants_duration_days ? ` · ${c.grants_duration_days}d` : null}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="py-3 pr-3 text-xs">{segmentText(c.newsletter_segment)}</td>
                        <td className="py-3 pr-3">
                          <div className="flex flex-col items-start gap-1">
                            <Badge variant={c.status === "sent" ? "default" : "secondary"}>
                              {t(CAMPAIGN_STATUS_LABEL_KEYS[c.status])}
                            </Badge>
                            {/* Podpięcie to NIE wysyłka - osobny stan, dopóki
                                serwer nie ustawi `sent` po zakończonej wysyłce. */}
                            {linkedId && c.status === "generated" && (
                              <Badge variant="outline">
                                {t("adminCoupons.campaignsFlow.linked")}
                              </Badge>
                            )}
                          </div>
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
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-[6px]"
                                onClick={() => exportCodes(c.id, c.name)}
                              >
                                <Download className="h-3.5 w-3.5 mr-1" />
                                CSV
                              </Button>
                            )}
                            {c.status === "generated" && !linkedId && (
                              <Button
                                size="sm"
                                className="h-8 rounded-[6px]"
                                onClick={() => prepareSend.mutate(c)}
                                disabled={prepareSend.isPending}
                                title={t("adminCoupons.campaignsFlow.prepareSendHint")}
                              >
                                <Send className="h-3.5 w-3.5 mr-1" />
                                {t("adminCoupons.campaignsFlow.prepareSend")}
                              </Button>
                            )}
                            {linkedId && c.status !== "archived" && (
                              <Button
                                asChild
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-[6px]"
                              >
                                <Link
                                  to="/admin/newsletter/campaigns/$id"
                                  params={{ id: linkedId }}
                                >
                                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                                  {t("adminCoupons.campaignsFlow.openNewsletter")}
                                </Link>
                              </Button>
                            )}
                            {c.status !== "archived" ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => changeStatus(c, "archived")}
                                disabled={setStatus.isPending}
                                aria-label={t("adminCoupons.archiveAction")}
                              >
                                <Archive className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              // Przejście `archived -> generated|draft` dopuszcza RPC
                              // (wg liczby wygenerowanych kodów) - archiwizacja
                              // przestała być jednokierunkowa.
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() =>
                                  changeStatus(c, c.generated_count > 0 ? "generated" : "draft")
                                }
                                disabled={setStatus.isPending}
                                aria-label={t("adminCoupons.campaignsFlow.restoreAction")}
                              >
                                <ArchiveRestore className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
