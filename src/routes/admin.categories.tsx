import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/categories")({
  component: Categories,
});

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function Categories() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name_pl: "", name_en: "", slug: "", description_pl: "", description_en: "" });

  const { data } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("*").order("name_pl")).data ?? [],
  });

  const openNew = () => { setEditing(null); setForm({ name_pl: "", name_en: "", slug: "", description_pl: "", description_en: "" }); setOpen(true); };
  const openEdit = (c: any) => { setEditing(c); setForm(c); setOpen(true); };

  const save = async () => {
    const payload = { ...form, slug: form.slug || slugify(form.name_pl || form.name_en) };
    const { error } = editing
      ? await supabase.from("categories").update(payload).eq("id", editing.id)
      : await supabase.from("categories").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(t("admin.saved"));
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["categories"] });
  };

  const del = async (id: string) => {
    if (!confirm(t("admin.confirmDelete"))) return;
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["categories"] });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl font-bold">{t("admin.nav.categories")}</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button onClick={openNew}><Plus className="w-4 h-4 mr-2" />{t("admin.new")}</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? t("admin.edit") : t("admin.new")}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Nazwa (PL)</Label><Input value={form.name_pl} onChange={(e) => setForm({ ...form, name_pl: e.target.value })} /></div>
              <div><Label>Name (EN)</Label><Input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /></div>
              <div><Label>Slug</Label><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="auto" /></div>
              <div><Label>Opis (PL)</Label><Input value={form.description_pl ?? ""} onChange={(e) => setForm({ ...form, description_pl: e.target.value })} /></div>
              <div><Label>Description (EN)</Label><Input value={form.description_en ?? ""} onChange={(e) => setForm({ ...form, description_en: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={save}>{t("admin.save")}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {!data?.length ? (
          <div className="p-12 text-center text-muted-foreground">{t("admin.empty")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr><th className="text-left p-3">PL</th><th className="text-left p-3">EN</th><th className="text-left p-3">Slug</th><th></th></tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-muted/20">
                  <td className="p-3 font-medium">{c.name_pl}</td>
                  <td className="p-3">{c.name_en}</td>
                  <td className="p-3 text-xs text-muted-foreground">{c.slug}</td>
                  <td className="p-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(c)}><Pencil className="w-4 h-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => del(c.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
