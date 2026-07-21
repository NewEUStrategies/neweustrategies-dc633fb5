// Zakładka Kampanie kuponowe - bulk generator + integracja z newsletterem.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Loader2, Send, Archive, Download } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePickerField } from "@/components/admin/coupons/DatePickerField";

export const Route = createFileRoute("/admin/coupons/campaigns")({
  component: CampaignsPage,
});

interface CampaignRow {
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

function CampaignsPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
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
      toast.success(L(`Wygenerowano ${n} kodów`, `Generated ${n} codes`));
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
    toast.success(L("Wyeksportowano CSV", "CSV exported"));
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
      await supabase
        .from("b2b_coupon_campaigns")
        .update({ newsletter_campaign_id: nl.id, status: "sent" })
        .eq("id", campaign.id);
      return nl.id;
    },
    onSuccess: () => {
      toast.success(L("Kampania newslettera utworzona", "Newsletter campaign created"));
      void qc.invalidateQueries({ queryKey: ["admin", "b2b-coupon-campaigns"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {L(
            "Twórz kampanie masowo, generuj unikalne kody i rozsyłaj przez newsletter.",
            "Create bulk campaigns, generate unique codes and send via newsletter.",
          )}
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="h-10 rounded-[6px]">
              <Plus className="h-4 w-4 mr-2" />
              {L("Nowa kampania", "New campaign")}
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
          <CardTitle className="text-base">{L("Kampanie", "Campaigns")}</CardTitle>
        </CardHeader>
        <CardContent>
          {campaignsQ.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              {L("Wczytywanie…", "Loading…")}
            </div>
          ) : (campaignsQ.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">
              {L("Brak kampanii. Utwórz pierwszą.", "No campaigns yet.")}
            </p>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase">
                  <tr className="border-b border-border/60">
                    <th className="text-left py-2 pr-3">{L("Nazwa", "Name")}</th>
                    <th className="text-left py-2 pr-3">{L("Rabat", "Discount")}</th>
                    <th className="text-left py-2 pr-3">{L("Kody", "Codes")}</th>
                    <th className="text-left py-2 pr-3">{L("Subskrypcja", "Subscription")}</th>
                    <th className="text-left py-2 pr-3">{L("Segment", "Segment")}</th>
                    <th className="text-left py-2 pr-3">{L("Status", "Status")}</th>
                    <th className="text-right py-2">{L("Akcje", "Actions")}</th>
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
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-xs">
                        {c.newsletter_segment ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-3 pr-3">
                        <Badge variant={c.status === "sent" ? "default" : "secondary"}>
                          {c.status}
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
                              {L("Generuj", "Generate")}
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
                                {L("Wyślij", "Send")}
                              </Button>
                            </>
                          )}
                          {c.status !== "archived" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => archive.mutate(c.id)}
                              aria-label="archive"
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

function CampaignCreateDialog({
  tiers,
  onCreated,
}: {
  tiers: Array<{ key: string; name_pl: string; name_en: string }>;
  onCreated: () => void;
}) {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prefix, setPrefix] = useState("");
  const [codeLength, setCodeLength] = useState(8);
  const [codeCount, setCodeCount] = useState(100);
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [percent, setPercent] = useState(20);
  const [cents, setCents] = useState(2000);
  const [currency, setCurrency] = useState("PLN");
  const [validUntil, setValidUntil] = useState<Date | undefined>(undefined);
  const [tierKey, setTierKey] = useState("");
  const [durationDays, setDurationDays] = useState("30");
  const [segment, setSegment] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error(L("Podaj nazwę", "Enter a name"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("b2b_coupon_campaigns").insert({
      name: name.trim(),
      description: description.trim() || null,
      prefix: prefix.trim(),
      code_length: codeLength,
      code_count: codeCount,
      discount_kind: kind,
      discount_percent: kind === "percent" ? percent : null,
      discount_cents: kind === "fixed" ? cents : null,
      currency: kind === "fixed" ? currency.toUpperCase() : null,
      valid_until: validUntil ? validUntil.toISOString() : null,
      grants_tier_key: tierKey || null,
      grants_duration_days: durationDays && tierKey ? Number(durationDays) : null,
      newsletter_segment: segment.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(L("Kampania utworzona (draft)", "Campaign created (draft)"));
    onCreated();
  };

  return (
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>{L("Nowa kampania kuponowa", "New coupon campaign")}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>{L("Nazwa", "Name")}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-10 rounded-[6px]"
            placeholder="Q1 2026 - VIP subscribers"
          />
        </div>
        <div>
          <Label>{L("Opis (opcjonalnie)", "Description (optional)")}</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>{L("Prefix", "Prefix")}</Label>
            <Input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.toUpperCase())}
              placeholder="NES-"
              className="h-10 rounded-[6px] uppercase"
            />
          </div>
          <div>
            <Label>{L("Długość kodu", "Code length")}</Label>
            <Input
              type="number"
              min={4}
              max={24}
              value={codeLength}
              onChange={(e) => setCodeLength(Number(e.target.value))}
              className="h-10 rounded-[6px]"
            />
          </div>
          <div>
            <Label>{L("Ilość kodów", "Code count")}</Label>
            <Input
              type="number"
              min={1}
              max={10000}
              value={codeCount}
              onChange={(e) => setCodeCount(Number(e.target.value))}
              className="h-10 rounded-[6px]"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{L("Typ rabatu", "Discount type")}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as "percent" | "fixed")}>
              <SelectTrigger className="h-10 rounded-[6px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">%</SelectItem>
                <SelectItem value="fixed">{L("Kwotowy", "Fixed")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === "percent" ? (
            <div>
              <Label>{L("Procent", "Percent")}</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={percent}
                onChange={(e) => setPercent(Number(e.target.value))}
                className="h-10 rounded-[6px]"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>{L("Kwota (gr)", "Amount (cents)")}</Label>
                <Input
                  type="number"
                  min={1}
                  value={cents}
                  onChange={(e) => setCents(Number(e.target.value))}
                  className="h-10 rounded-[6px]"
                />
              </div>
              <div>
                <Label>{L("Waluta", "Currency")}</Label>
                <Input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  maxLength={4}
                  className="h-10 rounded-[6px]"
                />
              </div>
            </div>
          )}
        </div>

        <DatePickerField
          value={validUntil}
          onChange={setValidUntil}
          label={L("Ważne do", "Valid until")}
        />

        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/60">
          <div>
            <Label>{L("Nadaje subskrypcję", "Grants subscription")}</Label>
            <Select value={tierKey || "none"} onValueChange={(v) => setTierKey(v === "none" ? "" : v)}>
              <SelectTrigger className="h-10 rounded-[6px]">
                <SelectValue placeholder={L("Brak", "None")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{L("Brak", "None")}</SelectItem>
                {tiers.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {lang === "pl" ? t.name_pl : t.name_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{L("Czas trwania (dni)", "Duration (days)")}</Label>
            <Input
              type="number"
              min={1}
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              disabled={!tierKey}
              className="h-10 rounded-[6px]"
            />
          </div>
        </div>

        <div>
          <Label>{L("Segment newslettera (tag)", "Newsletter segment (tag)")}</Label>
          <Input
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            placeholder="vip"
            className="h-10 rounded-[6px]"
          />
        </div>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={busy} className="h-10 rounded-[6px]">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : L("Utwórz kampanię", "Create campaign")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
