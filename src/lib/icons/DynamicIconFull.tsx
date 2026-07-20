// Pełny rejestr lucide-react - TYLKO w leniwym chunku. Ten moduł jest jedynym
// miejscem w kodzie publicznym z namespace-importem lucide-react (ok. 640 KB
// raw); DynamicIcon dociąga go wyłącznie, gdy nazwa ikony nie występuje w
// wyselekcjonowanym, tree-shakowanym zestawie. Nie importować statycznie!
import * as LucideIcons from "lucide-react";
import { HelpCircle, type LucideProps } from "lucide-react";

type IconComponent = React.ComponentType<LucideProps>;

const registry = LucideIcons as unknown as Record<string, IconComponent | undefined>;

// Indeks case-insensitive budowany raz przy załadowaniu chunka - nazwy w DB
// bywają PascalCase ("LogIn"), camelCase ("logIn") albo z innym caseowaniem
// niż eksporty lucide.
let registryLc: Record<string, IconComponent> | null = null;
function lookupCaseInsensitive(key: string): IconComponent | undefined {
  if (!registryLc) {
    registryLc = {};
    for (const [k, v] of Object.entries(registry)) {
      if (typeof v === "function" || typeof v === "object") {
        registryLc[k.toLowerCase()] = v as IconComponent;
      }
    }
  }
  return registryLc[key.toLowerCase()] ?? registryLc[`${key.toLowerCase()}icon`];
}

interface DynamicIconFullProps extends LucideProps {
  /** Klucz PascalCase (bez sufiksu "Icon"), znormalizowany w DynamicIcon. */
  iconKey: string;
}

export default function DynamicIconFull({ iconKey, ...rest }: DynamicIconFullProps) {
  const Icon = iconKey
    ? (registry[iconKey] ?? registry[`${iconKey}Icon`] ?? lookupCaseInsensitive(iconKey))
    : undefined;
  const Cmp = Icon ?? HelpCircle;
  return <Cmp {...rest} />;
}
