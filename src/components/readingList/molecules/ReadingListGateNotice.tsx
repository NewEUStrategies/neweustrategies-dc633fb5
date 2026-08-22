// Wspólna „zaślepka" listy czytelniczej: personalizacja wyłączona globalnie
// ALBO gość bez trybu gościnnego.
//
// MOLEKUŁA o JEDNEJ odpowiedzialności: wyśrodkowana kolumna z nagłówkiem,
// zdaniem wyjaśniającym i OPCJONALNĄ akcją. Oba stany różnią się wyłącznie
// obecnością przycisku - dlatego jeden komponent, a nie dwie kopie tego układu.
//
// Odstęp pod akapitem pojawia się tylko wtedy, gdy pod nim COŚ jest; bez tego
// warunku stan „wyłączona personalizacja" dostałby wolne 24 px pod tekstem.
import type { ReactNode } from "react";

export function ReadingListGateNotice({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 max-w-2xl mx-auto px-4 py-20 text-center">
        <h1 className="font-display text-3xl mb-3">{title}</h1>
        <p className={action ? "text-muted-foreground mb-6" : "text-muted-foreground"}>{body}</p>
        {action}
      </div>
    </div>
  );
}
