// Global Colors editor — pozwala ustawić kolory dla light/dark mode
// dla każdego slotu z GLOBAL_COLOR_GROUPS. Wybór z palety presetów,
// pełny color picker oraz przycisk przywracania domyślnych wartości.
import { useEffect, useRef, useState, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { Save, Undo, Redo, X } from "@/lib/lucide-shim";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  GLOBAL_COLOR_GROUPS,
  EMPTY_GLOBAL_COLORS,
  globalColorsToCss,
  type GlobalColorsValue,
  type GlobalColorSlot,
} from "@/lib/builder/globalColors";
import { useGlobalColors, useSaveGlobalColors } from "@/hooks/useGlobalColors";

// Paleta presetów — kolory marki + neutralne.
const BRAND_PALETTE: Array<{ name: string; value: string }> = [
  { name: "Background Dark", value: "#01112F" },
  { name: "Background Light", value: "#F8F6F4" },
  { name: "Granat", value: "#15334D" },
  { name: "Pomarańcz", value: "#FA9346" },
  { name: "Pomarańcz Light", value: "#FDB078" },
  { name: "Pomarańcz Very Light", value: "#FFF4ED" },
  { name: "Złoty", value: "#E1B076" },
  { name: "Czerwień", value: "#CD393B" },
  { name: "Czerwony przycisk", value: "#CA4343" },
  { name: "Czerwień wykres", value: "#EF5454" },
  { name: "Czerwień video", value: "#FF0000" },
  { name: "Szary ciemny", value: "#333333" },
  { name: "Szary jasny", value: "#CCCCCC" },
];

const NEUTRAL_PALETTE = [
  "#000000", "#ffffff", "#1f2937", "#374151", "#6b7280", "#9ca3af", "#e5e7eb", "#f3f4f6",
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#10b981", "#14b8a6",
  "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
];


export function GlobalColorsEditor() {
  const { data, isLoading } = useGlobalColors();
  const save = useSaveGlobalColors();
  const [draft, setDraft] = useState<GlobalColorsValue | null>(null);
  // Stosy historii dla undo/redo. past = poprzednie stany, future = stany cofnięte.
  const [past, setPast] = useState<GlobalColorsValue[]>([]);
  const [future, setFuture] = useState<GlobalColorsValue[]>([]);
  // Flag, by zapobiec pushowaniu do historii przy undo/redo/cancel.
  const skipHistoryRef = useRef(false);

  useEffect(() => {
    if (data && draft === null) setDraft({ ...EMPTY_GLOBAL_COLORS, ...data });
  }, [data, draft]);

  const baseline = { ...EMPTY_GLOBAL_COLORS, ...(data ?? {}) };
  const isDirty = draft ? JSON.stringify(draft) !== JSON.stringify(baseline) : false;
  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  // Centralna funkcja zmiany draftu — automatycznie zapisuje historię.
  const applyDraft = useCallback((next: GlobalColorsValue) => {
    setDraft((prev) => {
      if (prev && !skipHistoryRef.current) {
        setPast((p) => [...p, prev]);
        setFuture([]);
      }
      skipHistoryRef.current = false;
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setDraft((cur) => {
        if (cur) setFuture((f) => [...f, cur]);
        return prev;
      });
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[f.length - 1];
      setDraft((cur) => {
        if (cur) setPast((p) => [...p, cur]);
        return next;
      });
      return f.slice(0, -1);
    });
  }, []);

  const handleSave = useCallback(() => {
    if (!draft || !isDirty || save.isPending) return;
    save.mutate(draft, {
      onSuccess: () => { setPast([]); setFuture([]); },
    });
  }, [draft, isDirty, save]);

  // Skróty klawiszowe: Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z lub Ctrl+Y = redo, Cmd/Ctrl+S = save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
      else if (k === "s") { e.preventDefault(); handleSave(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, handleSave]);

  if (isLoading || !draft) return <p className="text-sm text-muted-foreground">Ładowanie…</p>;

  const setSlot = (key: string, mode: "light" | "dark", value: string) => {
    applyDraft({ ...draft, [key]: { ...(draft[key] ?? {}), [mode]: value } });
  };
  const resetSlot = (slot: GlobalColorSlot) => {
    applyDraft({
      ...draft,
      [slot.key]: { light: slot.defaultLight ?? "", dark: slot.defaultDark ?? "" },
    });
  };

  // Live preview — natychmiast nadpisuje :root / .dark tokenami z draftu.
  const liveCss = globalColorsToCss(draft);


  return (
    <div className="space-y-6">
      {/* eslint-disable-next-line react/no-danger */}
      <style data-global-colors-preview dangerouslySetInnerHTML={{ __html: liveCss }} />
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg">Global Colors</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ustaw kolory dla trybu jasnego i ciemnego. Skróty: ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z, ⌘/Ctrl+S.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={undo}
            disabled={!canUndo}
            title="Cofnij (⌘/Ctrl+Z)"
          >
            <Undo className="w-4 h-4 mr-2" />
            Cofnij
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={redo}
            disabled={!canRedo}
            title="Ponów (⌘/Ctrl+Shift+Z)"
          >
            <Redo className="w-4 h-4 mr-2" />
            Ponów
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              skipHistoryRef.current = true;
              setPast([]);
              setFuture([]);
              setDraft(baseline);
            }}
            disabled={save.isPending || !isDirty}
          >
            <X className="w-4 h-4 mr-2" />
            Anuluj
          </Button>
          <Button size="sm" onClick={handleSave} disabled={save.isPending || !isDirty}>
            <Save className="w-4 h-4 mr-2" />
            {save.isPending ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </div>

      </div>


      <Tabs defaultValue={GLOBAL_COLOR_GROUPS[0]?.id} className="w-full">
        <TabsList className="w-full grid grid-cols-2 gap-1 h-auto bg-muted/50 p-1">
          {GLOBAL_COLOR_GROUPS.map((group) => (
            <TabsTrigger
              key={group.id}
              value={group.id}
              className="text-xs justify-start w-full"
            >
              {group.label}
            </TabsTrigger>
          ))}
        </TabsList>


        {GLOBAL_COLOR_GROUPS.map((group) => (
          <TabsContent key={group.id} value={group.id} className="mt-4">
            <div className="rounded-lg border border-border bg-card/40">
              <div className="rounded-t-lg bg-sky-500 text-white text-xs font-semibold px-3 py-2">
                {group.label}
              </div>
              <div className="p-4 space-y-5">
                {group.slots.map((slot) => {
                  const val = draft[slot.key] ?? {};
                  return (
                    <div key={slot.key} className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Label className="text-sm font-medium">{slot.label}</Label>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{slot.description}</p>
                        </div>
                        {(slot.defaultLight || slot.defaultDark) && (
                          <button
                            type="button"
                            onClick={() => resetSlot(slot)}
                            className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
                            title="Przywróć kolor domyślny"
                          >
                            <Undo className="w-3 h-3" />
                            Domyślny
                          </button>
                        )}
                      </div>

                      <SlotPreview slot={slot} draft={draft} />



                      <ColorRow
                        label="Light"
                        value={val.light ?? ""}
                        defaultValue={slot.defaultLight}
                        onChange={(v) => setSlot(slot.key, "light", v)}
                      />
                      {slot.hasDark && (
                        <ColorRow
                          label="Dark"
                          value={val.dark ?? ""}
                          defaultValue={slot.defaultDark}
                          onChange={(v) => setSlot(slot.key, "dark", v)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>

    </div>
  );
}

function ColorRow({
  label, value, defaultValue, onChange,
}: { label: string; value: string; defaultValue?: string; onChange: (v: string) => void }) {
  const effective = value || defaultValue || "#ffffff";
  return (
    <div className="rounded-md border border-border bg-background/60 p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground w-12">{label}</span>
        <Input
          type="color"
          value={effective}
          onChange={(e) => onChange(e.target.value)}
          className="w-12 h-8 p-1 cursor-pointer"
        />
        <Input
          type="text"
          value={value}
          placeholder={defaultValue || "#______"}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-xs font-mono w-[120px]"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Wyczyść
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Marka</div>
          <div className="flex flex-wrap gap-1">
            {BRAND_PALETTE.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => onChange(c.value)}
                className={`w-5 h-5 rounded border transition ${
                  value?.toLowerCase() === c.value.toLowerCase()
                    ? "border-foreground ring-2 ring-offset-1 ring-foreground/30"
                    : "border-border hover:scale-110"
                }`}
                style={{ background: c.value }}
                title={`${c.name} — ${c.value}`}
              />
            ))}
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Neutralne</div>
          <div className="flex flex-wrap gap-1">
            {NEUTRAL_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange(c)}
                className={`w-5 h-5 rounded border transition ${
                  value?.toLowerCase() === c.toLowerCase()
                    ? "border-foreground ring-2 ring-offset-1 ring-foreground/30"
                    : "border-border hover:scale-110"
                }`}
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}

// Pobiera aktualny kolor dla danego klucza w danym trybie.
// Fallback: mode → light → defaultDark/defaultLight → szary.
function getColor(draft: GlobalColorsValue, key: string, mode: "light" | "dark"): string {
  const v = draft[key];
  if (v?.[mode]) return v[mode] as string;
  if (v?.light) return v.light;
  let slot: GlobalColorSlot | undefined;
  for (const g of GLOBAL_COLOR_GROUPS) {
    const s = g.slots.find((x) => x.key === key);
    if (s) { slot = s; break; }
  }
  if (mode === "dark" && slot?.defaultDark) return slot.defaultDark;
  if (slot?.defaultLight) return slot.defaultLight;
  return mode === "dark" ? "#e5e7eb" : "#374151";
}

/** Renderuje treść podglądu używając podanej funkcji `get(key)` zwracającej kolor. */
function renderPreviewBody(slot: GlobalColorSlot, get: (key: string) => string): React.ReactNode {
  const c = get(slot.key);
  switch (slot.key) {
    case "header-icon":
    case "header-icon-hover": {
      const base = get("header-icon");
      const hover = get("header-icon-hover");
      return (
        <div className="flex items-center gap-4 text-xs font-medium">
          <span style={{ color: base }}>Strona główna</span>
          <span style={{ color: hover, textDecoration: "underline" }}>Aktualności (hover)</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={base} strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4-4"/></svg>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={hover} strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        </div>
      );
    }
    case "highlight":
      return (
        <div className="flex items-center gap-3 text-xs">
          <a style={{ color: c }} className="font-medium underline">Link tekstowy</a>
          <span style={{ color: c }} className="uppercase tracking-wider font-bold">Kategoria</span>
        </div>
      );
    case "dark-accent":
      return (
        <div style={{ background: c }} className="w-full h-12 rounded flex items-center px-3 text-white text-xs font-semibold">
          Hero / nagłówek pojedynczego wpisu
        </div>
      );
    case "body-bg":
    case "body-bg-single":
      return (
        <div style={{ background: c }} className="w-full h-12 rounded border border-black/10 flex items-center justify-center text-xs" >
          <span style={{ color: get("highlight") }}>Tło strony</span>
        </div>
      );
    case "btn-bg":
    case "btn-text":
    case "btn-hover-bg":
    case "btn-hover-text": {
      const bg = get("btn-bg");
      const text = get("btn-text");
      const hBg = get("btn-hover-bg");
      const hText = get("btn-hover-text");
      return (
        <div className="flex items-center gap-2">
          <button style={{ background: bg, color: text }} className="text-xs font-semibold px-3 py-1.5 rounded">Normalny</button>
          <button style={{ background: hBg, color: hText }} className="text-xs font-semibold px-3 py-1.5 rounded">Hover</button>
        </div>
      );
    }
    case "switcher-light-icon":
    case "switcher-light-bg":
    case "switcher-dark-icon":
    case "switcher-dark-bg": {
      const li = get("switcher-light-icon");
      const lb = get("switcher-light-bg");
      const di = get("switcher-dark-icon");
      const db = get("switcher-dark-bg");
      return (
        <div className="flex items-center gap-2">
          <span style={{ background: lb, color: li }} className="inline-flex w-8 h-8 rounded-full items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
          </span>
          <span style={{ background: db, color: di }} className="inline-flex w-8 h-8 rounded-full items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          </span>
        </div>
      );
    }
    case "bookmark-hover":
      return (
        <div className="flex items-center gap-2 text-xs">
          <svg width="20" height="20" viewBox="0 0 24 24" fill={c} stroke={c} strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          <span style={{ opacity: 0.7 }}>Zakładka po najechaniu</span>
        </div>
      );
    case "review-bg":
    case "review-icon": {
      const bg = get("review-bg");
      const ic = get("review-icon");
      return (
        <div className="flex items-center gap-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} style={{ background: bg }} className="w-6 h-6 rounded inline-flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill={ic}><polygon points="12 2 15 9 22 9.3 17 14 18.5 21 12 17.5 5.5 21 7 14 2 9.3 9 9 12 2"/></svg>
            </span>
          ))}
        </div>
      );
    }
    case "sponsor-label":
      return <span style={{ color: c }} className="text-[10px] uppercase tracking-widest font-bold">Sponsored</span>;
    case "popular-counter":
      return (
        <div className="flex items-baseline gap-2">
          <span style={{ color: c }} className="text-3xl font-black leading-none">1</span>
          <span className="text-xs" style={{ opacity: 0.6 }}>Popularny artykuł</span>
        </div>
      );
    case "live-blog":
      return (
        <div className="flex items-center gap-2 text-xs">
          <span style={{ background: c }} className="w-2 h-2 rounded-full animate-pulse" />
          <span style={{ color: c }} className="font-bold uppercase tracking-wider">Live</span>
        </div>
      );
    case "toc-bg":
      return (
        <div style={{ background: c }} className="w-full p-2 rounded text-[11px] space-y-1">
          <div className="font-semibold">Spis treści</div>
          <div style={{ opacity: 0.7 }}>1. Wprowadzenie</div>
          <div style={{ opacity: 0.7 }}>2. Główna część</div>
        </div>
      );
    case "verified-tick":
      return (
        <div className="flex items-center gap-2 text-xs">
          <svg width="18" height="18" viewBox="0 0 24 24" fill={c}><path d="M12 2l2.4 1.8 3 .2.2 3L19.4 9.6l-1.8 2.4 1.8 2.4-1.8 3-3 .2L12 19.4l-2.4-1.8-3-.2-.2-3L4.6 12 6.4 9.6 4.6 7.2l1.8-3 3-.2z"/><path d="M9 12.5l2 2 4-4.5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span style={{ opacity: 0.7 }}>Zweryfikowany autor</span>
        </div>
      );
    default:
      return <div style={{ background: c }} className="w-12 h-8 rounded border border-black/10" />;
  }
}

/**
 * Funkcjonalny mini-podgląd — pokazuje fragment UI jednocześnie w trybie
 * jasnym i ciemnym, używając aktualnych kolorów z draftu.
 */
function SlotPreview({ slot, draft }: { slot: GlobalColorSlot; draft: GlobalColorsValue }) {
  const Panel = ({ mode }: { mode: "light" | "dark" }) => {
    const get = (key: string) => getColor(draft, key, mode);
    const isDark = mode === "dark";
    return (
      <div
        className="rounded-md border p-3 flex flex-col gap-2 min-h-[72px]"
        style={{
          background: isDark ? "#0b1220" : "#ffffff",
          borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
          color: isDark ? "#e5e7eb" : "#1f2937",
        }}
      >
        <span className="text-[9px] uppercase tracking-widest" style={{ opacity: 0.5 }}>
          {mode}
        </span>
        <div className="flex items-center justify-center flex-1">
          {renderPreviewBody(slot, get)}
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      <Panel mode="light" />
      <Panel mode="dark" />
    </div>
  );
}


