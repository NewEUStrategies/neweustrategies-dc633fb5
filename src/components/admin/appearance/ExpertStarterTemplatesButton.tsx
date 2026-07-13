// Wstawia startowe szablony layoutu eksperta (scope='expert_profile') do
// builder_templates. Idempotentne po nazwie - jeśli szablon o danej nazwie
// już istnieje, nie jest duplikowany. Po zakończeniu odświeża listy używane
// przez ExpertLayoutSettingsDialog i AppearanceBuilderPane.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { EXPERT_STARTER_TEMPLATES } from "@/lib/experts/expertTemplates";
import { toJson } from "@/lib/builder/types";

interface ExistingTemplate {
  id: string;
  name: string;
}

async function fetchExpertTemplates(): Promise<ExistingTemplate[]> {
  const { data, error } = await supabase
    .from("builder_templates")
    .select("id, name")
    .eq("scope", "expert_profile");
  if (error) throw error;
  return data ?? [];
}

export function ExpertStarterTemplatesButton() {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const existingQ = useQuery({
    queryKey: ["admin", "expert-layout-templates"] as const,
    queryFn: fetchExpertTemplates,
  });

  const existingNames = useMemo(
    () => new Set((existingQ.data ?? []).map((t) => t.name)),
    [existingQ.data],
  );
  const missing = useMemo(
    () => EXPERT_STARTER_TEMPLATES.filter((t) => !existingNames.has(t.name)),
    [existingNames],
  );

  const insert = useMutation({
    mutationFn: async () => {
      if (missing.length === 0) return 0;
      const rows = missing.map((t) => ({
        name: t.name,
        scope: "expert_profile",
        data: toJson(t.build()),
      }));
      const { error } = await supabase.from("builder_templates").insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["admin", "expert-layout-templates"] });
      qc.invalidateQueries({ queryKey: ["builder_templates"] });
      if (count > 0) {
        toast.success(
          lang === "pl"
            ? `Dodano ${count} szablon(y) startowe.`
            : `Added ${count} starter template(s).`,
        );
      } else {
        toast.info(
          lang === "pl" ? "Wszystkie szablony są już dostępne." : "All templates already exist.",
        );
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err));
    },
    onSettled: () => setBusy(false),
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={busy || insert.isPending || existingQ.isLoading}
        onClick={() => {
          setBusy(true);
          insert.mutate();
        }}
      >
        <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />
        {lang === "pl"
          ? `Wstaw startowe szablony${missing.length > 0 ? ` (${missing.length})` : ""}`
          : `Add starter templates${missing.length > 0 ? ` (${missing.length})` : ""}`}
      </Button>
      {existingQ.data && existingQ.data.length > 0 && (
        <span className="text-xs text-muted-foreground">
          {lang === "pl"
            ? `Zapisane szablony: ${existingQ.data.length}`
            : `Saved templates: ${existingQ.data.length}`}
        </span>
      )}
    </div>
  );
}
