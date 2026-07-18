// /admin/newsletter/campaigns/$id — edytor kampanii + wysyłka.
import { useState, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, Save, Send, Mail, Users } from "lucide-react";
import {
  getCampaign,
  getCampaignEngagement,
  upsertCampaign,
  countCampaignAudience,
  sendCampaignTest,
  sendCampaign,
  type AudienceFilter,
} from "@/lib/newsletter-campaigns.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FloatingInput } from "@/components/ui/floating-input";
import { Textarea } from "@/components/ui/textarea";

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
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
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
  const tiersQ = useMembershipTiers();

  useEffect(() => {
    if (campaign && !form) {
      setForm({
        name: campaign.name,
        subject_pl: campaign.subject_pl,
        subject_en: campaign.subject_en,
        html_pl: campaign.html_pl,
        html_en: campaign.html_en,
        from_name: campaign.from_name ?? "",
        from_email: campaign.from_email ?? "",
        reply_to: campaign.reply_to ?? "",
        audience_filter: campaign.audience_filter ?? {},
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
          from_name: state.from_name || null,
          from_email: state.from_email || null,
          reply_to: state.reply_to || null,
          audience_filter: state.audience_filter,
          scheduled_at: localInputToIso(state.scheduled_at_local),
        },
      }),
    onSuccess: () => {
      toast.success(isPl ? "Zapisano" : "Saved");
      qc.invalidateQueries({ queryKey: ["admin", "newsletter-campaigns"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const testMut = useMutation({
    mutationFn: () => test({ data: { id, toEmail: testEmail, language: testLang } }),
    onSuccess: () => toast.success(isPl ? "Wysłano test" : "Test sent"),
    onError: (err: Error) => toast.error(err.message),
  });

  const sendMut = useMutation({
    // Wysyłka idzie porcjami (MAX_EMAILS_PER_INVOCATION na request) - pętla
    // kontynuuje aż done, odświeżając licznik między porcjami. Zamknięcie
    // karty NIE przerywa kampanii trwale: tick crona / ponowne wejście
    // podejmie ją dzięki oddanej dzierżawie.
    mutationFn: async () => {
      let res = await send({ data: { id } });
      let guard = 0;
      while (!res.done && guard < 500) {
        guard++;
        qc.invalidateQueries({ queryKey: ["admin", "newsletter-campaigns"] });
        res = await send({ data: { id } });
      }
      return res;
    },
    onSuccess: (res) => {
      toast.success(
        isPl
          ? `Wysłano: ${res.sent}, błędy: ${res.failed}`
          : `Sent: ${res.sent}, failed: ${res.failed}`,
      );
      qc.invalidateQueries({ queryKey: ["admin", "newsletter-campaigns"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading || !form) {
    return <div className="p-6 text-muted-foreground">{isPl ? "Wczytywanie…" : "Loading…"}</div>;
  }
  if (!campaign) {
    return (
      <div className="p-6 text-muted-foreground">{isPl ? "Nie znaleziono." : "Not found."}</div>
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
            aria-label={isPl ? "Wróć" : "Back"}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h2 className="text-xl font-semibold">
              {form.name || (isPl ? "Kampania" : "Campaign")}
            </h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">{campaign.status}</Badge>
              {campaign.sent_count > 0 && (
                <span>
                  {isPl ? "Wysłano" : "Sent"}: {campaign.sent_count} / {campaign.recipient_count}
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
            {isPl ? "Zapisz" : "Save"}
          </Button>
          {canResume && (
            <Button variant="outline" onClick={() => sendMut.mutate()}>
              <Send className="w-4 h-4 mr-2" />
              {isPl ? "Wznów wysyłkę" : "Resume sending"}
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={readonly || sendMut.isPending}>
                <Send className="w-4 h-4 mr-2" />
                {isPl ? "Wyślij teraz" : "Send now"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {isPl ? "Rozpocząć wysyłkę?" : "Start sending?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {isPl
                    ? `Kampania zostanie wysłana do ${audience?.count ?? 0} odbiorców. Ta operacja jest nieodwracalna.`
                    : `The campaign will be sent to ${audience?.count ?? 0} recipients. This cannot be undone.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{isPl ? "Anuluj" : "Cancel"}</AlertDialogCancel>
                <AlertDialogAction onClick={() => sendMut.mutate()}>
                  {isPl ? "Wyślij" : "Send"}
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
              <CardTitle className="text-base">{isPl ? "Ustawienia" : "Settings"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FloatingInput
                label={isPl ? "Nazwa (wewnętrzna)" : "Name (internal)"}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={readonly}
              />
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 max-w-[280px]">
                    <FloatingInput
                      label={isPl ? "Zaplanuj wysyłkę" : "Schedule send"}
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
                      {isPl ? "Usuń plan" : "Clear"}
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isPl
                    ? "Po zapisaniu kampania przejdzie w status „Zaplanowana” i wyśle się automatycznie o wskazanym czasie."
                    : "After saving, the campaign becomes “Scheduled” and sends automatically at the chosen time."}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <FloatingInput
                  label={isPl ? "Nadawca (nazwa)" : "From name"}
                  value={form.from_name}
                  onChange={(e) => setForm({ ...form, from_name: e.target.value })}
                  disabled={readonly}
                />
                <FloatingInput
                  label={isPl ? "Nadawca (e-mail)" : "From email"}
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
            <CardHeader>
              <CardTitle className="text-base">
                <Mail className="w-4 h-4 inline mr-2" />
                {isPl ? "Treść" : "Content"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="pl">
                <TabsList>
                  <TabsTrigger value="pl">Polski</TabsTrigger>
                  <TabsTrigger value="en">English</TabsTrigger>
                </TabsList>
                <TabsContent value="pl" className="space-y-3">
                  <FloatingInput
                    label={`${isPl ? "Temat" : "Subject"} (PL)`}
                    value={form.subject_pl}
                    onChange={(e) => setForm({ ...form, subject_pl: e.target.value })}
                    disabled={readonly}
                  />
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
                  <FloatingInput
                    label="Subject (EN)"
                    value={form.subject_en}
                    onChange={(e) => setForm({ ...form, subject_en: e.target.value })}
                    disabled={readonly}
                  />
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
              <p className="text-xs text-muted-foreground mt-2">
                {isPl
                  ? 'Zmienne: {{firstName}}, {{lastName}}, {{email}}. Stopka „Wypisz się" jest doklejana automatycznie.'
                  : "Variables: {{firstName}}, {{lastName}}, {{email}}. Unsubscribe footer is appended automatically."}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                <Users className="w-4 h-4 inline mr-2" />
                {isPl ? "Odbiorcy" : "Audience"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs uppercase text-muted-foreground">
                  {isPl ? "Języki" : "Languages"}
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
                  {isPl ? "Puste = wszystkie" : "Empty = all"}
                </p>
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">
                  {isPl ? "Źródło (opcjonalne)" : "Source (optional)"}
                </Label>
                <Input
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
                  placeholder="popup, footer-form…"
                />
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">
                  {isPl ? "Poziom członkostwa" : "Membership level"}
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
                      {isPl ? "Wszyscy subskrybenci" : "All subscribers"}
                    </SelectItem>
                    {[...(tiersQ.data ?? [])]
                      .filter((tier) => tier.rank > 0)
                      .sort((a, b) => a.rank - b.rank)
                      .map((tier) => (
                        <SelectItem key={tier.key} value={String(tier.rank)}>
                          {isPl ? "Od" : "From"} {tierName(tier, isPl ? "pl" : "en")}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {isPl
                    ? "Zawęża do subskrybentów będących kontami o co najmniej tym poziomie."
                    : "Restricts to subscribers who are accounts of at least this level."}
                </p>
              </div>
              <div className="pt-2 border-t border-border">
                <div className="text-2xl font-semibold tabular-nums">{audience?.count ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {isPl
                    ? "aktywnych subskrybentów spełnia filtr"
                    : "active subscribers match the filter"}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{isPl ? "Zaangażowanie" : "Engagement"}</CardTitle>
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
                        {isPl ? "Otwarcia" : "Opens"} · {pct(opens)}
                      </div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold tabular-nums">{clicks}</div>
                      <div className="text-xs text-muted-foreground">
                        {isPl ? "Kliknięcia" : "Clicks"} · {pct(clicks)}
                      </div>
                    </div>
                  </div>
                );
              })()}
              <p className="text-xs text-muted-foreground">
                {isPl
                  ? "Otwarcia liczone pikselem, kliknięcia przez przekierowanie. Wartości przybliżone (% z dostarczonych)."
                  : "Opens tracked via pixel, clicks via redirect. Approximate (% of delivered)."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{isPl ? "Wysyłka testowa" : "Test send"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                type="email"
                placeholder="test@example.com"
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
                  {isPl ? "Wyślij test" : "Send test"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
