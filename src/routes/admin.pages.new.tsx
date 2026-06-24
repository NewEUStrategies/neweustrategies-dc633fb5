import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { createPage } from "@/lib/content.functions";
import { toast } from "sonner";
import { PatternPicker, type AppliedPattern } from "@/components/patterns/PatternPicker";

export const Route = createFileRoute("/admin/pages/new")({
  component: NewPage,
});

function NewPage() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const lang = (i18n.language ?? "pl").startsWith("pl") ? "pl" : "en";
  const { user, loading, tenantId } = useAuth();
  const create = useServerFn(createPage);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);

  const persist = async (payload: AppliedPattern | null): Promise<void> => {
    if (!user || !tenantId || busy) return;
    setBusy(true);
    try {
      if (payload && payload.kind === "page") {
        const { slug } = await create({
          data: {
            title_pl: payload.title_pl || undefined,
            title_en: payload.title_en || undefined,
            builder_data: payload.builder as unknown as Record<string, unknown>,
          },
        });
        navigate({ to: "/admin/pages/$slug", params: { slug }, replace: true });
        toast.success(lang === "pl" ? "Zastosowano szablon" : "Template applied");
      } else {
        const { slug } = await create({ data: {} });
        navigate({ to: "/admin/pages/$slug", params: { slug }, replace: true });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      navigate({ to: "/admin/pages" });
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground p-6">...</div>;
  }

  return (
    <>
      <div className="p-6 text-sm text-muted-foreground">
        {lang === "pl" ? "Wybierz szablon, aby kontynuować…" : "Pick a template to continue…"}
      </div>
      <PatternPicker
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v && !busy) navigate({ to: "/admin/pages" });
        }}
        kind="page"
        lang={lang}
        onSkip={() => void persist(null)}
        onApply={(applied) => void persist(applied)}
      />
    </>
  );
}
