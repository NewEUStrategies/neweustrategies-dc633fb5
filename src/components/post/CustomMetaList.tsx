// Renders the post's custom meta items (icon + label + value).
// Uses lucide icons by name (`def.icon`). Unknown icon names fall back to Info.
import type { ComponentType, SVGProps } from "react";
import { Info, Clock, Award, Users, Tag, Star, BookOpen, MapPin } from "@/lib/lucide-shim";
import { buildCustomMetaItems, metaLabel, type CustomMetaDef, type CustomMetaValues } from "@/lib/customMeta";

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

const ICONS: Record<string, IconCmp> = {
  Info, Clock, Award, Users, Tag, Star, BookOpen, MapPin,
};

interface Props {
  defs: readonly CustomMetaDef[];
  values: CustomMetaValues | null | undefined;
  lang: "pl" | "en";
  variant?: "inline" | "stacked";
  className?: string;
}

export function CustomMetaList({ defs, values, lang, variant = "inline", className }: Props) {
  const items = buildCustomMetaItems(defs, values);
  if (items.length === 0) return null;
  if (variant === "stacked") {
    return (
      <dl className={["grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm", className].filter(Boolean).join(" ")}>
        {items.map(({ def, value }) => {
          const Icon = ICONS[def.icon] ?? Info;
          return (
            <div key={def.id} className="flex items-start gap-2">
              <Icon className="w-4 h-4 mt-0.5 text-brand shrink-0" aria-hidden />
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{metaLabel(def, lang)}</dt>
                <dd className="font-semibold text-foreground truncate">{value}</dd>
              </div>
            </div>
          );
        })}
      </dl>
    );
  }
  return (
    <ul className={["inline-flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground", className].filter(Boolean).join(" ")}>
      {items.map(({ def, value }) => {
        const Icon = ICONS[def.icon] ?? Info;
        return (
          <li key={def.id} className="inline-flex items-center gap-1.5">
            <Icon className="w-3.5 h-3.5 text-brand" aria-hidden />
            <span className="sr-only">{metaLabel(def, lang)}: </span>
            <span className="font-semibold text-foreground">{value}</span>
            <span className="text-muted-foreground">{metaLabel(def, lang)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export const CUSTOM_META_ICON_NAMES: readonly string[] = Object.keys(ICONS);
