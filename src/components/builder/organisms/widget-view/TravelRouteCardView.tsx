// Widget "travel-route-card" - karta trasy (mapa w tle, tytuł, autor, dystans,
// polubienia). Warstwa organizmu: treść widgetu -> propsy molekuły, i18n PL/EN,
// sanityzacja adresów i kolorów. Molekuła: @/components/ui/travel-route-card.
//
// Renderer czyta KAŻDE ustawienie z `WIDGET_SCHEMAS["travel-route-card"]`
// bezwarunkowo (bramka wierności ustawień porównuje oba zbiory kluczy), więc
// nie ma tu gałęzi typu "czytaj kolor tylko gdy włączone polubienia".
import type { WidgetContent } from "@/lib/builder/types";
import { safeImageUrl, safeUrl } from "@/lib/sanitize";
import { safeWidgetColor } from "@/lib/builder/cssColor";
import { asNumInRange, pickI18n } from "@/lib/content-model/contentValue";
import { TRAVEL_ROUTE_CARD_DEFAULTS, travelRouteLikeKey } from "@/lib/builder/travelRouteCard";
import { TravelRouteCard, type TravelRouteCardLabels } from "@/components/ui/travel-route-card";
import { getBool, getNum, getStr, type Lang } from "./frame";

const LABELS: Record<Lang, TravelRouteCardLabels> = {
  pl: {
    like: "Polub trasę",
    unlike: "Cofnij polubienie trasy",
    likesCount: "polubienia: {{n}}",
    distance: "Dystans: {{v}}",
    mapAlt: "Trasa",
  },
  en: {
    like: "Like this route",
    unlike: "Remove your like from this route",
    likesCount: "likes: {{n}}",
    distance: "Distance: {{v}}",
    mapAlt: "Route",
  },
};

export function TravelRouteCardView({
  c,
  lang,
  nodeId,
  editable = false,
}: {
  c: WidgetContent;
  lang: Lang;
  nodeId: string;
  /** Kanwa buildera: polubienie nie ma zapisywać preferencji redaktora. */
  editable?: boolean;
}) {
  const d = TRAVEL_ROUTE_CARD_DEFAULTS;
  return (
    <TravelRouteCard
      title={pickI18n(c, "title", lang)}
      author={pickI18n(c, "author", lang)}
      distance={getStr(c, "distance")}
      distanceCaption={pickI18n(c, "distanceCaption", lang)}
      initialLikes={getNum(c, "likes", 0)}
      imageUrl={safeImageUrl(getStr(c, "image"))}
      imageAlt={pickI18n(c, "imageAlt", lang)}
      href={safeUrl(getStr(c, "href"), "")}
      overlayColor={safeWidgetColor(c.overlayColor)}
      overlayAlpha={asNumInRange(c.overlayAlpha, d.overlayAlpha, 0, 1)}
      minHeight={asNumInRange(c.minHeight, d.minHeight, 120, 720)}
      radius={asNumInRange(c.radius, d.radius, 0, 48)}
      maxWidth={asNumInRange(c.maxWidth, d.maxWidth, 0, 1200)}
      distanceSizePx={asNumInRange(c.distanceSizePx, d.distanceSizePx, 24, 200)}
      showLikes={getBool(c, "showLikes", true)}
      likeAccentColor={safeWidgetColor(c.likeAccentColor)}
      animate={getBool(c, "animate", true)}
      hoverLift={getBool(c, "hoverLift", true)}
      storageKey={editable ? null : travelRouteLikeKey(nodeId)}
      labels={LABELS[lang]}
    />
  );
}
