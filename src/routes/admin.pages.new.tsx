import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { createPage } from "@/lib/content.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/pages/new")({
  component: NewPage,
});

function NewPage() {
  const navigate = useNavigate();
  const { user, loading, tenantId } = useAuth();
  const create = useServerFn(createPage);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || busy || !user || !tenantId) return;
    setBusy(true);
    (async () => {
      try {
        const { slug } = await create({ data: {} });
        navigate({ to: "/admin/pages/$slug", params: { slug }, replace: true });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
        navigate({ to: "/admin/pages" });
      }
    })();
  }, [user, tenantId, loading, busy, navigate, create]);

  return <div className="text-sm text-muted-foreground">...</div>;
}
