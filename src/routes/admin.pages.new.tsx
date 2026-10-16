import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { adminPageHead } from "@/lib/adminPageHead";
import { useAuth } from "@/hooks/useAuth";
import { createPage } from "@/lib/content.functions";
import { toast } from "sonner";
import { PatternPicker, type AppliedPattern } from "@/components/patterns/PatternPicker";

export const Route = createFileRoute("/admin/pages/new")({
  head: () =>
    adminPageHead(
      "New page",
      "Create a page from a template or a blank canvas. New European Strategies administration.",
    ),
  component: NewPage,
});

function NewPage() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const lang = (i18n.language ?? "pl").startsWith("pl") ? "pl" : "en";
  const { user, loading, tenantId } = useAuth();
  const create = useServerFn(createPage);
  // Ref, nie stan: PatternPicker woła `onOpenChange(false)` i `onSkip`/`onApply`
  // w JEDNYM handlerze kliknięcia, więc `busy` ze stanu byłby tam zawsze
  // wartością z poprzedniego renderu (fałsz) - zamknięcie okna wysyłało wtedy
  // redaktora na listę w trakcie tworzenia strony.
  const busyRef = useRef(false);
  const [open, setOpen] = useState(true);

  const persist = async (payload: AppliedPattern | null): Promise<void> => {
    if (!user || !tenantId || busyRef.current) return;
    busyRef.current = true;
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
          if (v) return;
          // Zamknięcie okna znaczy „wróć na listę" TYLKO wtedy, gdy nie ruszyło
          // tworzenie. PatternPicker zamyka okno PRZED `onSkip` i PO `onApply`
          // (ten sam handler), więc decyzja zapada po jego zakończeniu.
          // Kontrakt: para zamknięcie + wybór musi zostać w JEDNYM synchronicznym
          // handlerze PatternPickera (bez `await` pomiędzy) - pilnuje tego test
          // z prawdziwym PatternPickerem w adminPagesNewRoute.test.tsx.
          queueMicrotask(() => {
            if (!busyRef.current) navigate({ to: "/admin/pages" });
          });
        }}
        kind="page"
        lang={lang}
        onSkip={() => void persist(null)}
        onApply={(applied) => void persist(applied)}
      />
    </>
  );
}
