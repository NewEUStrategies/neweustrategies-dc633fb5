import { createFileRoute } from "@tanstack/react-router";
import { ArchiveLayoutAdmin } from "@/components/admin/archiveLayout/ArchiveLayoutAdmin";

export const Route = createFileRoute("/admin/appearance/category-archive")({
  component: () => <ArchiveLayoutAdmin archiveType="category" />,
});
