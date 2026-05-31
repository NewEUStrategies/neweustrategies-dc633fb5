// Column properties: width per device, padding/margin, background, border,
// vertical alignment, HTML tag, advanced (id/class/hide on).
import type { ColumnNode, Device, CommonStyle, AdvancedSettings, ResponsiveValue } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

interface Props {
  column: ColumnNode;
  device: Device;
  onChange: (mut: (c: ColumnNode) => void) => void;
}

export function ColumnProperties({ column, device, onChange }: Props) {
  const setStyle = (mut: (s: CommonStyle) => void) => onChange((c) => { c.style = c.style ?? {}; mut(c.style); });
  const setAdvanced = (mut: (a: AdvancedSettings) => void) => onChange((c) => { c.advanced = c.advanced ?? {}; mut(c.advanced); });
  const setSpan = (n: number) => onChange((c) => { c.span = { ...(c.span ?? {}), [device]: n }; });
  const setResp = <T,>(rv: ResponsiveValue<T> | undefined, val: T | undefined): ResponsiveValue<T> =>
    ({ ...(rv ?? {}), [device]: val });

  const currentSpan = column.span?.[device] ?? column.span?.desktop ?? 12;

  return (
    <Tabs defaultValue="layout">
      <TabsList className="grid grid-cols-3 w-full h-8">
        <TabsTrigger value="layout" className="text-xs">Układ</TabsTrigger>
        <TabsTrigger value="style" className="text-xs">Styl</TabsTrigger>
        <TabsTrigger value="advanced" className="text-xs">Zaawans.</TabsTrigger>
      </TabsList>

      <TabsContent value="layout" className="space-y-3 mt-3">
        <div className="text-[10px] text-muted-foreground uppercase">Edytujesz: {device}</div>
        <div>
          <Label className="text-xs">Szerokość (1–12)</Label>
          <Input type="number" min={1} max={12} value={currentSpan}
            onChange={(e) => setSpan(Math.max(1, Math.min(12, Number(e.target.value) || 12)))}
            className="h-8 text-xs" />
        </div>
      </TabsContent>

      <TabsContent value="style" className="space-y-3 mt-3">
        <div>
          <Label className="text-xs">Tło</Label>
          <Input value={column.style?.bgColor ?? ""}
            onChange={(e) => setStyle((s) => { s.bgColor = e.target.value || undefined; })}
            placeholder="#fff" className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs">Kolor tekstu</Label>
          <Input value={column.style?.textColor ?? ""}
            onChange={(e) => setStyle((s) => { s.textColor = e.target.value || undefined; })}
            placeholder="#000" className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs">Padding ({device})</Label>
          <Input value={column.style?.padding?.[device] ?? ""}
            onChange={(e) => setStyle((s) => { s.padding = setResp(s.padding, e.target.value || undefined); })}
            placeholder="16px" className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs">Margin ({device})</Label>
          <Input value={column.style?.margin?.[device] ?? ""}
            onChange={(e) => setStyle((s) => { s.margin = setResp(s.margin, e.target.value || undefined); })}
            placeholder="0" className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs">Border radius</Label>
          <Input value={column.style?.borderRadius ?? ""}
            onChange={(e) => setStyle((s) => { s.borderRadius = e.target.value || undefined; })}
            placeholder="8px" className="h-8 text-xs" />
        </div>
      </TabsContent>

      <TabsContent value="advanced" className="space-y-3 mt-3">
        <div>
          <Label className="text-xs">HTML ID</Label>
          <Input value={column.advanced?.htmlId ?? ""}
            onChange={(e) => setAdvanced((a) => { a.htmlId = e.target.value || undefined; })}
            className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs">CSS class</Label>
          <Input value={column.advanced?.cssClass ?? ""}
            onChange={(e) => setAdvanced((a) => { a.cssClass = e.target.value || undefined; })}
            className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs">Animacja wejścia</Label>
          <Select value={column.advanced?.animation ?? "none"}
            onValueChange={(v) => setAdvanced((a) => { a.animation = v as AdvancedSettings["animation"]; })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Brak</SelectItem>
              <SelectItem value="fade">Fade</SelectItem>
              <SelectItem value="slide-up">Slide up</SelectItem>
              <SelectItem value="zoom">Zoom</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Ukryj na</Label>
          {(["desktop","tablet","mobile"] as const).map((d) => (
            <label key={d} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={column.advanced?.hideOn?.[d] ?? false}
                onChange={(e) => setAdvanced((a) => { a.hideOn = { ...(a.hideOn ?? {}), [d]: e.target.checked }; })} />
              {d}
            </label>
          ))}
        </div>
      </TabsContent>
    </Tabs>
  );
}
