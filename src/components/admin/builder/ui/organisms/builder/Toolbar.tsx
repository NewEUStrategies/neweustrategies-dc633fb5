import { Monitor, Tablet, Smartphone, Undo, Redo, Eye } from "@/lib/lucide-shim";
import type { Device } from "@/lib/builder/types";

export function Toolbar({
  lang, onLangChange, device, setDevice, canUndo, canRedo, onUndo, onRedo,
}: {
  lang: "pl" | "en"; onLangChange: (l: "pl" | "en") => void;
  device: Device; setDevice: (d: Device) => void;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
}) {
  return (
    <div className="border-b border-border p-2 flex items-center justify-between gap-2 bg-card">
      <div className="flex items-center gap-1">
        {(["pl", "en"] as const).map((l) => (
          <button key={l} onClick={() => onLangChange(l)}
            className={`px-2.5 py-1 text-xs rounded ${lang === l ? "bg-brand text-brand-foreground" : "bg-muted"}`}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        {([["desktop", Monitor], ["tablet", Tablet], ["mobile", Smartphone]] as const).map(([d, Icon]) => (
          <button key={d} onClick={() => setDevice(d)}
            className={`p-1.5 rounded ${device === d ? "bg-brand text-brand-foreground" : "bg-muted hover:bg-muted/70"}`} title={d}>
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button onClick={onUndo} disabled={!canUndo} className="p-1.5 rounded bg-muted hover:bg-muted/70 disabled:opacity-30" title="Cofnij (Ctrl/Cmd+Z)">
          <Undo className="w-4 h-4" />
        </button>
        <button onClick={onRedo} disabled={!canRedo} className="p-1.5 rounded bg-muted hover:bg-muted/70 disabled:opacity-30" title="Ponów (Ctrl/Cmd+Shift+Z)">
          <Redo className="w-4 h-4" />
        </button>
        <span className="text-xs text-muted-foreground inline-flex items-center gap-1 ml-2">
          <Eye className="w-3.5 h-3.5" /> Podgląd
        </span>
      </div>
    </div>
  );
}
