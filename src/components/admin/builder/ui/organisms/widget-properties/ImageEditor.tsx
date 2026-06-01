// Organism: image widget editor (light/dark variants + preview + alt + link).
import { useState } from "react";
import { Sun, Moon, Image as ImageIcon } from "lucide-react";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { PropField } from "../../atoms";
import { ImageSlot } from "./ImageSlot";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

export function ImageEditor({ c, lang, setContent }: Props) {
  const src = typeof c.src === "string" ? c.src : "";
  const srcDark = typeof c.srcDark === "string" ? c.srcDark : "";
  const altPl = typeof c.alt_pl === "string" ? c.alt_pl : "";
  const altEn = typeof c.alt_en === "string" ? c.alt_en : "";
  const href = typeof c.href === "string" ? c.href : "";
  const [previewMode, setPreviewMode] = useState<"light" | "dark">("light");

  return (
    <div className="space-y-4">
      {/* Preview on prepared backgrounds */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Podgląd</span>
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setPreviewMode("light")}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] ${previewMode === "light" ? "bg-brand text-brand-foreground" : "bg-background hover:bg-muted"}`}
            >
              <Sun className="w-3 h-3" /> Light
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode("dark")}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] ${previewMode === "dark" ? "bg-brand text-brand-foreground" : "bg-background hover:bg-muted"}`}
            >
              <Moon className="w-3 h-3" /> Dark
            </button>
          </div>
        </div>
        <div
          className="rounded-md border border-border flex items-center justify-center p-4 min-h-[120px]"
          style={{ background: previewMode === "dark" ? "#0b0b0e" : "#ffffff" }}
        >
          {(() => {
            const shown = previewMode === "dark" ? (srcDark || src) : (src || srcDark);
            if (!shown) {
              return (
                <div className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground">
                  <ImageIcon className="w-5 h-5 opacity-50" />
                  Brak obrazka
                </div>
              );
            }
            return <img src={shown} alt="" className="max-h-32 max-w-full object-contain" />;
          })()}
        </div>
      </div>

      <ImageSlot
        label="Obrazek – Light mode"
        icon={<Sun className="w-3.5 h-3.5" />}
        value={src}
        onChange={(v) => setContent("src", v)}
      />

      <ImageSlot
        label="Obrazek – Dark mode (opcjonalnie)"
        icon={<Moon className="w-3.5 h-3.5" />}
        value={srcDark}
        onChange={(v) => setContent("srcDark", v)}
        hint="Jeśli puste – używany jest wariant Light."
      />

      <div className="pt-2 border-t border-border space-y-2">
        <PropField label="Alt (PL)">
          <Input value={altPl} onChange={(e) => setContent("alt_pl", e.target.value)} className="h-8 text-xs" />
        </PropField>
        <PropField label="Alt (EN)">
          <Input value={altEn} onChange={(e) => setContent("alt_en", e.target.value)} className="h-8 text-xs" />
        </PropField>
        <PropField label="Link (opcjonalnie)">
          <Input value={href} placeholder="https://..." onChange={(e) => setContent("href", e.target.value)} className="h-8 text-xs" />
        </PropField>
      </div>
      <div className="text-[10px] text-muted-foreground">Aktywny język edycji: {lang.toUpperCase()}</div>
    </div>
  );
}
