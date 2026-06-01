// Organism: Section Style tab (background, overlay, border, shape dividers, typography).
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { SectionNode, Device } from "@/lib/builder/types";
import { CollapsibleDetails as Collapsible } from "../../atoms";
import {
  BackgroundEditor, OverlayEditor, BorderEditor, ShapeEditor, TypographyEditor,
} from "../../molecules";

type Mut = (mut: (s: SectionNode) => void) => void;
const ensure = <T extends object>(v: T | undefined): T => (v ?? ({} as T));

export function StylePane({ section, device, onChange }: { section: SectionNode; device: Device; onChange: Mut }) {
  return (
    <div className="space-y-5">
      <Collapsible title="Tło">
        <Tabs defaultValue="normal">
          <TabsList className="grid grid-cols-2 w-full h-7">
            <TabsTrigger value="normal" className="text-xs">Normalne</TabsTrigger>
            <TabsTrigger value="hover" className="text-xs">Najechanie</TabsTrigger>
          </TabsList>
          <TabsContent value="normal" className="mt-2 space-y-3">
            <BackgroundEditor
              value={section.background}
              onChange={(mut) => onChange((s) => { s.background = ensure(s.background); mut(s.background!); })}
            />
          </TabsContent>
          <TabsContent value="hover" className="mt-2 space-y-3">
            <BackgroundEditor
              value={section.backgroundHover}
              onChange={(mut) => onChange((s) => { s.backgroundHover = ensure(s.backgroundHover); mut(s.backgroundHover!); })}
            />
          </TabsContent>
        </Tabs>
      </Collapsible>

      <Collapsible title="Nakładka tła">
        <OverlayEditor
          value={section.overlay}
          onChange={(mut) => onChange((s) => { s.overlay = ensure(s.overlay); mut(s.overlay!); })}
        />
      </Collapsible>

      <Collapsible title="Obramowanie">
        <BorderEditor
          value={section.border}
          onChange={(mut) => onChange((s) => { s.border = ensure(s.border); mut(s.border!); })}
        />
      </Collapsible>

      <Collapsible title="Kształt rozdzielacza · góra">
        <ShapeEditor
          value={section.shapeDividerTop}
          onChange={(mut) => onChange((s) => { s.shapeDividerTop = ensure(s.shapeDividerTop); mut(s.shapeDividerTop!); })}
        />
      </Collapsible>
      <Collapsible title="Kształt rozdzielacza · dół">
        <ShapeEditor
          value={section.shapeDividerBottom}
          onChange={(mut) => onChange((s) => { s.shapeDividerBottom = ensure(s.shapeDividerBottom); mut(s.shapeDividerBottom!); })}
        />
      </Collapsible>

      <Collapsible title="Typografia">
        <TypographyEditor
          value={section.typography}
          device={device}
          onChange={(mut) => onChange((s) => { s.typography = ensure(s.typography); mut(s.typography!); })}
        />
      </Collapsible>
    </div>
  );
}
