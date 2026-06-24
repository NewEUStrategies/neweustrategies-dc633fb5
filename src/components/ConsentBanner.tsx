// Minimalny baner zgody marketingowej (RODO). Pojawia się na dole strony,
// gdy użytkownik jeszcze nie zdecydował. Można go rozbudować o pełny CMP.
import { Button } from "@/components/ui/button";
import { useMarketingConsent } from "@/lib/ads/consent";

export function ConsentBanner() {
  const { decided, grant, deny } = useMarketingConsent();
  if (decided) return null;
  return (
    <div
      role="dialog"
      aria-label="Zgoda marketingowa"
      className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-3xl rounded-lg border border-border bg-card text-card-foreground shadow-lg p-4 sm:p-5"
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <p className="text-sm leading-relaxed flex-1">
          Używamy plików cookie do wyświetlania reklam i analizy ruchu. Możesz zaakceptować lub odrzucić — wybór można zmienić w stopce.
        </p>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={deny}>Odrzuć</Button>
          <Button size="sm" onClick={grant}>Akceptuję</Button>
        </div>
      </div>
    </div>
  );
}
