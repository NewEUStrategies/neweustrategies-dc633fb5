import { createFileRoute } from "@tanstack/react-router";
import { ThemeOptionsPane } from "@/components/admin/ThemeOptionsPane";
import { DesignSubNav } from "@/components/admin/DesignSubNav";

export const Route = createFileRoute("/admin/theme-options")({
  component: () => (
    <>
      <DesignSubNav />
      <ThemeOptionsPane />
    </>
  ),
});
