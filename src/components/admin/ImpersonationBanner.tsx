// Banner widoczny dla super_admina podczas trybu "Zaloguj jako".
// Renderowany na każdej publicznej stronie (SiteChrome) - hydration-safe.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getImpersonationState, stopImpersonation } from "@/lib/admin/impersonation";
import { useHasMounted } from "@/hooks/useHasMounted";
import { useAuth } from "@/hooks/useAuth";

const COPY = {
  pl: { viewingAs: "Tryb superadmina - przegląd jako", exit: "Zakończ" },
  en: { viewingAs: "Super admin view - acting as", exit: "Exit" },
};

export function ImpersonationBanner() {
  const mounted = useHasMounted();
  // Baner jedzie w SiteChrome, czyli na KAŻDEJ stronie publicznej - także dla
  // anonima, który trybu podszywania nie zobaczy nigdy. Odpytywanie zostaje
  // więc tylko dla personelu (F38: zero timerów dla czytelnika).
  const { isStaff } = useAuth();
  const { i18n } = useTranslation();
  const lang = (i18n.language ?? "pl").startsWith("pl") ? "pl" : "en";
  const t = COPY[lang];
  const [state, setState] = useState(() => getImpersonationState());

  useEffect(() => {
    const read = () => setState(getImpersonationState());
    // ŚCIEŻKA GŁÓWNA to odczyt przy montażu: i start (`impersonateUser` ->
    // `location.assign("/profile")`), i wyjście (`stopImpersonation` ->
    // `location.reload()`) przeładowują dokument, więc baner i tak montuje się
    // od nowa. `storage` łapie zmianę z innego dokumentu tego samego magazynu,
    // `visibilitychange` - powrót do karty. Oba są zdarzeniami, nie timerem.
    read();
    window.addEventListener("storage", read);
    document.addEventListener("visibilitychange", read);
    return () => {
      window.removeEventListener("storage", read);
      document.removeEventListener("visibilitychange", read);
    };
  }, []);

  useEffect(() => {
    // Odpytywanie cykliczne zostaje WYŁĄCZNIE dla personelu: stan siedzi w
    // `sessionStorage` (per karta), więc zapis spoza Reacta w TEJ karcie nie
    // emituje żadnego zdarzenia. Moduł zapisu (`lib/admin/impersonation`) nie
    // wysyła własnego CustomEventu; dopóki go nie wyśle, interwał jest jedyną
    // siatką bezpieczeństwa - i płaci za nią tylko ten, kto może podszywać.
    if (!isStaff) return;
    const id = window.setInterval(() => setState(getImpersonationState()), 1500);
    return () => window.clearInterval(id);
  }, [isStaff]);

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
