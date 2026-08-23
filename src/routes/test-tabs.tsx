import { createFileRoute } from "@tanstack/react-router";
import { SectionTabsBar } from "@/components/builder/molecules/SectionTabsBar";
import type { SectionTabsConfig } from "@/lib/builder/types";

const demoTabs: SectionTabsConfig = {
  enabled: true,
  orientation: "horizontal",
  variant: "underline",
  align: "start",
  fontSize: 14,
  iconPosition: "top",
  iconSize: 24,
  items: [
    { id: "m1", label_pl: "Misja", icon: "rocket" },
    { id: "m2", label_pl: "Globalne wyzwania", icon: "globe" },
    { id: "m3", label_pl: "Talenty", icon: "users" },
  ],
  defaultTabId: "m1",
};

const demoTabs2: SectionTabsConfig = {
  enabled: true,
  orientation: "horizontal",
  variant: "underline",
  align: "start",
  fontSize: 14,
  iconPosition: "top",
  iconSize: 24,
  items: [
    { id: "r1", label_pl: "Geopolityka i wojskowość", icon: "shield" },
    { id: "r2", label_pl: "Finanse i gospodarka", icon: "landmark" },
    { id: "r3", label_pl: "Dyplomacja i stosunki międzynarodowe", icon: "handshake" },
    { id: "r4", label_pl: "Transport i energetyka", icon: "truck" },
    { id: "r5", label_pl: "Technologia i cyberbezpieczeństwo", icon: "cpu" },
  ],
  defaultTabId: "r1",
};

export const Route = createFileRoute("/test-tabs")({
  component: () => (
    <div className="p-4" data-builder-renderer data-device="mobile">
      <h2 className="mb-4 text-lg font-bold">Poznaj nas bliżej</h2>
      <SectionTabsBar
        sectionId="demo1"
        tabs={demoTabs}
        lang="pl"
        activeId="m1"
        onSelect={() => {}}
      />
      <h2 className="mt-8 mb-4 text-lg font-bold">Rady Programowe</h2>
      <SectionTabsBar
        sectionId="demo2"
        tabs={demoTabs2}
        lang="pl"
        activeId="r1"
        onSelect={() => {}}
      />
    </div>
  ),
});
