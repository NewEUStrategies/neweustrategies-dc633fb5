// Global Colors editor — pozwala ustawić kolory dla light/dark mode
// dla każdego slotu z GLOBAL_COLOR_GROUPS. Wybór z palety presetów,
// pełny color picker oraz przycisk przywracania domyślnych wartości.
import { useEffect, useRef, useState, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { Save, Undo, Redo, X, ChevronUp, ChevronDown } from "@/lib/lucide-shim";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  GLOBAL_COLOR_GROUPS,
  GLOBAL_COLOR_CATEGORIES,
  EMPTY_GLOBAL_COLORS,
  globalColorsToCss,
  isSlotHoverable,
  type GlobalColorsValue,
  type GlobalColorSlot,
} from "@/lib/builder/globalColors";
import { useGlobalColors, useSaveGlobalColors } from "@/hooks/useGlobalColors";

// Paleta marki — edytowalna przez użytkownika, trzymana w localStorage.
type BrandColor = { name: string; value: string };
const BRAND_STORAGE_KEY = "lovable.globalColors.brandPalette.v1";
const RECENT_STORAGE_KEY = "lovable.globalColors.recentColors.v1";
const RECENT_MAX = 10;

const DEFAULT_BRAND_PALETTE: BrandColor[] = [
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

function useLocalStorageState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify(state)); } catch { /* noop */ }
  }, [key, state]);
  return [state, setState];
}

function isHexColor(v: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v.trim());
}



export function GlobalColorsEditor() {
  const { data, isLoading } = useGlobalColors();
  const save = useSaveGlobalColors();
  const [draft, setDraft] = useState<GlobalColorsValue | null>(null);
  // Stosy historii dla undo/redo. past = poprzednie stany, future = stany cofnięte.
  const [past, setPast] = useState<GlobalColorsValue[]>([]);
  const [future, setFuture] = useState<GlobalColorsValue[]>([]);
  // Flag, by zapobiec pushowaniu do historii przy undo/redo/cancel.
  const skipHistoryRef = useRef(false);

  // Edytowalna paleta marki + ostatnio użyte kolory (per-przeglądarka).
  const [brandPalette, setBrandPalette] = useLocalStorageState<BrandColor[]>(
    BRAND_STORAGE_KEY,
    DEFAULT_BRAND_PALETTE,
  );
  const [recentColors, setRecentColors] = useLocalStorageState<string[]>(RECENT_STORAGE_KEY, []);
  const trackRecent = useCallback((v: string) => {
    if (!v || !isHexColor(v)) return;
    const norm = v.toLowerCase();
    setRecentColors((prev) => [norm, ...prev.filter((c) => c.toLowerCase() !== norm)].slice(0, RECENT_MAX));
  }, [setRecentColors]);

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

  const setSlot = (key: string, mode: "light" | "dark" | "hoverLight" | "hoverDark", value: string) => {
    applyDraft({ ...draft, [key]: { ...(draft[key] ?? {}), [mode]: value } });
  };
  const setSlotMeta = (
    key: string,
    field: "fontFamily" | "fontSize" | "fontWeight" | "fontStyle" | "textDecoration",
    value: string,
  ) => {
    applyDraft({ ...draft, [key]: { ...(draft[key] ?? {}), [field]: value } });
  };
  const resetSlot = (slot: GlobalColorSlot) => {
    applyDraft({
      ...draft,
      [slot.key]: {
        light: slot.defaultLight ?? "",
        dark: slot.defaultDark ?? "",
        hoverLight: slot.defaultHoverLight ?? "",
        hoverDark: slot.defaultHoverDark ?? "",
        fontFamily: slot.defaultFontFamily ?? "",
        fontSize: slot.defaultFontSize ?? "",
      },
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



      <BrandPaletteEditor palette={brandPalette} onChange={setBrandPalette} />

      <Tabs defaultValue={GLOBAL_COLOR_GROUPS[0]?.id} className="w-full">
        <TabsList className="w-full flex flex-col gap-2 h-auto bg-muted/50 p-2 items-stretch">
          {GLOBAL_COLOR_CATEGORIES.map((cat) => {
            const groupsInCat = GLOBAL_COLOR_GROUPS.filter((g) => g.category === cat.id);
            if (groupsInCat.length === 0) return null;
            return (
              <div key={cat.id} className="space-y-1">
                <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground px-2 pt-1">
                  {cat.label}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {groupsInCat.map((group) => (
                    <TabsTrigger
                      key={group.id}
                      value={group.id}
                      className="text-xs justify-start w-full"
                    >
                      {group.label}
                    </TabsTrigger>
                  ))}
                </div>
              </div>
            );
          })}
          {GLOBAL_COLOR_GROUPS.filter((g) => !g.category).length > 0 && (
            <div className="grid grid-cols-2 gap-1">
              {GLOBAL_COLOR_GROUPS.filter((g) => !g.category).map((group) => (
                <TabsTrigger key={group.id} value={group.id} className="text-xs justify-start w-full">
                  {group.label}
                </TabsTrigger>
              ))}
            </div>
          )}
        </TabsList>


        {GLOBAL_COLOR_GROUPS.map((group) => (
          <TabsContent key={group.id} value={group.id} className="mt-4">
            <div className="rounded-lg border border-border bg-card/40">
              <div className="rounded-t-lg text-white text-xs font-semibold px-3 py-2" style={{ background: "#FA9346" }}>
                {group.label}
              </div>
              <div className="p-4 space-y-5">
                {group.slots.map((slot) => {
                  const val = draft[slot.key] ?? {};
                  return (
                    <div key={slot.key} className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Label className="text-base font-bold">{slot.label}</Label>
                          <p className="text-[10px] font-normal text-muted-foreground mt-0.5">{slot.description}</p>
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

                      {slot.typography && (
                        <>
                          <TypographyRow
                            fontFamily={val.fontFamily ?? ""}
                            fontSize={val.fontSize ?? ""}
                            defaultFontFamily={slot.defaultFontFamily}
                            defaultFontSize={slot.defaultFontSize}
                            onFontFamily={(v) => setSlotMeta(slot.key, "fontFamily", v)}
                            onFontSize={(v) => setSlotMeta(slot.key, "fontSize", v)}
                          />
                          <FormatRow
                            fontWeight={val.fontWeight ?? ""}
                            fontStyle={val.fontStyle ?? ""}
                            textDecoration={val.textDecoration ?? ""}
                            onWeight={(v) => setSlotMeta(slot.key, "fontWeight", v)}
                            onStyle={(v) => setSlotMeta(slot.key, "fontStyle", v)}
                            onDecoration={(v) => setSlotMeta(slot.key, "textDecoration", v)}
                          />
                        </>
                      )}

                      <ColorRow
                        label="Light"
                        value={val.light ?? ""}
                        defaultValue={slot.defaultLight}
                        onChange={(v) => setSlot(slot.key, "light", v)}
                        onCommit={trackRecent}
                        brandPalette={brandPalette}
                        recentColors={recentColors}
                      />
                      {slot.hasDark && (
                        <ColorRow
                          label="Dark"
                          value={val.dark ?? ""}
                          defaultValue={slot.defaultDark}
                          onChange={(v) => setSlot(slot.key, "dark", v)}
                          onCommit={trackRecent}
                          brandPalette={brandPalette}
                          recentColors={recentColors}
                        />
                      )}
                      {isSlotHoverable(slot, group) && (
                        <div className="rounded-md border border-dashed border-border/70 bg-muted/20 p-2 space-y-2">
                          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                            Hover (po najechaniu)
                          </div>
                          <ColorRow
                            label="Light"
                            value={val.hoverLight ?? ""}
                            defaultValue={slot.defaultHoverLight ?? slot.defaultLight}
                            onChange={(v) => setSlot(slot.key, "hoverLight", v)}
                            onCommit={trackRecent}
                            brandPalette={brandPalette}
                            recentColors={recentColors}
                          />
                          <ColorRow
                            label="Dark"
                            value={val.hoverDark ?? ""}
                            defaultValue={slot.defaultHoverDark ?? slot.defaultDark}
                            onChange={(v) => setSlot(slot.key, "hoverDark", v)}
                            onCommit={trackRecent}
                            brandPalette={brandPalette}
                            recentColors={recentColors}
                          />
                        </div>
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
  label, value, defaultValue, onChange, onCommit, brandPalette, recentColors,
}: {
  label: string;
  value: string;
  defaultValue?: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  brandPalette: BrandColor[];
  recentColors: string[];
}) {
  const effective = value || defaultValue || "#ffffff";
  const handlePick = (v: string) => { onChange(v); onCommit(v); };
  return (
    <div className="rounded-md border border-border bg-background/60 p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground w-12">{label}</span>
        <Input
          type="color"
          value={effective}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
          className="w-12 h-8 p-1 cursor-pointer"
        />
        <Input
          type="text"
          value={value}
          placeholder={defaultValue || "#______"}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
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
            {brandPalette.length === 0 && (
              <span className="text-[10px] text-muted-foreground italic">Brak kolorów — dodaj w sekcji „Paleta marki" powyżej.</span>
            )}
            {brandPalette.map((c) => (
              <button
                key={`${c.value}-${c.name}`}
                type="button"
                onClick={() => handlePick(c.value)}
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
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">
            Ostatnio użyte {recentColors.length > 0 && <span className="opacity-60">({recentColors.length}/{RECENT_MAX})</span>}
          </div>
          <div className="flex flex-wrap gap-1">
            {recentColors.length === 0 && (
              <span className="text-[10px] text-muted-foreground italic">Wybrane kolory pojawią się tutaj.</span>
            )}
            {recentColors.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => handlePick(c)}
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

const FONT_PRESETS: { label: string; value: string }[] = [
  { label: "Red Hat Display (domyślny)", value: '"Red Hat Display", Georgia, serif' },
  { label: "Inter", value: "Inter, system-ui, sans-serif" },
  { label: "Georgia (serif)", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "ui-monospace, SFMono-Regular, monospace" },
  { label: "Display (var)", value: "var(--font-display)" },
  { label: "Sans (var)", value: "var(--font-sans)" },
  { label: "Inherit", value: "inherit" },
];

/** Zwiększ/zmniejsz wartość rozmiaru fontu zachowując jednostkę (px/rem/em). */
function bumpFontSize(current: string, delta: number): string {
  const m = /^(-?\d*\.?\d+)\s*(px|rem|em|%)?$/i.exec((current || "").trim());
  if (!m) return current;
  const num = parseFloat(m[1]);
  const unit = m[2] || "px";
  const step = unit.toLowerCase() === "px" ? 1 : 0.125;
  const next = Math.max(0, +(num + delta * step).toFixed(3));
  return `${next}${unit}`;
}

function TypographyRow({
  fontFamily, fontSize, defaultFontFamily, defaultFontSize, onFontFamily, onFontSize,
}: {
  fontFamily: string;
  fontSize: string;
  defaultFontFamily?: string;
  defaultFontSize?: string;
  onFontFamily: (v: string) => void;
  onFontSize: (v: string) => void;
}) {
  return (
    <div className="rounded-md border border-dashed border-border/70 bg-muted/20 p-2 space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
        Typografia
      </div>
      <div className="grid grid-cols-[1fr_120px] gap-2 items-center">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground w-12">Font</span>
          <Input
            list="gc-font-presets"
            value={fontFamily}
            placeholder={defaultFontFamily || '"Red Hat Display", Georgia, serif'}
            onChange={(e) => onFontFamily(e.target.value)}
            className="h-8 text-xs"
          />
          <datalist id="gc-font-presets">
            {FONT_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </datalist>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Size</span>
          <div className="relative flex-1">
            <Input
              value={fontSize}
              placeholder={defaultFontSize || "16px"}
              onChange={(e) => onFontSize(e.target.value)}
              className="h-8 text-xs font-mono pr-6"
            />
            <div className="absolute right-0 top-0 h-8 flex flex-col border-l border-border">
              <button
                type="button"
                aria-label="Zwiększ rozmiar"
                onClick={() => onFontSize(bumpFontSize(fontSize || defaultFontSize || "16px", +1))}
                className="flex-1 px-1 hover:bg-muted/60 flex items-center justify-center"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
              <button
                type="button"
                aria-label="Zmniejsz rozmiar"
                onClick={() => onFontSize(bumpFontSize(fontSize || defaultFontSize || "16px", -1))}
                className="flex-1 px-1 hover:bg-muted/60 flex items-center justify-center border-t border-border"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
      {(fontFamily || fontSize) && (
        <button
          type="button"
          onClick={() => { onFontFamily(""); onFontSize(""); }}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          Wyczyść font/size
        </button>
      )}
    </div>
  );
}

function FormatRow({
  fontWeight, fontStyle, textDecoration, onWeight, onStyle, onDecoration,
}: {
  fontWeight: string;
  fontStyle: string;
  textDecoration: string;
  onWeight: (v: string) => void;
  onStyle: (v: string) => void;
  onDecoration: (v: string) => void;
}) {
  const weightOptions: { label: string; value: string }[] = [
    { label: "Brak", value: "" },
    { label: "Normal", value: "400" },
    { label: "Semibold", value: "600" },
    { label: "Bold", value: "700" },
  ];
  const Btn = ({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title: string }) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`h-7 px-2 text-[11px] rounded border transition ${active ? "bg-foreground text-background border-foreground" : "bg-muted/40 border-border hover:bg-muted/70"}`}
    >
      {children}
    </button>
  );
  return (
    <div className="rounded-md border border-dashed border-border/70 bg-muted/20 p-2 space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
        Formatowanie
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {weightOptions.map((w) => (
          <Btn key={w.value || "none"} active={fontWeight === w.value} onClick={() => onWeight(w.value)} title={`Grubość: ${w.label}`}>
            <span style={{ fontWeight: w.value || "inherit" }}>{w.label}</span>
          </Btn>
        ))}
        <span className="w-px h-5 bg-border mx-1" />
        <Btn active={fontStyle === "italic"} onClick={() => onStyle(fontStyle === "italic" ? "" : "italic")} title="Kursywa">
          <span className="italic">I</span>
        </Btn>
        <Btn active={textDecoration === "underline"} onClick={() => onDecoration(textDecoration === "underline" ? "" : "underline")} title="Podkreślenie">
          <span className="underline">U</span>
        </Btn>
        {(fontWeight || fontStyle || textDecoration) && (
          <button
            type="button"
            onClick={() => { onWeight(""); onStyle(""); onDecoration(""); }}
            className="text-[10px] text-muted-foreground hover:text-foreground ml-auto"
          >
            Wyczyść
          </button>
        )}
      </div>
    </div>
  );
}

function BrandPaletteEditor({
  palette, onChange,
}: { palette: BrandColor[]; onChange: (next: BrandColor[]) => void }) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftValue, setDraftValue] = useState("#000000");
  const [adding, setAdding] = useState(false);

  const startAdd = () => { setAdding(true); setEditingIdx(null); setDraftName(""); setDraftValue("#000000"); };
  const startEdit = (i: number) => {
    setAdding(false); setEditingIdx(i);
    setDraftName(palette[i].name); setDraftValue(palette[i].value);
  };
  const cancel = () => { setAdding(false); setEditingIdx(null); };
  const commit = () => {
    const v = draftValue.trim();
    if (!isHexColor(v)) return;
    const name = draftName.trim() || v;
    if (adding) onChange([...palette, { name, value: v }]);
    else if (editingIdx !== null) {
      const next = palette.slice();
      next[editingIdx] = { name, value: v };
      onChange(next);
    }
    cancel();
  };
  const remove = (i: number) => onChange(palette.filter((_, j) => j !== i));

  return (
    <div className="rounded-lg border border-border bg-card/40">
      <div className="flex items-center justify-between px-3 py-2 rounded-t-lg text-white text-xs font-semibold" style={{ background: "#FA9346" }}>
        <span>Paleta marki ({palette.length})</span>
        <button
          type="button"
          onClick={startAdd}
          className="text-[11px] bg-white/20 hover:bg-white/30 rounded px-2 py-0.5"
        >
          + Dodaj kolor
        </button>
      </div>
      <div className="p-3 space-y-2">
        {palette.length === 0 && !adding && (
          <p className="text-xs text-muted-foreground italic">Brak kolorów w palecie marki. Dodaj swój pierwszy.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {palette.map((c, i) => (
            <div key={`${c.value}-${i}`} className="group relative">
              <button
                type="button"
                onClick={() => startEdit(i)}
                className="w-8 h-8 rounded border border-border hover:scale-110 transition block"
                style={{ background: c.value }}
                title={`${c.name} — ${c.value} (kliknij aby edytować)`}
              />
              <button
                type="button"
                onClick={() => remove(i)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[10px] leading-none opacity-0 group-hover:opacity-100 transition"
                title="Usuń"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {(adding || editingIdx !== null) && (
          <div className="rounded-md border border-border bg-background/60 p-2 flex flex-wrap items-center gap-2">
            <Input
              type="color"
              value={isHexColor(draftValue) ? draftValue : "#000000"}
              onChange={(e) => setDraftValue(e.target.value)}
              className="w-10 h-8 p-1 cursor-pointer"
            />
            <Input
              type="text"
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              placeholder="#______"
              className="h-8 text-xs font-mono w-[110px]"
            />
            <Input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Nazwa (opcjonalna)"
              className="h-8 text-xs flex-1 min-w-[140px]"
            />
            <Button size="sm" onClick={commit} disabled={!isHexColor(draftValue)}>
              {adding ? "Dodaj" : "Zapisz"}
            </Button>
            <Button size="sm" variant="outline" onClick={cancel}>Anuluj</Button>
          </div>
        )}
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
    case "icon":
    case "icon-hover": {
      const base = get("icon");
      const hover = get("icon-hover");
      return (
        <div className="flex items-center gap-4">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={base} strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z"/></svg>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={base} strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={hover} strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <span className="text-[10px]" style={{ opacity: 0.6 }}>base / hover</span>
        </div>
      );
    }
    case "sidebar-bg":
    case "sidebar-text":
    case "sidebar-btn-bg":
    case "sidebar-btn-text":
    case "sidebar-btn-hover-bg":
    case "sidebar-btn-hover-text":
    case "sidebar-border": {
      const bg = get("sidebar-bg");
      const text = get("sidebar-text");
      const btnBg = get("sidebar-btn-bg");
      const btnText = get("sidebar-btn-text");
      const hBg = get("sidebar-btn-hover-bg");
      const hText = get("sidebar-btn-hover-text");
      const border = get("sidebar-border");
      return (
        <div
          style={{ background: bg, color: text, borderColor: border }}
          className="w-full rounded border p-2 flex flex-col gap-1 text-[11px]"
        >
          <div style={{ borderColor: border }} className="pb-1 border-b font-semibold">Menu</div>
          <div className="flex items-center gap-1.5 px-1.5 py-1 rounded" style={{ background: btnBg, color: btnText }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2z"/></svg>
            <span>Aktywny</span>
          </div>
          <div className="flex items-center gap-1.5 px-1.5 py-1 rounded" style={{ background: hBg, color: hText }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
            <span>Hover</span>
          </div>
          <div className="flex items-center gap-1.5 px-1.5 py-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
            <span>Normalny link</span>
          </div>
        </div>
      );
    }
    case "h1":
      return <h1 style={{ color: c }} className="text-2xl font-black leading-tight m-0">Nagłówek H1 — tytuł</h1>;
    case "h2":
      return <h2 style={{ color: c }} className="text-xl font-bold leading-tight m-0">Nagłówek H2 — sekcja</h2>;
    case "h3":
      return <h3 style={{ color: c }} className="text-lg font-bold leading-snug m-0">Nagłówek H3 — podsekcja</h3>;
    case "h4":
      return <h4 style={{ color: c }} className="text-base font-semibold leading-snug m-0">Nagłówek H4 — akapit</h4>;
    case "h5":
      return <h5 style={{ color: c }} className="text-sm font-semibold uppercase tracking-wide m-0">Nagłówek H5</h5>;
    case "h6":
      return <h6 style={{ color: c }} className="text-xs font-bold uppercase tracking-widest m-0">Nagłówek H6</h6>;
    case "body-text":
      return (
        <p style={{ color: c }} className="text-xs leading-relaxed m-0">
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Treść akapitu na tle strony.
        </p>
      );
    case "body-text-muted":
      return (
        <p style={{ color: c }} className="text-[11px] leading-relaxed m-0 italic">
          Podpis pod obrazkiem · meta informacja · data publikacji
        </p>
      );
    case "link":
    case "link-hover": {
      const base = get("link");
      const hover = get("link-hover");
      return (
        <p className="text-xs leading-relaxed m-0" style={{ color: "inherit" }}>
          To jest <a style={{ color: base, textDecoration: "underline" }}>link domyślny</a>, a to <a style={{ color: hover, textDecoration: "underline" }}>link po najechaniu</a>.
        </p>
      );
    }
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


