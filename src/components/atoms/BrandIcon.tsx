// Hook + komponent: ładuje ikony brandów z biblioteki ikon (icon_library)
// i pozwala ich używać jako drop-in zastępstwo dla ikon Lucide. Jeśli dla
// danego brandu nie ma wpisu w bibliotece - renderujemy fallback (Lucide).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listIcons, resolveIconUrl, slugifyIconName, type IconRow } from "@/lib/iconLibrary";
import { useTheme } from "@/components/ThemeProvider";
import type { ComponentType, SVGAttributes } from "react";

const STALE = 5 * 60 * 1000;

export interface BrandIconMap {
  byName: Record<string, IconRow>;
  resolve: (key: string) => IconRow | undefined;
}

/**
 * Globalna mapa ikon - cache współdzielony.
 * Domyślnie przeszukuje wszystkie kindy (brand + custom + flag), z priorytetem
 * brand > custom > flag, żeby ikony zapisane w /admin/icons (zazwyczaj jako
 * "custom" po imporcie hurtowym) były dostępne wszędzie tam, gdzie używamy
 * BrandIcon - bez wymagania ręcznej rekategoryzacji.
 */
export function useBrandIcons(kind?: "brand" | "flag" | "custom"): BrandIconMap {
  const { data = [] } = useQuery({
    queryKey: ["icon-library", kind ?? "all"],
    queryFn: () => listIcons(kind),
    staleTime: STALE,
  });

  return useMemo(() => {
    const byName: Record<string, IconRow> = {};
    const priority: Record<string, number> = { brand: 3, custom: 2, flag: 1 };
    for (const row of data) {
      const existing = byName[row.name];
      if (!existing || (priority[row.kind] ?? 0) > (priority[existing.kind] ?? 0)) {
        byName[row.name] = row;
      }
    }
    const resolve = (key: string) => byName[slugifyIconName(key)];
    return { byName, resolve };
  }, [data]);
}

export interface BrandIconProps extends SVGAttributes<SVGSVGElement> {
  /** Nazwa ikony w bibliotece (shortcode, np. "facebook", "x", "spotify"). */
  name: string;
  /** Fallback Lucide/SVG component renderowany gdy brak w bibliotece. */
  fallback: ComponentType<{ className?: string } & SVGAttributes<SVGSVGElement>>;
  className?: string;
  /** Etykieta dostępności. */
  alt?: string;
}

/**
 * Renderuje ikonę z biblioteki (icon_library, kind='brand') jeśli istnieje;
 * w przeciwnym razie - Lucide fallback. Wybór wariantu light/dark zgodny z motywem.
 */
const ALIASES: Record<string, string[]> = {
  x: ["x", "twitter", "x-twitter"],
  twitter: ["twitter", "x", "x-twitter"],
  website: ["website", "globe", "web", "link"],
  linkedin: ["linkedin", "linked-in"],
  facebook: ["facebook", "fb", "meta"],
  youtube: ["youtube", "yt"],
  instagram: ["instagram", "ig"],
  tiktok: ["tiktok", "tik-tok"],
  threads: ["threads", "meta-threads"],
  spotify: ["spotify"],
  email: ["email", "mail", "envelope", "at"],
  mail: ["mail", "email", "envelope"],
};

export function BrandIcon({ name, fallback: Fallback, className, alt, ...rest }: BrandIconProps) {
  const { theme } = useTheme();
  const { resolve } = useBrandIcons();
  const candidates = ALIASES[name.toLowerCase()] ?? [name];
  let row: IconRow | undefined;
  for (const c of candidates) {
    row = resolve(c);
    if (row) break;
  }

  if (row && (row.url_default || row.url_light || row.url_dark)) {
    const mode = theme === "dark" ? "dark" : "light";
    const src = resolveIconUrl(row, mode);
    if (src) {
      return (
        <img
          src={src}
          alt={alt ?? row.label ?? name}
          className={className}
          loading="lazy"
          decoding="async"
          draggable={false}
          style={{ objectFit: "contain" }}
        />
      );
    }
  }
  return <Fallback className={className} {...rest} />;
}
