// CMS panel for the header "Na czasie / Trending" ticker.
// Stores config in site_settings.header.value.trending.
import { useEffect, useState } from "react";
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
interface TrendingCfg {
  enabled: boolean;
  days: number;
  limit: number;
  fullWidth: boolean;
}

const DEFAULTS: TrendingCfg = { enabled: true, days: 7, limit: 8, fullWidth: true };

const COPY = {
  pl: {
    title: "Widget „Na czasie”",
    desc: "Pasek najczęściej czytanych wpisów wyświetlany w nagłówku.",
    enabled: "Włącz pasek",
    days: "Okres (dni)",
    limit: "Liczba wpisów",
    full: "Pełna szerokość",
    save: "Zapisz",
    preview: "Podgląd na żywo",
    saved: "Zapisano",
  },
  en: {
    title: "Trending widget",
    desc: "Most-read posts bar displayed in the header.",
    enabled: "Enable bar",
    days: "Window (days)",
    limit: "Posts shown",
    full: "Full width",
    save: "Save",
    preview: "Live preview",
    saved: "Saved",
  },
} as const;

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
        <div className="flex items-center justify-between">
          <Label htmlFor="tt-full" className="font-medium">{t.full}</Label>
          <Switch id="tt-full" checked={cfg.fullWidth} onCheckedChange={(v) => set("fullWidth", v)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="tt-days">{t.days}</Label>
            <Input id="tt-days" type="number" min={1} max={90} value={cfg.days}
              onChange={(e) => set("days", Math.max(1, Number(e.target.value) || 1))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tt-limit">{t.limit}</Label>
            <Input id="tt-limit" type="number" min={1} max={30} value={cfg.limit}
              onChange={(e) => set("limit", Math.max(1, Number(e.target.value) || 1))} />
          </div>
        </div>
      </div>

      {cfg.enabled && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{t.preview}</p>
          <div className="rounded-[5px] border border-border overflow-hidden">
            <TrendingTicker days={cfg.days} limit={cfg.limit} fullWidth={cfg.fullWidth} />
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
