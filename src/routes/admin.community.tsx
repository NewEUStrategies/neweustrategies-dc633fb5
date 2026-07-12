// Layout /admin/community — hosts sub-nav + Outlet dla Chat / Events / Q&A.
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { CommunitySubNav } from "@/components/admin/community/CommunitySubNav";

export const Route = createFileRoute("/admin/community")({
  head: () => ({
    meta: [{ title: "Community · Admin" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: CommunityLayout,
});

function CommunityLayout() {
  return (
    <div className="space-y-4">
      <CommunitySubNav />
      <Outlet />
    </div>
  );
}
