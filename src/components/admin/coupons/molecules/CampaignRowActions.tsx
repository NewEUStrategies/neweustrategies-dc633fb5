// Molekuła: przyciski akcji w wierszu listy kampanii.
//
// CO BYŁO W TRASIE. `admin.coupons.campaigns.tsx` (dawne 277-324) - trzy
// warunki na status rozsypane po komórce tabeli, oddalone od siebie o kilkanaście
// linii JSX-a. To tutaj mieszka reguła „która akcja dla którego statusu",
// a jej cichy rozjazd (np. „Wyślij" dla kampanii już wysłanej albo brak
// archiwizacji dla wersji roboczej) nie zostawia śladu ani w `tsc`, ani
// w recenzji.
//
// Reguła wyszła do `campaignActions(status)` w `@/lib/billing/couponCampaignForm`
// i jest przejechana tabelarycznie po czterech statusach; molekuła odpowiada
// wyłącznie za to, że KAŻDA zwrócona akcja ma swój przycisk i swoje zdarzenie.
//
// PRZENIESIONE ZNAK W ZNAK, RAZEM Z WADAMI:
//   * archiwizacja NIE PYTA o potwierdzenie (kasowanie kuponu na sąsiedniej
//     zakładce pyta przez `confirm()`), a jej przycisk jest samą ikoną
//     z angielskim `aria-label="archive"`;
//   * eksport CSV nie ma stanu oczekiwania - można go kliknąć dowolnie wiele
//     razy pod rząd, każde kliknięcie to osobne zapytanie o 10 000 wierszy.
import { Archive, Download, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { campaignActions, type CampaignStatus } from "@/lib/billing/couponCampaignForm";

export interface CampaignRowActionLabels {
  readonly generate: string;
  readonly csv: string;
  readonly send: string;
  readonly archive: string;
}

export function CampaignRowActions({
  status,
  generating,
  sending,
  onGenerate,
  onExport,
  onSend,
  onArchive,
  labels,
}: {
  status: CampaignStatus;
  generating: boolean;
  sending: boolean;
  onGenerate: () => void;
  onExport: () => void;
  onSend: () => void;
  onArchive: () => void;
  labels: CampaignRowActionLabels;
}) {
  const actions = campaignActions(status);
  return (
    <div className="inline-flex items-center gap-1 flex-wrap justify-end">
      {actions.includes("generate") && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 rounded-[6px]"
          onClick={onGenerate}
          disabled={generating}
        >
          {labels.generate}
        </Button>
      )}
      {actions.includes("export") && (
        <Button size="sm" variant="outline" className="h-8 rounded-[6px]" onClick={onExport}>
          <Download className="h-3.5 w-3.5 mr-1" />
          {labels.csv}
        </Button>
      )}
      {actions.includes("send") && (
        <Button size="sm" className="h-8 rounded-[6px]" onClick={onSend} disabled={sending}>
          <Send className="h-3.5 w-3.5 mr-1" />
          {labels.send}
        </Button>
      )}
      {actions.includes("archive") && (
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={onArchive}
          aria-label={labels.archive}
        >
          <Archive className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
