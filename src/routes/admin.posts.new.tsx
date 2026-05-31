import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth, useRequiredTenant } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/posts/new")({
  component: NewPost,
});

function NewPost() {
  const navigate = useNavigate();
  const { user, loading, tenantId } = useAuth();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || busy || !user || !tenantId) return;
    setBusy(true);
    (async () => {
      const slug = `post-${Date.now().toString(36)}`;
      const { data, error } = await supabase
        .from("posts")
        .insert({ slug, author_id: user.id, tenant_id: tenantId, title_pl: "", title_en: "" })
        .select("id")
        .single();
      if (error) {
        toast.error(error.message);
        navigate({ to: "/admin/posts" });
      } else {
        navigate({ to: "/admin/posts/$id", params: { id: data.id }, replace: true });
      }
    })();
  }, [user, tenantId, loading, busy, navigate]);

  // touch useRequiredTenant to make intent explicit at type level
  void useRequiredTenant;

  return <div className="text-sm text-muted-foreground">...</div>;
}
