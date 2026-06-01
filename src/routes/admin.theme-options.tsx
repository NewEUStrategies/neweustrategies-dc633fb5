import { createFileRoute } from "@tanstack/react-router";
import { ThemeOptionsPane } from "@/components/admin/ThemeOptionsPane";

export const Route = createFileRoute("/admin/theme-options")({
  component: () => <ThemeOptionsPane />,
});
