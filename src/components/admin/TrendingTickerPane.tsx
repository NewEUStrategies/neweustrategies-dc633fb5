// CMS panel for the header "Na czasie / Trending" ticker.
// Stores config in site_settings.header.value.trending.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Save } from "@/lib/lucide-shim";
import { toast } from "sonner";
import { TrendingTicker } from "@/components/header/TrendingTicker";

type Json = Record<string, unknown>;
type Source = "trending" | "latest" | "pinned";
type Mode = "scroll" | "rotate";

interface TrendingCfg {
  enabled: boolean;
  source: Source;
  mode: Mode;
  days: number;
  limit: number;
  intervalSec: number;
  pinnedPostId: string;
  pinnedUntil: string;
  fullWidth: boolean;
}

const DEFAULTS: TrendingCfg = {
  enabled: true,
  source: "trending",
  mode: "scroll",
  days: 7,
  limit: 8,
  intervalSec: 6,
  pinnedPostId: "",
  pinnedUntil: "",
  fullWidth: true,
};

const COPY = {
  pl: {
    title: "Widget „Na czasie”",
    desc: "Pasek wyświetlany w nagłówku - wybierz źródło wpisów, tryb i czas rotacji.",
    enabled: "Włącz pasek",
    source: "Źródło wpisów",
    source_trending: "Najczęściej czytane",
    source_latest: "Najnowsze",
    source_pinned: "Przypięty wpis",
    mode: "Tryb wyświetlania",
    mode_scroll: "Przewijanie poziome",
    mode_rotate: "Rotacja (po jednym)",
    days: "Okres dla trendingu (dni)",
    limit: "Liczba wpisów",
    interval: "Co ile sekund zmieniać komunikat",
    pinnedId: "ID przypiętego wpisu (UUID)",
    pinnedUntil: "Wyświetlaj do (data i godzina)",
    full: "Pełna szerokość",
    save: "Zapisz",
    preview: "Podgląd na żywo",
    saved: "Zapisano",
    pickPost: "Wybierz wpis",
  },
  en: {
    title: "Trending widget",
    desc: "Header bar - pick the post source, display mode and rotation interval.",
    enabled: "Enable bar",
    source: "Post source",
    source_trending: "Most read",
    source_latest: "Latest",
    source_pinned: "Pinned post",
    mode: "Display mode",
    mode_scroll: "Horizontal scroll",
    mode_rotate: "Rotate (one at a time)",
    days: "Trending window (days)",
    limit: "Posts shown",
    interval: "Seconds between rotations",
    pinnedId: "Pinned post ID (UUID)",
    pinnedUntil: "Display until (date & time)",
    full: "Full width",
    save: "Save",
    preview: "Live preview",
    saved: "Saved",
    pickPost: "Pick a post",
  },
} as const;

interface PostOption { id: string; title: string }

export function TrendingTickerPane() {
  const qc = useQueryClient();
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language?.startsWith("en") ? "en" : "pl";
  const t = COPY[lang];

  const { data } = useQuery({
    queryKey: ["site_settings", "header"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "header")
        .maybeSingle();
      if (error) throw error;
      return (data?.value ?? {}) as Json;
    },
  });

  const { data: posts } = useQuery({
    queryKey: ["ticker_post_options"],
    queryFn: async (): Promise<PostOption[]> => {
      const { data, error } = await supabase
        .from("posts")
        .select("id,title_pl,title_en")
        .eq("status", "published")
        .is("deleted_at", null)
        .order("published_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((p) => ({
        id: p.id,
        title: (lang === "en" ? p.title_en : p.title_pl) || p.title_pl || p.title_en || p.id,
      }));
    },
  });

  const [cfg, setCfg] = useState<TrendingCfg>(DEFAULTS);
  useEffect(() => {
    const raw = (data?.trending as Partial<TrendingCfg> | undefined) ?? {};
    setCfg({ ...DEFAULTS, ...raw });
  }, [data]);

  const save = useMutation({
    mutationFn: async (next: TrendingCfg) => {
      const merged = { ...(data ?? {}), trending: next };
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: "header", value: merged as never }, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site_settings", "header"] });
      qc.invalidateQueries({ queryKey: ["site_settings_public", "all"] });
      qc.invalidateQueries({ queryKey: ["site_settings_public", "header"] });
      toast.success(t.saved);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = <K extends keyof TrendingCfg>(k: K, v: TrendingCfg[K]): void =>
    setCfg((c) => ({ ...c, [k]: v }));

  const previewKey = useMemo(
    () => `${cfg.source}-${cfg.mode}-${cfg.intervalSec}-${cfg.pinnedPostId}-${cfg.pinnedUntil}-${cfg.limit}-${cfg.days}`,
    [cfg],
  );

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h3 className="font-display text-lg">{t.title}</h3>
        <p className="text-sm text-muted-foreground">{t.desc}</p>
      </div>

      <div className="rounded-[5px] border border-border p-4 space-y-4 bg-card">
        <div className="flex items-center justify-between">
          <Label htmlFor="tt-enabled" className="font-medium">{t.enabled}</Label>
          <Switch id="tt-enabled" checked={cfg.enabled} onCheckedChange={(v) => set("enabled", v)} />
        </div>

        <div className="space-y-1.5">
          <Label>{t.source}</Label>
          <div className="grid grid-cols-3 gap-2">
            {(["trending", "latest", "pinned"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => set("source", s)}
                className={`rounded-[5px] border px-3 py-2 text-sm transition ${
                  cfg.source === s
                    ? "border-brand bg-brand/10 text-brand font-medium"
                    : "border-border hover:bg-muted"
                }`}
              >
                {t[`source_${s}` as const]}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{t.mode}</Label>
          <div className="grid grid-cols-2 gap-2">
            {(["scroll", "rotate"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => set("mode", m)}
                className={`rounded-[5px] border px-3 py-2 text-sm transition ${
                  cfg.mode === m
                    ? "border-brand bg-brand/10 text-brand font-medium"
                    : "border-border hover:bg-muted"
                }`}
              >
                {t[`mode_${m}` as const]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {cfg.source === "trending" && (
            <div className="space-y-1.5">
              <Label htmlFor="tt-days">{t.days}</Label>
              <Input id="tt-days" type="number" min={1} max={90} value={cfg.days}
                onChange={(e) => set("days", Math.max(1, Number(e.target.value) || 1))} />
            </div>
          )}
          {cfg.source !== "pinned" && (
            <div className="space-y-1.5">
              <Label htmlFor="tt-limit">{t.limit}</Label>
              <Input id="tt-limit" type="number" min={1} max={30} value={cfg.limit}
                onChange={(e) => set("limit", Math.max(1, Number(e.target.value) || 1))} />
            </div>
          )}
          {cfg.mode === "rotate" && (
            <div className="space-y-1.5">
              <Label htmlFor="tt-int">{t.interval}</Label>
              <Input id="tt-int" type="number" min={2} max={120} value={cfg.intervalSec}
                onChange={(e) => set("intervalSec", Math.max(2, Number(e.target.value) || 2))} />
            </div>
          )}
        </div>

        {cfg.source === "pinned" && (
          <div className="space-y-3 rounded-[5px] border border-dashed border-border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="tt-pick">{t.pickPost}</Label>
              <select
                id="tt-pick"
                value={cfg.pinnedPostId}
                onChange={(e) => set("pinnedPostId", e.target.value)}
                className="w-full rounded-[5px] border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">-</option>
                {posts?.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tt-pid">{t.pinnedId}</Label>
              <Input id="tt-pid" value={cfg.pinnedPostId}
                onChange={(e) => set("pinnedPostId", e.target.value.trim())} placeholder="00000000-0000-0000-0000-000000000000" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tt-until">{t.pinnedUntil}</Label>
              <Input id="tt-until" type="datetime-local" value={cfg.pinnedUntil}
                onChange={(e) => set("pinnedUntil", e.target.value)} />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <Label htmlFor="tt-full" className="font-medium">{t.full}</Label>
          <Switch id="tt-full" checked={cfg.fullWidth} onCheckedChange={(v) => set("fullWidth", v)} />
        </div>
      </div>

      {cfg.enabled && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{t.preview}</p>
          <div className="rounded-[5px] border border-border overflow-hidden">
            <TrendingTicker
              key={previewKey}
              source={cfg.source}
              mode={cfg.mode}
              days={cfg.days}
              limit={cfg.limit}
              intervalSec={cfg.intervalSec}
              pinnedPostId={cfg.pinnedPostId || undefined}
              pinnedUntil={cfg.pinnedUntil || null}
              fullWidth={cfg.fullWidth}
            />
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={() => save.mutate(cfg)} disabled={save.isPending}>
          <Save className="w-4 h-4 mr-2" /> {save.isPending ? "..." : t.save}
        </Button>
      </div>
    </div>
  );
}
