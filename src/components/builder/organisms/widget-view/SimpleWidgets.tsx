// Read-only widget renderers (no inline editing). Returns null when the
// widget type isn't handled here - caller falls through to the main switch.
import { type CSSProperties, type ReactElement, type ReactNode } from "react";
import type { WidgetNode, WidgetTypography } from "@/lib/builder/types";
import * as LucideIcons from "@/lib/lucide-shim";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { safeUrl, safeImageUrl } from "@/lib/sanitizePure";
// Type-only z ciężkich modułów wariantów - runtime dociera lazy przez
// lazyWidgets (slider ~53 KB i animowane nagłówki nie obciążają stron,
// które ich nie renderują).
import type { SliderVariant } from "@/lib/builder/sliderVariants";
import { sliderUsesPostsSource } from "@/lib/builder/sliderPostsQuery";
import type {
  AnimatedHeadingConfig,
  AnimatedHeadingMode,
  AnimatedHeadingShape,
} from "@/lib/builder/animatedHeadingVariants";
import { toAnimatedHeadingLink } from "@/lib/builder/animatedHeadingLinks";
import {
  SliderRender,
  AnimatedHeadingRender,
  AccordionWidget,
  SectionLabelWidgetView,
} from "./lazyWidgets";
import {
  COMPACT_ICON_BOX_SIZE,
  COMPACT_WIDGET_MIN_HEIGHT,
  getStr,
  getNum,
  getStrArr,
  type Lang,
} from "./frame";
import { asBool, asNumInRange, asOneOf, asStr } from "@/lib/content-model/contentValue";
import { safeWidgetColor } from "@/lib/builder/cssColor";
import { SOCIAL_OFFICIAL_COLOR } from "@/lib/builder/socialBrand";
import { localizedPath } from "@/lib/i18n/localePath";
import { autoInvertColor } from "@/lib/builder/autoInvertColor";
import { useCurrentPostCtx } from "@/lib/content-model/postContext";
import { resolveDynamicText, resolveDynamicList } from "@/lib/builder/dynamicText";
// Ciężkie widgety jadą przez rejestr leniwy - SimpleWidgets jest w eager-owej
// ścieżce chrome (Header/Footer -> BuilderRenderer -> WidgetView), więc każdy
// statyczny import stąd ląduje w chunku wejściowym KAŻDEJ strony.
import {
  ContactFormView,
  AuthFormWidget,
  CounterWidget,
  DynamicTagWidget,
  GalleryLightboxZone,
  PostsSliderWidget,
  SearchButtonWidget,
  AccountMenuWidget,
  TeamMemberWidget,
  AuthorProfileCardWidget,
  SpeakersWidget,
  InteractiveCircleWidget,
  TocWidget,
  PricingPlansView,
} from "./lazyWidgets";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { WidgetMediaImage } from "@/components/atoms/WidgetMediaImage";
import { AppLink } from "@/components/atoms/AppLink";
import {
  useGlobalSocialLinks,
  resolveSocialHref,
  type GlobalSocialLinks,
} from "@/lib/social/globalSocialLinks";
import {
  SB_CHIP,
  SB_CTA,
  SB_LABEL,
  SB_ROW,
  SB_SEP,
  SB_TILE,
  SOCIAL_HOUSE_TONES,
  SOCIAL_HOVER_ICON_MODES,
  SOCIAL_OFFICIAL_COLORS,
  SOCIAL_ROW_HOVER_MODES,
  socialHoverGradient,
  socialHoverIconColor,
  socialHoverStyle,
  type SocialHoverPlan,
} from "./socialHover";
import { SocialMailIcon } from "./socialGlyphs";

import { DeferredFrame } from "@/components/atoms/DeferredFrame";
// ImageWidget zostaje eager: renderuje logo w chrome i obrazy nad zgięciem
// (kandydaci LCP) - leniwy chunk opóźniałby hydratację najważniejszego medium.
import { ImageWidget } from "./mediaWidgets";
import { LangSwitcherDropdown, ThemeToggleWidget } from "./chromeWidgets";
import type { AccountMenuConfig } from "./AccountMenuWidget";
// Eager swiadomie - patrz nota "text-rotate" w ./lazyWidgets.
import { TextRotate } from "@/components/ui/text-rotate";
import { AuthorByline } from "@/components/molecules/AuthorByline";
import { resolveAuthorDisplay, widgetAuthorDisplayDefaults } from "@/lib/builder/authorDisplay";
import { buildAvatarSrc, buildAvatarSrcSet } from "@/lib/cropSizes";
import { siteYear } from "@/lib/i18n/format";
export { ResizableBox } from "./resizeWrappers";

// Render-prop most do globalnych linków social (site_settings → opcje motywu).
// Renderery widgetów żyją w wielkim switchu, więc hooka nie można wywołać
// bezpośrednio - ten mikro-komponent daje bezpieczny punkt zaczepienia.
function WithGlobalSocials({
  render,
}: {
  render: (links: GlobalSocialLinks) => ReactElement;
}): ReactElement {
  return render(useGlobalSocialLinks());
}

// Wraps AnimatedHeadingRender with dynamic-token resolution. Runs on every
// render so `{post.title}` / `{author.name}` reflect the current post context
// (or the placeholder ctx in the admin canvas via PLACEHOLDER_POST_CTX).
function AnimatedHeadingWithDynamicText({
  config,
  lang,
}: {
  config: AnimatedHeadingConfig;
  lang: Lang;
}) {
  const ctx = useCurrentPostCtx();
  const resolved: AnimatedHeadingConfig = {
    ...config,
    textBefore: resolveDynamicText(config.textBefore, ctx, lang),
    textAfter: resolveDynamicText(config.textAfter, ctx, lang),
    highlight: resolveDynamicText(config.highlight, ctx, lang),
    rotateWords: resolveDynamicList(config.rotateWords, ctx, lang),
  };
  return <AnimatedHeadingRender config={resolved} />;
}

const compactRowStyle: CSSProperties = {
  minHeight: COMPACT_WIDGET_MIN_HEIGHT,
  boxSizing: "border-box",
  maxWidth: "100%",
};

const compactIconBoxStyle = (size = COMPACT_ICON_BOX_SIZE): CSSProperties => ({
  width: size,
  height: size,
  minWidth: size,
  minHeight: size,
  lineHeight: 0,
  boxSizing: "border-box",
});

/** Tryby koloru ikon social, które renderer umie rozwiązać. */
const SOCIAL_COLOR_MODES = ["inherit", "brand", "official", "custom", "dark", "light"] as const;
/** Tryby tła kafelka ikony social. */
const SOCIAL_BG_MODES = ["none", "subtle", "brand", "official", "contrast", "custom"] as const;

/** Warianty rozdzielacza, które renderer naprawdę umie narysować. */
const DIVIDER_VARIANTS = [
  "line",
  "dashed",
  "dotted",
  "double",
  "gradient",
  "icon",
  "wave",
  "space",
] as const;

/**
 * Jedna grubość domyślna dla panelu (`WIDGET_SCHEMAS.divider.thickness.default`),
 * palety (`WIDGETS.divider.defaults`) i renderera. Rozjazd tych trzech miejsc
 * sprawiał, że świeży rozdzielacz miał 2px w kanwie i 1px na stronie publicznej.
 * Zgodności trzech miejsc pilnuje test `dividerPreviewParity.test.tsx`.
 */
const DIVIDER_DEFAULT_THICKNESS = 2;

export function renderSimpleWidget(
  node: WidgetNode,
  lang: Lang,
  theme: string | undefined,
  editable: boolean = false,
  onContentChange?: (key: string, value: string | number) => void,
  typography?: WidgetTypography,
): ReactNode | undefined {
  const c = node.content;

  switch (node.type) {
    case "divider": {
      const variant = asOneOf(c.variant, DIVIDER_VARIANTS, "line");
      const thickness = asNumInRange(c.thickness, DIVIDER_DEFAULT_THICKNESS, 1, 400);
      const color = safeWidgetColor(c.color);
      const widthPct = asNumInRange(c.widthPct, 100, 10, 100);
      const align = asOneOf(c.align, ["left", "center", "right"] as const, "center");
      const alignStyle: CSSProperties =
        align === "center"
          ? { marginLeft: "auto", marginRight: "auto" }
          : align === "right"
            ? { marginLeft: "auto", marginRight: 0 }
            : { marginLeft: 0, marginRight: "auto" };
      // Kanwa rysuje DOKŁADNIE to, co strona publiczna: żadnego pogrubiania ani
      // rozjaśniania linii "żeby było widać". Klikalność cienkiej linii załatwia
      // przezroczysta warstwa trafienia (niżej), która nie zmienia wyglądu.
      const wrapCls = editable
        ? "w-full py-2 px-1 rounded-[6px] border border-dashed border-foreground/15 bg-foreground/[0.02] relative flex items-center"
        : "w-full";
      const spacerLabel =
        variant === "space"
          ? lang === "pl"
            ? "Odstęp"
            : "Spacer"
          : lang === "pl"
            ? "Rozdzielacz"
            : "Divider";
      const label = editable ? (
        <span className="pointer-events-none absolute -top-2 left-2 px-1 text-[9px] uppercase tracking-wider text-muted-foreground bg-background rounded">
          {spacerLabel}
        </span>
      ) : null;
      // Przezroczysty pas trafienia: 1px linia bywa nieklikalna w kanwie, więc
      // powiększamy OBSZAR kliknięcia, a nie samą linię (klik bąbelkuje do
      // handlera zaznaczenia widgetu na przodku).
      const hitArea = (
        <span
          aria-hidden="true"
          data-divider-hit-area=""
          className="absolute inset-x-0 top-1/2 h-5 -translate-y-1/2"
        />
      );
      const wrap = (inner: ReactNode) =>
        editable ? (
          <div className={wrapCls} aria-label={spacerLabel}>
            {label}
            {inner}
            {hitArea}
          </div>
        ) : (
          <>{inner}</>
        );

      // "space" variant: pure vertical spacing area, no line. Height = thickness.
      if (variant === "space") {
        const h = Math.max(thickness, 1);
        if (editable) {
          return (
            <div
              className="w-full flex items-center justify-center text-[10px] uppercase tracking-wider text-muted-foreground/70 border border-dashed border-foreground/20 rounded-[6px] bg-foreground/[0.03] relative"
              style={{ height: `${h}px`, minHeight: `${h}px` }}
              aria-label={lang === "pl" ? "Odstęp" : "Spacer"}
            >
              <span>↕ {h}px</span>
            </div>
          );
        }
        return <div style={{ height: `${h}px`, width: "100%" }} aria-hidden="true" />;
      }

      const widthStyle: CSSProperties = { width: `${widthPct}%`, ...alignStyle };

      if (variant === "gradient") {
        const gradFrom = safeWidgetColor(c.gradientFrom);
        const gradTo = safeWidgetColor(c.gradientTo);
        const customGrad =
          gradFrom && gradTo
            ? `linear-gradient(to right, transparent, ${gradFrom}, ${gradTo}, transparent)`
            : color
              ? `linear-gradient(to right, transparent, ${color}, transparent)`
              : undefined;
        return wrap(
          <div
            style={{
              height: `${thickness}px`,
              ...widthStyle,
              ...(customGrad ? { backgroundImage: customGrad } : {}),
            }}
            className={
              customGrad ? "" : "bg-gradient-to-r from-transparent via-border to-transparent"
            }
          />,
        );
      }
      if (variant === "icon") {
        const iconName = getStr(c, "iconName") || "Star";
        const reg = LucideIcons as Record<
          string,
          React.ComponentType<{ size?: number; color?: string }> | undefined
        >;
        const Icon = reg[iconName] ?? LucideIcons.Star;
        const lineStyle: CSSProperties = {
          borderTopWidth: thickness,
          borderTopStyle: "solid",
          ...(color ? { borderTopColor: color } : {}),
        };
        const lineCls = color ? "flex-1 border-t" : "flex-1 border-t border-border";
        const iconColor = safeWidgetColor(c.iconColor);
        return wrap(
          <div
            className="flex items-center gap-3 text-muted-foreground"
            style={{ ...widthStyle, ...(color ? { color } : {}) }}
          >
            <div className={lineCls} style={lineStyle} />
            <Icon size={16} color={iconColor || undefined} />
            <div className={lineCls} style={lineStyle} />
          </div>,
        );
      }
      if (variant === "wave") {
        return wrap(
          <svg
            viewBox="0 0 200 8"
            preserveAspectRatio="none"
            className={color ? "h-3" : "h-3 text-border"}
            style={{ ...widthStyle, ...(color ? { color } : {}) }}
          >
            <path
              d="M0 4 Q 25 0 50 4 T 100 4 T 150 4 T 200 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>,
        );
      }
      const styleType =
        variant === "dashed"
          ? "dashed"
          : variant === "dotted"
            ? "dotted"
            : variant === "double"
              ? "double"
              : "solid";
      // Render as <div> with border-top so width + alignment work reliably
      // (hr has UA quirks with margin/width interplay in some browsers).
      const lineColor = color || "var(--border)";
      const dividerStyle: CSSProperties = {
        borderTopStyle: styleType,
        borderTopWidth: thickness,
        borderTopColor: lineColor,
        height: 0,
        ...widthStyle,
      };
      return wrap(<div role="separator" aria-orientation="horizontal" style={dividerStyle} />);
    }
    case "spacer": {
      // Fresh spacer implementation - responsive height, controlled width,
      // optional background, editor label toggle. Keeps DOM minimal so the
      // widget behaves like a real layout primitive rather than a card.
      const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
      const hDesktop = clamp(getNum(c, "height", 32), 1, 800);
      const hTabletRaw = getNum(c, "heightTablet", 0);
      const hMobileRaw = getNum(c, "heightMobile", 0);
      const hTablet = hTabletRaw > 0 ? clamp(hTabletRaw, 1, 800) : hDesktop;
      const hMobile = hMobileRaw > 0 ? clamp(hMobileRaw, 1, 800) : hTablet;
      const widthPct = clamp(getNum(c, "widthPct", 100), 10, 100);
      const alignRaw = getStr(c, "align") || "left";
      const align: "left" | "center" | "right" =
        alignRaw === "center" ? "center" : alignRaw === "right" ? "right" : "left";
      const margin =
        align === "center" ? "0 auto" : align === "right" ? "0 0 0 auto" : "0 auto 0 0";
      const bgRaw = getStr(c, "bgColor");
      const bg = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(bgRaw) ? bgRaw : "";
      const showLabel = getStr(c, "showLabel") !== "hide";

      const uid = `sp-${(node.id || "x").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 10) || "x"}`;
      const needsResponsive = hTablet !== hDesktop || hMobile !== hTablet;
      const responsiveCss = needsResponsive
        ? `@media (max-width:1023px){.${uid}{height:${hTablet}px !important;}}` +
          `@media (max-width:640px){.${uid}{height:${hMobile}px !important;}}`
        : "";

      const baseStyle: CSSProperties = {
        height: `${hDesktop}px`,
        width: `${widthPct}%`,
        margin,
        ...(bg ? { backgroundColor: bg } : {}),
      };

      if (editable) {
        return (
          <>
            {responsiveCss ? <style>{responsiveCss}</style> : null}
            <div
              className={`${uid} relative flex items-center justify-center rounded-[6px] border border-dashed border-border/70 bg-muted/25`}
              style={baseStyle}
              role="separator"
              aria-orientation="horizontal"
              aria-label={lang === "pl" ? "Odstęp" : "Spacer"}
            >
              {showLabel ? (
                <span className="pointer-events-none select-none text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  ↕ {hDesktop}px · {widthPct}%{align !== "left" ? ` · ${align}` : ""}
                  {needsResponsive ? ` · ↔ ${hTablet}/${hMobile}` : ""}
                </span>
              ) : null}
            </div>
          </>
        );
      }
      return (
        <>
          {responsiveCss ? <style>{responsiveCss}</style> : null}
          <div className={uid} aria-hidden="true" style={baseStyle} />
        </>
      );
    }
    case "social-icons": {
      const size = asNumInRange(c.size, 14, 10, 64);
      const gap = asNumInRange(c.gap, 4, 0, 32);
      const box = size + 6;
      const showEmpty = asStr(c.showEmpty) === "show";
      const colorMode = asOneOf(c.colorMode, SOCIAL_COLOR_MODES, "inherit");
      const customColor = safeWidgetColor(c.customColor);
      const bgMode = asOneOf(c.bgMode, SOCIAL_BG_MODES, "none");
      const customBgColor = safeWidgetColor(c.customBgColor);
      const shape = asStr(c.shape) || "md";
      const themeAdapt = asStr(c.themeAdapt) || "auto";

      const OFFICIAL: Record<string, string> = SOCIAL_OFFICIAL_COLOR;

      const mkIcon =
        (path: string) =>
        ({ size: s = 14 }: { size?: number }) => (
          <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d={path} />
          </svg>
        );
      const XIcon = mkIcon(
        "M18.244 2H21.5l-7.5 8.57L23 22h-6.84l-5.36-6.86L4.6 22H1.34l8.02-9.16L1 2h7.02l4.84 6.27L18.244 2Zm-1.2 18h1.86L7.06 4H5.1l11.944 16Z",
      );
      const FacebookIcon = mkIcon(
        "M12 2C6.48 2 2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c5.05-.5 9-4.76 9-9.95 0-5.52-4.48-10-10-10z",
      );
      const YoutubeIcon = mkIcon(
        "M21.6 7.2c-.2-1-1-1.8-2-2C17.8 5 12 5 12 5s-5.8 0-7.6.2c-1 .2-1.8 1-2 2C2.2 9 2.2 12 2.2 12s0 3 .2 4.8c.2 1 1 1.8 2 2 1.8.2 7.6.2 7.6.2s5.8 0 7.6-.2c1-.2 1.8-1 2-2 .2-1.8.2-4.8.2-4.8s0-3-.2-4.8zM10 15.5v-7l6 3.5-6 3.5z",
      );
      const InstagramIcon = ({ size: s = 14 }: { size?: number }) => (
        <svg
          width={s}
          height={s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="5" ry="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
      const LinkedinIcon = mkIcon(
        "M4.98 3.5a2.5 2.5 0 11-.02 5.02A2.5 2.5 0 014.98 3.5zM3 9h4v12H3V9zm7.5 0h3.8v1.7h.1c.5-.9 1.8-1.9 3.7-1.9 4 0 4.7 2.6 4.7 6V21h-4v-5.4c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9V21h-4V9z",
      );
      const SpotifyIcon = mkIcon(
        "M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.622.622 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.623.623 0 0 1-.276-1.215c3.809-.88 7.076-.502 9.712 1.115a.623.623 0 0 1 .206.857zm1.223-2.722a.78.78 0 0 1-1.072.257c-2.686-1.652-6.785-2.131-9.965-1.165a.781.781 0 0 1-.348-1.525c3.626-1.08 8.12-.543 11.128 1.305a.78.78 0 0 1 .257 1.128zm.105-2.835c-3.223-1.914-8.54-2.09-11.618-1.156a.937.937 0 1 1-.543-1.793c3.53-1.072 9.405-.865 13.115 1.338a.938.938 0 0 1-.954 1.611z",
      );

      type IconCmp = (props: { size?: number }) => ReactElement;
      const items: Array<{ k: string; altKeys?: string[]; Cmp: IconCmp; label: string }> = [
        { k: "facebook", Cmp: FacebookIcon, label: "Facebook" },
        // `x` jest kluczem PLATFORMY: steruje też `ctaX` i mapowaniem na
        // globalne Ikony social (`readGlobal`). Panel zapisuje ten sam klucz i
        // czyta `twitter` jako alias historyczny (`legacyKeys`), więc dokumenty
        // sprzed zmiany nazwy renderują się i pozostają edytowalne.
        { k: "x", altKeys: ["twitter"], Cmp: XIcon, label: "X" },
        { k: "youtube", Cmp: YoutubeIcon, label: "YouTube" },
        { k: "instagram", Cmp: InstagramIcon, label: "Instagram" },
        { k: "linkedin", Cmp: LinkedinIcon, label: "LinkedIn" },
        { k: "spotify", Cmp: SpotifyIcon, label: "Spotify" },
      ];

      const radiusCls =
        shape === "none"
          ? "rounded-none"
          : shape === "sm"
            ? "rounded-sm"
            : shape === "lg"
              ? "rounded-lg"
              : shape === "full"
                ? "rounded-full"
                : shape === "square"
                  ? "rounded-none"
                  : "rounded-md";

      const themeCls =
        themeAdapt === "force-light"
          ? "[color-scheme:light]"
          : themeAdapt === "force-dark"
            ? "[color-scheme:dark]"
            : "";

      // Jawny wybór koloru wygrywa z adaptacją motywu. `themeAdapt` opisuje, co
      // robić z kolorem DZIEDZICZONYM (tryb "inherit"), a nie unieważniać wybór
      // redakcji - przy domyślnym `auto` opcje "ciemne"/"jasne" były no-opem
      // (zawsze currentColor), więc kontrolka wyglądała na zepsutą.
      // Per-platforma: redakcja może nadpisać kolor ikony pojedynczego wiersza
      // (klucz `colorFacebook`, `colorX`, ...). Pusty = wspólny `colorMode`.
      const capKey = (k: string): string => `${k.charAt(0).toUpperCase()}${k.slice(1)}`;
      const perPlatformColor = (k: string): string | undefined =>
        safeWidgetColor(c[`color${capKey(k)}`]) || undefined;

      const resolveColor = (k: string): string | undefined => {
        const own = perPlatformColor(k);
        if (own) return own;
        if (colorMode === "official") return OFFICIAL[k];
        if (colorMode === "custom") return customColor || undefined;
        if (colorMode === "brand") return "var(--brand, currentColor)";
        if (colorMode === "dark") return "#0a0a0a";
        if (colorMode === "light") return "#ffffff";
        return undefined;
      };

      const resolveBg = (k: string, active: boolean): string | undefined => {
        if (!active && showEmpty) return undefined;
        if (bgMode === "none") return undefined;
        if (bgMode === "subtle") return "var(--muted)";
        if (bgMode === "brand") return "var(--brand, currentColor)";
        if (bgMode === "official") return SOCIAL_OFFICIAL_COLORS[k];
        if (bgMode === "contrast") return "var(--foreground)";
        if (bgMode === "custom") return customBgColor || undefined;
        return undefined;
      };

      const linkStyle = compactIconBoxStyle(box);
      const layout = asOneOf(c.layout, ["row", "list"] as const, "row");

      // Wygląd kafelka ikony jest wspólny dla obu układów. Wcześniej „list"
      // rysował sam kolor ikony i ignorował tło (bgMode / customBgColor), więc
      // te same ustawienia działały tylko w jednym układzie.
      //
      // STAN PODSTAWOWY IKONY = `text-foreground` kontenera, czyli atrament
      // motywu: ciemny w light mode, biały w dark mode. To wygląd ustalony na
      // publicznej stronie kontaktu i jedyny, który jest ZE SWOJEJ NATURY
      // spójny w kanwie, w podglądzie panelu i na froncie - nie zależy od
      // żadnego tokenu, który mógłby się nie rozwiązać w jednym z kontekstów.
      //
      // Wcześniejsza próba rozjaśniania stanu podstawowego domieszką marki
      // (`--sb-icon` / `--sb-off-tone` liczone przez `color-mix`) dała dokładnie
      // ten rozjazd, który redakcja zgłosiła: w builderze ikony wychodziły
      // jasnopomarańczowe, a na stronie publicznej zostawały czarne. Rozjaśnienie
      // ikony należy do stanu HOVER (patrz socialHover.ts), nie do spoczynku.
      const chipStyle = (k: string, active: boolean): CSSProperties => {
        const bg = resolveBg(k, active);
        const onContrast = bgMode === "official" && active;
        return {
          ...linkStyle,
          // Na kontrastowym tle marki ikona musi być biała, żeby nie zniknęła.
          // Tryb „oficjalne kolory marek" daje kolor SUROWY - rozjaśniany
          // przestawał być kolorem YouTube'a czy Facebooka, a to obiecuje nazwa.
          color: onContrast ? "#fff" : active ? resolveColor(k) : undefined,
          backgroundColor: bg,
        };
      };

      const linksSource = asOneOf(c.linksSource, ["auto", "global", "own"] as const, "auto");
      const hrefOf = (
        k: string,
        altKeys: string[] | undefined,
        globalLinks: GlobalSocialLinks,
      ): string => {
        const own = getStr(c, k) || (altKeys?.map((ak) => getStr(c, ak)).find(Boolean) ?? "");
        return resolveSocialHref(own, globalLinks, k, linksSource);
      };

      // Ton ikon = dokładnie to, co renderuje strona publiczna:
      // w stanie spoczynku ikona ma kolor tekstu (foreground - ciemny w light
      // mode, jasny w dark mode), a nie odcień marki. Kolory marki pojawiają
      // się tylko wtedy, gdy ustawiono je jawnie (tryb "official" lub kolor
      // per platforma) oraz na hover (arkusz instancji, patrz socialHover.ts).
      const ICON_TONE = [
        "[--sb-icon:currentColor]",
        "[--sb-off-tone:var(--sb-off,currentColor)]",
      ].join(" ");

      // Ustawienia hovera czytamy BEZWARUNKOWO (tak jak `customColor`): działają
      // w obu układach, a bramka wierności widzi je w każdej próbce.
      const hoverPlan: SocialHoverPlan = {
        mode: asOneOf(c.rowHover, SOCIAL_ROW_HOVER_MODES, "brand"),
        tone: asOneOf(c.newsletterTone, SOCIAL_HOUSE_TONES, "amber"),
        iconMode: asOneOf(c.hoverIconMode, SOCIAL_HOVER_ICON_MODES, "auto"),
        rowColor: safeWidgetColor(c.rowHoverColor),
        iconColor: safeWidgetColor(c.hoverIconColor),
      };
      // Arkusz o zasięgu instancji: jedna reguła obsługuje hover, fokus i
      // wymuszony podgląd hovera w panelu buildera. Klasa narzędziowa nie
      // wystarczy - kafelek trzyma kolor w atrybucie `style`, więc kolor ikony
      // na hoverze musi iść z arkusza, z `!important`.
      const hoverSheet = socialHoverStyle(hoverPlan);
      const hoverScope = hoverSheet?.uid ?? "";
      const hoverVars = (k: string): CSSProperties =>
        ({
          "--sb-grad": socialHoverGradient(hoverPlan, k) ?? "none",
          "--sb-ico-h": socialHoverIconColor(hoverPlan, k) ?? "currentColor",
        }) as CSSProperties;
      const hoverCssTag = hoverSheet ? <style>{hoverSheet.css}</style> : null;

      // Newsletter jest wierszem listy jak każda platforma - ta sama ikona w
      // kafelku, separator, etykieta i CTA - żeby nie odstawał wyglądem.
      // Rysunek koperty pochodzi ze wspólnego modułu (socialGlyphs), tego
      // samego, którego używa samodzielny widget „Newsletter".
      const MailIcon = SocialMailIcon;

      const renderSocials = (globalLinks: GlobalSocialLinks): ReactElement => {
        if (layout === "list") {
          // CTA są tłumaczone (PL/EN); pole w panelu nadal nadpisuje domyślną
          // wartość, a klucz z sufiksem języka (`ctaX_pl`) ma pierwszeństwo.
          const defaultCta: Record<string, { pl: string; en: string }> = {
            facebook: { pl: "Polub to", en: "Like" },
            x: { pl: "Obserwuj", en: "Follow" },
            youtube: { pl: "Subskrybuj", en: "Subscribe" },
            instagram: { pl: "Obserwuj", en: "Follow" },
            linkedin: { pl: "Obserwuj", en: "Follow" },
            spotify: { pl: "Obserwuj", en: "Follow" },
            newsletter: { pl: "Subskrybuj", en: "Subscribe" },
          };

          // Domyślnie kierujemy na publiczną stronę "Dołącz do newslettera";
          // wersja EN dostaje prefiks językowy tej samej strony.
          const newsletterHref =
            getStr(c, "newsletterUrl") ||
            localizedPath("/dolacz-do-newslettera", lang === "en" ? "en" : "pl");
          const listItems: Array<{
            k: string;
            altKeys?: string[];
            Cmp: IconCmp;
            label: string;
            href: string;
            external: boolean;
          }> = [
            ...items.map((it) => ({
              ...it,
              href: hrefOf(it.k, it.altKeys, globalLinks),
              external: true,
            })),
          ];
          if (getStr(c, "showNewsletter") !== "0") {
            listItems.push({
              k: "newsletter",
              Cmp: MailIcon,
              label: "Newsletter",
              href: newsletterHref,
              external: /^https?:/i.test(newsletterHref),
            });
          }

          const rows = listItems
            .map(({ k, Cmp, label, href, external }) => {
              if (!href && !showEmpty) return null;
              const ctaKey = `cta${k.charAt(0).toUpperCase()}${k.slice(1)}`;
              const target = lang === "pl" ? "pl" : "en";
              // Zapisane wcześniej etykiety bywają jednojęzyczne (np. "Like").
              // Jeśli nadpisanie jest jedną ze znanych fraz, tłumaczymy je na
              // aktualny język zamiast pokazywać angielski tekst w PL.
              const CTA_SYNONYMS: Record<string, { pl: string; en: string }> = {
                like: { pl: "Polub to", en: "Like" },
                "lubię to": { pl: "Polub to", en: "Like" },
                "lubie to": { pl: "Polub to", en: "Like" },
                "polub to": { pl: "Polub to", en: "Like" },
                follow: { pl: "Obserwuj", en: "Follow" },
                obserwuj: { pl: "Obserwuj", en: "Follow" },
                subscribe: { pl: "Subskrybuj", en: "Subscribe" },
                subskrybuj: { pl: "Subskrybuj", en: "Subscribe" },
              };
              // Panel zapisuje CTA per język (`ctaX_pl` / `ctaX_en`). Klucz
              // BEZJĘZYKOWY to treść sprzed tej zmiany - czytamy go WYŁĄCZNIE,
              // gdy dokument nie ma żadnej wersji językowej, bo inaczej
              // wyczyszczone PL podstawiałoby angielski tekst (przeciek PL/EN).
              const hasLocalizedCta = Boolean(
                getStr(c, `${ctaKey}_pl`) || getStr(c, `${ctaKey}_en`),
              );
              const rawCta =
                getStr(c, `${ctaKey}_${lang}`) || (hasLocalizedCta ? "" : getStr(c, ctaKey));
              const cta = rawCta
                ? (CTA_SYNONYMS[rawCta.trim().toLowerCase()]?.[target] ?? rawCta)
                : (defaultCta[k]?.[target] ?? "");
              const rowVars = hoverVars(k);
              return (
                <AppLink
                  key={k}
                  href={href ? safeUrl(href) : "#"}
                  aria-label={label}
                  target={href && external ? "_blank" : undefined}
                  rel={href && external ? "noopener noreferrer" : undefined}
                  // Odnośnik zewnętrzny, ale wygląda jak wiersz listy, nie jak
                  // hiperłącze. Gradient i ton ikony na hoverze podaje wiersz
                  // (`--sb-grad` / `--sb-ico-h`), a maluje je arkusz instancji -
                  // ta sama reguła obsługuje fokus i podgląd hovera w panelu.
                  style={{ textDecoration: "none", ...rowVars }}
                  className={`${SB_ROW} flex items-center gap-3 rounded-[6px] border-b border-border/60 px-2 py-2.5 no-underline last:border-b-0 ${!href ? "pointer-events-none opacity-40" : ""}`}
                >
                  <span
                    className={`${SB_CHIP} inline-flex items-center justify-center ${radiusCls} shrink-0 transition-colors`}
                    style={chipStyle(k, Boolean(href))}
                  >
                    <Cmp size={size} />
                  </span>
                  <span
                    className={`${SB_SEP} mx-1 h-4 w-px shrink-0 bg-border/70 transition-colors`}
                    aria-hidden="true"
                  />
                  <span
                    className={`${SB_LABEL} flex-1 truncate text-sm font-medium text-foreground transition-colors`}
                  >
                    {label}
                  </span>
                  {cta && (
                    <span
                      className={`${SB_CTA} shrink-0 text-xs uppercase tracking-wide text-muted-foreground transition-colors`}
                    >
                      {cta}
                    </span>
                  )}
                </AppLink>
              );
            })
            .filter(Boolean);
          return (
            <>
              <div
                className={`flex w-full flex-col text-foreground ${ICON_TONE} ${themeCls} ${hoverScope}`}
                style={{ ...compactRowStyle, gap: `${gap}px` }}
              >
                {rows}
              </div>
              {hoverCssTag}
            </>
          );
        }

        // Newsletter jest w układzie „rząd" takim samym kafelkiem jak
        // platformy społecznościowe: ten sam rozmiar, kształt, tło i hover.
        // Wcześniej rendrował się wyłącznie w układzie „lista", więc redakcja
        // musiała dokładać osobny widget newslettera, który wyglądał inaczej.
        const rowNewsletterHref =
          getStr(c, "newsletterUrl") ||
          localizedPath("/dolacz-do-newslettera", lang === "en" ? "en" : "pl");
        const rowItems: Array<{
          k: string;
          altKeys?: string[];
          Cmp: IconCmp;
          label: string;
          href?: string;
          external?: boolean;
        }> = [...items];
        if (getStr(c, "showNewsletter") !== "0") {
          rowItems.push({
            k: "newsletter",
            Cmp: MailIcon,
            label: "Newsletter",
            href: rowNewsletterHref,
            external: /^https?:/i.test(rowNewsletterHref),
          });
        }

        return (
          <>
            <div
              className={`flex flex-wrap items-center text-foreground ${ICON_TONE} ${themeCls} ${hoverScope}`}
              style={{ ...compactRowStyle, gap: `${gap}px` }}
            >
              {rowItems.map(({ k, altKeys, Cmp, label, href: fixedHref, external }) => {
                const href = fixedHref ?? hrefOf(k, altKeys, globalLinks);
                const active = !!href;
                if (!active && !showEmpty) return null;
                const isExternal = external ?? true;
                const bg = resolveBg(k, active);
                const style: CSSProperties = {
                  ...chipStyle(k, active),
                  ...hoverVars(k),
                  opacity: active ? 1 : 0.35,
                };
                // Kafelek nieaktywny nie dostaje klasy hovera - podświetlanie
                // ikony bez linku obiecywałoby działanie, którego nie ma. Gdy
                // ustawienia nie malują hovera (tryb „brak"), zostaje dawne
                // przygaszenie, żeby kafelek nie stał się zupełnie martwy.
                const tileHover = hoverSheet ? SB_TILE : "hover:opacity-80";
                const cls = `inline-flex items-center justify-center ${radiusCls} transition-colors shrink-0 ${active ? tileHover : "cursor-not-allowed"} ${!bg ? "hover:bg-muted/40" : ""}`;
                return active ? (
                  <AppLink
                    key={k}
                    href={safeUrl(href)}
                    aria-label={label}
                    title={label}
                    target={isExternal ? "_blank" : undefined}
                    rel={isExternal ? "noopener noreferrer" : undefined}
                    className={cls}
                    style={style}
                  >
                    <Cmp size={size} />
                  </AppLink>
                ) : (
                  <span
                    key={k}
                    aria-label={`${label} (${lang === "pl" ? "brak linku" : "no link"})`}
                    className={cls}
                    style={style}
                  >
                    <Cmp size={size} />
                  </span>
                );
              })}
            </div>

            {hoverCssTag}
          </>
        );
      };

      return <WithGlobalSocials render={renderSocials} />;
    }

    case "lang-switcher": {
      const label =
        getStr(c, `label_${lang}`) ||
        getStr(c, "label_pl") ||
        (lang === "pl" ? "Zmień język" : "Change language");
      return (
        <div className="inline-flex items-center text-xs leading-none" style={compactRowStyle}>
          {/* Widoczne są wyłącznie flagi z animowanym kciukiem; etykieta
              służy tylko jako aria-label dla czytników ekranu. */}
          <LangSwitcherDropdown label={label} />
        </div>
      );
    }

    case "theme-toggle":
      return <ThemeToggleWidget />;
    case "account-link": {
      return <AccountMenuWidget config={c as unknown as AccountMenuConfig} lang={lang} />;
    }
    case "search-button": {
      const label = getStr(c, `label_${lang}`) || getStr(c, "label_pl") || "Szukaj";
      const mode = (getStr(c, "mode") || "dropdown") as "standalone" | "dropdown" | "fullscreen";
      const heading = getStr(c, `heading_${lang}`) || getStr(c, "heading_pl") || "";
      const liveResults = getStr(c, "liveResults") !== "off";
      const limit = getNum(c, "limit", 8);
      const height = getNum(c, "height", 40);
      const radius = getNum(c, "radius", 6);
      const fontSize = getNum(c, "fontSize", 14);
      return (
        <SearchButtonWidget
          label={label}
          mode={mode}
          heading={heading}
          liveResults={liveResults}
          limit={limit}
          lang={lang}
          height={height}
          radius={radius}
          fontSize={fontSize}
        />
      );
    }

    case "copyright": {
      const txt = getStr(c, `text_${lang}`) || getStr(c, "text_pl");
      const showYear = c.showYear !== false;
      const brand = getStr(c, "brand");
      return (
        <div className="text-xs text-muted-foreground text-center">
          {/* Rok w STREFIE SERWISU, nie w strefie maszyny - patrz siteYear(). */}
          {showYear && `© ${siteYear()} `}
          {brand}
          {brand && txt ? ". " : ""}
          {txt}
          {txt && "."}
        </div>
      );
    }
    case "icon": {
      const name = getStr(c, "name") || "star";
      const size = getNum(c, "size", 32);
      const variant = getStr(c, "variant") || "plain";
      const spin = getStr(c, "spin") || "none";
      const spinCls =
        spin === "spin"
          ? "animate-spin"
          : spin === "pulse"
            ? "animate-pulse"
            : spin === "bounce"
              ? "animate-bounce"
              : "";
      const wrapperCls =
        variant === "circle"
          ? "inline-flex items-center justify-center rounded-full bg-brand/10 text-brand p-3"
          : variant === "square"
            ? "inline-flex items-center justify-center rounded-md bg-brand/10 text-brand p-3"
            : variant === "soft"
              ? "inline-flex items-center justify-center rounded-lg bg-muted p-3"
              : variant === "outlined"
                ? "inline-flex items-center justify-center rounded-lg border border-border p-3"
                : "inline-flex";
      return (
        <span key={`${name}-${size}-${variant}`} className={`${wrapperCls} ${spinCls}`.trim()}>
          <DynamicIcon name={name} size={size} />
        </span>
      );
    }
    case "map": {
      const q = getStr(c, "query") || "Warszawa";
      const ratio = getStr(c, "ratio") || "16/9";
      const src = `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
      // Deferred mount: the Google Maps subframe used to load eagerly on every
      // page containing this widget; now it mounts only near the viewport.
      return (
        <DeferredFrame
          src={src}
          title={q}
          className="rounded overflow-hidden"
          style={{ aspectRatio: ratio.replace("/", " / ") }}
          placeholder={<LucideIcons.MapPin className="h-6 w-6" aria-hidden />}
        />
      );
    }
    case "video": {
      const url = getStr(c, "url");
      const ratio = getStr(c, "ratio") || "16/9";
      const autoplay = getStr(c, "autoplay") === "on";
      const loop = getStr(c, "loop") === "on";
      const controls = getStr(c, "controls") !== "off";
      const ratioStyle: CSSProperties = { aspectRatio: ratio.replace("/", " / ") };
      if (!url)
        return (
          <div
            className="bg-muted rounded flex items-center justify-center text-xs text-muted-foreground"
            style={ratioStyle}
          >
            brak wideo
          </div>
        );
      const ytMatch = url.match(/(?:youtube\.com\/.*v=|youtu\.be\/)([\w-]+)/);
      if (ytMatch) {
        const params = new URLSearchParams();
        if (autoplay) {
          params.set("autoplay", "1");
          params.set("mute", "1");
        }
        if (loop) {
          params.set("loop", "1");
          params.set("playlist", ytMatch[1]);
        }
        if (!controls) params.set("controls", "0");
        const q = params.toString();
        return (
          <div style={ratioStyle}>
            <iframe
              src={`https://www.youtube.com/embed/${ytMatch[1]}${q ? `?${q}` : ""}`}
              title="video"
              className="w-full h-full rounded"
              allowFullScreen
            />
          </div>
        );
      }
      const safe = safeImageUrl(url) || (url.startsWith("https://") ? url : "");
      if (!safe)
        return (
          <div
            className="bg-muted rounded flex items-center justify-center text-xs text-muted-foreground"
            style={ratioStyle}
          >
            niedozwolony URL
          </div>
        );
      return (
        <video
          src={safe}
          controls={controls}
          autoPlay={autoplay}
          muted={autoplay}
          loop={loop}
          playsInline
          className="w-full rounded"
          style={ratioStyle}
        />
      );
    }
    case "gallery": {
      const imgs = getStrArr(c, "images").map(safeImageUrl).filter(Boolean);
      const cols = getNum(c, "columns", 3);
      const variant = getStr(c, "variant") || "grid";
      const gap = getStr(c, "gap") || "sm";
      const gapCls =
        gap === "none"
          ? "gap-0"
          : gap === "xs"
            ? "gap-1"
            : gap === "md"
              ? "gap-4"
              : gap === "lg"
                ? "gap-6"
                : "gap-2";
      if (imgs.length === 0)
        return (
          <div className="bg-muted rounded h-24 flex items-center justify-center text-xs text-muted-foreground">
            {lang === "pl" ? "brak zdjęć" : "no images"}
          </div>
        );
      // Przełącznik "Lightbox" jest ustawieniem redakcji, a nie właściwością
      // wariantu: pełny ekran działa w siatce, masonry, polaroidzie i karuzeli
      // jednakowo. `GalleryLightboxZone` wnosi stan i overlay, a przez
      // render-prop `trigger` opakowuje każdy kafel - dzięki temu gałąź switcha
      // pozostaje bezstanowa (hooki nie mogą żyć w `case`).
      const lightbox = asBool(c["lightbox"], false);
      return (
        <GalleryLightboxZone images={imgs} enabled={lightbox} lang={lang}>
          {(trigger) => {
            if (variant === "carousel") {
              return (
                <div className={`flex ${gapCls} overflow-x-auto snap-x pb-2`}>
                  {imgs.map((src, i) =>
                    trigger(
                      i,
                      <WidgetMediaImage
                        src={src}
                        alt=""
                        frameClassName="relative block aspect-[4/3] w-full overflow-hidden rounded bg-muted"
                        sizes="(max-width: 640px) 80vw, (max-width: 1024px) 42vw, 30vw"
                      />,
                      "flex-[0_0_80%] snap-start sm:flex-[0_0_42%] lg:flex-[0_0_30%]",
                    ),
                  )}
                </div>
              );
            }
            if (variant === "masonry") {
              return (
                <div
                  style={{
                    columnCount: cols,
                    columnGap: gap === "lg" ? "1.5rem" : gap === "md" ? "1rem" : "0.5rem",
                  }}
                >
                  {imgs.map((src, i) =>
                    trigger(
                      i,
                      <OptimizedImage
                        src={src}
                        alt=""
                        responsive
                        sizes="(max-width: 767px) 100vw, 33vw"
                        className="block w-full rounded"
                      />,
                      "mb-2 break-inside-avoid",
                    ),
                  )}
                </div>
              );
            }
            if (variant === "polaroid") {
              return (
                <div
                  data-widget-grid
                  className={`grid ${gapCls}`}
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                >
                  {imgs.map((src, i) =>
                    trigger(
                      i,
                      <span className="block bg-white p-2 pb-5 shadow-lg rotate-[-1deg] transition hover:rotate-0">
                        <WidgetMediaImage
                          src={src}
                          alt=""
                          frameClassName="relative block aspect-[4/3] w-full overflow-hidden bg-muted"
                          sizes="(max-width: 767px) 100vw, 33vw"
                        />
                      </span>,
                    ),
                  )}
                </div>
              );
            }
            return (
              <div
                data-widget-grid
                className={`grid ${gapCls}`}
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
              >
                {imgs.map((src, i) =>
                  trigger(
                    i,
                    <WidgetMediaImage
                      src={src}
                      alt=""
                      frameClassName="relative block aspect-[4/3] w-full overflow-hidden rounded bg-muted"
                      sizes="(max-width: 767px) 100vw, 33vw"
                    />,
                  ),
                )}
              </div>
            );
          }}
        </GalleryLightboxZone>
      );
    }
    case "image": {
      return (
        <ImageWidget
          c={c}
          lang={lang}
          theme={theme}
          editable={editable}
          onContentChange={onContentChange}
        />
      );
    }
    case "slider": {
      // Auto-route to posts source when explicitly set OR when all manual
      // items are placeholders (no image, no post binding) so legacy
      // "Pierwszy/Drugi slajd" defaults render real published posts. The
      // predicate is shared with the SSR prefetch registry so the server
      // warms exactly the query this branch will read.
      if (sliderUsesPostsSource(c)) {
        return <PostsSliderWidget c={c} lang={lang} typography={typography} />;
      }

      const rawItems = Array.isArray(c.items)
        ? (c.items as unknown[]).filter(
            (x): x is Record<string, unknown> => typeof x === "object" && x !== null,
          )
        : [];
      const hasRealItems = rawItems.length > 0;
      // In the builder canvas, fall back to demo slides so changing the
      // variant on the left is immediately reflected on the right preview
      // even before the user adds any images. On the published site
      // (editable=false) we still show the empty placeholder.
      const sampleItems =
        !hasRealItems && editable
          ? [
              {
                image: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1200",
                title_pl: "Przykładowy slajd",
                title_en: "Sample slide",
                subtitle_pl: "Podgląd wariantu – dodaj własne slajdy poniżej",
                subtitle_en: "Variant preview – add your own slides below",
                href: "#",
                cta_pl: "Zobacz",
                cta_en: "View",
              },
              {
                image: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200",
                title_pl: "Drugi slajd",
                title_en: "Second slide",
                subtitle_pl: "Podtytuł",
                subtitle_en: "Subtitle",
                href: "#",
                cta_pl: "Zobacz",
                cta_en: "View",
              },
              {
                image: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1200",
                title_pl: "Trzeci slajd",
                title_en: "Third slide",
                subtitle_pl: "Podtytuł",
                subtitle_en: "Subtitle",
                href: "#",
                cta_pl: "Zobacz",
                cta_en: "View",
              },
            ]
          : rawItems.map((it) => ({
              image: typeof it.image === "string" ? it.image : "",
              title_pl: typeof it.title_pl === "string" ? it.title_pl : "",
              title_en: typeof it.title_en === "string" ? it.title_en : "",
              subtitle_pl: typeof it.subtitle_pl === "string" ? it.subtitle_pl : "",
              subtitle_en: typeof it.subtitle_en === "string" ? it.subtitle_en : "",
              href: typeof it.href === "string" ? it.href : "",
              cta_pl: typeof it.cta_pl === "string" ? it.cta_pl : "",
              cta_en: typeof it.cta_en === "string" ? it.cta_en : "",
            }));
      const cfg = {
        variant: (getStr(c, "variant") || "classic") as SliderVariant,
        ratio: (getStr(c, "ratio") || "16/9") as "16/9" | "4/3" | "1/1" | "21/9" | "3/2",
        // Jawna wartość z inspektora wygrywa; brak = globalny default karuzeli
        // (Motyw -> Karuzele), rozstrzygany w SliderRender.
        autoplay: typeof c.autoplay === "boolean" ? c.autoplay : undefined,
        intervalMs: typeof c.intervalMs === "number" ? c.intervalMs : undefined,
        rounded: (getStr(c, "rounded") || "md") as "none" | "sm" | "md" | "lg" | "xl" | "full",
        overlayOpacity: typeof c.overlayOpacity === "number" ? c.overlayOpacity : 0.45,
        titleSizePx: typeof c.titleSizePx === "number" ? c.titleSizePx : undefined,
        titleWeight: typeof c.titleWeight === "number" ? c.titleWeight : undefined,
        subtitleSizePx: typeof c.subtitleSizePx === "number" ? c.subtitleSizePx : undefined,
        subtitleWeight: typeof c.subtitleWeight === "number" ? c.subtitleWeight : undefined,
        columns:
          typeof c.columns === "number"
            ? (Math.max(1, Math.min(4, c.columns)) as 1 | 2 | 3 | 4)
            : undefined,
        navSizePx: typeof c.navSizePx === "number" ? c.navSizePx : undefined,
        navRoundedPx: typeof c.navRoundedPx === "number" ? c.navRoundedPx : undefined,
        navBgColor: typeof c.navBgColor === "string" ? c.navBgColor : undefined,
        navArrowColor: typeof c.navArrowColor === "string" ? c.navArrowColor : undefined,
        navBgStyle: (typeof c.navBgStyle === "string" ? c.navBgStyle : undefined) as
          "glass" | "solid" | "outline" | "soft" | "gradient" | "shadow" | undefined,
        navPosition: (typeof c.navPosition === "string" ? c.navPosition : undefined) as
          "mid" | "mid-outside" | "bottom" | "top" | undefined,
        navArrowVariant: (typeof c.navArrowVariant === "string" ? c.navArrowVariant : undefined) as
          | "chevron"
          | "chevron-bold"
          | "arrow"
          | "arrow-long"
          | "caret"
          | "angle"
          | "double-chevron"
          | "arrow-tail"
          | undefined,
        navArrowStroke: typeof c.navArrowStroke === "number" ? c.navArrowStroke : undefined,
        items: sampleItems,
      };
      if (!hasRealItems && editable) {
        return (
          <div className="relative w-full">
            <SliderRender config={{ ...cfg, typography }} lang={lang} />
            <div className="pointer-events-none absolute top-2 left-2 z-10 rounded-md bg-background/85 backdrop-blur px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground border border-border">
              {lang === "pl"
                ? "Podgląd · dodaj slajdy w panelu"
                : "Preview · add slides in the panel"}
            </div>
          </div>
        );
      }
      return <SliderRender config={{ ...cfg, typography }} lang={lang} />;
    }
    case "animated-heading": {
      const rotateRaw = c[`rotateWords_${lang}`] ?? c.rotateWords_pl;
      const rotateWords = Array.isArray(rotateRaw)
        ? rotateRaw.filter((x): x is string => typeof x === "string")
        : typeof rotateRaw === "string"
          ? rotateRaw
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      const rawColor = getStr(c, "color") || undefined;
      const rawAccent = getStr(c, "accentColor") || undefined;
      // Auto-invert when rendering in dark mode and the user set a single
      // (light-mode) color - so headings stay readable on dark backgrounds.
      const isDark = theme === "dark";
      const ahCfg: AnimatedHeadingConfig = {
        mode: (getStr(c, "mode") || "highlight") as AnimatedHeadingMode,
        shape: (getStr(c, "shape") || "underline") as AnimatedHeadingShape,
        tag: (getStr(c, "tag") || "h2") as AnimatedHeadingConfig["tag"],
        align: (getStr(c, "align") || "left") as "left" | "center" | "right",
        textBefore: getStr(c, `textBefore_${lang}`) || getStr(c, "textBefore_pl"),
        textAfter: getStr(c, `textAfter_${lang}`) || getStr(c, "textAfter_pl"),
        highlight: getStr(c, `highlight_${lang}`) || getStr(c, "highlight_pl"),
        rotateWords,
        color: isDark && rawColor ? autoInvertColor(rawColor, "dark") : rawColor,
        accentColor: isDark && rawAccent ? autoInvertColor(rawAccent, "dark") : rawAccent,
        durationMs: getNum(c, "durationMs", 1600),
        delayMs: getNum(c, "delayMs", 200),
        loop: c.loop !== false,
        linkBefore: toAnimatedHeadingLink(c.linkBefore),
        linkWhole: toAnimatedHeadingLink(c.linkWhole),
        linkHighlight: toAnimatedHeadingLink(c.linkHighlight),
        linkAfter: toAnimatedHeadingLink(c.linkAfter),
      };
      return <AnimatedHeadingWithDynamicText config={ahCfg} lang={lang} />;
    }
    case "text-rotate": {
      const rawTexts = c[`texts_${lang}`] ?? c.texts_pl;
      const texts = Array.isArray(rawTexts)
        ? rawTexts.filter((x): x is string => typeof x === "string")
        : typeof rawTexts === "string"
          ? rawTexts
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      const trTag = (getStr(c, "tag") || "h2") as "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "span";
      const trAlign = (getStr(c, "align") || "left") as "left" | "center" | "right";
      const splitBy = (getStr(c, "splitBy") || "characters") as "characters" | "words" | "lines";
      const staggerFrom = (getStr(c, "staggerFrom") || "first") as "first" | "last" | "center";
      const before = getStr(c, `before_${lang}`) || getStr(c, "before_pl");
      const after = getStr(c, `after_${lang}`) || getStr(c, "after_pl");
      const rawColor = getStr(c, "color") || undefined;
      const rawAccent = getStr(c, "accentColor") || undefined;
      const isDark = theme === "dark";
      const color = isDark && rawColor ? autoInvertColor(rawColor, "dark") : rawColor;
      const accent = isDark && rawAccent ? autoInvertColor(rawAccent, "dark") : rawAccent;
      const interval = getNum(c, "rotationInterval", 2200);
      const stagger = getNum(c, "staggerDurationMs", 30);
      const transitionMs = getNum(c, "transitionMs", 450);
      const loop = c.loop !== false;
      const auto = c.auto !== false;
      const Tag = trTag;
      const alignCls =
        trAlign === "center" ? "text-center" : trAlign === "right" ? "text-right" : "text-left";
      const safeTexts = texts.length ? texts : [""];
      return (
        <Tag className={`m-0 font-semibold ${alignCls}`} style={color ? { color } : undefined}>
          {before && <span className="mr-1">{before}</span>}
          <span style={accent ? { color: accent } : undefined} className="inline-block">
            <TextRotate
              texts={safeTexts}
              splitBy={splitBy}
              rotationInterval={interval}
              staggerDurationMs={stagger}
              transitionMs={transitionMs}
              loop={loop}
              auto={auto}
              staggerFrom={staggerFrom}
            />
          </span>
          {after && <span className="ml-1">{after}</span>}
        </Tag>
      );
    }
    case "contact":
      // Legacy alias: delegate to the full-featured contact-form renderer.
      return <ContactFormView data={(node.content ?? {}) as Record<string, unknown>} lang={lang} />;

    case "accordion":
      // Lazy (AccordionWidget): jedyny konsument sanitizeHtml/DOMPurify w tym
      // module - statyczna krawędź trzymała DOMPurify w chunku wejściowym.
      return <AccordionWidget content={c} lang={lang} />;
    case "timeline": {
      const entries = Array.isArray(c.entries) ? (c.entries as Array<Record<string, unknown>>) : [];
      const Icons = LucideIcons as Record<string, React.ComponentType<{ className?: string }>>;
      const strOf = (v: unknown): string => (typeof v === "string" ? v : "");
      return (
        <div className="w-full">
          {entries.map((entry, idx) => {
            const kind = strOf(entry.type) || "item";
            if (kind === "heading") {
              const date = strOf(entry[`date_${lang}`]) || strOf(entry.date_pl);
              if (!date) return null;
              return (
                <div key={idx} className="ps-2 my-2 first:mt-0">
                  <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {date}
                  </h3>
                </div>
              );
            }
            const title = strOf(entry[`title_${lang}`]) || strOf(entry.title_pl);
            const desc = strOf(entry[`desc_${lang}`]) || strOf(entry.desc_pl);
            const iconType = strOf(entry.iconType) || "avatar";
            const avatar = safeImageUrl(strOf(entry.avatar));
            const initials = (strOf(entry.initials) || "?").slice(0, 2).toUpperCase();
            const iconName = strOf(entry.iconName) || "FileText";
            const IconCmp = Icons[iconName] || Icons.FileText;
            const titleIconName = strOf(entry.titleIconName);
            const TitleIcon = titleIconName ? Icons[titleIconName] : undefined;
            const actorName = strOf(entry.actorName);
            const actorAvatar = safeImageUrl(strOf(entry.actorAvatar));
            const actorInitials = (strOf(entry.actorInitials) || "?").slice(0, 2).toUpperCase();
            const actorHref = safeUrl(strOf(entry.actorHref));
            const isLast = idx === entries.length - 1;
            return (
              <div key={idx} className="flex gap-x-3">
                <div
                  className={`relative ${isLast ? "" : "after:absolute after:top-7 after:bottom-0 after:start-3.5 after:-translate-x-[0.5px] after:border-s after:border-border"}`}
                >
                  <div className="relative z-10 size-7 flex justify-center items-center">
                    {iconType === "avatar" && avatar ? (
                      <img
                        src={buildAvatarSrc(avatar, 28)}
                        srcSet={buildAvatarSrcSet(avatar, 28) || undefined}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="shrink-0 size-7 rounded-[6px] object-cover border border-border"
                      />
                    ) : iconType === "lucide" && IconCmp ? (
                      <span className="flex shrink-0 justify-center items-center size-7 bg-muted border border-border text-foreground rounded-[6px]">
                        <IconCmp className="size-4" />
                      </span>
                    ) : (
                      <span className="flex shrink-0 justify-center items-center size-7 bg-muted border border-border text-[11px] font-semibold uppercase text-foreground rounded-[6px]">
                        {initials}
                      </span>
                    )}
                  </div>
                </div>
                <div className="grow pt-0.5 pb-8">
                  {title && (
                    <h3 className="flex gap-x-1.5 font-medium text-sm text-foreground">
                      {TitleIcon && <TitleIcon className="shrink-0 size-4 mt-0.5" />}
                      <span>{title}</span>
                    </h3>
                  )}
                  {desc && (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{desc}</p>
                  )}
                  {actorName &&
                    (() => {
                      const inner = (
                        <>
                          {actorAvatar ? (
                            <img
                              src={buildAvatarSrc(actorAvatar, 16)}
                              srcSet={buildAvatarSrcSet(actorAvatar, 16) || undefined}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="shrink-0 size-4 rounded-[6px] object-cover border border-border"
                            />
                          ) : (
                            <span className="flex shrink-0 justify-center items-center size-4 bg-muted border border-border text-[9px] font-semibold uppercase text-foreground rounded-[6px]">
                              {actorInitials}
                            </span>
                          )}
                          <span>{actorName}</span>
                        </>
                      );
                      return actorHref ? (
                        <AppLink
                          href={actorHref}
                          className="mt-1 -ms-1 p-1 inline-flex items-center gap-x-2 text-[11px] rounded-[6px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                          {inner}
                        </AppLink>
                      ) : (
                        <span className="mt-1 -ms-1 p-1 inline-flex items-center gap-x-2 text-[11px] rounded-[6px] text-muted-foreground">
                          {inner}
                        </span>
                      );
                    })()}
                </div>
              </div>
            );
          })}
        </div>
      );
    }
    case "logo-cloud": {
      const heading = getStr(c, `heading_${lang}`) || getStr(c, "heading_pl");
      const logosRaw = Array.isArray(c.logos) ? (c.logos as Array<Record<string, unknown>>) : [];
      const strOf = (v: unknown): string => (typeof v === "string" ? v : "");
      const logos = logosRaw
        .map((l) => ({
          src: safeImageUrl(strOf(l.src)),
          href: safeUrl(strOf(l.href)),
          alt: strOf(l.alt) || strOf(l.label),
          label: strOf(l.label),
        }))
        .filter((l) => l.src || l.label);
      const rawSpeed = typeof c.speedSeconds === "number" ? c.speedSeconds : 40;
      const speed = Math.max(8, Math.min(180, rawSpeed));
      const pauseOnHover = c.pauseOnHover !== false;
      const fadeEdges = c.fadeEdges !== false;
      const grayscale = c.grayscale !== false;
      if (logos.length === 0) {
        return (
          <div className="w-full rounded-[6px] border border-dashed border-border bg-muted/20 py-6 text-center text-xs text-muted-foreground">
            {lang === "pl"
              ? "Dodaj logo w panelu właściwości."
              : "Add logos in the properties panel."}
          </div>
        );
      }
      const doubled = [...logos, ...logos];
      const fadeCls = fadeEdges
        ? "before:pointer-events-none before:absolute before:inset-y-0 before:start-0 before:z-[2] before:w-20 before:bg-[linear-gradient(to_right,var(--background),transparent)] after:pointer-events-none after:absolute after:inset-y-0 after:end-0 after:z-[2] after:w-20 after:bg-[linear-gradient(to_left,var(--background),transparent)]"
        : "";
      return (
        <div className="w-full">
          {heading && (
            <h3 className="mb-4 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {heading}
            </h3>
          )}
          <div
            className={`relative overflow-hidden ${fadeCls} ${pauseOnHover ? "lc-pause-hover" : ""}`}
            style={{ ["--marquee-duration" as string]: `${speed}s` }}
            aria-label={lang === "pl" ? "Karuzela logo" : "Logo cloud"}
          >
            <div className="lc-track items-center">
              {doubled.map((l, i) => {
                const inner = l.src ? (
                  <img
                    src={l.src}
                    alt={l.alt}
                    loading="lazy"
                    decoding="async"
                    className={`w-20 md:w-28 h-12 object-contain rounded-[6px] ${grayscale ? "grayscale opacity-70 hover:grayscale-0 hover:opacity-100 transition-[filter,opacity] duration-300" : ""}`}
                  />
                ) : (
                  <span className="px-3 py-2 text-xs font-medium text-muted-foreground">
                    {l.label}
                  </span>
                );
                return (
                  <div
                    key={`${i}-${l.src || l.label}`}
                    className="px-4 md:px-8 w-40 md:w-64 h-12 flex shrink-0 justify-center items-center"
                    aria-hidden={i >= logos.length}
                  >
                    {l.href ? (
                      <AppLink
                        href={l.href}
                        className="inline-flex items-center justify-center rounded-[6px]"
                        aria-label={l.alt || l.label}
                      >
                        {inner}
                      </AppLink>
                    ) : (
                      inner
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    }
    case "testimonial": {
      const quote = getStr(c, `quote_${lang}`) || getStr(c, "quote_pl");
      const author = getStr(c, "author");
      const role = getStr(c, `role_${lang}`) || getStr(c, "role_pl");
      const avatar = safeImageUrl(getStr(c, "avatar"));
      const rating = getNum(c, "rating", 0);
      const variant = getStr(c, "variant") || "card";
      const containerCls =
        variant === "minimal"
          ? "space-y-3"
          : variant === "quote"
            ? "relative pl-10 space-y-3"
            : variant === "centered"
              ? "text-center space-y-4 max-w-xl mx-auto"
              : "bg-muted/30 rounded-lg p-6 space-y-4";
      const stars = rating > 0 && (
        <div
          className={`flex gap-0.5 text-brand ${variant === "centered" ? "justify-center" : ""}`}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <LucideIcons.Star key={i} size={14} fill={i < rating ? "currentColor" : "none"} />
          ))}
        </div>
      );
      return (
        <figure className={containerCls}>
          {variant === "quote" && (
            <LucideIcons.Quote className="absolute left-0 top-0 w-7 h-7 text-brand/40" />
          )}
          {stars}
          <blockquote className="cms-post-excerpt italic">"{quote}"</blockquote>
          <figcaption
            className={`flex flex-wrap items-center gap-3 ${variant === "centered" ? "justify-center" : ""}`}
          >
            <AuthorByline
              name={author}
              avatarUrl={avatar}
              display={resolveAuthorDisplay(c, lang, widgetAuthorDisplayDefaults("testimonial", c))}
            />
            {role && <div className="cms-meta text-muted-foreground">{role}</div>}
          </figcaption>
        </figure>
      );
    }
    case "team-member": {
      // `editable` musi dojechać do komponentu - bez tego guard w
      // TeamMemberWidget (modal bio nie otwiera się w kanwie) był martwy.
      return <TeamMemberWidget node={node} lang={lang} editable={editable} />;
    }
    case "author-profile-card": {
      return <AuthorProfileCardWidget node={node} lang={lang} />;
    }
    case "speakers": {
      return <SpeakersWidget node={node} lang={lang} />;
    }
    case "interactive-circle": {
      return <InteractiveCircleWidget node={node} lang={lang} />;
    }
    case "pricing": {
      // Tryb „plans": karty czytane z katalogu access_plans (spójne z /pricing,
      // panelem admina i cenami u operatora). Tryb domyślny: ręczne wartości.
      if (getStr(c, "source") === "plans") {
        return (
          <PricingPlansView
            lang={lang}
            interval={getStr(c, "planInterval") || "all"}
            tierKeysCsv={getStr(c, "tierKeysCsv")}
            limit={Number(c.planLimit ?? 0) || 0}
            ctaLabel={getStr(c, `cta_${lang}`) || undefined}
          />
        );
      }
      const plans = Array.isArray(c.plans) ? (c.plans as Array<Record<string, unknown>>) : [];
      return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((p, i) => {
            const name = (p[`name_${lang}`] || p.name_pl) as string;
            const price = (p.price ?? "") as string;
            const currency = (p.currency ?? "") as string;
            const period = (p[`period_${lang}`] || p.period_pl || "") as string;
            const featuresRaw = (p[`features_${lang}`] || p.features_pl || []) as unknown;
            const features = Array.isArray(featuresRaw)
              ? featuresRaw.filter((x): x is string => typeof x === "string")
              : [];
            const cta = (p[`cta_${lang}`] || p.cta_pl || "Wybierz") as string;
            const href = safeUrl(typeof p.href === "string" ? p.href : "#");
            const featured = !!p.featured;
            return (
              <div
                key={i}
                className={`rounded-lg border p-6 flex flex-col ${featured ? "border-brand bg-brand/5 shadow-lg" : "border-border bg-card"}`}
              >
                <h3 className="cms-post-title mb-2">{name}</h3>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-3xl font-bold">{price}</span>
                  <span className="cms-meta text-muted-foreground">
                    {currency}
                    {period}
                  </span>
                </div>
                <ul className="cms-post-excerpt space-y-2 mb-6 flex-1">
                  {features.map((f, j) => (
                    <li key={j} className="flex items-start gap-2">
                      <span className="text-brand mt-0.5">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <AppLink
                  href={href}
                  className={`text-center px-4 py-2 rounded font-medium text-sm ${featured ? "bg-brand text-brand-foreground" : "border border-border hover:bg-muted"}`}
                >
                  {cta}
                </AppLink>
              </div>
            );
          })}
        </div>
      );
    }
    case "section-label":
      // Lazy (sectionLabelVariants ~39 kB źródeł, 21 wariantów) - nie chrome;
      // SSR wypełnia granicę, chunk dogrzewa warmWidgetChunks.
      return (
        <SectionLabelWidgetView
          content={c}
          lang={lang}
          theme={theme === "dark" ? "dark" : "light"}
        />
      );

    case "hot-topic-bar": {
      const badge = getStr(c, `badge_${lang}`) || getStr(c, "badge_pl") || "Hot topic";
      const title = getStr(c, `title_${lang}`) || getStr(c, "title_pl");
      const href = safeUrl(getStr(c, "href"));
      const iconName = getStr(c, "iconName") || "Flame";
      const Icons = LucideIcons as Record<string, React.ComponentType<{ className?: string }>>;
      const Icon = Icons[iconName] || Icons.Flame;
      const ArrowRight = Icons.ArrowRight;
      const inner = (
        <div className="flex items-center gap-4 text-sm">
          <span className="inline-flex items-center gap-2 bg-brand text-brand-foreground font-bold px-3 py-1 rounded text-xs uppercase tracking-wider shrink-0">
            {Icon && <Icon className="w-3.5 h-3.5" />} {badge}
          </span>
          <p className="truncate flex-1">{title}</p>
          {ArrowRight && <ArrowRight className="w-4 h-4 text-brand shrink-0" />}
        </div>
      );
      return (
        <div className="border-y border-border bg-muted/40 py-3 px-4">
          {href ? (
            <AppLink href={href} className="block hover:opacity-90 transition">
              {inner}
            </AppLink>
          ) : (
            inner
          )}
        </div>
      );
    }
    case "login-form":
    case "register-form":
    case "lost-password-form":
    case "reset-password-form":
      return <AuthFormWidget node={node} lang={lang} />;
    case "post-title":
    case "post-meta":
    case "post-tags-dyn":
    case "post-categories-dyn":
    case "post-author-card":
    case "post-breadcrumbs":
    case "post-cover":
    case "post-excerpt":
    case "archive-title":
    case "search-form":
      return <DynamicTagWidget node={node} lang={lang} />;
    case "contact-form":
      return <ContactFormView data={(node.content ?? {}) as Record<string, unknown>} lang={lang} />;
    case "counter":
      return <CounterWidget content={c} lang={lang} />;
    case "toc":
      return <TocWidget content={c} lang={lang} />;
    default:
      return undefined;
  }
}
