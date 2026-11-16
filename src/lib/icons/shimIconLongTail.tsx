// Ogon rejestru ikon shimu po nazwie: komponent KAŻDEGO eksportu
// `@/lib/lucide-shim`, wybierany nazwą z treści CMS.
//
// Ten moduł jest jedynym miejscem kodu publicznego, które trzyma przestrzeń
// nazw shimu (`import * as`). W przeglądarce ładuje się leniwie i tylko wtedy,
// gdy treść zawiera nazwę spoza zestawu synchronicznego (`shimIconByName.tsx`);
// na serwerze jest importowany statycznie, więc HTML pierwszej odpowiedzi
// zawiera ikonę od razu. Dzięki temu obiekt przestrzeni nazw - a z nim glify
// Lucide, których nie używa nic innego w kodzie startowym - nie siedzi
// w chunku startowym (roadmapa ładowania §9.1, D4).
import type { ComponentProps } from "react";
import * as ShimIcons from "@/lib/lucide-shim";
import type { LucideIcon } from "@/lib/lucide-shim";

const REGISTRY = ShimIcons as unknown as Readonly<Record<string, LucideIcon | undefined>>;

export type ShimIconLongTailProps = ComponentProps<LucideIcon> & { iconName: string };

/**
 * Ikona shimu o nazwie `iconName` z tymi samymi propsami co bezpośrednie
 * użycie komponentu. `Object.hasOwn`: nazwa klucza prototypu (`constructor`)
 * nie jest ikoną.
 */
export function ShimIconLongTail({ iconName, ...props }: ShimIconLongTailProps) {
  const Icon = Object.hasOwn(REGISTRY, iconName) ? REGISTRY[iconName] : undefined;
  return Icon ? <Icon {...props} /> : null;
}
