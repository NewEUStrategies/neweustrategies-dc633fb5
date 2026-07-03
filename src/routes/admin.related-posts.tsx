// Admin: global related-posts configuration (singleton per tenant).
import { createFileRoute } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { relatedPostsConfigQueryOptions } from "@/lib/queries/relatedPosts";
import { RELATED_POSTS_DEFAULTS, type RelatedPostsConfig } from "@/lib/relatedPosts";

export const Route = createFileRoute("/admin/related-posts")({
  component: AdminRelatedPostsPage,
  notFoundComponent: () => <div className="p-8">Nie znaleziono</div>,
  errorComponent: (props) => <RouteErrorFallback {...props} variant="admin" />,
});

function AdminRelatedPostsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery(relatedPostsConfigQueryOptions());
  const [form, setForm] = useState<RelatedPostsConfig>(RELATED_POSTS_DEFAULTS);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: async (next: RelatedPostsConfig) => {
      const { error } = await supabase
        .from("related_posts_config")
        .update(next)
        // tenant_id is PK; the editor policy scopes to the current tenant.
        .neq("tenant_id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["public", "related-posts-config"] });
      toast.success(t("admin.saved", { defaultValue: "Zapisano" }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = <K extends keyof RelatedPostsConfig>(k: K, v: RelatedPostsConfig[K]) => {
    setForm((s) => ({ ...s, [k]: v }));
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl">Powiązane wpisy</h1>
        <p className="text-sm text-muted-foreground">
          Globalna konfiguracja silnika rekomendacji. Wpisy mogą nadpisać te ustawienia
          indywidualnie.
        </p>
      </header>

      <section className="rounded-lg border border-border bg-card p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-semibold">Włączone</Label>
            <p className="text-xs text-muted-foreground">Renderuj sekcję pod wpisami</p>
          </div>
          <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>Tytuł (PL)</Label>
            <Input value={form.title_pl} onChange={(e) => set("title_pl", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Tytuł (EN)</Label>
            <Input value={form.title_en} onChange={(e) => set("title_en", e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label>Pozycja</Label>
            <Select
              value={form.position}
              onValueChange={(v) => set("position", v as RelatedPostsConfig["position"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="end">Na końcu wpisu</SelectItem>
                <SelectItem value="sidebar">W sidebarze</SelectItem>
                <SelectItem value="after_paragraph">Po paragrafie</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Po którym paragrafie</Label>
            <Input
              type="number"
              min={1}
              value={form.after_paragraph}
              onChange={(e) => set("after_paragraph", Math.max(1, Number(e.target.value) || 1))}
              disabled={form.position !== "after_paragraph"}
            />
          </div>
          <div className="space-y-1">
            <Label>Liczba wpisów</Label>
            <Input
              type="number"
              min={1}
              max={24}
              value={form.items_limit}
              onChange={(e) =>
                set("items_limit", Math.max(1, Math.min(24, Number(e.target.value) || 1)))
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label>Layout</Label>
            <Select
              value={form.layout}
              onValueChange={(v) => set("layout", v as RelatedPostsConfig["layout"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="grid">Grid</SelectItem>
                <SelectItem value="list">Lista</SelectItem>
                <SelectItem value="slider">Slider</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Kolumny (grid)</Label>
            <Select
              value={String(form.columns)}
              onValueChange={(v) => set("columns", Number(v) as RelatedPostsConfig["columns"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="4">4</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Strategia źródła</Label>
            <Select
              value={form.source_strategy}
              onValueChange={(v) =>
                set("source_strategy", v as RelatedPostsConfig["source_strategy"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Kategorie + Tagi</SelectItem>
                <SelectItem value="categories">Tylko kategorie</SelectItem>
                <SelectItem value="tags">Tylko tagi</SelectItem>
                <SelectItem value="author">Ten sam autor</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Toggle label="Pokaż miniaturę" v={form.show_cover} on={(v) => set("show_cover", v)} />
          <Toggle label="Pokaż zajawkę" v={form.show_excerpt} on={(v) => set("show_excerpt", v)} />
          <Toggle label="Pokaż datę / meta" v={form.show_meta} on={(v) => set("show_meta", v)} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>Bonus świeżości (dni)</Label>
            <Input
              type="number"
              min={0}
              value={form.recency_boost_days}
              onChange={(e) => set("recency_boost_days", Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <div className="space-y-1 flex items-end gap-3">
            <div className="flex-1">
              <Label>Interwał slidera (ms)</Label>
              <Input
                type="number"
                min={2000}
                value={form.slider_interval_ms}
                onChange={(e) =>
                  set("slider_interval_ms", Math.max(2000, Number(e.target.value) || 2000))
                }
                disabled={!form.slider_autoplay}
              />
            </div>
            <div className="pb-2">
              <Toggle
                label="Autoplay"
                v={form.slider_autoplay}
                on={(v) => set("slider_autoplay", v)}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-border">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
            {save.isPending ? "Zapisywanie..." : "Zapisz"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function Toggle({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 cursor-pointer">
      <span className="text-sm">{label}</span>
      <Switch checked={v} onCheckedChange={on} />
    </label>
  );
}
