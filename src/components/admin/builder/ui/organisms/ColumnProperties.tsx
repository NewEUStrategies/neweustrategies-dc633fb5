// Column properties: width per device, padding/margin, background, border,
// vertical alignment, HTML tag, advanced (id/class/hide on).
// Composed from atomic-design molecules — shares vocabulary with WidgetProperties.
import type { ColumnNode, Device, CommonStyle, AdvancedSettings, Mode, Themed } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sun, Moon, Undo as RotateCcw } from "@/lib/lucide-shim";
import { pickMode, setMode as setThemedMode, isModeOverridden, resetMode } from "@/lib/builder/themed";
import { PropField } from "../atoms/PropField";
import { ColorField } from "../atoms/ColorField";
import { SpacingControl } from "../molecules/SpacingControl";
import { MotionControl } from "../molecules/MotionControl";
import { VisibilityControl } from "../molecules/VisibilityControl";
import { AccessControl } from "../molecules/AccessControl";

interface Props {
  column: ColumnNode;
  device: Device;
  mode?: Mode;
  onModeChange?: (m: Mode) => void;
  onChange: (mut: (c: ColumnNode) => void) => void;
}

export function ColumnProperties({ column, device, mode = "light", onModeChange, onChange }: Props) {
  const setStyle = (mut: (s: CommonStyle) => void) =>
    onChange((c) => { c.style = c.style ?? {}; mut(c.style); });
  const setAdvanced = (mut: (a: AdvancedSettings) => void) =>
    onChange((c) => { c.advanced = c.advanced ?? {}; mut(c.advanced); });
  const setSpan = (n: number) =>
    onChange((c) => { c.span = { ...(c.span ?? {}), [device]: n }; });

  const currentSpan = column.span?.[device] ?? column.span?.desktop ?? 12;

  type ColorKey = "bgColor" | "textColor";
  const getColor = (key: ColorKey): string | undefined =>
    pickMode<string>(column.style?.[key] as Themed<string> | undefined, mode);
  const setColor = (key: ColorKey, v: string | undefined) => setStyle((s) => {
    (s[key] as Themed<string> | undefined) = setThemedMode<string>(
      s[key] as Themed<string> | undefined, mode, v,
    );
  });
  const isOver = (key: ColorKey) => isModeOverridden(column.style?.[key] as Themed<string> | undefined, mode);
  const resetColor = (key: ColorKey) => setStyle((s) => {
    const next = resetMode<string>(s[key] as Themed<string> | undefined, mode);
    if (next == null) delete (s as Record<string, unknown>)[key];
    else (s[key] as Themed<string> | undefined) = next;
  });

  return (
    <Tabs defaultValue="layout">
      <TabsList className="grid grid-cols-3 w-full h-8">
        <TabsTrigger value="layout" className="text-xs">Układ</TabsTrigger>
        <TabsTrigger value="style" className="text-xs">Styl</TabsTrigger>
        <TabsTrigger value="advanced" className="text-xs">Zaawans.</TabsTrigger>
      </TabsList>

      <TabsContent value="layout" className="space-y-3 mt-3">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Edytujesz: {device}
        </div>
        <PropField
          label="Szerokość (1–12)"
          hint="Szerokość kolumny w 12-kolumnowej siatce rzędu. Np. 6 = pół rzędu, 4 = 1/3, 12 = pełny rząd. Suma szerokości kolumn w rzędzie powinna wynosić 12. Ustawiana osobno dla każdego urządzenia."
        >
          <Input
            type="number" min={1} max={12} value={currentSpan}
            onChange={(e) => setSpan(Math.max(1, Math.min(12, Number(e.target.value) || 12)))}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField
          label="Minimalna wysokość (px)"
          hint="Puste = dopasuj do treści. Wpisz np. 200, aby kolumna była co najmniej tak wysoka."
        >
          <Input
            type="number" min={0} max={2000}
            value={column.style?.minHeight ? parseInt(String(column.style.minHeight), 10) || "" : ""}
            placeholder="auto"
            onChange={(e) => {
              const v = e.target.value;
              setStyle((s) => { s.minHeight = v === "" ? undefined : `${Math.max(0, Number(v) || 0)}px`; });
            }}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label="Wyrównanie poziome (w rzędzie)">
          <div className="flex gap-1">
            {([
              { v: "start", label: "Start" },
              { v: "center", label: "Środek" },
              { v: "end", label: "Koniec" },
            ] as const).map((o) => {
              const active = (column.contentAlign ?? "start") === o.v;
              return (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => onChange((c) => { c.contentAlign = o.v; })}
                  className={`flex-1 h-8 text-xs rounded border ${active ? "bg-brand text-brand-foreground border-brand" : "border-border hover:bg-muted"}`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </PropField>
        <PropField label="Wyrównanie pionowe">
          <div className="flex gap-1">
            {([
              { v: "start", label: "Góra" },
              { v: "center", label: "Środek" },
              { v: "end", label: "Dół" },
              { v: "stretch", label: "Rozciągnij" },
            ] as const).map((o) => {
              const active = (column.verticalAlign ?? "start") === o.v;
              return (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => onChange((c) => { c.verticalAlign = o.v; })}
                  className={`flex-1 h-8 text-xs rounded border ${active ? "bg-brand text-brand-foreground border-brand" : "border-border hover:bg-muted"}`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </PropField>

      </TabsContent>

      <TabsContent value="style" className="space-y-4 mt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Edytujesz: {device}
          </div>
          <div className="inline-flex items-center rounded border border-border bg-muted p-0.5" role="group" aria-label="Tryb">
            {([["light", Sun, "Jasny"], ["dark", Moon, "Ciemny"]] as const).map(([m, Icon, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange?.(m)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-sm transition ${
                  mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3 h-3" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <section className="space-y-2">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Kolory ({mode === "dark" ? "ciemny" : "jasny"})</h4>
          <ThemedColorRow
            label="Tło"
            value={getColor("bgColor")}
            onChange={(v) => setColor("bgColor", v)}
            overridden={isOver("bgColor")}
            onReset={() => resetColor("bgColor")}
          />
          <ThemedColorRow
            label="Tekst"
            value={getColor("textColor")}
            onChange={(v) => setColor("textColor", v)}
            overridden={isOver("textColor")}
            onReset={() => resetColor("textColor")}
          />
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Odstępy</h4>
          <SpacingControl style={column.style} device={device} onChange={setStyle} />
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Wymiary</h4>
          <PropField label="Border radius">
            <Input
              value={typeof column.style?.borderRadius === "string" ? column.style.borderRadius : ""}
              placeholder="8px"
              onChange={(e) => setStyle((s) => { s.borderRadius = e.target.value || undefined; })}
              className="h-8 text-xs"
            />
          </PropField>
        </section>
      </TabsContent>

      <TabsContent value="advanced" className="space-y-4 mt-3">
        <section className="space-y-2">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Identyfikatory</h4>
          <PropField label="HTML ID">
            <Input
              value={column.advanced?.htmlId ?? ""}
              onChange={(e) => setAdvanced((a) => { a.htmlId = e.target.value || undefined; })}
              className="h-8 text-xs"
            />
          </PropField>
          <PropField label="CSS class">
            <Input
              value={column.advanced?.cssClass ?? ""}
              onChange={(e) => setAdvanced((a) => { a.cssClass = e.target.value || undefined; })}
              className="h-8 text-xs"
            />
          </PropField>
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Motion</h4>
          <MotionControl value={column.advanced} onChange={setAdvanced} />
        </section>

        <section className="space-y-2 pt-2 border-t border-border">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Widoczność</h4>
          <VisibilityControl value={column.advanced} onChange={setAdvanced} />
        </section>
      </TabsContent>
    </Tabs>
  );
}

function ThemedColorRow({
  label, value, onChange, overridden, onReset,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  overridden: boolean;
  onReset: () => void;
}) {
  return (
    <PropField
      label={
        <span className="inline-flex items-center gap-1.5">
          {label}
          {overridden && (
            <>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand" aria-label="Nadpisane" title="Nadpisane w tym trybie" />
              <button
                type="button"
                onClick={onReset}
                title="Przywróć z global colors"
                className="inline-flex items-center text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </>
          )}
        </span>
      }
    >
      <ColorField value={value} onChange={onChange} placeholder="dziedziczy z global colors" />
    </PropField>
  );
}
