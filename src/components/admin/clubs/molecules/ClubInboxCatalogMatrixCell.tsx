// Molekuła: JEDNA komórka macierzy uprawnień - „wolno / zależy / nie wolno”.
//
// CO BYŁO W ORGANIZMIE. Lokalna `MatrixCell` w `ClubElementsCatalog`: trzy
// gałęzie `if` z niemal identycznym blokiem JSX, w pliku na 859 linii.
//
// DLACZEGO KAŻDA KOMÓRKA MA TEKST DLA CZYTNIKA EKRANU. Macierz ma siedem
// kolumn ról i dziewięć wierszy zdolności; sam piktogram nie mówi nic bez
// koloru, a kolor nie mówi nic czytnikowi ekranu. Bez `sr-only` cała tabela
// jest dla niego pustą siatką - a to jest dokument, z którego pisze się SQL-a.
// `title` zostaje dla myszy, `sr-only` dla czytnika: dwie różne drogi do tej
// samej legendy.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać jedną wartość macierzy. Skąd ta wartość się
// bierze, wie `capabilityValue` w `capabilityMatrix` - i to tam, a nie tutaj,
// jest zapisane, że macierz jest DOKUMENTACJĄ zachowania bazy, a nie jego
// źródłem.
import { useTranslation } from "react-i18next";
import { Check, Minus, Settings2 } from "lucide-react";
import type { CapabilityValue } from "@/lib/clubs/capabilityMatrix";

const CELL: Record<
  CapabilityValue,
  { readonly Icon: typeof Check; readonly className: string; readonly legendKey: string }
> = {
  yes: {
    Icon: Check,
    className: "size-4 text-emerald-600 dark:text-emerald-400",
    legendKey: "clubElements.matrix.legendYes",
  },
  cond: {
    Icon: Settings2,
    className: "size-4 text-amber-600 dark:text-amber-400",
    legendKey: "clubElements.matrix.legendCond",
  },
  no: {
    Icon: Minus,
    className: "size-4 text-muted-foreground/60",
    legendKey: "clubElements.matrix.legendNo",
  },
};

export function ClubInboxCatalogMatrixCell({ value }: { value: CapabilityValue }) {
  const { t } = useTranslation();
  const { Icon, className, legendKey } = CELL[value];
  const legend = t(legendKey);
  return (
    <span className="inline-flex" title={legend}>
      <Icon className={className} />
      <span className="sr-only">{legend}</span>
    </span>
  );
}
