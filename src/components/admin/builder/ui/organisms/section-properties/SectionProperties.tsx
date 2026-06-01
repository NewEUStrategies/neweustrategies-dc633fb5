// Organism: Section properties orchestrator (Layout / Style / Advanced tabs).
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { SectionNode, Device } from "@/lib/builder/types";
import { LayoutPane } from "./LayoutPane";
import { StylePane } from "./StylePane";
import { AdvancedPane } from "./AdvancedPane";

interface Props {
  section: SectionNode;
  device: Device;
  onChange: (mut: (s: SectionNode) => void) => void;
}

export function SectionProperties({ section, device, onChange }: Props) {
  return (
    <Tabs defaultValue="layout">
      <TabsList className="grid grid-cols-3 w-full h-8">
        <TabsTrigger value="layout" className="text-xs">Układ</TabsTrigger>
        <TabsTrigger value="style" className="text-xs">Styl</TabsTrigger>
        <TabsTrigger value="advanced" className="text-xs">Zaawans.</TabsTrigger>
      </TabsList>

      <TabsContent value="layout" className="space-y-3 mt-3">
        <LayoutPane section={section} onChange={onChange} />
      </TabsContent>

      <TabsContent value="style" className="space-y-4 mt-3">
        <div className="text-[10px] text-muted-foreground uppercase">Edytujesz: {device}</div>
        <StylePane section={section} device={device} onChange={onChange} />
      </TabsContent>

      <TabsContent value="advanced" className="space-y-3 mt-3">
        <AdvancedPane section={section} onChange={onChange} />
      </TabsContent>
    </Tabs>
  );
}
