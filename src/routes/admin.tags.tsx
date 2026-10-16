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
import { adminPageHead } from "@/lib/adminPageHead";
import { adminToast } from "@/lib/adminToasts";
import { confirmDialog } from "@/lib/appDialogs";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/tags")({
  head: () =>
    adminPageHead(
      "Tags",
      "Add, search and delete post tags. New European Strategies administration.",
    ),
  component: Tags,
});

interface TagRow {
  id: string;
  name: string;
  slug: string;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function Tags() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const tenantId = useRequiredTenant();
  const create$ = useServerFn(createTag);
  const delete$ = useServerFn(deleteTag);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const { data, isError } = useQuery({
    // Własny trzeci człon: edytor wpisu trzyma pod `["tags", tenant]` wiersze
    // bez sluga, a przy globalnym `staleTime` ten ekran brał je za swoje.
    // Inwalidacja prefiksem `["tags"]` (tu i w edytorze) obejmuje oba klucze.
    queryKey: ["tags", tenantId, "admin"],
    queryFn: async (): Promise<TagRow[]> => {
      const { data, error } = await supabase
        .from("tags")
        .select("id, name, slug")
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
    const submitted = name;
    const tagName = submitted.trim();
    // Drugi Enter w trakcie żądania dawał drugi `createTag`: duplikat `ai-2`
    // albo błąd unikalności sluga.
    if (!tagName || adding) return;
    // Serwer dokleja do sluga sufiks, więc ta sama nazwa dałaby osobny tag,
    // nieodróżnialny od istniejącego w każdym selektorze tagów.
    const existing = data?.find((tg) => tg.name.trim().toLowerCase() === tagName.toLowerCase());
    if (existing) {
      toast.error(t("admin.tags.duplicate", { name: existing.name }));
      return;
    }
    setAdding(true);
    try {
      await create$({ data: { name: tagName } });
      toast.success(adminToast.added());
      // Pole zostaje edytowalne w trakcie zapisu - czyścimy tylko nazwę,
      // która właśnie trafiła do bazy, nie zaczęty już kolejny tag.
      setName((current) => (current === submitted ? "" : current));
      // Blokada trwa do odświeżenia listy, żeby kontrola duplikatu widziała nowy tag.
      await qc.invalidateQueries({ queryKey: ["tags"] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setAdding(false);
    }
  };
  const del = async (tag: TagRow) => {
    // `post_tags` kasuje się kaskadowo - usunięcie odpina tag od wszystkich wpisów.
    const confirmed = await confirmDialog({
      title: t("admin.tags.confirmDeleteTitle", { name: tag.name }),
      description: t("admin.tags.confirmDeleteDescription"),
      destructive: true,
      confirmLabel: t("admin.delete"),
    });
    if (!confirmed) return;
    try {
      await delete$({ data: { id: tag.id } });
      toast.success(adminToast.deleted());
      qc.invalidateQueries({ queryKey: ["tags"] });
      // Kaskada opróżniła też `post_tags`. Edytor wpisu trzymałby w cache
      // relację z usuniętym id, a jego autozapis (`updatePost`: delete, potem
      // insert) padałby na kluczu obcym po skasowaniu WSZYSTKICH tagów wpisu.
      qc.invalidateQueries({ queryKey: ["post-tags"] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-display text-2xl font-bold">{t("admin.nav.tags")}</h1>
          {data && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {filtered.length}
              {data.length !== filtered.length ? ` / ${data.length}` : ""}
            </p>
          )}
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
          <Button
            size="sm"
            type="submit"
            className="h-8"
            disabled={adding}
            aria-label={t("admin.tags.add")}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </form>
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("admin.list.searchTags")}
            className="pl-8 h-8 text-xs"
          />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch("")} className="h-8 text-xs">
            <X className="w-3.5 h-3.5 mr-1" /> {t("admin.list.clear")}
          </Button>
        )}
      </div>

      {isError && (
        <p role="alert" className="text-xs text-destructive mb-2">
          {t("admin.tags.loadError")}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {filtered.map((tg) => (
          <span
            key={tg.id}
            className="inline-flex items-center gap-1.5 bg-card border border-border rounded-full pl-2.5 pr-1 py-0.5 text-xs"
          >
            {tg.name}
            <button
              onClick={() => del(tg)}
              type="button"
              aria-label={t("admin.tags.deleteAria", { name: tg.name })}
              className="w-5 h-5 rounded-full hover:bg-destructive/10 inline-flex items-center justify-center"
            >
              <X className="w-3 h-3 text-destructive" />
            </button>
          </span>
        ))}
        {/* Wczytywanie i błąd odczytu to nie „pusto” - przed odpowiedzią bazy
            nie wiadomo, czy tagi istnieją. */}
        {!data && !isError && <p className="text-xs text-muted-foreground">{t("admin.loading")}</p>}
        {data && !filtered.length && (
          <p className="text-xs text-muted-foreground">
            {data.length ? t("admin.list.noResults") : t("admin.empty")}
          </p>
        )}
      </div>
    </div>
  );
}
