// /admin/newsletter/campaigns/$id — edytor kampanii + wysyłka.
import { useState, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { uiLang } from "@/lib/i18n/format";
import { ensureI18n as ensureNewsletterAdminI18n } from "@/lib/i18n-newsletter-admin";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Save, Send, Mail, Users } from "lucide-react";
import {
  getCampaign,
  getCampaignEngagement,
  upsertCampaign,
  countCampaignAudience,
  sendCampaignTest,
  sendCampaign,
  readAudienceFilter,
  type AudienceFilter,
} from "@/lib/newsletter-campaigns.functions";
import { Button } from "@/components/ui/button";

import { Label } from "@/components/ui/label";
import { FloatingInput } from "@/components/ui/floating-input";
import { Textarea } from "@/components/ui/textarea";
import { CampaignContentBuilder } from "@/components/admin/newsletter/CampaignContentBuilder";
import { parseEmailDoc, createDefaultEmailDoc, type EmailDoc } from "@/lib/newsletter/emailDoc";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMembershipTiers, tierName } from "@/lib/billing/tiers";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/admin/newsletter/campaigns/$id")({
  component: CampaignEditor,
});

interface FormState {
  name: string;
  subject_pl: string;
  subject_en: string;
  html_pl: string;
  html_en: string;
  /** Silnik treści: "doc" = kreator bloków, "html" = surowy HTML (legacy). */
  editor: "html" | "doc";
  content_doc: EmailDoc;
  from_name: string;
  from_email: string;
  reply_to: string;
  audience_filter: AudienceFilter;
  /** Wartość <input type=datetime-local> (czas lokalny); "" = bez planu. */
  scheduled_at_local: string;
}

/** ISO (UTC) -> wartość datetime-local w strefie przeglądarki. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Wartość datetime-local -> ISO (UTC); pusta/niepoprawna -> null. */
function localInputToIso(v: string): string | null {
  if (!v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function CampaignEditor() {
  const { id } = Route.useParams();
  ensureNewsletterAdminI18n();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const get = useServerFn(getCampaign);
  const save = useServerFn(upsertCampaign);
  const count = useServerFn(countCampaignAudience);
  const test = useServerFn(sendCampaignTest);
  const send = useServerFn(sendCampaign);
  const engagement = useServerFn(getCampaignEngagement);

  const { data: campaign, isLoading } = useQuery({
    queryKey: ["admin", "newsletter-campaigns", id],
    queryFn: () => get({ data: { id } }),
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [testLang, setTestLang] = useState<"pl" | "en">("pl");
  const [previewLang, setPreviewLang] = useState<"pl" | "en">("pl");
  // Powody, dla których bramka reputacji zatrzymała wysyłkę (kody z serwera:
  // "reputation_blocked:complaint_rate,hard_bounce_rate"). Niepusta lista
  // otwiera dialog świadomego potwierdzenia ryzyka.
  const [gateReasons, setGateReasons] = useState<string[]>([]);
  const tiersQ = useMembershipTiers();

  useEffect(() => {
    if (campaign && !form) {
      setForm({
        name: campaign.name,
        subject_pl: campaign.subject_pl,
        subject_en: campaign.subject_en,
        html_pl: campaign.html_pl,
        html_en: campaign.html_en,
        editor: campaign.editor === "doc" ? "doc" : "html",
        content_doc: parseEmailDoc(campaign.content_doc) ?? createDefaultEmailDoc(),
        from_name: campaign.from_name ?? "",
        from_email: campaign.from_email ?? "",
        reply_to: campaign.reply_to ?? "",
        audience_filter: readAudienceFilter(campaign.audience_filter),
        scheduled_at_local: isoToLocalInput(campaign.scheduled_at),
      });
    }
  }, [campaign, form]);

  const { data: audience } = useQuery({
    queryKey: ["admin", "newsletter-campaigns", id, "audience", form?.audience_filter],
    queryFn: () => count({ data: form?.audience_filter ?? {} }),
    enabled: Boolean(form),
  });

  const { data: engagementStats } = useQuery({
    queryKey: ["admin", "newsletter-campaigns", id, "engagement"],
    queryFn: () => engagement({ data: { id } }),
  });

  const saveMut = useMutation({
    mutationFn: (state: FormState) =>
      save({
        data: {
          id,
          name: state.name,
          subject_pl: state.subject_pl,
          subject_en: state.subject_en,
          html_pl: state.html_pl,
          html_en: state.html_en,
          editor: state.editor,
          // Zawsze utrwalamy oba silniki (wzorzec posts: blocks_data +
          // builder_data współistnieją); `editor` decyduje, który jest
          // autorytatywny przy wysyłce. Dzięki temu przełączenie doc↔html
          // i zapis NIE kasuje pracy w drugim silniku.
          content_doc: state.content_doc,
          from_name: state.from_name || null,
          from_email: state.from_email || null,
          reply_to: state.reply_to || null,
          audience_filter: state.audience_filter,
          scheduled_at: localInputToIso(state.scheduled_at_local),
        },
      }),
    onSuccess: () => {
      toast.success(t("adminNewsletter.campaigns.detailSaved"));
      qc.invalidateQueries({ queryKey: ["admin", "newsletter-campaigns"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const testMut = useMutation({
    mutationFn: () => test({ data: { id, toEmail: testEmail, language: testLang } }),
    onSuccess: () => toast.success(t("adminNewsletter.campaigns.testSent")),
    onError: (err: Error) => toast.error(err.message),
  });

  const sendMut = useMutation({
    // Wysyłka idzie porcjami (MAX_EMAILS_PER_INVOCATION na request) - pętla
    // kontynuuje aż done, odświeżając licznik między porcjami. Zamknięcie
    // karty NIE przerywa kampanii trwale: tick crona / ponowne wejście
    // podejmie ją dzięki oddanej dzierżawie.
    mutationFn: async (acknowledgeReputation: boolean) => {
      let res = await send({ data: { id, acknowledgeReputation } });
      let guard = 0;
      while (!res.done && guard < 500) {
        guard++;
        qc.invalidateQueries({ queryKey: ["admin", "newsletter-campaigns"] });
        // Kolejne porcje idą bez potwierdzenia: kampania jest już `sending`,
        // więc bramka reputacji jej nie dotyczy (patrz sendCampaign).
        res = await send({ data: { id, acknowledgeReputation: false } });
      }
      return res;
    },
    onSuccess: (res) => {
      setGateReasons([]);
      toast.success(
        t("adminNewsletter.campaigns.testResult", { sent: res.sent, failed: res.failed }),
      );
      qc.invalidateQueries({ queryKey: ["admin", "newsletter-campaigns"] });
    },
    onError: (err: Error) => {
      // Bramka reputacji zwraca kod z powodami - zamiast surowego toasta
      // pokazujemy dialog, w którym operator może świadomie potwierdzić ryzyko.
      const blocked = err.message.match(/^reputation_blocked:?(.*)$/);
      if (blocked) {
        setGateReasons(blocked[1] ? blocked[1].split(",").filter(Boolean) : []);
        return;
      }
      toast.error(err.message);
    },
  });

  if (isLoading || !form) {
    return (
      <div className="p-6 text-muted-foreground">
        {t("adminNewsletter.campaigns.detailLoading")}
      </div>
    );
  }
  if (!campaign) {
    return (
      <div className="p-6 text-muted-foreground">{t("adminNewsletter.campaigns.notFound")}</div>
    );
  }

  const readonly = campaign.status === "sending" || campaign.status === "sent";
  const canResume = campaign.status === "sending" && !sendMut.isPending;

  const toggleLang = (lang: "pl" | "en", on: boolean) => {
    const current = form.audience_filter.languages ?? [];
    const next = on ? [...new Set([...current, lang])] : current.filter((l) => l !== lang);
    setForm({
      ...form,
      audience_filter: { ...form.audience_filter, languages: next.length ? next : undefined },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: "/admin/newsletter/campaigns" })}
            aria-label={t("adminNewsletter.campaigns.back")}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h2 className="text-xl font-semibold">
              {form.name || t("adminNewsletter.campaigns.detailEyebrow")}
            </h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">{campaign.status}</Badge>
              {campaign.sent_count > 0 && (
                <span>
                  {t("adminNewsletter.campaigns.sentLabel")}: {campaign.sent_count} /{" "}
                  {campaign.recipient_count}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => saveMut.mutate(form)}
            disabled={saveMut.isPending || readonly}
          >
            <Save className="w-4 h-4 mr-2" />
            {t("adminNewsletter.campaigns.saveChanges")}
          </Button>
          {canResume && (
            <Button variant="outline" onClick={() => sendMut.mutate(false)}>
              <Send className="w-4 h-4 mr-2" />
              {t("adminNewsletter.campaigns.resume")}
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={readonly || sendMut.isPending}>
                <Send className="w-4 h-4 mr-2" />
                {t("adminNewsletter.campaigns.sendNow")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("adminNewsletter.campaigns.sendConfirmHeading")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("adminNewsletter.campaigns.sendConfirmCount", {
                    count: audience?.count ?? 0,
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("adminNewsletter.campaigns.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={() => sendMut.mutate(false)}>
                  {t("adminNewsletter.campaigns.send")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Bramka reputacji: wysyłka wstrzymana, dopóki operator nie
              potwierdzi ryzyka. Osobny dialog (nie toast), bo to decyzja
              o konsekwencjach dla całej domeny nadawczej. */}
          <AlertDialog
            open={gateReasons.length > 0}
            onOpenChange={(open) => !open && setGateReasons([])}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-4 h-4" />
                  {t("adminNewsletter.campaigns.sendingPaused")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("adminNewsletter.campaigns.riskIntro")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <ul className="list-disc pl-5 text-sm text-destructive/90 space-y-1">
                {gateReasons.map((code) => (
                  <li key={code}>
                    {code === "complaint_rate"
                      ? t("adminNewsletter.campaigns.riskComplaints")
                      : t("adminNewsletter.campaigns.riskBounces")}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                {t("adminNewsletter.campaigns.riskWhereToLook")}
              </p>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("adminNewsletter.campaigns.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => sendMut.mutate(true)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {t("adminNewsletter.campaigns.sendDespiteRisk")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("adminNewsletter.campaigns.settingsHeading")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FloatingInput
                label={t("adminNewsletter.campaigns.internalName")}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={readonly}
              />
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 max-w-[280px]">
                    <FloatingInput
                      label={t("adminNewsletter.campaigns.scheduleSend")}
                      type="datetime-local"
                      value={form.scheduled_at_local}
                      onChange={(e) => setForm({ ...form, scheduled_at_local: e.target.value })}
                      disabled={readonly}
                    />
                  </div>
                  {form.scheduled_at_local && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={readonly}
                      onClick={() => setForm({ ...form, scheduled_at_local: "" })}
                    >
                      {t("adminNewsletter.campaigns.clearSchedule")}
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("adminNewsletter.campaigns.scheduleHint")}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <FloatingInput
                  label={t("adminNewsletter.campaigns.fromName")}
                  value={form.from_name}
                  onChange={(e) => setForm({ ...form, from_name: e.target.value })}
                  disabled={readonly}
                />
                <FloatingInput
                  label={t("adminNewsletter.campaigns.fromEmail")}
                  type="email"
                  value={form.from_email}
                  onChange={(e) => setForm({ ...form, from_email: e.target.value })}
                  disabled={readonly}
                />
              </div>
              <FloatingInput
                label="Reply-To"
                type="email"
                value={form.reply_to}
                onChange={(e) => setForm({ ...form, reply_to: e.target.value })}
                disabled={readonly}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                <Mail className="w-4 h-4 inline mr-2" />
                {t("adminNewsletter.campaigns.contentHeading")}
              </CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={form.editor === "doc" ? "default" : "outline"}
                  className="h-7 text-[11px]"
                  disabled={readonly}
                  onClick={() => setForm({ ...form, editor: "doc" })}
                >
                  {t("adminNewsletter.campaigns.builderTab")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={form.editor === "html" ? "default" : "outline"}
                  className="h-7 text-[11px]"
                  disabled={readonly}
                  onClick={() => setForm({ ...form, editor: "html" })}
                >
                  HTML
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Temat jest wspólny dla obu silników. */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <FloatingInput
                  label={t("adminNewsletter.campaigns.subjectPl")}
                  value={form.subject_pl}
                  onChange={(e) => setForm({ ...form, subject_pl: e.target.value })}
                  disabled={readonly}
                />
                <FloatingInput
                  label={t("adminNewsletter.campaigns.subjectEn")}
                  value={form.subject_en}
                  onChange={(e) => setForm({ ...form, subject_en: e.target.value })}
                  disabled={readonly}
                />
              </div>

              {form.editor === "doc" ? (
                <CampaignContentBuilder
                  doc={form.content_doc}
                  onChange={(content_doc) => setForm({ ...form, content_doc })}
                  previewLang={previewLang}
                  onPreviewLangChange={setPreviewLang}
                />
              ) : (
                <Tabs defaultValue="pl">
                  <TabsList>
                    <TabsTrigger value="pl">Polski</TabsTrigger>
                    <TabsTrigger value="en">English</TabsTrigger>
                  </TabsList>
                  <TabsContent value="pl" className="space-y-3">
                    <div>
                      <Label>HTML (PL)</Label>
                      <Textarea
                        value={form.html_pl}
                        onChange={(e) => setForm({ ...form, html_pl: e.target.value })}
                        disabled={readonly}
                        rows={14}
                        className="font-mono text-xs"
                        placeholder="<h1>Witaj {{firstName}}</h1><p>…</p>"
                      />
                    </div>
                  </TabsContent>
                  <TabsContent value="en" className="space-y-3">
                    <div>
                      <Label>HTML (EN)</Label>
                      <Textarea
                        value={form.html_en}
                        onChange={(e) => setForm({ ...form, html_en: e.target.value })}
                        disabled={readonly}
                        rows={14}
                        className="font-mono text-xs"
                        placeholder="<h1>Hi {{firstName}}</h1><p>…</p>"
                      />
                    </div>
                  </TabsContent>
                </Tabs>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                {t("adminNewsletter.campaigns.variablesHint", {
                  interpolation: { skipOnVariables: true },
                })}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                <Users className="w-4 h-4 inline mr-2" />
                {t("adminNewsletter.campaigns.audience")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs uppercase text-muted-foreground">
                  {t("adminNewsletter.campaigns.languagesLabel")}
                </Label>
                <div className="flex items-center gap-4 mt-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.audience_filter.languages?.includes("pl") ?? false}
                      onCheckedChange={(v) => toggleLang("pl", Boolean(v))}
                      disabled={readonly}
                    />
                    Polski
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.audience_filter.languages?.includes("en") ?? false}
                      onCheckedChange={(v) => toggleLang("en", Boolean(v))}
                      disabled={readonly}
                    />
                    English
                  </label>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("adminNewsletter.campaigns.emptyMeansAll")}
                </p>
              </div>
              <FloatingInput
                label={t("adminNewsletter.campaigns.sourceOptional")}
                value={form.audience_filter.source ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    audience_filter: {
                      ...form.audience_filter,
                      source: e.target.value || undefined,
                    },
                  })
                }
                disabled={readonly}
              />

              <div>
                <Label className="text-xs uppercase text-muted-foreground">
                  {t("adminNewsletter.campaigns.membershipLevel")}
                </Label>
                <Select
                  value={String(form.audience_filter.min_tier_rank ?? 0)}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      audience_filter: {
                        ...form.audience_filter,
                        min_tier_rank: Number(v) > 0 ? Number(v) : undefined,
                      },
                    })
                  }
                  disabled={readonly}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">
                      {t("adminNewsletter.campaigns.allSubscribers")}
                    </SelectItem>
                    {[...(tiersQ.data ?? [])]
                      .filter((tier) => tier.rank > 0)
                      .sort((a, b) => a.rank - b.rank)
                      .map((tier) => (
                        <SelectItem key={tier.key} value={String(tier.rank)}>
                          {t("adminNewsletter.campaigns.tierFrom")}{" "}
                          {tierName(tier, uiLang(i18n.language))}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("adminNewsletter.campaigns.membershipHint")}
                </p>
              </div>
              <div className="pt-2 border-t border-border">
                <div className="text-2xl font-semibold tabular-nums">{audience?.count ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {t("adminNewsletter.campaigns.matchingSubscribers")}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("adminNewsletter.campaigns.engagementHeading")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(() => {
                const opens = engagementStats?.opens ?? 0;
                const clicks = engagementStats?.clicks ?? 0;
                const base = campaign.sent_count || 0;
                const pct = (n: number) => (base > 0 ? `${Math.round((n / base) * 100)}%` : "—");
                return (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-2xl font-semibold tabular-nums">{opens}</div>
                      <div className="text-xs text-muted-foreground">
                        {t("adminNewsletter.campaigns.opens")} · {pct(opens)}
                      </div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold tabular-nums">{clicks}</div>
                      <div className="text-xs text-muted-foreground">
                        {t("adminNewsletter.campaigns.clicks")} · {pct(clicks)}
                      </div>
                    </div>
                  </div>
                );
              })()}
              <p className="text-xs text-muted-foreground">
                {t("adminNewsletter.campaigns.engagementHint")}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("adminNewsletter.campaigns.testSendHeading")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FloatingInput
                label={t("adminNewsletter.campaigns.testEmail")}
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
              />

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={testLang === "pl" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTestLang("pl")}
                >
                  PL
                </Button>
                <Button
                  type="button"
                  variant={testLang === "en" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTestLang("en")}
                >
                  EN
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="ml-auto"
                  disabled={!testEmail || testMut.isPending}
                  onClick={() => testMut.mutate()}
                >
                  <Send className="w-3.5 h-3.5 mr-1" />
                  {t("adminNewsletter.campaigns.sendTest")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
