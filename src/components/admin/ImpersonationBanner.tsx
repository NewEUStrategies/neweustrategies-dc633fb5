// Banner widoczny dla super_admina podczas trybu "Zaloguj jako".
// Renderowany na każdej publicznej stronie (SiteChrome) - hydration-safe.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getImpersonationState, stopImpersonation } from "@/lib/admin/impersonation";
import { useHasMounted } from "@/hooks/useHasMounted";

const COPY = {
  pl: { viewingAs: "Tryb superadmina - przegląd jako", exit: "Zakończ" },
  en: { viewingAs: "Super admin view - acting as", exit: "Exit" },
};

export function ImpersonationBanner() {
  const mounted = useHasMounted();
  const { i18n } = useTranslation();
  const lang = (i18n.language ?? "pl").startsWith("pl") ? "pl" : "en";
  const t = COPY[lang];
  const [state, setState] = useState(() => getImpersonationState());

  useEffect(() => {
    const tick = () => setState(getImpersonationState());
    const id = window.setInterval(tick, 1500);
    return () => window.clearInterval(id);
  }, []);

  if (!mounted || !state) return null;

  const onExit = async () => {
    await stopImpersonation();
    window.location.reload();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-[60] flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 shadow-sm"
    >
      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
      <span className="truncate">
        {t.viewingAs} <strong className="font-semibold">{state.targetLabel}</strong>
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1 border-amber-950/30 bg-white/80 text-amber-950 hover:bg-white"
        onClick={onExit}
      >
        <LogOut className="h-3.5 w-3.5" /> {t.exit}
      </Button>
    </div>
  );
}
