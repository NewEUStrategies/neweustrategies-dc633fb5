// Widget "cover-overlay-card" - karta z okładką na całym tle, gradientową
// nakładką i treścią (data, tytuł-link, zajawka) przy dolnej krawędzi.
// Warstwa organizmu: treść widgetu -> propsy molekuły, i18n PL/EN, sanityzacja
// adresów i kolorów. Molekuła: @/components/ui/cover-overlay-card.
//
// Renderer czyta KAŻDE ustawienie z `WIDGET_SCHEMAS["cover-overlay-card"]`
// bezwarunkowo (bramka wierności ustawień porównuje oba zbiory kluczy).
import type { WidgetContent } from "@/lib/builder/types";
import { safeImageUrl, safeUrl } from "@/lib/sanitize";
import { safeWidgetColor } from "@/lib/builder/cssColor";
import { asNumInRange, pickI18n } from "@/lib/content-model/contentValue";
import {
  COVER_OVERLAY_CARD_DEFAULTS,
  coverCardDateAttr,
  formatCoverCardDate,
} from "@/lib/builder/coverOverlayCard";
import { CoverOverlayCard } from "@/components/ui/cover-overlay-card";
import { getBool, getStr, type Lang } from "./frame";

export function CoverOverlayCardView({ c, lang }: { c: WidgetContent; lang: Lang }) {
  const d = COVER_OVERLAY_CARD_DEFAULTS;
  const rawDate = getStr(c, "date");
  const showDate = getBool(c, "showDate", true);
  return (
    <CoverOverlayCard
      dateLabel={showDate ? formatCoverCardDate(rawDate, lang) : ""}
      dateTime={coverCardDateAttr(rawDate)}
      title={pickI18n(c, "title", lang)}
      excerpt={pickI18n(c, "excerpt", lang)}
      imageUrl={safeImageUrl(getStr(c, "image"))}
      imageAlt={pickI18n(c, "imageAlt", lang)}
      href={safeUrl(getStr(c, "href"), "")}
      overlayColor={safeWidgetColor(c.overlayColor)}
      overlayAlphaTop={asNumInRange(c.overlayAlphaTop, d.overlayAlphaTop, 0, 1)}
      overlayAlphaBottom={asNumInRange(c.overlayAlphaBottom, d.overlayAlphaBottom, 0, 1)}
      mediaMinHeight={asNumInRange(c.mediaMinHeight, d.mediaMinHeight, 0, 720)}
      radius={asNumInRange(c.radius, d.radius, 0, 48)}
      maxWidth={asNumInRange(c.maxWidth, d.maxWidth, 0, 1200)}
      clampLines={asNumInRange(c.clampLines, d.clampLines, 1, 6)}
      hoverLift={getBool(c, "hoverLift", true)}
    />
  );
}
