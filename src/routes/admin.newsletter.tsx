import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { useNewsletterSettings, useSaveNewsletterSettings, defaultNewsletterSettings, type NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Save } from "@/lib/lucide-shim";

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
    toast.success("Zapisano");
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
    if (!confirm("Usunąć subskrybenta?")) return;
    const { error } = await supabase.from("newsletter_subscribers").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Usunięto");
    refetch();
  };

  return (
    <AdminShell hideSidebar>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl">Newsletter</h1>
          <Button onClick={onSave} disabled={save.isPending}><Save className="w-4 h-4 mr-2" />Zapisz ustawienia</Button>
        </div>

        <section className="bg-card border border-border rounded-lg p-5 space-y-4">
          <h2 className="font-display text-lg">Ustawienia formularza</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cur.enabled} onChange={(e) => upd({ enabled: e.target.checked })} />
            Pokaż formularz newslettera
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cur.double_opt_in} onChange={(e) => upd({ double_opt_in: e.target.checked })} />
            Double opt-in (zapisuje status „pending” do potwierdzenia)
          </label>

          <Tabs defaultValue="pl">
            <TabsList>
              <TabsTrigger value="pl">🇵🇱 Polski</TabsTrigger>
              <TabsTrigger value="en">🇬🇧 English</TabsTrigger>
            </TabsList>
            <TabsContent value="pl" className="space-y-3 mt-4">
              <div><Label>Nagłówek</Label><Input value={cur.heading_pl} onChange={(e) => upd({ heading_pl: e.target.value })} /></div>
              <div><Label>Opis</Label><Textarea rows={2} value={cur.description_pl} onChange={(e) => upd({ description_pl: e.target.value })} /></div>
              <div><Label>Klauzula (HTML)</Label><Textarea rows={2} value={cur.policy_html_pl ?? ""} onChange={(e) => upd({ policy_html_pl: e.target.value })} /></div>
              <div><Label>Komunikat sukcesu</Label><Input value={cur.success_message_pl} onChange={(e) => upd({ success_message_pl: e.target.value })} /></div>
            </TabsContent>
            <TabsContent value="en" className="space-y-3 mt-4">
              <div><Label>Heading</Label><Input value={cur.heading_en} onChange={(e) => upd({ heading_en: e.target.value })} /></div>
              <div><Label>Description</Label><Textarea rows={2} value={cur.description_en} onChange={(e) => upd({ description_en: e.target.value })} /></div>
              <div><Label>Policy text (HTML)</Label><Textarea rows={2} value={cur.policy_html_en ?? ""} onChange={(e) => upd({ policy_html_en: e.target.value })} /></div>
              <div><Label>Success message</Label><Input value={cur.success_message_en} onChange={(e) => upd({ success_message_en: e.target.value })} /></div>
            </TabsContent>
          </Tabs>
        </section>

        <section className="bg-card border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg">Subskrybenci ({subs?.length ?? 0})</h2>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!subs?.length}>
              ↓ Eksportuj CSV
            </Button>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left p-2">E-mail</th>
                  <th className="text-left p-2">Imię</th>
                  <th className="text-left p-2">Język</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Źródło</th>
                  <th className="text-left p-2">Data</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {subs?.map((s) => (
                  <tr key={s.id} className="border-b border-border/60">
                    <td className="p-2 font-mono text-xs">{s.email}</td>
                    <td className="p-2">{s.display_name ?? "—"}</td>
                    <td className="p-2 uppercase">{s.language}</td>
                    <td className="p-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${s.status === "subscribed" ? "bg-green-500/10 text-green-700 dark:text-green-400" : s.status === "pending" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-muted"}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="p-2 text-muted-foreground">{s.source ?? "—"}</td>
                    <td className="p-2 text-muted-foreground">{new Date(s.created_at).toLocaleDateString()}</td>
                    <td className="p-2 text-right">
                      <button onClick={() => remove(s.id)} className="text-xs text-destructive hover:underline">Usuń</button>
                    </td>
                  </tr>
                ))}
                {!subs?.length && (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground text-sm">Brak subskrybentów.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
