// Widget "progress-carousel" - progresywna karuzela: duże zdjęcie slajdu
// + lista przycisków z paskiem postępu (auto-play). Atomy/molekuły żyją
// w @/components/ui/progressive-carousel, tu jest tylko warstwa organizmu:
// mapowanie treści widgetu -> propsy, i18n PL/EN, tokeny dark/light, 6px.
import type { CSSProperties } from "react";
import type { WidgetContent } from "@/lib/builder/types";
import { safeImageUrl, safeUrl } from "@/lib/sanitize";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import {
  ProgressSlider,
  SliderBtn,
  SliderBtnGroup,
  SliderContent,
  SliderWrapper,
} from "@/components/ui/progressive-carousel";
import { clampDuration, parseProgressCarouselItems } from "@/lib/builder/progressCarousel";
import { getBool, getNum, getStr, type Lang } from "./frame";

const RATIO_CLASS: Record<string, string> = {
  "16/9": "aspect-[16/9]",
  "4/3": "aspect-[4/3]",
  "3/2": "aspect-[3/2]",
  "1/1": "aspect-square",
  "21/9": "aspect-[21/9]",
};

const EMPTY_TEXT: Record<Lang, string> = {
  pl: "Dodaj slajdy w panelu widgetu.",
  en: "Add slides in the widget panel.",
};

export function ProgressCarouselView({
  c,
  lang,
  paused = false,
}: {
  c: WidgetContent;
  lang: Lang;
  paused?: boolean;
}) {
  const items = parseProgressCarouselItems(c, lang);
  const duration = clampDuration(getNum(c, "duration", 5000));
  const vertical = getBool(c, "vertical", false);
  const showDesc = getBool(c, "showDesc", true);
  const accent = getStr(c, "accentColor");
  const heading = getStr(c, `heading_${lang}`) || getStr(c, "heading_pl");
  const ratio = RATIO_CLASS[getStr(c, "ratio")] ?? RATIO_CLASS["16/9"];

  const style = accent ? ({ "--progress-carousel-accent": accent } as CSSProperties) : undefined;

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
        <h2 className="mb-4 text-xl font-semibold text-foreground sm:text-2xl">{heading}</h2>
      ) : null}
      <ProgressSlider
        vertical={vertical}
        duration={duration}
        paused={paused}
        activeSlider={undefined}
        aria-label={heading || undefined}
        className={
          vertical
            ? "flex flex-col gap-4 lg:flex-row"
            : "flex flex-col gap-4 lg:h-[500px] lg:flex-row"
        }
      >
        <SliderContent className="w-full flex-1">
          {items.map((item) => (
            <SliderWrapper key={item.value} value={item.value} className="h-full w-full">
              <figure
                className={`relative h-full w-full overflow-hidden rounded-[6px] bg-muted ${ratio} lg:aspect-auto`}
              >
                {item.img ? (
                  <OptimizedImage
                    src={safeImageUrl(item.img)}
                    alt={item.title}
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </figure>
            </SliderWrapper>
          ))}
        </SliderContent>

        <SliderBtnGroup
          className={
            vertical
              ? "grid w-full grid-cols-1 gap-2 overflow-hidden rounded-[6px] border border-border bg-card lg:max-w-xs"
              : "grid w-full grid-cols-1 gap-2 overflow-hidden rounded-[6px] border border-border bg-card sm:grid-cols-2 lg:max-w-xs lg:grid-cols-1"
          }
        >
          {items.map((item) => {
            const href = item.href ? safeUrl(item.href, "") : "";
            const body = (
              <>
                <p className="text-sm font-semibold text-foreground">{item.title}</p>
                {showDesc && item.desc ? (
                  <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                    {item.desc}
                  </p>
                ) : null}
              </>
            );
            return (
              <SliderBtn
                key={item.value}
                value={item.value}
                className="border-b border-border/60 p-3 last:border-b-0 hover:bg-muted/50"
              >
                {href ? (
                  <a href={href} className="block" onClick={(e) => e.stopPropagation()}>
                    {body}
                  </a>
                ) : (
                  body
                )}
              </SliderBtn>
            );
          })}
        </SliderBtnGroup>
      </ProgressSlider>
    </div>
  );
}
