// Ogon rejestru ikon shimu po nazwie: komponent KAŻDEGO eksportu
// `@/lib/lucide-shim`, wybierany nazwą z treści CMS.
//
// W przeglądarce ten moduł ładuje się leniwie i tylko wtedy, gdy treść zawiera
// nazwę spoza zestawu synchronicznego (`shimIconByName.tsx`); na serwerze jest
// importowany statycznie, więc HTML pierwszej odpowiedzi zawiera ikonę od razu
// (roadmapa ładowania §9.1, D4). Mapa nazw: `shimIconMap.ts`.
import type { ComponentProps } from "react";
import type { LucideIcon } from "@/lib/lucide-shim";
import { SHIM_ICONS } from "./shimIconMap";

export type ShimIconLongTailProps = ComponentProps<LucideIcon> & { iconName: string };

/**
 * Ikona shimu o nazwie `iconName` z tymi samymi propsami co bezpośrednie
 * użycie komponentu. `Object.hasOwn`: nazwa klucza prototypu (`constructor`)
 * nie jest ikoną.
 */
export function ShimIconLongTail({ iconName, ...props }: ShimIconLongTailProps) {
  const Icon = Object.hasOwn(SHIM_ICONS, iconName) ? SHIM_ICONS[iconName] : undefined;
  return Icon ? <Icon {...props} /> : null;
}
