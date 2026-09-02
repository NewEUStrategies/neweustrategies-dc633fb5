// Model tarczy kołowej: co rysuje wykres, jakim slotem palety i z jakiego
// mianownika liczy udziały. Osobny moduł, bo z tego samego modelu korzystają
// TRZY drogi do tych samych liczb - grafika (PieChart), legenda i tabela
// danych (Chart) - a rozjazd między nimi jest defektem samym w sobie.
import type { ChartConfig } from "@/lib/charts/types";
import { MAX_SERIES } from "@/lib/charts/types";
import type { ChartLang } from "@/lib/charts/format";

const L = {
  pl: { other: "Pozostałe" },
  en: { other: "Other" },
} as const;

export interface PieSlice {
  label: string;
  value: number;
  share: number;
  colorSlot: number;
  startAngle: number;
  endAngle: number;
}

export interface PieModel {
  /** Wycinki w kolejności kategorii - najwyżej MAX_SERIES. */
  slices: PieSlice[];
  /** Mianownik udziału: suma DODATNICH. */
  total: number;
}

/**
 * Model tarczy: co się rysuje, jakim slotem palety i z jakiego mianownika.
 * JEDNA funkcja dla grafiki, legendy i tabeli danych - inaczej alternatywa
 * tekstowa liczy udziały z innej sumy niż kąty.
 *
 * Mianownikiem jest suma DODATNICH, bo kąt nie umie zakodować wartości
 * ujemnej ani luki. Rozstrzygnięcie na korzyść grafiki, nie tabeli: udział
 * liczony z sumy o mieszanych znakach nie jest udziałem niczego widzialnego -
 * dla zestawu [-10, 100] tabela podawała "111%" i "-11,1%" przy tarczy
 * pokazującej jeden wycinek 100%, a udział poza zakresem 0..100% jest
 * w kolumnie udziałów bełkotem. Wartości, których tarcza nie rysuje,
 * zajmują na niej 0%; ich liczby niesie kolumna wartości, więc nic nie ginie.
 *
 * Paleta ma MAX_SERIES slotów i przypisuje je POZYCJI kategorii, nigdy po
 * obwodzie: dwa wycinki tego samego koloru przestają być kluczem legendy.
 * Dlatego nadmiar kategorii ani nie zawija palety, ani nie wypada
 * z mianownika - ostatni slot niesie jeden wycinek zbiorczy z sumą ogona
 * (a gdy w ogonie została dokładnie jedna kategoria, jej własną nazwę).
 */
export function pieModel(config: ChartConfig, lang: ChartLang): PieModel {
  const first = config.series[0];
  const drawable = config.categories
    .map((label, index) => ({ label, index, value: first?.values[index] ?? null }))
    .filter(
      (d): d is { label: string; index: number; value: number } => d.value !== null && d.value > 0,
    );
  const total = drawable.reduce((a, d) => a + d.value, 0);

  // Kategorie z pozycji >= MAX_SERIES nie mają własnego slotu palety. Gdy
  // takie są, ostatni slot rezerwujemy na wycinek zbiorczy, więc własny
  // kolor zachowują pozycje 0..MAX_SERIES-2.
  const tail = drawable.filter((d) => d.index >= MAX_SERIES);
  const head = tail.length === 0 ? drawable : drawable.filter((d) => d.index < MAX_SERIES - 1);
  const parts: { label: string; value: number; colorSlot: number }[] = head.map((d) => ({
    label: d.label,
    value: d.value,
    colorSlot: d.index + 1,
  }));
  if (tail.length > 0) {
    const rest = drawable.filter((d) => d.index >= MAX_SERIES - 1);
    parts.push({
      label: rest.length === 1 ? rest[0].label : L[lang].other,
      value: rest.reduce((a, d) => a + d.value, 0),
      colorSlot: MAX_SERIES,
    });
  }

  let angle = -Math.PI / 2;
  const slices: PieSlice[] = parts.map((part) => {
    const share = total > 0 ? part.value / total : 0;
    const startAngle = angle;
    angle += share * Math.PI * 2;
    return { ...part, share, startAngle, endAngle: angle };
  });
  return { slices, total };
}

/** Udział z mianownika tarczy; czego tarcza nie rysuje, tego udział jest zerowy. */
export function pieShare(value: number | null, total: number): number {
  return value !== null && value > 0 && total > 0 ? value / total : 0;
}
