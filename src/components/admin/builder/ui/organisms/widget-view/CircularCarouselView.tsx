// Widget "circular-carousel" - karuzela okrężna (karty na elipsie).
// Warstwa organizmu: treść widgetu -> propsy molekuły, i18n PL/EN,
// tokeny dark/light, rounding 6px. Molekuła: @/components/ui/circular-carousel.
import type { CSSProperties } from "react";
import type { WidgetContent } from "@/lib/builder/types";
import { safeUrl } from "@/lib/sanitize";
import { CircularCarousel, type CircularCarouselLabels } from "@/components/ui/circular-carousel";
import {
  clampInterval,
  clampRadius,
  clampVisibleCount,
  parseCircularCarouselItems,
} from "@/lib/builder/circularCarousel";
import { getBool, getNum, getStr, type Lang } from "./frame";

const EMPTY_TEXT: Record<Lang, string> = {
  pl: "Dodaj karty w panelu widgetu.",
  en: "Add cards in the widget panel.",
};

const LABELS: Record<Lang, CircularCarouselLabels> = {
  pl: {
    of: "z",
    previous: "Poprzednia karta",
    next: "Następna karta",
    goTo: "Przejdź do karty {{n}}",
    region: "Karuzela okrężna",
  },
  en: {
    of: "of",
    previous: "Previous card",
    next: "Next card",
    goTo: "Go to card {{n}}",
    region: "Circular carousel",
  },
};

export function CircularCarouselView({
  c,
  lang,
  paused = false,
}: {
  c: WidgetContent;
  lang: Lang;
  paused?: boolean;
}) {
  const items = parseCircularCarouselItems(c, lang).map((item) => ({
    ...item,
    href: item.href ? safeUrl(item.href, "") : "",
  }));
  const heading = getStr(c, `heading_${lang}`) || getStr(c, "heading_pl");
  const accent = getStr(c, "accentColor");
  const style = accent ? ({ "--circular-carousel-accent": accent } as CSSProperties) : undefined;

  if (items.length === 0) {
    return (
      <div className="rounded-[6px] border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {EMPTY_TEXT[lang]}
      </div>
    );
  }

  return (
    <div style={style} className="w-full">
      {heading ? (
        <h2 className="mb-4 text-center text-xl font-semibold text-foreground sm:text-2xl">
          {heading}
        </h2>
      ) : null}
      <CircularCarousel
        items={items}
        labels={LABELS[lang]}
        autoPlay={!paused && getBool(c, "autoPlay", true)}
        autoPlayInterval={clampInterval(getNum(c, "autoPlayInterval", 4000))}
        visibleCount={clampVisibleCount(getNum(c, "visibleCount", 5))}
        radiusX={clampRadius(getNum(c, "radiusX", 220), 220)}
        radiusY={clampRadius(getNum(c, "radiusY", 100), 100)}
        showCounter={getBool(c, "showCounter", true)}
        showDots={getBool(c, "showDots", true)}
        showArrows={getBool(c, "showArrows", true)}
      />
    </div>
  );
}
