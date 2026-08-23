// Molekuła: pasek filtrów historii realizacji - zakres dat + eksport CSV.
//
// CO BYŁO W TRASIE. `admin.coupons.redemptions.tsx` (dawne 101-110).
//
// DLACZEGO EKSPORT JEST TUTAJ, A ZAPIS PLIKU NIE. Przycisk eksportu stoi
// w jednym rzędzie z filtrami, bo eksportuje DOKŁADNIE TO, co widać po
// filtrach - i to jest decyzja produktowa (arkusz jest obcięty tym samym
// `limit(500)`, co ekran). Samo pobranie pliku (Blob, adres obiektowy,
// kotwica) zostaje u wołającego: to trzy API przeglądarki, których molekuła nie
// ma prawa znać.
//
// PRZENIESIONE ZNAK W ZNAK: eksport jest zawsze klikalny, także gdy tabela jest
// pusta (powstaje wtedy plik z samym nagłówkiem) i nie melduje niczego - żadnego
// toastu, w przeciwieństwie do eksportu kodów kampanii.
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CouponDateRangeFields } from "@/components/admin/coupons/molecules/CouponDateRangeFields";

export function RedemptionsFilterBar({
  from,
  to,
  onFrom,
  onTo,
  onExport,
  fromLabel,
  toLabel,
  exportLabel,
}: {
  from: Date | undefined;
  to: Date | undefined;
  onFrom: (value: Date | undefined) => void;
  onTo: (value: Date | undefined) => void;
  onExport: () => void;
  fromLabel: string;
  toLabel: string;
  exportLabel: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap">
      <div className="grid grid-cols-2 gap-3 w-full max-w-md">
        <CouponDateRangeFields
          from={from}
          to={to}
          onFrom={onFrom}
          onTo={onTo}
          fromLabel={fromLabel}
          toLabel={toLabel}
        />
      </div>
      <Button variant="outline" className="h-10 rounded-[6px]" onClick={onExport}>
        <Download className="h-4 w-4 mr-2" />
        {exportLabel}
      </Button>
    </div>
  );
}
