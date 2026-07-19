// Organism: Section properties orchestrator (Layout / Style / Tabs / Advanced tabs).
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { SectionNode, Device } from "@/lib/builder/types";
import { LayoutPane } from "./LayoutPane";
import { StylePane } from "./StylePane";
import { AdvancedPane } from "./AdvancedPane";
import { TabsPane } from "./TabsPane";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface Props {
  section: SectionNode;
  device: Device;
  onChange: (mut: (s: SectionNode) => void) => void;
}

export function SectionProperties({ section, device, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <Tabs defaultValue="layout">
      <TabsList className="grid grid-cols-4 w-full h-8">
        <TabsTrigger value="layout" className="text-xs">
          {t("builder.columnProps.tabLayout")}
        </TabsTrigger>
        <TabsTrigger value="style" className="text-xs">
          {t("builder.columnProps.tabStyle")}
        </TabsTrigger>
        <TabsTrigger value="tabs" className="text-xs">
          {t("builder.sectionProps.tabTabs")}
        </TabsTrigger>
        <TabsTrigger value="advanced" className="text-xs">
          {t("builder.columnProps.tabAdvanced")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="layout" className="space-y-3 mt-3">
        <LayoutPane section={section} onChange={onChange} />
      </TabsContent>

      <TabsContent value="style" className="space-y-4 mt-3">
        <div className="text-[10px] text-muted-foreground uppercase">
          {t("builder.columnProps.editing", { device })}
        </div>
        <StylePane section={section} device={device} onChange={onChange} />
      </TabsContent>

      <TabsContent value="tabs" className="space-y-3 mt-3">
        <TabsPane section={section} onChange={onChange} />
      </TabsContent>

      <TabsContent value="advanced" className="space-y-3 mt-3">
        <AdvancedPane section={section} onChange={onChange} />
      </TabsContent>
    </Tabs>
  );
}
