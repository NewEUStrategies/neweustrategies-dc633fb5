import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { AccessPlan } from "@/hooks/useContentAccess";
import { formatMoney } from "@/hooks/useContentAccess";
import { Plus, Trash2 as Trash } from "@/lib/lucide-shim";

export const Route = createFileRoute("/admin/paywall")({ component: PaywallAdmin });

function emptyPlan(): Partial<AccessPlan> {
  return { name_pl: "", name_en: "", description_pl: "", description_en: "",
    price_cents: 1900, currency: "PLN", interval: "month", active: true, sort_order: 0,
    features_pl: [], features_en: [], badge_pl: "", badge_en: "", highlighted: false, trial_days: 0 };
}


function PaywallAdmin() {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<AccessPlan[]>([]);
  const [draft, setDraft] = useState<Partial<AccessPlan>>(emptyPlan());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("access_plans").select("*").order("sort_order");
    setPlans((data as AccessPlan[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    const { error } = draft.id
      ? await supabase.from("access_plans").update(draft).eq("id", draft.id)
      : await supabase.from("access_plans").insert(draft);
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success(t("admin.paywall.savedPlan")); setDraft(emptyPlan()); load(); }
  };

  const remove = async (id: string) => {
    if (!confirm(t("admin.paywall.confirmRemove"))) return;
    const { error } = await supabase.from("access_plans").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success(t("admin.paywall.removed")); load(); }
  };

  return (
    <AdminShell hideSidebar>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <header>
          <h1 className="font-display text-2xl font-bold">{t("admin.paywall.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("admin.paywall.subtitle")}
          </p>
        </header>

        <section className="border border-border rounded-lg bg-card">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left p-3">{t("admin.paywall.colName")}</th>
                <th className="text-left p-3">{t("admin.paywall.colPrice")}</th>
                <th className="text-left p-3">{t("admin.paywall.colInterval")}</th>
                <th className="text-left p-3">{t("admin.paywall.colActive")}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-b border-border hover:bg-muted/40">
                  <td className="p-3">
                    <div className="font-semibold">{p.name_pl || p.name_en}</div>
                    {p.name_en && p.name_pl && <div className="text-xs text-muted-foreground">{p.name_en}</div>}
                  </td>
                  <td className="p-3">{formatMoney(p.price_cents, p.currency)}</td>
                  <td className="p-3">{p.interval}</td>
                  <td className="p-3">{p.active ? "✓" : "-"}</td>
                  <td className="p-3 text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={() => setDraft(p)}>{t("admin.paywall.edit")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(p.id)}><Trash className="w-4 h-4" /></Button>
                  </td>
                </tr>
              ))}
              {plans.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground text-sm">{t("admin.paywall.empty")}</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="border border-border rounded-lg bg-card p-5">
          <h2 className="font-semibold mb-4">{draft.id ? t("admin.paywall.editPlan") : t("admin.paywall.newPlan")}</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div><Label>{t("admin.paywall.namePl")}</Label><Input value={draft.name_pl ?? ""} onChange={(e) => setDraft({ ...draft, name_pl: e.target.value })} /></div>
            <div><Label>{t("admin.paywall.nameEn")}</Label><Input value={draft.name_en ?? ""} onChange={(e) => setDraft({ ...draft, name_en: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>{t("admin.paywall.descPl")}</Label><Textarea rows={2} value={draft.description_pl ?? ""} onChange={(e) => setDraft({ ...draft, description_pl: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>{t("admin.paywall.descEn")}</Label><Textarea rows={2} value={draft.description_en ?? ""} onChange={(e) => setDraft({ ...draft, description_en: e.target.value })} /></div>
            <div><Label>{t("admin.paywall.priceCents")}</Label><Input type="number" value={draft.price_cents ?? 0} onChange={(e) => setDraft({ ...draft, price_cents: Number(e.target.value) })} /></div>
            <div><Label>{t("admin.paywall.currency")}</Label><Input value={draft.currency ?? "PLN"} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} /></div>
            <div>
              <Label>{t("admin.paywall.interval")}</Label>
              <Select value={draft.interval ?? "month"} onValueChange={(v) => setDraft({ ...draft, interval: v as AccessPlan["interval"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">{t("admin.paywall.intervalMonth")}</SelectItem>
                  <SelectItem value="year">{t("admin.paywall.intervalYear")}</SelectItem>
                  <SelectItem value="one_time">{t("admin.paywall.intervalOnce")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={!!draft.active} onCheckedChange={(v) => setDraft({ ...draft, active: v })} /> {t("admin.paywall.active")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={!!draft.highlighted} onCheckedChange={(v) => setDraft({ ...draft, highlighted: v })} /> {t("admin.paywall.highlighted", "Wyróżniony")}
              </label>
              <div className="ml-auto"><Label>{t("admin.paywall.sort")}</Label><Input type="number" value={draft.sort_order ?? 0} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })} className="w-24" /></div>
            </div>
            <div><Label>{t("admin.paywall.badgePl", "Plakietka (PL)")}</Label><Input value={draft.badge_pl ?? ""} onChange={(e) => setDraft({ ...draft, badge_pl: e.target.value })} placeholder="Najpopularniejszy" /></div>
            <div><Label>{t("admin.paywall.badgeEn", "Badge (EN)")}</Label><Input value={draft.badge_en ?? ""} onChange={(e) => setDraft({ ...draft, badge_en: e.target.value })} placeholder="Most popular" /></div>
            <div><Label>{t("admin.paywall.trialDays", "Dni okresu próbnego")}</Label><Input type="number" min={0} value={draft.trial_days ?? 0} onChange={(e) => setDraft({ ...draft, trial_days: Number(e.target.value) })} /></div>
            <div></div>
            <div className="sm:col-span-2">
              <Label>{t("admin.paywall.featuresPl", "Funkcje (PL, jedna na linię)")}</Label>
              <Textarea rows={4} value={(draft.features_pl ?? []).join("\n")} onChange={(e) => setDraft({ ...draft, features_pl: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />
            </div>
            <div className="sm:col-span-2">
              <Label>{t("admin.paywall.featuresEn", "Features (EN, one per line)")}</Label>
              <Textarea rows={4} value={(draft.features_en ?? []).join("\n")} onChange={(e) => setDraft({ ...draft, features_en: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />
            </div>

          </div>
          <div className="flex gap-2 mt-5">
            <Button onClick={save} disabled={busy}><Plus className="w-4 h-4 mr-2" />{draft.id ? t("admin.save") : t("admin.paywall.addPlan")}</Button>
            {draft.id && <Button variant="outline" onClick={() => setDraft(emptyPlan())}>{t("admin.cancel")}</Button>}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
