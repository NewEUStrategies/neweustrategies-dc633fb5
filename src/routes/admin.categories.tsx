import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil } from "@/lib/lucide-shim";
import { upsertCategory, deleteCategory } from "@/lib/content.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/categories")({
  component: Categories,
});

interface CategoryRow {
  id: string;
  slug: string;
  name_pl: string;
  name_en: string;
  description_pl: string | null;
  description_en: string | null;
}

interface CategoryForm {
  name_pl: string;
  name_en: string;
  slug: string;
  description_pl: string;
  description_en: string;
}

const emptyForm: CategoryForm = { name_pl: "", name_en: "", slug: "", description_pl: "", description_en: "" };

function Categories() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const tenantId = useRequiredTenant();
  const upsert$ = useServerFn(upsertCategory);
  const delete$ = useServerFn(deleteCategory);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [form, setForm] = useState<CategoryForm>(emptyForm);

  const { data } = useQuery({
    queryKey: ["categories", tenantId],
    queryFn: async (): Promise<CategoryRow[]> => {
      const { data, error } = await supabase.from("categories").select("*").eq("tenant_id", tenantId).order("name_pl");
      if (error) throw error;
      return data ?? [];
    },
  });

  const openNew = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (c: CategoryRow) => {
    setEditing(c);
    setForm({
      name_pl: c.name_pl,
      name_en: c.name_en,
      slug: c.slug,
      description_pl: c.description_pl ?? "",
      description_en: c.description_en ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      await upsert$({
        data: {
          id: editing?.id,
          fields: {
            name_pl: form.name_pl,
            name_en: form.name_en,
            slug: form.slug || undefined,
            description_pl: form.description_pl || null,
            description_en: form.description_en || null,
          },
        },
      });
      toast.success(t("admin.saved"));
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["categories"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const del = async (id: string) => {
    if (!confirm(t("admin.confirmDelete"))) return;
    try {
      await delete$({ data: { id } });
      qc.invalidateQueries({ queryKey: ["categories"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
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
              <div><Label>Opis (PL)</Label><Input value={form.description_pl} onChange={(e) => setForm({ ...form, description_pl: e.target.value })} /></div>
              <div><Label>Description (EN)</Label><Input value={form.description_en} onChange={(e) => setForm({ ...form, description_en: e.target.value })} /></div>
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
              <tr><th className="text-left p-3">PL</th><th className="text-left p-3">EN</th><th className="text-left p-3">Slug</th><th /></tr>
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
