import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { createPost } from "@/lib/content.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/posts/new")({
  component: NewPost,
});

function NewPost() {
  const navigate = useNavigate();
  const { user, loading, tenantId } = useAuth();
  const create = useServerFn(createPost);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || busy || !user || !tenantId) return;
    setBusy(true);
    (async () => {
      try {
        const { id } = await create({ data: {} });
        navigate({ to: "/admin/posts/$id", params: { id }, replace: true });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
        navigate({ to: "/admin/posts" });
      }
    })();
  }, [user, tenantId, loading, busy, navigate, create]);

  return <div className="text-sm text-muted-foreground">...</div>;
}
