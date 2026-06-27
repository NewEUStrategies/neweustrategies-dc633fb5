import { createFileRoute } from "@tanstack/react-router";
import { SidebarBuilderPane } from "@/components/admin/sidebarBuilder/SidebarBuilderPane";

export const Route = createFileRoute("/admin/appearance/post-sidebar")({
  component: () => <SidebarBuilderPane />,
});
