// Organism: Section Layout tab (content width, gap, height, align, html tag).
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
  SectionNode, SectionLayout, ContentWidth, ColumnsGap, SectionHeight,
  VerticalAlign, OverflowMode, HtmlTag,
} from "@/lib/builder/types";
import { Row, NumberInput } from "../../atoms";

type Mut = (mut: (s: SectionNode) => void) => void;
const ensure = <T extends object>(v: T | undefined): T => (v ?? ({} as T));

export function LayoutPane({ section, onChange }: { section: SectionNode; onChange: Mut }) {
  const L = section.layout ?? {};
  const setL = (mut: (l: SectionLayout) => void) => onChange((s) => { s.layout = ensure(s.layout); mut(s.layout!); });

  return (
    <>
      <Row label="Szerokość treści">
        <Select value={L.contentWidth ?? "boxed"} onValueChange={(v) => setL((l) => { l.contentWidth = v as ContentWidth; })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="boxed">Opakowane</SelectItem>
            <SelectItem value="full">Pełna szerokość</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      {(L.contentWidth ?? "boxed") === "boxed" && (
        <Row label="Szerokość (px)" hint="Domyślnie 1140">
          <NumberInput value={L.width} onChange={(n) => setL((l) => { l.width = n; })} min={300} max={1920} suffix="px" />
        </Row>
      )}

      <Row label="Odstęp kolumn">
        <Select value={L.columnsGap ?? "default"} onValueChange={(v) => setL((l) => { l.columnsGap = v as ColumnsGap; })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Domyślnie (20)</SelectItem>
            <SelectItem value="no">Bez odstępów (0)</SelectItem>
            <SelectItem value="narrow">Wąsko (10)</SelectItem>
            <SelectItem value="extended">Rozszerzony (15)</SelectItem>
            <SelectItem value="wide">Szeroki (30)</SelectItem>
            <SelectItem value="wider">Szerzej (40)</SelectItem>
            <SelectItem value="custom">Własne…</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      {L.columnsGap === "custom" && (
        <Row label="Własny odstęp (px)">
          <NumberInput value={L.columnsGapCustom} onChange={(n) => setL((l) => { l.columnsGapCustom = n; })} min={0} max={200} suffix="px" />
        </Row>
      )}

      <Row label="Wysokość">
        <Select value={L.height ?? "default"} onValueChange={(v) => setL((l) => { l.height = v as SectionHeight; })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Domyślnie</SelectItem>
            <SelectItem value="fit-screen">Dopasuj do ekranu</SelectItem>
            <SelectItem value="min-height">Minimalna wysokość</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      {L.height === "fit-screen" && (
        <Row label="Wysokość (vh)"><NumberInput value={L.heightValue} onChange={(n) => setL((l) => { l.heightValue = n; })} min={10} max={100} suffix="vh" /></Row>
      )}
      {L.height === "min-height" && (
        <Row label="Wysokość (px)"><NumberInput value={L.heightValue} onChange={(n) => setL((l) => { l.heightValue = n; })} min={40} max={2000} suffix="px" /></Row>
      )}

      <Row label="Wyrównanie pionowe">
        <Select value={L.verticalAlign ?? "default"} onValueChange={(v) => setL((l) => { l.verticalAlign = v as VerticalAlign; })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Domyślnie</SelectItem>
            <SelectItem value="top">Góra</SelectItem>
            <SelectItem value="middle">Środek</SelectItem>
            <SelectItem value="bottom">Dół</SelectItem>
            <SelectItem value="space-between">Odstęp pomiędzy</SelectItem>
            <SelectItem value="space-around">Odstęp wokół</SelectItem>
            <SelectItem value="space-evenly">Równomiernie</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label="Przepływ">
        <Select value={L.overflow ?? "default"} onValueChange={(v) => setL((l) => { l.overflow = v as OverflowMode; })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Domyślnie</SelectItem>
            <SelectItem value="hidden">Ukryty</SelectItem>
          </SelectContent>
        </Select>
      </Row>

      <Row label="Sekcja rozciągania" hint="Rozciąga sekcję na pełną szerokość okna (100vw).">
        <Switch checked={!!L.stretch} onCheckedChange={(v) => setL((l) => { l.stretch = v; })} />
      </Row>

      <Row label="Znacznik HTML">
        <Select value={L.htmlTag ?? "section"} onValueChange={(v) => setL((l) => { l.htmlTag = v as HtmlTag; })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(["div","section","header","footer","main","article","aside","nav"] as const).map((t) =>
              <SelectItem key={t} value={t}>{t}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </Row>
    </>
  );
}
