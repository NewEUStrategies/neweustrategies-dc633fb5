// Fallback dla nazw spoza kurowanego zestawu DynamicIcon.
//
// Historia (zmierzona w tej sesji): KAŻDA forma referencji do rejestru ikon
// lucide-react - namespace-import barrela, deep-import icons/index.js, a
// nawet mapa dynamicIconImports (1600 thunków import()) - kończyła się tym,
// że Rollup umieszczał wszystkie ~1690 modułów ikon w bundlu WEJŚCIOWYM
// (~640 KB raw na każdej stronie). Dlatego pełny zestaw żyje tu jako WŁASNY,
// wygenerowany plik danych węzłów SVG (lucideIconNodes.generated.ts) bez
// żadnych importów z rejestru - komponent ikony powstaje w locie przez
// createLucideIcon. Ten moduł jest leniwym chunkiem (React.lazy w
// DynamicIcon), więc dane schodzą dopiero przy pierwszej egzotycznej nazwie.
import { createLucideIcon, HelpCircle, type LucideProps } from "lucide-react";
import { LUCIDE_ICON_NODES, LUCIDE_ICON_ALIASES } from "./lucideIconNodes.generated";

type IconComponent = React.ComponentType<LucideProps>;

// Komponenty tworzone raz per nazwa (stabilna tożsamość dla Reacta).
const cache = new Map<string, IconComponent>();

function iconFor(kebab: string): IconComponent {
  let Cmp = cache.get(kebab);
  if (!Cmp) {
    const canonical = LUCIDE_ICON_NODES[kebab] ? kebab : LUCIDE_ICON_ALIASES[kebab];
    const node = canonical ? LUCIDE_ICON_NODES[canonical] : undefined;
    Cmp = node ? createLucideIcon(canonical ?? kebab, node) : HelpCircle;
    cache.set(kebab, Cmp);
  }
  return Cmp;
}

/** "XLineTop" -> "x-line-top", "Building2" -> "building-2" (klucze danych). */
export function pascalToKebabIconName(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-zA-Z])([0-9])/g, "$1-$2")
    .toLowerCase();
}

/** Kanoniczne, kebab-case'owe nazwy wszystkich ikon (katalog dla pickerów). */
export function allIconNames(): string[] {
  return Object.keys(LUCIDE_ICON_NODES).sort();
}

interface DynamicIconFullProps extends LucideProps {
  /** Klucz PascalCase (bez sufiksu "Icon"), znormalizowany w DynamicIcon. */
  iconKey: string;
}

export default function DynamicIconFull({ iconKey, ...rest }: DynamicIconFullProps) {
  const Icon = iconFor(pascalToKebabIconName(iconKey));
  return <Icon {...rest} />;
}
