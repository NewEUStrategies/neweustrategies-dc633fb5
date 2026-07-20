// Inline tworzenie kategorii / tagów z poziomu edytora wpisu.
// Wyodrębnione 1:1 z trasy admin.posts.$slug (zachowanie bez zmian).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { slugifyTaxonomy } from "@/lib/content/taxonomySlug";

export function useInlineTaxonomy(args: {
  tenantId: string;
  onCategoryCreated: (id: string) => void;
  onTagCreated: (id: string) => void;
}) {
  const { tenantId, onCategoryCreated, onTagCreated } = args;
  const qc = useQueryClient();
  const [newCatPl, setNewCatPl] = useState("");
  const [newCatEn, setNewCatEn] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [taxonomyBusy, setTaxonomyBusy] = useState<"cat" | "tag" | null>(null);

  const addCategory = async () => {
    const pl = newCatPl.trim();
    const en = newCatEn.trim() || pl;
    if (!pl) {
      toast.error("Podaj nazwę PL kategorii");
      return;
    }
    setTaxonomyBusy("cat");
    try {
      const slug = slugifyTaxonomy(pl) || slugifyTaxonomy(en) || `cat-${Date.now()}`;
      const { data, error } = await supabase
        .from("categories")
        .insert({ tenant_id: tenantId, name_pl: pl, name_en: en, slug })
        .select("id, name_pl, name_en")
        .single();
      if (error) throw error;
      if (data) {
        onCategoryCreated(data.id);
        setNewCatPl("");
        setNewCatEn("");
        await qc.invalidateQueries({ queryKey: ["categories", tenantId] });
        toast.success(`Dodano kategorię: ${data.name_pl}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTaxonomyBusy(null);
    }
  };

  const addTag = async () => {
    const name = newTagName.trim();
    if (!name) {
      toast.error("Podaj nazwę tagu");
      return;
    }
    setTaxonomyBusy("tag");
    try {
      const slug = slugifyTaxonomy(name) || `tag-${Date.now()}`;
      const { data, error } = await supabase
        .from("tags")
        .insert({ tenant_id: tenantId, name, slug })
        .select("id, name")
        .single();
      if (error) throw error;
      if (data) {
        onTagCreated(data.id);
        setNewTagName("");
        await qc.invalidateQueries({ queryKey: ["tags", tenantId] });
        toast.success(`Dodano tag: ${data.name}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTaxonomyBusy(null);
    }
  };

  return {
    newCatPl,
    setNewCatPl,
    newCatEn,
    setNewCatEn,
    newTagName,
    setNewTagName,
    taxonomyBusy,
    addCategory,
    addTag,
  };
}
