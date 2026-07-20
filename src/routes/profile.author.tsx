// Konsolidacja edycji tożsamości: profil eksperta mieszka teraz w
// /profile/edit (zakładka "expert"). Trasa zostaje jako przekierowanie,
// żeby stare linki, zakładki i notyfikacje nie umarły.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/profile/author")({
  beforeLoad: () => {
    throw redirect({ to: "/profile/edit", search: { tab: "expert" }, replace: true });
  },
});
