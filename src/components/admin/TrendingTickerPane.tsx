// CMS panel for the header "Na czasie / Trending" ticker.
// Stores config in site_settings.header.value.trending as { activeVariantId, variants }.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Save, Plus, Copy, Trash2, Check, Undo2, Redo2, X } from "@/lib/lucide-shim";
import { toast } from "sonner";
import { TrendingTicker } from "@/components/header/TrendingTicker";
import type { TickerConfig } from "@/lib/views/headerTickerQuery";
import { publishTickerDraft, clearTickerDraft } from "@/lib/views/tickerDraftBridge";
import {
  DEFAULT_LIGHT_COLORS,
  DEFAULT_DARK_COLORS,
  DEFAULT_TICKER_COLORS,
  DEFAULT_TICKER_CONFIG,
  MAX_TICKER_VARIANTS,
  makeDefaultVariant,
  normalizeTickerSettings,
  type IconAnimation,
  type MixedFill,
  type TickerColors,
  type TickerColorScheme,
  type TickerSettings,
  type TickerVariant,
} from "@/lib/views/tickerVariants";

type Json = Record<string, unknown>;
type Source = "trending" | "latest" | "pinned" | "selected" | "mixed";
type Mode = "scroll" | "fade" | "slide" | "flip" | "typewriter";

const MAX_SELECTED = 3;

const COPY = {
  pl: {
    title: "Widget „Na czasie”",
    desc: "Pasek w nagłówku - warianty, źródła, kolory light/dark, etykieta i animacja ognia.",
    enabled: "Włącz pasek",
    source: "Źródło wpisów",
    source_trending: "Najczęściej czytane",
    source_latest: "Najnowsze",
    source_pinned: "Przypięty wpis",
    source_selected: "Wybrane materiały",
    source_mixed: "Miks (przypięte + wypełnienie)",
    mode: "Tryb animacji",
    mode_scroll: "Przewijanie w pętli",
    mode_fade: "Przenikanie (fade)",
    mode_slide: "Wysuwanie z dołu",
    mode_flip: "Obrót 3D (flip)",
    mode_typewriter: "Maszyna do pisania",
    visibleCount: "Ile newsów widocznych jednocześnie",
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
    selectedTitle: "Załączone materiały (max 3)",
    selectedHint: "Zaznacz do 3 wpisów - wyświetlą się w wybranej kolejności.",
    selectedEmpty: "Nie wybrano żadnego wpisu.",
    selectedRemove: "Usuń",
    selectedAdd: "Dodaj wpis",
    mixedFill: "Wypełnienie po przypiętych",
    mixedFill_trending: "Najczęściej czytane",
    mixedFill_latest: "Najnowsze",
    variants: "Warianty",
    variantsHint: `Możesz utworzyć do ${MAX_TICKER_VARIANTS} wariantów - jeden jest aktywny.`,
    addVariant: "Dodaj wariant",
    duplicate: "Duplikuj",
    remove: "Usuń wariant",
    activate: "Ustaw jako aktywny",
    variantName: "Nazwa wariantu",
    labels: "Etykieta paska",
    labelPl: "Etykieta (PL)",
    labelEn: "Etykieta (EN)",
    labelPlaceholderPl: "Na czasie",
    labelPlaceholderEn: "Trending",
    icon: "Animacja ikony ognia",
    icon_none: "Bez animacji",
    icon_pulse: "Pulsuje",
    icon_flicker: "Migoczący płomień",
    icon_spin: "Obraca się",
    icon_wave: "Fala",
    colors: "Kolory",
    colorsLight: "Tryb jasny",
    colorsDark: "Tryb ciemny",
    color_bg: "Tło",
    color_border: "Obramowanie / separator",
    color_label: "Etykieta i ikona",
    color_item: "Kolor tytułu",
    color_itemHover: "Tytuł na hover",
    color_counter: "Numery",
    resetColors: "Przywróć domyślne",
    cannotDeleteLast: "Musi zostać przynajmniej jeden wariant.",
    undo: "Cofnij",
    redo: "Ponów",
    cancel: "Anuluj zmiany",
    noChanges: "Brak zmian do cofnięcia.",
    reverted: "Przywrócono ostatnio zapisany stan.",
  },
  en: {
    title: "Trending widget",
    desc: "Header bar - variants, sources, light/dark colors, label and flame animation.",
    enabled: "Enable bar",
    source: "Post source",
    source_trending: "Most read",
    source_latest: "Latest",
    source_pinned: "Pinned post",
    source_selected: "Selected items",
    source_mixed: "Mix (pinned + fill)",
    mode: "Animation mode",
    mode_scroll: "Loop scroll",
    mode_fade: "Cross-fade",
    mode_slide: "Slide up",
    mode_flip: "3D flip",
    mode_typewriter: "Typewriter",
    visibleCount: "Items visible at once",
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
    selectedTitle: "Attached items (max 3)",
    selectedHint: "Pick up to 3 posts - they show in the chosen order.",
    selectedEmpty: "No items selected.",
    selectedRemove: "Remove",
    selectedAdd: "Add item",
    mixedFill: "Fill after pinned items",
    mixedFill_trending: "Most read",
    mixedFill_latest: "Latest",
    variants: "Variants",
    variantsHint: `You can create up to ${MAX_TICKER_VARIANTS} variants - one is active.`,
    addVariant: "Add variant",
    duplicate: "Duplicate",
    remove: "Delete variant",
    activate: "Set as active",
    variantName: "Variant name",
    labels: "Bar label",
    labelPl: "Label (PL)",
    labelEn: "Label (EN)",
    labelPlaceholderPl: "Na czasie",
    labelPlaceholderEn: "Trending",
    icon: "Flame icon animation",
    icon_none: "None",
    icon_pulse: "Pulse",
    icon_flicker: "Flicker",
    icon_spin: "Spin",
    icon_wave: "Wave",
    colors: "Colors",
    colorsLight: "Light mode",
    colorsDark: "Dark mode",
    color_bg: "Background",
    color_border: "Border / divider",
    color_label: "Label & icon",
    color_item: "Title color",
    color_itemHover: "Title on hover",
    color_counter: "Counters",
    resetColors: "Reset to defaults",
    cannotDeleteLast: "At least one variant must remain.",
    undo: "Undo",
    redo: "Redo",
    cancel: "Discard changes",
    noChanges: "No changes to discard.",
    reverted: "Restored the last saved state.",
  },
} as const;

interface PostOption {
  id: string;
  title: string;
}

const COLOR_KEYS: readonly (keyof TickerColors)[] = [
  "bg",
  "border",
  "label",
  "item",
  "itemHover",
  "counter",
];



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

  const [settings, setSettings] = useState<TickerSettings>(() => ({
    activeVariantId: "",
    variants: [makeDefaultVariant()],
  }));

  // Undo/redo history + baseline snapshot for the "cancel" action.
  const [past, setPast] = useState<TickerSettings[]>([]);
  const [future, setFuture] = useState<TickerSettings[]>([]);
  const baselineRef = useRef<TickerSettings | null>(null);

  useEffect(() => {
    const next = normalizeTickerSettings(data?.trending);
    setSettings(next);
    baselineRef.current = next;
    setPast([]);
    setFuture([]);
  }, [data]);

  // commit() pushes the current state onto the past stack, drops any redo
  // future, then applies the updater. All mutations funnel through here so
  // undo/redo has a complete picture of edits made in this session.
  const commit = useCallback((updater: (s: TickerSettings) => TickerSettings): void => {
    setSettings((current) => {
      const next = updater(current);
      if (next === current) return current;
      setPast((p) => [...p, current]);
      setFuture([]);
      return next;
    });
  }, []);

  const undo = useCallback((): void => {
    setPast((p) => {
      if (p.length === 0) {
        toast.info(t.noChanges);
        return p;
      }
      const prev = p[p.length - 1];
      setSettings((current) => {
        setFuture((f) => [current, ...f]);
        return prev;
      });
      return p.slice(0, -1);
    });
  }, [t.noChanges]);

  const redo = useCallback((): void => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const [nextState, ...rest] = f;
      setSettings((current) => {
        setPast((p) => [...p, current]);
        return nextState;
      });
      return rest;
    });
  }, []);

  const cancelChanges = useCallback((): void => {
    const base = baselineRef.current;
    if (!base) return;
    if (past.length === 0 && future.length === 0) {
      toast.info(t.noChanges);
      return;
    }
    setSettings(base);
    setPast([]);
    setFuture([]);
    toast.success(t.reverted);
  }, [past.length, future.length, t.noChanges, t.reverted]);

  const activeVariant: TickerVariant =
    settings.variants.find((v) => v.id === settings.activeVariantId) ?? settings.variants[0];
  const cfg = activeVariant.config;

  // Broadcast current (unsaved) config to the live site Header so edits in
  // source, selection, order and colors reflect immediately without saving.
  useEffect(() => {
    publishTickerDraft(cfg);
    return () => clearTickerDraft();
  }, [cfg]);

  const save = useMutation({
    mutationFn: async (next: TickerSettings) => {
      const merged = { ...(data ?? {}), trending: next };
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: "header", value: merged as never }, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: (_r, next) => {
      baselineRef.current = next;
      setPast([]);
      setFuture([]);
      qc.invalidateQueries({ queryKey: ["site_settings", "header"] });
      qc.invalidateQueries({ queryKey: ["site_settings_public", "all"] });
      qc.invalidateQueries({ queryKey: ["site_settings_public", "header"] });
      toast.success(t.saved);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchActive = (patch: Partial<TickerConfig>): void => {
    commit((s) => ({
      ...s,
      variants: s.variants.map((v) =>
        v.id === s.activeVariantId ? { ...v, config: { ...v.config, ...patch } } : v,
      ),
    }));
  };
  const set = <K extends keyof TickerConfig>(k: K, v: TickerConfig[K]): void =>
    patchActive({ [k]: v } as Partial<TickerConfig>);

  const renameActive = (name: string): void => {
    commit((s) => ({
      ...s,
      variants: s.variants.map((v) => (v.id === s.activeVariantId ? { ...v, name } : v)),
    }));
  };

  const activate = (id: string): void => commit((s) => ({ ...s, activeVariantId: id }));

  const addVariant = (): void => {
    commit((s) => {
      if (s.variants.length >= MAX_TICKER_VARIANTS) return s;
      const v = makeDefaultVariant(`${lang === "en" ? "Variant" : "Wariant"} ${s.variants.length + 1}`);
      return { activeVariantId: v.id, variants: [...s.variants, v] };
    });
  };

  const duplicateActive = (): void => {
    commit((s) => {
      if (s.variants.length >= MAX_TICKER_VARIANTS) return s;
      const src = s.variants.find((v) => v.id === s.activeVariantId);
      if (!src) return s;
      const clone = makeDefaultVariant(`${src.name} (kopia)`);
      clone.config = { ...src.config, colors: cloneColors(src.config.colors ?? DEFAULT_TICKER_COLORS) };
      return { activeVariantId: clone.id, variants: [...s.variants, clone] };
    });
  };

  const removeActive = (): void => {
    commit((s) => {
      if (s.variants.length <= 1) {
        toast.error(t.cannotDeleteLast);
        return s;
      }
      const rest = s.variants.filter((v) => v.id !== s.activeVariantId);
      return { activeVariantId: rest[0].id, variants: rest };
    });
  };

  // Keyboard shortcuts: Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y = redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);


  const setColor = (mode: "light" | "dark", key: keyof TickerColors, value: string): void => {
    const current: TickerColorScheme = cfg.colors ?? DEFAULT_TICKER_COLORS;
    const nextMode: TickerColors = { ...current[mode], [key]: value };
    const next: TickerColorScheme =
      mode === "light" ? { ...current, light: nextMode } : { ...current, dark: nextMode };
    set("colors", next);
  };

  const resetColors = (): void => set("colors", { ...DEFAULT_TICKER_COLORS });

  const previewKey = useMemo(
    () =>
      `${activeVariant.id}-${cfg.source}-${cfg.mode}-${cfg.visibleCount}-${cfg.intervalSec}-${cfg.pinnedPostId}-${cfg.pinnedUntil}-${cfg.limit}-${cfg.days}-${(cfg.selectedPostIds ?? []).join(",")}-${cfg.mixedFill}-${cfg.iconAnimation}-${cfg.labelPl}-${cfg.labelEn}-${JSON.stringify(cfg.colors ?? {})}`,
    [activeVariant.id, cfg],
  );

  const toggleSelected = (id: string): void => {
    const list = cfg.selectedPostIds ?? [];
    if (list.includes(id)) set("selectedPostIds", list.filter((x) => x !== id));
    else if (list.length < MAX_SELECTED) set("selectedPostIds", [...list, id]);
  };
  const moveSelected = (id: string, dir: -1 | 1): void => {
    const arr = [...(cfg.selectedPostIds ?? [])];
    const i = arr.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set("selectedPostIds", arr);
  };

  const postTitle = (id: string): string => posts?.find((p) => p.id === id)?.title ?? id;

  const currentSource = (cfg.source ?? "trending") as Source;
  const currentMode = (cfg.mode ?? "scroll") as Mode;
  const selectedIds = cfg.selectedPostIds ?? [];

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h3 className="font-display text-lg">{t.title}</h3>
        <p className="text-sm text-muted-foreground">{t.desc}</p>
      </div>

      {/* Variants management */}
      <div className="rounded-[5px] border border-border p-4 space-y-3 bg-card">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium text-sm">{t.variants}</p>
            <p className="text-xs text-muted-foreground">{t.variantsHint}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addVariant}
            disabled={settings.variants.length >= MAX_TICKER_VARIANTS}
          >
            <Plus className="w-4 h-4 mr-1" /> {t.addVariant}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {settings.variants.map((v) => {
            const isActive = v.id === settings.activeVariantId;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => activate(v.id)}
                className={`inline-flex items-center gap-1.5 rounded-[5px] border px-2.5 py-1 text-xs transition ${
                  isActive
                    ? "border-brand bg-brand/10 text-brand font-medium"
                    : "border-border hover:bg-muted"
                }`}
                aria-pressed={isActive}
                title={isActive ? "" : t.activate}
              >
                {isActive && <Check className="w-3 h-3" />}
                <span className="truncate max-w-[160px]">{v.name}</span>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
          <div className="space-y-1.5">
            <Label htmlFor="tt-name">{t.variantName}</Label>
            <Input
              id="tt-name"
              value={activeVariant.name}
              onChange={(e) => renameActive(e.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={duplicateActive}
            disabled={settings.variants.length >= MAX_TICKER_VARIANTS}
          >
            <Copy className="w-4 h-4 mr-1" /> {t.duplicate}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={removeActive}
            disabled={settings.variants.length <= 1}
          >
            <Trash2 className="w-4 h-4 mr-1" /> {t.remove}
          </Button>
        </div>
      </div>

      <div className="rounded-[5px] border border-border p-4 space-y-4 bg-card">
        <div className="flex items-center justify-between">
          <Label htmlFor="tt-enabled" className="font-medium">
            {t.enabled}
          </Label>
          <Switch
            id="tt-enabled"
            checked={cfg.enabled ?? true}
            onCheckedChange={(v) => set("enabled", v)}
          />
        </div>

        {/* Labels */}
        <div className="space-y-1.5">
          <Label>{t.labels}</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input
              value={cfg.labelPl ?? ""}
              onChange={(e) => set("labelPl", e.target.value)}
              placeholder={t.labelPlaceholderPl}
              aria-label={t.labelPl}
            />
            <Input
              value={cfg.labelEn ?? ""}
              onChange={(e) => set("labelEn", e.target.value)}
              placeholder={t.labelPlaceholderEn}
              aria-label={t.labelEn}
            />
          </div>
        </div>

        {/* Source */}
        <div className="space-y-1.5">
          <Label>{t.source}</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(["trending", "latest", "pinned", "selected", "mixed"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => set("source", s)}
                className={`rounded-[5px] border px-3 py-2 text-xs transition ${
                  currentSource === s
                    ? "border-brand bg-brand/10 text-brand font-medium"
                    : "border-border hover:bg-muted"
                }`}
              >
                {t[`source_${s}` as const]}
              </button>
            ))}
          </div>
        </div>

        {/* Mode */}
        <div className="space-y-1.5">
          <Label>{t.mode}</Label>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {(["scroll", "fade", "slide", "flip", "typewriter"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => set("mode", m)}
                className={`rounded-[5px] border px-3 py-2 text-xs transition ${
                  currentMode === m
                    ? "border-brand bg-brand/10 text-brand font-medium"
                    : "border-border hover:bg-muted"
                }`}
              >
                {t[`mode_${m}` as const]}
              </button>
            ))}
          </div>
        </div>

        {/* Icon animation removed - flame stays static. */}


        {/* Numerics */}
        <div className="grid grid-cols-2 gap-4">
          {(currentSource === "trending" ||
            currentSource === "mixed") && (
            <div className="space-y-1.5">
              <Label htmlFor="tt-days">{t.days}</Label>
              <Input
                id="tt-days"
                type="number"
                min={1}
                max={90}
                value={cfg.days ?? 7}
                onChange={(e) => set("days", Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          )}
          {currentSource !== "pinned" && currentSource !== "selected" && (
            <div className="space-y-1.5">
              <Label htmlFor="tt-limit">{t.limit}</Label>
              <Input
                id="tt-limit"
                type="number"
                min={1}
                max={30}
                value={cfg.limit ?? 8}
                onChange={(e) => set("limit", Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="tt-visible">{t.visibleCount}</Label>
            <Input
              id="tt-visible"
              type="number"
              min={1}
              max={5}
              value={cfg.visibleCount ?? 1}
              onChange={(e) =>
                set("visibleCount", Math.max(1, Math.min(5, Number(e.target.value) || 1)))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tt-int">{t.interval}</Label>
            <Input
              id="tt-int"
              type="number"
              min={2}
              max={120}
              value={cfg.intervalSec ?? 6}
              onChange={(e) => set("intervalSec", Math.max(2, Number(e.target.value) || 2))}
            />
          </div>
        </div>

        {/* Mixed fill */}
        {currentSource === "mixed" && (
          <div className="space-y-1.5">
            <Label>{t.mixedFill}</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["trending", "latest"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => set("mixedFill", f)}
                  className={`rounded-[5px] border px-3 py-2 text-xs transition ${
                    (cfg.mixedFill ?? "trending") === f
                      ? "border-brand bg-brand/10 text-brand font-medium"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  {t[`mixedFill_${f}` as const]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Pinned selection */}
        {(currentSource === "pinned" || currentSource === "mixed") && (
          <div className="space-y-3 rounded-[5px] border border-dashed border-border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="tt-pick">{t.pickPost}</Label>
              <select
                id="tt-pick"
                value={cfg.pinnedPostId ?? ""}
                onChange={(e) => set("pinnedPostId", e.target.value || undefined)}
                className="w-full rounded-[5px] border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">-</option>
                {posts?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tt-pid">{t.pinnedId}</Label>
              <Input
                id="tt-pid"
                value={cfg.pinnedPostId ?? ""}
                onChange={(e) => set("pinnedPostId", e.target.value.trim() || undefined)}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </div>
            {currentSource === "pinned" && (
              <div className="space-y-1.5">
                <Label htmlFor="tt-until">{t.pinnedUntil}</Label>
                <Input
                  id="tt-until"
                  type="datetime-local"
                  value={cfg.pinnedUntil ?? ""}
                  onChange={(e) => set("pinnedUntil", e.target.value || null)}
                />
              </div>
            )}
          </div>
        )}

        {/* Selected / mixed selected list */}
        {(currentSource === "selected" || currentSource === "mixed") && (
          <div className="space-y-3 rounded-[5px] border border-dashed border-border p-3">
            <div>
              <p className="font-medium text-sm">{t.selectedTitle}</p>
              <p className="text-xs text-muted-foreground">{t.selectedHint}</p>
            </div>

            {selectedIds.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">{t.selectedEmpty}</p>
            ) : (
              <ul className="space-y-1.5">
                {selectedIds.map((id, i) => (
                  <li
                    key={id}
                    className="flex items-center gap-2 rounded-[5px] border border-border bg-background px-2 py-1.5 text-sm"
                  >
                    <span className="tabular-nums text-xs text-muted-foreground w-5">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="flex-1 truncate">{postTitle(id)}</span>
                    <button
                      type="button"
                      onClick={() => moveSelected(id, -1)}
                      disabled={i === 0}
                      className="px-1.5 py-0.5 rounded border border-border text-xs hover:bg-muted disabled:opacity-30"
                      aria-label="Up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSelected(id, 1)}
                      disabled={i === selectedIds.length - 1}
                      className="px-1.5 py-0.5 rounded border border-border text-xs hover:bg-muted disabled:opacity-30"
                      aria-label="Down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleSelected(id)}
                      className="px-2 py-0.5 rounded border border-destructive/40 text-destructive text-xs hover:bg-destructive/10"
                    >
                      {t.selectedRemove}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="tt-add">{t.selectedAdd}</Label>
              <select
                id="tt-add"
                value=""
                disabled={selectedIds.length >= MAX_SELECTED}
                onChange={(e) => {
                  if (e.target.value) toggleSelected(e.target.value);
                }}
                className="w-full rounded-[5px] border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="">
                  {selectedIds.length >= MAX_SELECTED ? "-" : t.pickPost}
                </option>
                {posts
                  ?.filter((p) => !selectedIds.includes(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        )}

        {/* Colors */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t.colors}</Label>
            <Button type="button" size="sm" variant="ghost" onClick={resetColors}>
              {t.resetColors}
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ColorGroup
              title={t.colorsLight}
              labels={t}
              values={cfg.colors?.light ?? DEFAULT_LIGHT_COLORS}
              onChange={(k, v) => setColor("light", k, v)}
            />
            <ColorGroup
              title={t.colorsDark}
              labels={t}
              values={cfg.colors?.dark ?? DEFAULT_DARK_COLORS}
              onChange={(k, v) => setColor("dark", k, v)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <Label htmlFor="tt-full" className="font-medium">
            {t.full}
          </Label>
          <Switch
            id="tt-full"
            checked={cfg.fullWidth ?? true}
            onCheckedChange={(v) => set("fullWidth", v)}
          />
        </div>
      </div>

      {(cfg.enabled ?? true) && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{t.preview}</p>
          <div className="rounded-[5px] border border-border overflow-hidden">
            <TrendingTicker
              key={previewKey}
              variantId={activeVariant.id}
              source={cfg.source ?? "trending"}
              mode={cfg.mode ?? "scroll"}
              days={cfg.days ?? 7}
              limit={cfg.limit ?? 8}
              visibleCount={cfg.visibleCount ?? 1}
              intervalSec={cfg.intervalSec ?? 6}
              pinnedPostId={cfg.pinnedPostId || undefined}
              pinnedUntil={cfg.pinnedUntil || null}
              selectedPostIds={cfg.selectedPostIds}
              mixedFill={cfg.mixedFill}
              labelPl={cfg.labelPl}
              labelEn={cfg.labelEn}
              iconAnimation={cfg.iconAnimation}
              colors={cfg.colors}
              fullWidth={cfg.fullWidth ?? true}
            />
          </div>
        </div>
      )}

      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={undo}
            disabled={past.length === 0}
            title={`${t.undo} (Ctrl+Z)`}
            aria-label={t.undo}
          >
            <Undo2 className="w-4 h-4 mr-1" /> {t.undo}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={redo}
            disabled={future.length === 0}
            title={`${t.redo} (Ctrl+Shift+Z)`}
            aria-label={t.redo}
          >
            <Redo2 className="w-4 h-4 mr-1" /> {t.redo}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={cancelChanges}
            disabled={past.length === 0 && future.length === 0}
          >
            <X className="w-4 h-4 mr-1" /> {t.cancel}
          </Button>
          <Button onClick={() => save.mutate(settings)} disabled={save.isPending}>
            <Save className="w-4 h-4 mr-2" /> {save.isPending ? "..." : t.save}
          </Button>
        </div>
      </div>
    </div>
  );
}

function cloneColors(c: TickerColorScheme): TickerColorScheme {
  return {
    light: { ...c.light },
    dark: { ...c.dark },
  };
}

function ColorGroup({
  title,
  labels,
  values,
  onChange,
}: {
  title: string;
  labels: Record<string, string>;
  values: TickerColors;
  onChange: (k: keyof TickerColors, v: string) => void;
}) {
  const labelMap: Record<keyof TickerColors, string> = {
    bg: labels.color_bg,
    border: labels.color_border,
    label: labels.color_label,
    item: labels.color_item,
    itemHover: labels.color_itemHover,
    counter: labels.color_counter,
  };
  return (
    <div className="rounded-[5px] border border-border p-3 space-y-2 bg-background/40">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div className="space-y-1.5">
        {COLOR_KEYS.map((k) => (
          <ColorField
            key={k}
            id={`tt-color-${title}-${k}`}
            label={labelMap[k]}
            value={values[k]}
            onChange={(v) => onChange(k, v)}
          />
        ))}
      </div>
    </div>
  );
}

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  // If it's a valid hex, drive the native color input; otherwise, keep it as
  // a token string and expose only the text input.
  const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
  return (
    <div className="grid grid-cols-[1fr_auto_2.5rem] gap-2 items-center">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-xs font-mono"
      />
      <input
        type="color"
        aria-label={label}
        value={isHex ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full rounded border border-border cursor-pointer bg-transparent"
      />
    </div>
  );
}
