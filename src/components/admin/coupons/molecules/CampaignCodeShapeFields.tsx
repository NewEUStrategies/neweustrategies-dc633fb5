// Molekuła: kształt generowanych kodów - prefiks, długość, liczba sztuk.
//
// CO BYŁO W TRASIE. `admin.coupons.campaigns.tsx` (dawne 411-443).
//
// PRZENIESIONE ZNAK W ZNAK, RAZEM Z WADĄ, KTÓRA JEST TU CAŁYM SENSEM TESTU.
// Stan długości i liczby kodów jest LICZBOWY, a pisarzem jest
// `Number(e.target.value)`, więc:
//   * wyczyszczenie pola daje 0 (`Number("") === 0`), a nie „brak wartości";
//   * wartość nieliczbowa daje NaN, które po `JSON.stringify` staje się `null`.
// Baza ma na to CHECK-i (`code_count > 0 AND <= 10000`, `code_length BETWEEN
// 4 AND 24`), więc panel wysyła żądanie skazane na odmowę, a operator dostaje
// surowy komunikat Postgresa zamiast wskazania pola. Atrybuty `min`/`max` nie
// bronią niczego - to podpowiedź przeglądarki, nie walidacja formularza.
// Defekt jest zgłoszony przez `it.fails`, a nie naprawiony w ekstrakcji.
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface CampaignCodeShapeLabels {
  readonly prefix: string;
  readonly codeLength: string;
  readonly codeCount: string;
}

export function CampaignCodeShapeFields({
  prefix,
  onPrefix,
  codeLength,
  onCodeLength,
  codeCount,
  onCodeCount,
  labels,
}: {
  prefix: string;
  onPrefix: (value: string) => void;
  codeLength: number;
  onCodeLength: (value: number) => void;
  codeCount: number;
  onCodeCount: (value: number) => void;
  labels: CampaignCodeShapeLabels;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div>
        <Label htmlFor="campaign-prefix">{labels.prefix}</Label>
        <Input
          id="campaign-prefix"
          value={prefix}
          onChange={(e) => onPrefix(e.target.value.toUpperCase())}
          placeholder="NES-"
          className="h-10 rounded-[6px] uppercase"
        />
      </div>
      <div>
        <Label htmlFor="campaign-code-length">{labels.codeLength}</Label>
        <Input
          id="campaign-code-length"
          type="number"
          min={4}
          max={24}
          value={codeLength}
          onChange={(e) => onCodeLength(Number(e.target.value))}
          className="h-10 rounded-[6px]"
        />
      </div>
      <div>
        <Label htmlFor="campaign-code-count">{labels.codeCount}</Label>
        <Input
          id="campaign-code-count"
          type="number"
          min={1}
          max={10000}
          value={codeCount}
          onChange={(e) => onCodeCount(Number(e.target.value))}
          className="h-10 rounded-[6px]"
        />
      </div>
    </div>
  );
}
