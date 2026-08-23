// Molekuła: komórka „Kod” - kod kuponu, kopiowanie i znacznik kampanii.
//
// KOPIOWANIE WYCHODZI PROPEM, bo dziś toast „Skopiowano” leci SYNCHRONICZNIE,
// obok porzuconej obietnicy `navigator.clipboard.writeText` (`void ...`).
// Molekuła oddaje samo zdarzenie; decyzja o komunikacie należy do organizmu,
// który tę wadę na razie odtwarza w niezmienionej postaci.
import { Copy, Link2 } from "lucide-react";

interface CouponCodeCellProps {
  code: string;
  name: string | null;
  hasCampaign: boolean;
  copyLabel: string;
  campaignLabel: string;
  onCopy: (code: string) => void;
}

export function CouponCodeCell({
  code,
  name,
  hasCampaign,
  copyLabel,
  campaignLabel,
  onCopy,
}: CouponCodeCellProps) {
  return (
    <>
      <div className="flex items-center gap-2">
        <code className="font-mono font-semibold text-sm">{code}</code>
        <button
          type="button"
          aria-label={copyLabel}
          className="text-muted-foreground hover:text-foreground"
          onClick={() => onCopy(code)}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        {hasCampaign && <Link2 className="h-3.5 w-3.5 text-brand" aria-label={campaignLabel} />}
      </div>
      {name && <div className="text-xs text-muted-foreground">{name}</div>}
    </>
  );
}
