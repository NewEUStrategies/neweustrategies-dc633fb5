import { createFileRoute } from "@tanstack/react-router";
import { MediaManager } from "@/components/admin/media/MediaManager";

export const Route = createFileRoute("/admin/media")({
  component: MediaManager,
});
