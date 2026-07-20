// Konsolidacja edycji tożsamości: dane podstawowe mieszkają teraz w
// /profile/edit (zakładka "basic"). Trasa zostaje jako przekierowanie,
// żeby stare linki, zakładki i notyfikacje nie umarły.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/profile/account")({
  beforeLoad: () => {
    throw redirect({ to: "/profile/edit", replace: true });
  },
});
