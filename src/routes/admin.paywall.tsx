import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { Plus, Trash } from "@/lib/lucide-shim";

export const Route = createFileRoute("/admin/paywall")({ component: PaywallAdmin });

function emptyPlan(): Partial<AccessPlan> {
  return { name_pl: "", name_en: "", description_pl: "", description_en: "",
    price_cents: 1900, currency: "PLN", interval: "month", active: true, sort_order: 0 };
}

function PaywallAdmin() {
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
    else { toast.success("Zapisano plan"); setDraft(emptyPlan()); load(); }
  };

  const remove = async (id: string) => {
    if (!confirm("Usunąć plan?")) return;
    const { error } = await supabase.from("access_plans").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Usunięto"); load(); }
  };

  return (
    <AdminShell>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <header>
          <h1 className="font-display text-2xl font-bold">Paywall — plany dostępu</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Twórz plany subskrypcyjne. Następnie w edytorze wpisu / strony przypisz tryb dostępu i wybrane plany.
            Płatności online zostaną podłączone w kolejnym kroku — póki co system zbiera „zainteresowanie" i obsługuje członkostwo.
          </p>
        </header>

        <section className="border border-border rounded-lg bg-card">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left p-3">Nazwa</th>
                <th className="text-left p-3">Cena</th>
                <th className="text-left p-3">Interwał</th>
                <th className="text-left p-3">Aktywny</th>
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
                  <td className="p-3">{p.active ? "✓" : "—"}</td>
                  <td className="p-3 text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={() => setDraft(p)}>Edytuj</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(p.id)}><Trash className="w-4 h-4" /></Button>
                  </td>
                </tr>
              ))}
              {plans.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground text-sm">Brak planów</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="border border-border rounded-lg bg-card p-5">
          <h2 className="font-semibold mb-4">{draft.id ? "Edytuj plan" : "Nowy plan"}</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div><Label>Nazwa PL</Label><Input value={draft.name_pl ?? ""} onChange={(e) => setDraft({ ...draft, name_pl: e.target.value })} /></div>
            <div><Label>Nazwa EN</Label><Input value={draft.name_en ?? ""} onChange={(e) => setDraft({ ...draft, name_en: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Opis PL</Label><Textarea rows={2} value={draft.description_pl ?? ""} onChange={(e) => setDraft({ ...draft, description_pl: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Opis EN</Label><Textarea rows={2} value={draft.description_en ?? ""} onChange={(e) => setDraft({ ...draft, description_en: e.target.value })} /></div>
            <div><Label>Cena (w groszach/centach)</Label><Input type="number" value={draft.price_cents ?? 0} onChange={(e) => setDraft({ ...draft, price_cents: Number(e.target.value) })} /></div>
            <div><Label>Waluta</Label><Input value={draft.currency ?? "PLN"} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} /></div>
            <div>
              <Label>Interwał</Label>
              <Select value={draft.interval ?? "month"} onValueChange={(v) => setDraft({ ...draft, interval: v as AccessPlan["interval"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">Miesięcznie</SelectItem>
                  <SelectItem value="year">Rocznie</SelectItem>
                  <SelectItem value="one_time">Jednorazowo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={!!draft.active} onCheckedChange={(v) => setDraft({ ...draft, active: v })} /> Aktywny
              </label>
              <div className="ml-auto"><Label>Kolejność</Label><Input type="number" value={draft.sort_order ?? 0} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })} className="w-24" /></div>
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <Button onClick={save} disabled={busy}><Plus className="w-4 h-4 mr-2" />{draft.id ? "Zapisz" : "Dodaj plan"}</Button>
            {draft.id && <Button variant="outline" onClick={() => setDraft(emptyPlan())}>Anuluj</Button>}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
