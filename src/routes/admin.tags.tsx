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
import { confirmDialog } from "@/lib/appDialogs";
import { adminPageHead } from "@/lib/adminPageHead";

export const Route = createFileRoute("/admin/tags")({
  head: () =>
    adminPageHead(
      "Tags",
      "Manage post tags and their slugs. New European Strategies administration.",
    ),
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
  const [adding, setAdding] = useState(false);
  const { data, error } = useQuery({
    // Własny klucz, NIE gołe ["tags", tenantId]: pod tym kluczem edytor wpisu
    // (usePostEditorData) trzyma wiersze `id, name` BEZ sluga, a przy
    // staleTime 5 min ekran tagów dostawał je z cache bez pobrania - szukanie
    // po slugu nie znajdowało wtedy nic. Prefiks ["tags", tenantId] zostaje,
    // więc unieważnienia z edytora i z tego ekranu nadal obejmują oba zapytania.
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
    // Blokada w locie: pole trzyma nazwę do końca żądania, więc drugi Enter
    // wysyłał ją ponownie i serwer tworzył duplikat ze slugiem „-2”.
    if (!tagName || adding) return;
    // Ta sama nazwa później też dawała duplikat: `createTag` dokleja sufiks do
    // sluga, a drugi tag o tej nazwie jest nieodróżnialny w selektorach.
    const existing = data?.find((tg) => tg.name.trim().toLowerCase() === tagName.toLowerCase());
    if (existing) {
      toast.error(t("admin.tags.duplicate", { name: existing.name }));
      return;
    }
    setAdding(true);
    try {
      await create$({ data: { name: tagName } });
      // Pole jest edytowalne w trakcie żądania - czyścimy tylko zapisaną
      // nazwę, nie zaczęty już kolejny tag.
      setName((current) => (current === submitted ? "" : current));
      // Blokada trwa do odświeżenia listy, żeby kontrola duplikatu widziała nowy tag.
      await qc.invalidateQueries({ queryKey: ["tags"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };
  const del = async (tg: TagRow) => {
    // Usunięcie tagu odpina go kaskadowo od WSZYSTKICH wpisów (post_tags
    // ON DELETE CASCADE) - jak w kategoriach, bez potwierdzenia ani rusz.
    if (
      !(await confirmDialog({
        title: t("admin.confirmDelete"),
        description: tg.name,
        destructive: true,
        confirmLabel: t("admin.delete"),
      }))
    )
      return;
    try {
      await delete$({ data: { id: tg.id } });
      qc.invalidateQueries({ queryKey: ["tags"] });
      // Kaskada opróżniła też `post_tags`. Edytor wpisu trzymałby w cache
      // relację z usuniętym id, a jego zapis (`updatePost`: delete, potem
      // insert) padałby na kluczu obcym już po skasowaniu WSZYSTKICH tagów wpisu.
      // Usunięcie, nie unieważnienie: unieważnioną relację przemontowany edytor
      // dostaje najpierw i uznaje za wczytaną, zanim wróci odczyt bazy.
      qc.removeQueries({ queryKey: ["post-tags"] });
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
          <Button
            size="sm"
            type="submit"
            className="h-8"
            disabled={adding}
            aria-label={t("admin.new")}
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
        {/* Pustka tylko po wczytaniu: w trakcie ładowania i po błędzie zapytania
            „Brak elementów” kłamało, że baza nie ma tagów. */}
        {!filtered.length &&
          (error && !data ? (
            <p role="alert" className="text-xs text-destructive">
              {error.message}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {!data
                ? t("admin.loading")
                : data.length
                  ? t("admin.list.noResults")
                  : t("admin.empty")}
            </p>
          ))}
      </div>
    </div>
  );
}
