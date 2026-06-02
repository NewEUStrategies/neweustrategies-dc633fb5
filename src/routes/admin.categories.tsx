import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil, Search, X } from "@/lib/lucide-shim";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { upsertCategory, deleteCategory } from "@/lib/content.functions";
import { toast } from "sonner";
import { LangCoverageBadges } from "@/components/admin/atoms/LangCoverageBadges";
import type { LangFilter } from "@/components/admin/molecules/AdminListToolbar";

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
  const [search, setSearch] = useState("");
  const [langFilter, setLangFilter] = useState<LangFilter>("all");

  const { data } = useQuery({
    queryKey: ["categories", tenantId],
    queryFn: async (): Promise<CategoryRow[]> => {
      const { data, error } = await supabase.from("categories").select("*").eq("tenant_id", tenantId).order("name_pl");
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.filter((c) => {
      if (q) {
        const hay = `${c.name_pl} ${c.name_en} ${c.slug}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (langFilter !== "all") {
        const pl = !!c.name_pl?.trim();
        const en = !!c.name_en?.trim();
        if (langFilter === "complete" && !(pl && en)) return false;
        if (langFilter === "missing_any" && pl && en) return false;
        if (langFilter === "pl_only" && !(pl && !en)) return false;
        if (langFilter === "en_only" && !(en && !pl)) return false;
      }
      return true;
    });
  }, [data, search, langFilter]);

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

  const isFiltered = !!search || langFilter !== "all";

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-display text-2xl font-bold">{t("admin.nav.categories")}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{filtered.length}{data && data.length !== filtered.length ? ` / ${data.length}` : ""}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-1.5" />{t("admin.new")}</Button></DialogTrigger>
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

      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("admin.list.searchCategories", { defaultValue: "Szukaj kategorii…" })} className="pl-7 h-8 text-xs" />
        </div>
        <Select value={langFilter} onValueChange={(v) => setLangFilter(v as LangFilter)}>
          <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.list.lang.all", { defaultValue: "Wszystkie języki" })}</SelectItem>
            <SelectItem value="complete">{t("admin.list.lang.complete", { defaultValue: "PL + EN" })}</SelectItem>
            <SelectItem value="missing_any">{t("admin.list.lang.missingAny", { defaultValue: "Brak tłumaczenia" })}</SelectItem>
            <SelectItem value="pl_only">{t("admin.list.lang.plOnly", { defaultValue: "Tylko PL" })}</SelectItem>
            <SelectItem value="en_only">{t("admin.list.lang.enOnly", { defaultValue: "Tylko EN" })}</SelectItem>
          </SelectContent>
        </Select>
        {isFiltered && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setLangFilter("all"); }} className="h-8 text-xs">
            <X className="w-3.5 h-3.5 mr-1" /> {t("admin.list.clear", { defaultValue: "Wyczyść" })}
          </Button>
        )}
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {!filtered.length ? (
          <div className="p-10 text-center text-muted-foreground text-sm">
            {data?.length ? t("admin.list.noResults", { defaultValue: "Brak wyników dla filtrów" }) : t("admin.empty")}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground tracking-wide">
              <tr>
                <th className="text-left p-2">Nazwa (PL)</th>
                <th className="text-left p-2">Name (EN)</th>
                <th className="text-left p-2 w-[110px]">{t("admin.list.lang.col", { defaultValue: "Języki" })}</th>
                <th className="text-left p-2 w-[180px]">Slug</th>
                <th className="p-2 w-[70px]" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const pl = !!c.name_pl?.trim();
                const en = !!c.name_en?.trim();
                return (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/20">
                    <td className="p-2 font-medium text-[13px]">{c.name_pl || <span className="italic text-muted-foreground">-</span>}</td>
                    <td className="p-2">{c.name_en || <span className="italic text-muted-foreground">-</span>}</td>
                    <td className="p-2"><LangCoverageBadges pl={pl} en={en} /></td>
                    <td className="p-2 text-[11px] text-muted-foreground truncate max-w-[180px]" title={c.slug}>{c.slug}</td>
                    <td className="p-2 text-right">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(c)}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => del(c.id)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
