import { createFileRoute } from "@tanstack/react-router";
import { InterestsCustomizer } from "@/components/interests/InterestsCustomizer";
import "@/lib/i18n-interests";

export const Route = createFileRoute("/profile/interests")({
  component: InterestsRoute,
  head: () => ({
    meta: [{ title: "Customize Interests" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function InterestsRoute() {
  return (
    <div className="py-6">
      <InterestsCustomizer />
    </div>
  );
}
