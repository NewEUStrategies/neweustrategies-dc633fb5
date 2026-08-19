// Pola własne wpisu (ikona + etykieta + wartość). Ikony z lucide po nazwie
// (`def.icon`); nieznana nazwa degraduje do neutralnego globusa.
//
// Oba warianty listy składa teraz JEDEN atom `atoms/MetaValueItem`. Wcześniej
// były to dwie kopie JSX o RÓŻNYM kontrakcie dostępności: wariant `stacked`
// wiązał nazwę z wartością przez `<dt>/<dd>`, a `inline` używał `sr-only`
// z dwukropkiem - czytnik ekranu dostawał w jednym miejscu listę definicji,
// w drugim ciąg tekstu.
import type { ComponentType, SVGProps } from "react";
import { Clock, Tags, Star, BookOpen, MapPin, Globe, Bookmark } from "@/lib/lucide-shim";
import {
  buildCustomMetaItems,
  metaLabel,
  type CustomMetaDef,
  type CustomMetaValues,
} from "@/lib/customMeta";
import { MetaValueItem } from "@/components/post/atoms/MetaValueItem";

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

const ICONS: Record<string, IconCmp> = {
  Info: Globe,
  Clock,
  Award: Star,
  Users: Globe,
  Tag: Tags,
  Star,
  BookOpen,
  MapPin,
  Bookmark,
  Globe,
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
      <dl
        className={["grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm", className]
          .filter(Boolean)
          .join(" ")}
      >
        {items.map(({ def, value }) => (
          <MetaValueItem
            key={def.id}
            icon={ICONS[def.icon] ?? Globe}
            label={metaLabel(def, lang)}
            value={value}
            variant="stacked"
          />
        ))}
      </dl>
    );
  }
  return (
    <ul
      className={["inline-flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground", className]
        .filter(Boolean)
        .join(" ")}
    >
      {items.map(({ def, value }) => (
        <MetaValueItem
          key={def.id}
          icon={ICONS[def.icon] ?? Globe}
          label={metaLabel(def, lang)}
          value={value}
          variant="inline"
        />
      ))}
    </ul>
  );
}

export const CUSTOM_META_ICON_NAMES: readonly string[] = Object.keys(ICONS);
