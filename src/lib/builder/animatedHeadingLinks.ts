// Mapowanie zapisanego w treści widgetu obiektu `WidgetLink` na lekki kontrakt
// linku używany przez renderer animowanego nagłówka. Trzymane osobno, żeby
// renderer (lib) nie zależał od typów panelu admina, a edytor i publiczny
// render korzystały z tej samej, jednej normalizacji.
import type { AnimatedHeadingLink } from "./animatedHeadingVariants";
import type { WidgetLink } from "./types";

/** Klucze treści widgetu, pod którymi zapisujemy linki segmentów. */
export const ANIMATED_HEADING_LINK_KEYS = [
  "linkWhole",
  "linkBefore",
  "linkHighlight",
  "linkAfter",
] as const;
export type AnimatedHeadingLinkKey = (typeof ANIMATED_HEADING_LINK_KEYS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Zwraca link tylko wtedy, gdy ma bezpieczny, niepusty URL. */
export function toAnimatedHeadingLink(value: unknown): AnimatedHeadingLink | undefined {
  if (!isRecord(value)) return undefined;
  const url = typeof value.url === "string" ? value.url.trim() : "";
  if (!url) return undefined;
  if (/^\s*javascript:/i.test(url)) return undefined;

  const rels: string[] = [];
  if (typeof value.rel === "string" && value.rel.trim()) rels.push(value.rel.trim());
  if (value.nofollow === true) rels.push("nofollow");

  return {
    href: url,
    target: value.target === "_blank" ? "_blank" : "_self",
    rel: rels.length ? Array.from(new Set(rels.join(" ").split(/\s+/))).join(" ") : undefined,
    ariaLabel: typeof value.ariaLabel === "string" && value.ariaLabel ? value.ariaLabel : undefined,
  };
}

/** Odczyt zapisanego linku do formatu akceptowanego przez `LinkPicker`. */
export function toWidgetLink(value: unknown): WidgetLink | undefined {
  if (!isRecord(value)) return undefined;
  const url = typeof value.url === "string" ? value.url : "";
  if (!url) return undefined;
  return {
    url,
    kind:
      value.kind === "post" ||
      value.kind === "page" ||
      value.kind === "media" ||
      value.kind === "category" ||
      value.kind === "tag"
        ? value.kind
        : "external",
    refId: typeof value.refId === "string" ? value.refId : undefined,
    refLabel: typeof value.refLabel === "string" ? value.refLabel : undefined,
    target: value.target === "_blank" ? "_blank" : "_self",
    rel: typeof value.rel === "string" ? value.rel : undefined,
    nofollow: value.nofollow === true,
    ariaLabel: typeof value.ariaLabel === "string" ? value.ariaLabel : undefined,
  };
}
