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
  /** Wycinki w kolejności MALEJĄCEJ od godziny dwunastej - najwyżej PIE_MAX_SLICES. */
  slices: PieSlice[];
  /** Mianownik udziału: suma DODATNICH. */
  total: number;
  /**
   * Suma udziałów PODANYCH W DANYCH, w punktach procentowych - i tylko wtedy,
   * gdy dane są udziałami (jednostka procentowa). `null` znaczy NIE MA CZEGO
   * SPRAWDZAĆ, więc model nie zaświadcza, że jest dobrze - milczy, dokładnie
   * jak suma kontrolna mostka bez jawnego stanu końcowego.
   *
   * SPRAWDZAMY DANE AUTORA, NIE WŁASNĄ ARYTMETYKĘ, i to jest tu cała treść.
   * Udziały policzone przez model dzielą wartości przez ich własną sumę, więc
   * sumują się do stu procent Z DEFINICJI - sprawdzanie ich (choćby po
   * zaokrągleniu) nie może wykryć niczego poza błędem zaokrąglenia, którego
   * nikt nie popełnił. Realny defekt jest inny: autor wkleja gotowe udziały,
   * które sumują się do 90% albo 104% (bo brakuje kategorii, bo dwie się
   * nakładają, bo arkusz zaokrąglił w drugą stronę), a tarcza PRZESKALOWUJE je
   * po cichu do pełnej całości. Wtedy liczba na łuku ("33%") jest inna niż
   * liczba w arkuszu i w tabeli danych ("30%") - i nic tego nie mówi.
   */
  shareSum: number | null;
  /** Czy podane udziały domykają 100%. `null` = nie ma czego sprawdzać. */
  shareSumOk: boolean | null;
  /**
   * Ile kategorii ma wartość DODATNIĄ - czyli ile tarcza narysowałaby bez
   * limitu wycinków. Osobne pole od `slices.length`, bo po zwinięciu ogona ta
   * druga liczba nigdy nie przekracza limitu i nie da się z niej odczytać, że
   * limit w ogóle był napięty. Reguła doboru formy ("powyżej pięciu kategorii
   * weź słupek skumulowany") pyta właśnie o tę liczbę.
   */
  positives: number;
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
  // KOLEJNOŚĆ MALEJĄCA OD GODZINY DWUNASTEJ, ZGODNIE Z RUCHEM WSKAZÓWEK.
  // To jedyna kolejność, w której czytelnik może porównywać SĄSIEDNIE łuki bez
  // szukania: kąt i powierzchnia siedzą w dolnej połowie hierarchii
  // percepcyjnej, więc porównanie dwóch wycinków oddalonych o pół obwodu jest
  // praktycznie niewykonalne. Sortowanie stoi PRZED podziałem na głowę i ogon,
  // dzięki czemu w wycinku zbiorczym ląduje faktyczny ogon rozkładu, a nie
  // przypadkowe kategorie z końca arkusza.
  drawable.sort((a, b) => b.value - a.value);

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
  // Suma kontrolna liczona z WARTOŚCI, nie z kątów - patrz `shareSum`.
  //
  // WCHODZĄ DO NIEJ WSZYSTKIE NIEPUSTE WARTOŚCI, TAKŻE UJEMNE I ZEROWE -
  // a nie mianownik tarczy. To była realna dziura: mianownik jest sumą
  // DODATNICH, więc zestaw [-10, 100] z jednostką "%" dawał sumę 100 i suma
  // kontrolna milczała, choć autor podał udziały sumujące się do 90, a jedna
  // kategoria w ogóle nie weszła na tarczę. Ujemny udział jest sam w sobie
  // bezsensem, więc ostrzeżenie jest tam tym bardziej na miejscu.
  //
  // Pytanie tej sumy brzmi "czy autor podał pełną strukturę", nie "co tarcza
  // narysowała" - dlatego liczy z arkusza, a nie z tego, co przeszło filtr
  // rysowania. Braki (`null`) nie wchodzą, bo brak nie jest deklaracją zera:
  // kategoria bez liczby to kategoria nieuzupełniona, a nie zerowa.
  const percentUnit = isPercentUnit(config.unit);
  const declared = config.categories.reduce<number | null>((acc, _label, index) => {
    const v = first?.values[index];
    if (v === null || v === undefined || !Number.isFinite(v)) return acc;
    return (acc ?? 0) + v;
  }, null);
  const shareSum = percentUnit && declared !== null ? round1(declared) : null;
  return {
    slices,
    total,
    shareSum,
    shareSumOk: shareSum === null ? null : Math.abs(shareSum - 100) <= SHARE_TOLERANCE_PP,
    positives: drawable.length,
  };
}

/**
 * Tolerancja sumy kontrolnej udziałów, w punktach procentowych.
 *
 * BEZWZGLĘDNA, nie względna - i to jest różnica wobec mostka. Mostek nie zna
 * swojej skali (miliony euro albo punkty procentowe), więc jego próg musi być
 * ułamkiem skali zmiany. Tu skala jest znana z góry i wynosi 100, bo dane SĄ
 * udziałami. Pół punktu to granica, poniżej której mówimy o zaokrągleniu
 * w arkuszu autora (trzy równe udziały podane jako 33,3 sumują się do 99,9),
 * a powyżej - o brakującej albo podwójnie liczonej kategorii.
 */
export const SHARE_TOLERANCE_PP = 0.5;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Czy dane są UDZIAŁAMI, czyli czy jest o czym mówić w sumie kontrolnej.
 *
 * Rozpoznajemy po jednostce, a nie po tym, że wartości sumują się blisko stu:
 * ta druga heurystyka odpalałaby na dowolnym zestawie, który przypadkiem
 * sumuje się do 100 (na przykład na czterech kwartałach po 25 mln), a nie
 * odpalałaby na zestawie udziałów sumujących się do 60 - czyli dokładnie tam,
 * gdzie ostrzeżenie jest potrzebne. Jednostka jest deklaracją autora o tym,
 * co liczby znaczą, i to jest właściwa podstawa.
 */
function isPercentUnit(unit: string): boolean {
  const u = unit.trim().toLowerCase().replace(/\s+/g, "");
  return u === "%" || u === "pp" || u === "p.p." || u === "pkt%";
}

/** Udział z mianownika tarczy; czego tarcza nie rysuje, tego udział jest zerowy. */
export function pieShare(value: number | null, total: number): number {
  return value !== null && value > 0 && total > 0 ? value / total : 0;
}
