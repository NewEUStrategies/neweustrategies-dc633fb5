// Molekuła: co kampania NADAJE - warstwa subskrypcji i liczba dni.
//
// CO BYŁO W TRASIE. `admin.coupons.campaigns.tsx` (dawne 501-532).
//
// DLACZEGO TO JEST DECYZJA PIENIĘŻNA. Wybór warstwy i liczby dni jest jedynym
// miejscem w panelu, z którego kupon rozdaje SUBSKRYPCJĘ. Pole dni jest tylko
// `disabled={!tierKey}`, więc jego stan PRZEŻYWA powrót do „brak warstwy" -
// blokada dotyczy klawiatury, nie pamięci formularza. W kampanii ratuje to
// dopiero bramka w ładunku (`durationDays && tierKey`), której bliźniaczy
// formularz pojedynczego kuponu NIE MA. Dowód tej różnicy stoi w testach
// `couponCampaignForm`.
//
// PRZENIESIONE ZNAK W ZNAK: molekuła NIE czyści `durationDays` przy wyborze
// „brak" i nie zna wartości domyślnej - obie decyzje zostają u wołającego.
// Pozycja „brak" ma wartość sentinel `"none"`, bo Radix `Select` nie przyjmuje
// pustego stringa jako wartości pozycji.
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Warstwa członkostwa w kształcie, w jakim czyta ją lista wyboru. */
export interface CampaignTierOption {
  readonly key: string;
  readonly label: string;
}

export interface CampaignGrantsLabels {
  readonly grantsSubscription: string;
  readonly none: string;
  readonly durationDays: string;
}

export function CampaignGrantsFields({
  tiers,
  tierKey,
  onTierKey,
  durationDays,
  onDurationDays,
  labels,
}: {
  tiers: readonly CampaignTierOption[];
  tierKey: string;
  /** Pusty string znaczy „brak warstwy" - pozycja `none` jest tłumaczona tutaj. */
  onTierKey: (value: string) => void;
  durationDays: string;
  onDurationDays: (value: string) => void;
  labels: CampaignGrantsLabels;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/60">
      <div>
        <Label>{labels.grantsSubscription}</Label>
        <Select value={tierKey || "none"} onValueChange={(v) => onTierKey(v === "none" ? "" : v)}>
          <SelectTrigger className="h-10 rounded-[6px]">
            <SelectValue placeholder={labels.none} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{labels.none}</SelectItem>
            {tiers.map((tier) => (
              <SelectItem key={tier.key} value={tier.key}>
                {tier.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="campaign-duration-days">{labels.durationDays}</Label>
        <Input
          id="campaign-duration-days"
          type="number"
          min={1}
          value={durationDays}
          onChange={(e) => onDurationDays(e.target.value)}
          disabled={!tierKey}
          className="h-10 rounded-[6px]"
        />
      </div>
    </div>
  );
}
