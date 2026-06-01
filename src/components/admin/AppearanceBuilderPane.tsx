// Reuses the page Builder to edit Header / Footer / Menu as builder documents
// stored under site_settings. Same widget UX as posts/pages.
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Builder } from "@/components/admin/builder/Builder";
import { emptyDocument, type BuilderDocument } from "@/lib/builder/types";
import { defaultDocFor } from "@/lib/builder/chromeDefaults";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Save, RotateCcw } from "@/lib/lucide-shim";
import { toast } from "sonner";
import { ThemeOptionsPane } from "@/components/admin/ThemeOptionsPane";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface Props {
  settingsKey: string;
  title: string;
  scope?: "header" | "footer" | "menu";
}


type Json = Record<string, unknown>;

export function AppearanceBuilderPane({ settingsKey, title, scope }: Props) {
  const qc = useQueryClient();
  const [lang, setLang] = useState<"pl" | "en">("pl");
  const [doc, setDoc] = useState<BuilderDocument | null>(null);

  const { data } = useQuery({
    queryKey: ["site_settings", settingsKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", settingsKey)
        .maybeSingle();
      if (error) throw error;
      return (data?.value ?? {}) as Json;
    },
  });

  useEffect(() => {
    if (!data || doc) return;
    const existing = (data.builder_data ?? null) as BuilderDocument | null;
    if (existing && existing.sections?.length) {
      setDoc(existing);
    } else if (scope) {
      // Seed with the live default chrome so every part is editable.
      setDoc(defaultDocFor(scope));
    } else {
      setDoc(emptyDocument());
    }
  }, [data, doc, scope]);

  const save = useMutation({
    mutationFn: async (next: BuilderDocument) => {
      const merged = { ...(data ?? {}), builder_data: next };
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: settingsKey, value: merged as never }, { onConflict: "key" });
      if (error) throw error;
      return next;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site_settings", settingsKey] });
      qc.invalidateQueries({ queryKey: ["site_settings_public", settingsKey] });
      toast.success("Zapisano");
    },
    onError: (e: Error) => toast.error(e.message || "Błąd zapisu"),
  });

  const onChange = useCallback((v: BuilderDocument) => setDoc(v), []);

  if (!doc) return <p className="text-sm text-muted-foreground">Ładowanie…</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl">{title}</h2>
        <Button onClick={() => save.mutate(doc)} disabled={save.isPending}>
          <Save className="w-4 h-4 mr-2" /> {save.isPending ? "..." : "Zapisz"}
        </Button>
      </div>
      {scope === "header" ? (
        <Tabs defaultValue="builder">
          <TabsList>
            <TabsTrigger value="builder">Builder</TabsTrigger>
            <TabsTrigger value="options">Opcje motywu</TabsTrigger>
          </TabsList>
          <TabsContent value="builder" className="mt-3">
            <Builder value={doc} onChange={onChange} lang={lang} onLangChange={setLang} hideChrome scope={scope} />
          </TabsContent>
          <TabsContent value="options" className="mt-3">
            <ThemeOptionsPane />
          </TabsContent>
        </Tabs>
      ) : (
        <Builder value={doc} onChange={onChange} lang={lang} onLangChange={setLang} hideChrome scope={scope} />
      )}
    </div>
  );
}
