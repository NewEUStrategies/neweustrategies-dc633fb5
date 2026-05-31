import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/tags")({
  component: Tags,
});

interface TagRow { id: string; name: string; slug: string }

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function Tags() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const tenantId = useRequiredTenant();
  const [name, setName] = useState("");
  const { data } = useQuery({
    queryKey: ["tags", tenantId],
    queryFn: async (): Promise<TagRow[]> => {
      const { data, error } = await supabase.from("tags").select("*").eq("tenant_id", tenantId).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const { error } = await supabase.from("tags").insert({ name: name.trim(), slug: slugify(name), tenant_id: tenantId });
    if (error) { toast.error(error.message); return; }
    setName("");
    qc.invalidateQueries({ queryKey: ["tags"] });
  };
  const del = async (id: string) => {
    await supabase.from("tags").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["tags"] });
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-bold mb-6">{t("admin.nav.tags")}</h1>

      <form onSubmit={add} className="flex gap-2 mb-6 max-w-md">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("admin.tags.placeholder")} />
        <Button type="submit"><Plus className="w-4 h-4" /></Button>
      </form>

      <div className="flex flex-wrap gap-2">
        {data?.map((tg) => (
          <span key={tg.id} className="inline-flex items-center gap-2 bg-card border border-border rounded-full pl-3 pr-1 py-1 text-sm">
            {tg.name}
            <button onClick={() => del(tg.id)} type="button" aria-label={t("admin.delete")} className="w-6 h-6 rounded-full hover:bg-destructive/10 inline-flex items-center justify-center">
              <X className="w-3.5 h-3.5 text-destructive" />
            </button>
          </span>
        ))}
        {!data?.length && <p className="text-sm text-muted-foreground">{t("admin.empty")}</p>}
      </div>
    </div>
  );
}
