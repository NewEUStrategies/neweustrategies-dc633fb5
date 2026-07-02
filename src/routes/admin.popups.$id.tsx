import { createFileRoute } from "@tanstack/react-router";
import { PopupEditorPane } from "@/components/admin/popups/PopupEditorPane";

export const Route = createFileRoute("/admin/popups/$id")({
  component: PopupEditorRoute,
});

function PopupEditorRoute() {
  const { id } = Route.useParams();
  return <PopupEditorPane popupId={id} />;
}
