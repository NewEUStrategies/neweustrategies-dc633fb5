// Admin: konfiguracja + BI-analiza silnika rekomendacji (singleton per tenant).
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
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { relatedPostsConfigQueryOptions } from "@/lib/queries/relatedPosts";
import { RELATED_POSTS_DEFAULTS, type RelatedPostsConfig } from "@/lib/relatedPosts";
import { RelatedPostsAnalytics } from "@/components/admin/analytics/RelatedPostsAnalytics";
import { RelatedLayoutPreview } from "@/components/admin/RelatedLayoutPreview";

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
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl">Powiązane wpisy</h1>
        <p className="text-sm text-muted-foreground">
          Globalna konfiguracja silnika rekomendacji + analiza sygnałów behawioralnych. Wpisy mogą nadpisać ustawienia indywidualnie.
        </p>
      </header>

      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">Konfiguracja</TabsTrigger>
          <TabsTrigger value="engine">Silnik (wagi)</TabsTrigger>
          <TabsTrigger value="analytics">Analiza (BI)</TabsTrigger>
        </TabsList>

        {/* ---- Konfiguracja podstawowa ---------------------------------- */}
        <TabsContent value="config" className="mt-4">
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
                  onChange={(e) =>
                    set("after_paragraph", Math.max(1, Number(e.target.value) || 1))
                  }
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
                    <SelectItem value="cards">Karty (kolor + ikona)</SelectItem>
                    <SelectItem value="magazine">Magazyn (hero + lista)</SelectItem>
                    <SelectItem value="timeline">Oś czasu</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Kolumny (grid)</Label>
                <Select
                  value={String(form.columns)}
                  onValueChange={(v) =>
                    set("columns", Number(v) as RelatedPostsConfig["columns"])
                  }
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
              <Toggle
                label="Pokaż zajawkę"
                v={form.show_excerpt}
                on={(v) => set("show_excerpt", v)}
              />
              <Toggle
                label="Pokaż datę / meta"
                v={form.show_meta}
                on={(v) => set("show_meta", v)}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Bonus świeżości (dni)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.recency_boost_days}
                  onChange={(e) =>
                    set("recency_boost_days", Math.max(0, Number(e.target.value) || 0))
                  }
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
                      set(
                        "slider_interval_ms",
                        Math.max(2000, Number(e.target.value) || 2000),
                      )
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
        </TabsContent>

        {/* ---- Silnik: wagi sygnałów ------------------------------------ */}
        <TabsContent value="engine" className="mt-4">
          <section className="rounded-lg border border-border bg-card p-5 space-y-5">
            <div className="space-y-1">
              <h2 className="font-display text-lg">Wagi silnika rekomendacji</h2>
              <p className="text-xs text-muted-foreground">
                Skala 0-10. Silnik składa wyniki: shared categories × waga + shared tags × waga (opcjonalnie IDF) + autor + świeżość + popularność (post_views) + dwell (user_read_history) + personalizacja (profil zalogowanego użytkownika).
              </p>
            </div>

            <WeightSlider
              label="Wspólne kategorie"
              hint="Klasyczny sygnał: ile kategorii dzielą wpisy"
              value={form.weight_categories}
              onChange={(v) => set("weight_categories", v)}
            />
            <WeightSlider
              label="Wspólne tagi"
              hint="Bardziej granularne niż kategorie, świetny sygnał dla content-hubów"
              value={form.weight_tags}
              onChange={(v) => set("weight_tags", v)}
            />
            <WeightSlider
              label="Ten sam autor"
              hint="W strategii `author` waga jest podnoszona x4"
              value={form.weight_author}
              onChange={(v) => set("weight_author", v)}
            />
            <WeightSlider
              label="Świeżość"
              hint="Bonus dla wpisów opublikowanych w oknie `recency_boost_days`"
              value={form.weight_recency}
              onChange={(v) => set("weight_recency", v)}
            />
            <WeightSlider
              label="Popularność (views)"
              hint="Bonus proporcjonalny do liczby wyświetleń w ostatnich 28 dniach"
              value={form.weight_popularity}
              onChange={(v) => set("weight_popularity", v)}
            />
            <WeightSlider
              label="Dwell / czytania"
              hint="Bonus dla wpisów które użytkownicy dodają do historii czytania"
              value={form.weight_dwell}
              onChange={(v) => set("weight_dwell", v)}
            />
            <WeightSlider
              label="Personalizacja"
              hint="Dopasowanie do profilu zainteresowań zalogowanego użytkownika (kategorie + tagi z historii)"
              value={form.weight_personalization}
              onChange={(v) => set("weight_personalization", v)}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border">
              <Toggle
                label="IDF (rzadkie tagi ważą więcej)"
                v={form.use_idf}
                on={(v) => set("use_idf", v)}
              />
              <div className="space-y-1">
                <Label>Minimalny score</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.min_score}
                  onChange={(e) => set("min_score", Math.max(0, Number(e.target.value) || 0))}
                />
                <p className="text-xs text-muted-foreground">
                  Kandydaci poniżej tej wartości nie wchodzą do listy - filtr jakości.
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-border">
              <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
                {save.isPending ? "Zapisywanie..." : "Zapisz wagi"}
              </Button>
            </div>
          </section>
        </TabsContent>

        {/* ---- BI dashboard --------------------------------------------- */}
        <TabsContent value="analytics" className="mt-4">
          <RelatedPostsAnalytics />
        </TabsContent>
      </Tabs>
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

function WeightSlider({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label className="text-sm font-semibold">{label}</Label>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <span className="text-sm font-mono tabular-nums w-8 text-right">{value}</span>
      </div>
      <Slider
        min={0}
        max={10}
        step={1}
        value={[value]}
        onValueChange={(vals) => onChange(vals[0] ?? 0)}
      />
    </div>
  );
}
