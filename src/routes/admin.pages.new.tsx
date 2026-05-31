import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/pages/new")({
  component: NewPage,
});

function NewPage() {
  const navigate = useNavigate();
  const { user, loading, tenantId } = useAuth();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || busy || !user || !tenantId) return;
    setBusy(true);
    (async () => {
      const slug = `page-${Date.now().toString(36)}`;
      const { data, error } = await supabase
        .from("pages")
        .insert({ slug, author_id: user.id, tenant_id: tenantId, title_pl: "", title_en: "" })
        .select("id")
        .single();
      if (error) {
        toast.error(error.message);
        navigate({ to: "/admin/pages" });
      } else {
        navigate({ to: "/admin/pages/$id", params: { id: data.id }, replace: true });
      }
    })();
  }, [user, tenantId, loading, busy, navigate]);

  return <div className="text-sm text-muted-foreground">...</div>;
}
