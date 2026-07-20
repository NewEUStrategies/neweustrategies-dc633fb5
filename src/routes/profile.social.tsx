// Konsolidacja edycji tożsamości: slug, bio i linki mieszkają teraz w
// /profile/edit (zakładka "social"). Trasa zostaje jako przekierowanie,
// żeby stare linki, zakładki i notyfikacje nie umarły.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/profile/social")({
  beforeLoad: () => {
    throw redirect({ to: "/profile/edit", search: { tab: "social" }, replace: true });
  },
});
