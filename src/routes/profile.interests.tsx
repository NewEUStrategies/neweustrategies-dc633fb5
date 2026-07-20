import { createFileRoute } from "@tanstack/react-router";
import { InterestsCustomizer } from "@/components/interests/InterestsCustomizer";
import { ensureI18n as ensureInterestsI18n } from "@/lib/i18n-interests";
export const Route = createFileRoute("/profile/interests")({
  component: InterestsRoute,
  head: () => ({
    meta: [{ title: "Customize Interests" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function InterestsRoute() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureInterestsI18n();
  return (
    <div className="py-6">
      <InterestsCustomizer />
    </div>
  );
}
