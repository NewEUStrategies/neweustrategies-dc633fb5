// Trasa panelu konfiguracji silnika rekomendacji.
//
// Plik trasy trzyma WYŁĄCZNIE rejestrację, granice błędu i kompozycję
// organizmu - treść panelu mieszka w `components/admin/postExperience`,
// a reguły w `lib/relatedPosts/panelRules` oraz `lib/admin/panelDraft`.
import { createFileRoute } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import {
  RelatedPostsNotFound,
  RelatedPostsSettingsPanel,
} from "@/components/admin/postExperience/organisms/RelatedPostsSettingsPanel";

export const Route = createFileRoute("/admin/related-posts")({
  component: RelatedPostsSettingsPanel,
  notFoundComponent: () => <RelatedPostsNotFound />,
  errorComponent: (props) => <RouteErrorFallback {...props} variant="admin" />,
});
