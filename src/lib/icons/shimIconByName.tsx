// Ikona shimu wybierana NAZWĄ zapisaną w treści CMS (separator, oś czasu,
// pasek „hot topic", newsletter, nagłówek, przycisk, pasek ogłoszeń).
//
// DLACZEGO NIE `import * as Icons from "@/lib/lucide-shim"`. Indeks
// przestrzeni nazw nazwą z treści zmusza bundler do zbudowania obiektu ze
// WSZYSTKIMI eksportami shimu, a te widgety są w kodzie startowym (chrome
// nagłówka i stopki), więc obiekt i każda ikona, do której tylko on prowadzi,
// lądowały w chunku startowym każdej strony (roadmapa ładowania §9.1, D4).
//
// ROZSTRZYGANIE NAZW JEST DOKŁADNIE TAKIE JAK WCZEŚNIEJ: nazwa rozwiązuje się
// wtedy i tylko wtedy, gdy jest własnym eksportem shimu (ta sama wielkość
// liter, bez przycinania spacji), i daje ten sam komponent. Nazwa spoza shimu
// (w tym każda kebab-case z `LucideIconPicker`) daje `undefined`, a zastępnik
// wybiera wywołujący - tak jak przy `Icons[name] ?? Zastępnik`. Jedyna
// zamierzona różnica: klucz prototypu (`constructor`, `toString`...) też daje
// `undefined`; w artefakcie Rolldowna przestrzeń nazw jest zwykłym obiektem,
// więc taka nazwa zwracała funkcję z `Object.prototype` i wywracała render.
//
// DWA ZESTAWY.
//   * Synchroniczny (`EAGER`): nazwy, które treść realnie zawiera - opcje listy
//     paska ogłoszeń w `ThemeOptionsPane`, wartości domyślne i zastępniki
//     widgetów, podpowiedź edytora osi czasu („Flag, FileText, Clock…"), nazwy
//     wpisane przez migracje treści (`Send`) i `ArrowRight` (i tak statycznie
//     w pasku „hot topic"). HTML tych nazw jest bajt w bajt taki jak wcześniej.
//   * Ogon (`SHIM_ICON_NAMES` poza zestawem): ten sam glif, ale komponent
//     dojeżdża z leniwego `shimIconLongTail.tsx` w granicy `Suspense`. Serwer
//     ma moduł statycznie, więc pierwsza odpowiedź zawiera ikonę (różnica
//     w HTML strumienia: tylko znaczniki granicy `<!--$-->`/`<!--/$-->`);
//     przy hydratacji React zostawia HTML serwera, dopóki chunk nie dojedzie.
//     Przy renderze czysto klienckim (nawigacja SPA, kanwa buildera) ikona
//     z ogona pojawia się po załadowaniu chunku.
//
// Bramki: `__tests__/contentIconNameMarkup.test.tsx` (HTML każdego miejsca dla
// każdej nazwy z dziedziny, plik referencyjny sprzed zmiany) i
// `__tests__/shimIconByName.test.tsx` (rozstrzyganie, hydratacja ogona).
import { lazy, memo, Suspense, type ComponentProps, type ComponentType } from "react";
import { createIsomorphicFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  FileText,
  Flame,
  Info,
  Mail,
  Megaphone,
  Send,
  Sparkles,
  Star,
  type LucideIcon,
} from "@/lib/lucide-shim";
import { SHIM_ICON_NAMES } from "./shimIconNames";
import {
  ShimIconLongTail as ServerShimIconLongTail,
  type ShimIconLongTailProps,
} from "./shimIconLongTail";

const EAGER: ReadonlyMap<string, LucideIcon> = new Map<string, LucideIcon>([
  ["AlertTriangle", AlertTriangle],
  ["ArrowRight", ArrowRight],
  ["Check", Check],
  ["Clock", Clock],
  ["FileText", FileText],
  ["Flame", Flame],
  ["Info", Info],
  ["Mail", Mail],
  ["Megaphone", Megaphone],
  ["Send", Send],
  ["Sparkles", Sparkles],
  ["Star", Star],
]);

const SHIM_NAMES: ReadonlySet<string> = new Set(SHIM_ICON_NAMES);

// Ten sam wzorzec co `serverReadingWidgets` w `lazyWidgets.tsx`: kompilator
// Start usuwa gałąź serwerową (i jej import) z bundla przeglądarki, więc
// klient dostaje wyłącznie granicę `import()`.
const getServerLongTail = createIsomorphicFn()
  .server(() => ServerShimIconLongTail)
  .client(() => null);

const LongTail: ComponentType<ShimIconLongTailProps> =
  getServerLongTail() ??
  lazy(() => import("./shimIconLongTail").then((m) => ({ default: m.ShimIconLongTail })));

// Jeden komponent na nazwę: nowa tożsamość przy każdym renderze przemontowałaby
// ikonę (i jej granicę Suspense) przy każdej aktualizacji rodzica.
const longTailIcons = new Map<string, LucideIcon>();

function longTailIcon(name: string): LucideIcon {
  const known = longTailIcons.get(name);
  if (known) return known;
  // `memo`: identyczne propsy z rodzica nie unieważniają granicy, która przy
  // hydratacji wciąż czeka na chunk (jak `withSuspense` w `lazySuspense.tsx`).
  const Icon = memo(function ShimIconFromLongTail(props: ComponentProps<LucideIcon>) {
    return (
      <Suspense fallback={null}>
        <LongTail {...props} iconName={name} />
      </Suspense>
    );
  }) as unknown as LucideIcon;
  longTailIcons.set(name, Icon);
  return Icon;
}

/**
 * Komponent ikony shimu o nazwie `name` albo `undefined`, gdy nazwa nie jest
 * eksportem shimu. Wywołujący dokłada swój zastępnik (`?? Star`).
 */
export function shimIconByName(name: string): LucideIcon | undefined {
  const eager = EAGER.get(name);
  if (eager) return eager;
  return SHIM_NAMES.has(name) ? longTailIcon(name) : undefined;
}
