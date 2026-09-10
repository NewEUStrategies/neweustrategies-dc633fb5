// Model tarczy kołowej: co rysuje wykres, jakim slotem palety i z jakiego
// mianownika liczy udziały. Osobny moduł, bo z tego samego modelu korzystają
// TRZY drogi do tych samych liczb - grafika (PieChart), legenda i tabela
// danych (Chart) - a rozjazd między nimi jest defektem samym w sobie.
import i18n from "@/lib/i18n";
import type { ChartConfig } from "@/lib/charts/types";
import { PIE_MAX_SLICES } from "@/lib/charts/types";
import type { ChartLang } from "@/lib/charts/format";
import "@/lib/i18n-charts";

export interface PieSlice {
  label: string;
  value: number;
  share: number;
  colorSlot: number;
  startAngle: number;
  endAngle: number;
}

export interface PieModel {
  /** Wycinki w kolejności kategorii - najwyżej PIE_MAX_SLICES. */
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
 * Paleta przypisuje slot POZYCJI RYSOWANEGO WYCINKA, a nie indeksowi
 * kategorii w konfiguracji, i to są dwie różne liczby, gdy w danych są luki.
 * Liczenie po indeksie kategorii zwijało tarczę: przy ośmiu kategoriach
 * z wartościami tylko na pozycjach 5-8 wszystkie cztery wpadały w "ogon"
 * (indeks >= limitu), głowa wychodziła pusta i tarcza pokazywała JEDEN wycinek
 * "Pozostałe" ze stustoma procentami - cztery odczytywalne kategorie znikały
 * bez śladu. Limit pilnuje liczby wycinków, więc musi liczyć wycinki.
 *
 * Slot z pozycji ma drugą zaletę: nigdy nie wychodzi poza 1-5, czyli zostaje
 * w zestawie bezpiecznym dla daltonizmu. Sloty 7-8 różnią się od 1-2 o ~10-12
 * jednostek CIELAB po symulacji i potrzebują kreskowania jako drugiego
 * nośnika różnicy - a wycinka tarczy nie da się zakreskować, więc na tarczy
 * takie sloty byłyby po prostu nierozróżnialne.
 *
 * Dwa wycinki w tym samym kolorze przestają być kluczem legendy, więc pozycje
 * są unikalne z definicji, a nadmiar kategorii ani nie zawija palety, ani nie
 * wypada z mianownika: ostatni slot niesie jeden wycinek zbiorczy z sumą ogona.
 *
 * LIMIT WYCINKÓW TO PIĘĆ, NIE OSIEM, i jest to zmiana świadoma. Tarcza koduje
 * kątem i powierzchnią, czyli kanałami z dolnej połowy hierarchii
 * percepcyjnej Clevelanda i McGilla - powyżej pięciu wycinków czytelnik nie
 * porówna już żadnej pary, a im więcej wycinków, tym mniejsza szansa, że
 * którykolwiek da się odczytać. Ograniczenie NIE GUBI ŻADNEJ LICZBY: ogon
 * zwija się w jeden wycinek zbiorczy, a pełne wartości każdej kategorii niesie
 * tabela danych, która jest zawsze pod wykresem.
 */
export function pieModel(config: ChartConfig, lang: ChartLang): PieModel {
  const first = config.series[0];
  const drawable = config.categories
    .map((label, index) => ({ label, index, value: first?.values[index] ?? null }))
    .filter(
      (d): d is { label: string; index: number; value: number } => d.value !== null && d.value > 0,
    );
  const total = drawable.reduce((a, d) => a + d.value, 0);

  // Nadmiar liczony po RYSOWANYCH wycinkach. Gdy jest, ostatnia pozycja idzie
  // na wycinek zbiorczy, więc własny kolor zachowuje PIE_MAX_SLICES-1
  // pierwszych. Ogon ma wtedy co najmniej dwie kategorie (inaczej nadmiaru by
  // nie było), więc zbiorczy wycinek zawsze nosi nazwę zbiorczą.
  const overflow = drawable.length > PIE_MAX_SLICES;
  const head = overflow ? drawable.slice(0, PIE_MAX_SLICES - 1) : drawable;
  const parts: { label: string; value: number; colorSlot: number }[] = head.map((d, pos) => ({
    label: d.label,
    value: d.value,
    colorSlot: pos + 1,
  }));
  if (overflow) {
    const rest = drawable.slice(PIE_MAX_SLICES - 1);
    parts.push({
      label: i18n.t("charts.frame.other", { lng: lang }),
      value: rest.reduce((a, d) => a + d.value, 0),
      colorSlot: PIE_MAX_SLICES,
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
