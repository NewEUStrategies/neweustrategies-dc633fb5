import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { createPost } from "@/lib/content.functions";
import { shouldStartPostCreation } from "@/components/admin/post-editor/lib/postRouteParams";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/posts/new")({
  component: NewPost,
});

function NewPost() {
  const navigate = useNavigate();
  const { user, loading, tenantId } = useAuth();
  const create = useServerFn(createPost);
  const [busy, setBusy] = useState(false);
  // React StrictMode uruchamia setup efektu dwukrotnie w dev. Stan `busy`
  // aktualizuje się dopiero w kolejnym renderze, więc sam nie chroni przed
  // dwoma równoległymi POST-ami. Ref jest synchronicznym single-flight lockiem
  // (regułę trzyma `shouldStartPostCreation`).
  const createStartedRef = useRef(false);

  useEffect(() => {
    if (
      !shouldStartPostCreation({
        loading,
        busy,
        user,
        tenantId,
        alreadyStarted: createStartedRef.current,
      })
    ) {
      return;
    }
    createStartedRef.current = true;
    setBusy(true);
    (async () => {
      try {
        const { slug } = await create({ data: {} });
        navigate({ to: "/admin/posts/$slug", params: { slug }, replace: true });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
        navigate({ to: "/admin/posts" });
      }
    })();
  }, [user, tenantId, loading, busy, navigate, create]);

  return <div className="text-sm text-muted-foreground">...</div>;
}
