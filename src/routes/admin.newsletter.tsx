import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { useNewsletterSettings, useSaveNewsletterSettings, defaultNewsletterSettings, type NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Save, Eye, Mail, X } from "@/lib/lucide-shim";

export const Route = createFileRoute("/admin/newsletter")({ component: Page });

interface SubRow {
  id: string;
  email: string;
  display_name: string | null;
  language: string;
  status: string;
  source: string | null;
  created_at: string;
  confirmed_at: string | null;
}

function Page() {
  const { t } = useTranslation();
  const { data } = useNewsletterSettings();
  const save = useSaveNewsletterSettings();
  const [local, setLocal] = useState<NewsletterSettings | null>(null);
  useEffect(() => { if (data && !local) setLocal(data); }, [data, local]);

  const { data: subs, refetch } = useQuery({
    queryKey: ["newsletter-subscribers"],
    queryFn: async (): Promise<SubRow[]> => {
      const { data, error } = await supabase
        .from("newsletter_subscribers")
        .select("id, email, display_name, language, status, source, created_at, confirmed_at")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as SubRow[];
    },
  });

  const cur = local ?? defaultNewsletterSettings();
  const upd = (p: Partial<NewsletterSettings>) => setLocal({ ...cur, ...p });

  const onSave = async () => {
    const { tenant_id: _tid, ...rest } = cur;
    void _tid;
    await save.mutateAsync(rest);
    toast.success(t("admin.saved"));
  };

  const exportCsv = () => {
    const rows = subs ?? [];
    const head = ["email", "display_name", "language", "status", "source", "created_at", "confirmed_at"];
    const csv = [head.join(",")]
      .concat(rows.map((r) => head.map((k) => {
        const v = (r as unknown as Record<string, string | null>)[k] ?? "";
        return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(",")))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `newsletter-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const remove = async (id: string) => {
    if (!confirm(t("admin.newsletter.confirmRemove"))) return;
    const { error } = await supabase.from("newsletter_subscribers").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(t("admin.deleted"));
    refetch();
  };

  return (
    <AdminShell hideSidebar>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl">{t("admin.newsletter.title")}</h1>
          <Button onClick={onSave} disabled={save.isPending}><Save className="w-4 h-4 mr-2" />{t("admin.saveSettings")}</Button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-6 items-start">
          <div className="space-y-6 min-w-0">


        <section className="bg-card border border-border rounded-lg p-5 space-y-4">
          <h2 className="font-display text-lg">{t("admin.newsletter.formSettings")}</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cur.enabled} onChange={(e) => upd({ enabled: e.target.checked })} />
            {t("admin.newsletter.show")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cur.double_opt_in} onChange={(e) => upd({ double_opt_in: e.target.checked })} />
            {t("admin.newsletter.doubleOptIn")}
          </label>

          <Tabs defaultValue="pl">
            <TabsList>
              <TabsTrigger value="pl">🇵🇱 Polski</TabsTrigger>
              <TabsTrigger value="en">🇬🇧 English</TabsTrigger>
            </TabsList>
            <TabsContent value="pl" className="space-y-3 mt-4">
              <div><Label>{t("admin.newsletter.heading")}</Label><Input value={cur.heading_pl} onChange={(e) => upd({ heading_pl: e.target.value })} /></div>
              <div><Label>{t("admin.newsletter.description")}</Label><Textarea rows={2} value={cur.description_pl} onChange={(e) => upd({ description_pl: e.target.value })} /></div>
              <div><Label>{t("admin.newsletter.policyHtml")}</Label><Textarea rows={2} value={cur.policy_html_pl ?? ""} onChange={(e) => upd({ policy_html_pl: e.target.value })} /></div>
              <div><Label>{t("admin.newsletter.successMsg")}</Label><Input value={cur.success_message_pl} onChange={(e) => upd({ success_message_pl: e.target.value })} /></div>
            </TabsContent>
            <TabsContent value="en" className="space-y-3 mt-4">
              <div><Label>{t("admin.newsletter.heading")}</Label><Input value={cur.heading_en} onChange={(e) => upd({ heading_en: e.target.value })} /></div>
              <div><Label>{t("admin.newsletter.description")}</Label><Textarea rows={2} value={cur.description_en} onChange={(e) => upd({ description_en: e.target.value })} /></div>
              <div><Label>{t("admin.newsletter.policyHtml")}</Label><Textarea rows={2} value={cur.policy_html_en ?? ""} onChange={(e) => upd({ policy_html_en: e.target.value })} /></div>
              <div><Label>{t("admin.newsletter.successMsg")}</Label><Input value={cur.success_message_en} onChange={(e) => upd({ success_message_en: e.target.value })} /></div>
            </TabsContent>
          </Tabs>
        </section>

        <section className="bg-card border border-border rounded-lg p-5 space-y-4">
          <h2 className="font-display text-lg">Popup newslettera</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cur.popup_enabled} onChange={(e) => upd({ popup_enabled: e.target.checked })} />
            Włącz popup
          </label>

          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <Label>Trigger</Label>
              <select
                className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
                value={cur.popup_trigger}
                onChange={(e) => upd({ popup_trigger: e.target.value as NewsletterSettings["popup_trigger"] })}
              >
                <option value="delay">Po opóźnieniu</option>
                <option value="scroll">Po przewinięciu %</option>
                <option value="exit-intent">Exit-intent</option>
              </select>
            </div>
            <div>
              <Label>Opóźnienie (s)</Label>
              <Input type="number" min={1} max={600} value={cur.popup_delay_seconds}
                onChange={(e) => upd({ popup_delay_seconds: Number(e.target.value) || 1 })}
                disabled={cur.popup_trigger !== "delay"} />
            </div>
            <div>
              <Label>Próg scroll (%)</Label>
              <Input type="number" min={1} max={100} value={cur.popup_scroll_percent}
                onChange={(e) => upd({ popup_scroll_percent: Number(e.target.value) || 1 })}
                disabled={cur.popup_trigger !== "scroll"} />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>Częstotliwość (dni między pokazami)</Label>
              <Input type="number" min={0} max={365} value={cur.popup_frequency_days}
                onChange={(e) => upd({ popup_frequency_days: Number(e.target.value) || 0 })} />
            </div>
            <div>
              <Label>Okładka (URL)</Label>
              <Input value={cur.popup_cover_url ?? ""} onChange={(e) => upd({ popup_cover_url: e.target.value || null })}
                placeholder="https://…" />
            </div>
          </div>

          <Tabs defaultValue="pl">
            <TabsList>
              <TabsTrigger value="pl">🇵🇱 Polski</TabsTrigger>
              <TabsTrigger value="en">🇬🇧 English</TabsTrigger>
            </TabsList>
            <TabsContent value="pl" className="space-y-3 mt-4">
              <div><Label>Nagłówek</Label><Input value={cur.popup_title_pl} onChange={(e) => upd({ popup_title_pl: e.target.value })} /></div>
              <div><Label>Opis</Label><Textarea rows={2} value={cur.popup_description_pl} onChange={(e) => upd({ popup_description_pl: e.target.value })} /></div>
              <div><Label>CTA (przycisk)</Label><Input value={cur.popup_cta_pl} onChange={(e) => upd({ popup_cta_pl: e.target.value })} /></div>
            </TabsContent>
            <TabsContent value="en" className="space-y-3 mt-4">
              <div><Label>Heading</Label><Input value={cur.popup_title_en} onChange={(e) => upd({ popup_title_en: e.target.value })} /></div>
              <div><Label>Description</Label><Textarea rows={2} value={cur.popup_description_en} onChange={(e) => upd({ popup_description_en: e.target.value })} /></div>
              <div><Label>CTA (button)</Label><Input value={cur.popup_cta_en} onChange={(e) => upd({ popup_cta_en: e.target.value })} /></div>
            </TabsContent>
          </Tabs>
        </section>
          </div>

          <NewsletterPreview settings={cur} />
        </div>

        <section className="bg-card border border-border rounded-lg p-5">

          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg">{t("admin.newsletter.subscribers")} ({subs?.length ?? 0})</h2>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!subs?.length}>
              {t("admin.newsletter.exportCsv")}
            </Button>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left p-2">{t("admin.newsletter.colEmail")}</th>
                  <th className="text-left p-2">{t("admin.newsletter.colName")}</th>
                  <th className="text-left p-2">{t("admin.newsletter.colLang")}</th>
                  <th className="text-left p-2">{t("admin.newsletter.colStatus")}</th>
                  <th className="text-left p-2">{t("admin.newsletter.colSource")}</th>
                  <th className="text-left p-2">{t("admin.newsletter.colDate")}</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {subs?.map((s) => (
                  <tr key={s.id} className="border-b border-border/60">
                    <td className="p-2 font-mono text-xs">{s.email}</td>
                    <td className="p-2">{s.display_name ?? "-"}</td>
                    <td className="p-2 uppercase">{s.language}</td>
                    <td className="p-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${s.status === "subscribed" ? "bg-green-500/10 text-green-700 dark:text-green-400" : s.status === "pending" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-muted"}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="p-2 text-muted-foreground">{s.source ?? "-"}</td>
                    <td className="p-2 text-muted-foreground">{new Date(s.created_at).toLocaleDateString()}</td>
                    <td className="p-2 text-right">
                      <button onClick={() => remove(s.id)} className="text-xs text-destructive hover:underline">{t("admin.delete")}</button>
                    </td>
                  </tr>
                ))}
                {!subs?.length && (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground text-sm">{t("admin.newsletter.empty")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
