import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X, Search } from "@/lib/lucide-shim";
import { createTag, deleteTag } from "@/lib/content.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/tags")({
  component: Tags,
});

interface TagRow {
  id: string;
  name: string;
  slug: string;
}

function Tags() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const tenantId = useRequiredTenant();
  const create$ = useServerFn(createTag);
  const delete$ = useServerFn(deleteTag);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const { data } = useQuery({
    queryKey: ["tags", tenantId],
    queryFn: async (): Promise<TagRow[]> => {
      const { data, error } = await supabase
        .from("tags")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((tg) => `${tg.name} ${tg.slug}`.toLowerCase().includes(q));
  }, [data, search]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await create$({ data: { name: name.trim() } });
      setName("");
      qc.invalidateQueries({ queryKey: ["tags"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };
  const del = async (id: string) => {
    try {
      await delete$({ data: { id } });
      qc.invalidateQueries({ queryKey: ["tags"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-display text-2xl font-bold">{t("admin.nav.tags")}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {filtered.length}
            {data && data.length !== filtered.length ? ` / ${data.length}` : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <form onSubmit={add} className="flex gap-1.5">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("admin.tags.placeholder")}
            className="h-8 text-xs w-[240px]"
          />
          <Button size="sm" type="submit" className="h-8">
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </form>
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("admin.list.searchTags", { defaultValue: "Szukaj tagów…" })}
            className="pl-7 h-8 text-xs"
          />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch("")} className="h-8 text-xs">
            <X className="w-3.5 h-3.5 mr-1" /> {t("admin.list.clear", { defaultValue: "Wyczyść" })}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {filtered.map((tg) => (
          <span
            key={tg.id}
            className="inline-flex items-center gap-1.5 bg-card border border-border rounded-full pl-2.5 pr-1 py-0.5 text-xs"
          >
            {tg.name}
            <button
              onClick={() => del(tg.id)}
              type="button"
              aria-label={t("admin.delete")}
              className="w-5 h-5 rounded-full hover:bg-destructive/10 inline-flex items-center justify-center"
            >
              <X className="w-3 h-3 text-destructive" />
            </button>
          </span>
        ))}
        {!filtered.length && (
          <p className="text-xs text-muted-foreground">
            {data?.length
              ? t("admin.list.noResults", { defaultValue: "Brak wyników" })
              : t("admin.empty")}
          </p>
        )}
      </div>
    </div>
  );
}
