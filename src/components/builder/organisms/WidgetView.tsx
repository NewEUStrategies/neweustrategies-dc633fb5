// Renders a widget (read-only by default; opt-in inline editing in the builder
// canvas via `editable` + `onContentChange`). Used in the live preview inside
// the builder canvas and on public pages. All user-authored strings (custom
// CSS, ids, classes, html, urls) go through src/lib/sanitize.ts.
import { memo, type CSSProperties } from "react";
import type { Device, WidgetNode } from "@/lib/builder/types";
import { safeUrl, safeImageUrl } from "@/lib/sanitizePure";
import { resolveColorForMode } from "@/lib/builder/autoInvertColor";
import { WIDGET_MEDIA_SPLIT_SIZES } from "@/lib/builder/widgetImageSizes";
// Heavy, non-critical widgets are code-split via lazyWidgets so they never
// weigh down the shared Header/Footer bundle on pages that don't render them.
// SSR streaming still renders them server-side, so the HTML is unchanged.
import { parseCustomFields } from "@/lib/builder/formFieldConfig";
import {
  JoinUsForm,
  InterestsCustomizer,
  TtsPlayerHost,
  PodcastLatestView,
  ClubCardView,
  ClubThreadsView,
  WebStoriesCarouselView,
  NewsTickerView,
  TrendingNowView,
  RatedListView,
  TabsBlock,
  AdSlotById,
  DonationsWidgetView,
  RichTextView,
  ChartWidgetView,
  DataMapWidgetView,
  WorldMapWidgetView,
  TimelineWidgetView,
  SankeyWidgetView,
  CompareWidgetView,
  RiskMatrixWidgetView,
  IndicatorWidgetView,
  NetworkWidgetView,
  CorridorMapWidgetView,
  SourcesWidgetView,
  MethodologyWidgetView,
  EventScheduleView,
  EventsListView,
  EventCountdownView,
  MeetingBookingView,
  EventSponsorsView,
  CircularCarouselView,
  TravelRouteCardView,
  ClubHubView,
  CoverOverlayCardView,
  PromoCardView,
  // Podział po typie (2026-08-15): listingi, karty zdarzeń, billing, formularz
  // onboardingu, karuzela postępu i renderer HTML tekstu jadą w chunkach na
  // żądanie - entry chrome nie płaci już za komplet widgetów.
  PostListView,
  TailoredMustReadsView,
  EventCountdownCardView,
  PurchaseConfirmationView,
  OnboardingFormView,
  ProgressCarouselView,
} from "./widget-view/lazyWidgets";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { AppLink } from "@/components/atoms/AppLink";
import { pickI18n } from "@/lib/content-model/contentValue";

type Lang = "pl" | "en";

import { getWidgetFrameStyle, hiddenOnDevice, getStr, getNum } from "./widget-view/frame";
// Editable przez rejestr leniwy: renderuje się tylko w kanwie (canEdit), a jego
// normalizacja HTML ciągnie node-html-parser - nie może jechać w entry chrome.
import { Editable } from "./widget-view/lazyWidgets";
import { CategoriesView } from "./widget-view/CategoriesView";
import { TagsView } from "./widget-view/TagsView";
import { renderSimpleWidget } from "./widget-view/SimpleWidgets";
import {
  renderChromeWidget,
  useWidgetFrame,
} from "@/components/builder/organisms/ChromeWidgetView";
export { getWidgetFrameStyle, hiddenOnDevice };
interface ViewProps {
  node: WidgetNode;
  lang: Lang;
  device: Device;
  /** When true, click-to-edit text fields are enabled in canvas. */
  editable?: boolean;
  /** Commit a single content field. Called on blur / Enter / resize end. */
  onContentChange?: (key: string, value: string | number) => void;
}

export const WidgetView = memo(function WidgetView(props: ViewProps) {
  // RAMKA I GAŁĘZIE CHROME ŻYJĄ W `ChromeWidgetView` - patrz nota w tamtym
  // pliku. Ten moduł jest jego ROZSZERZENIEM o widgety treściowe, więc
  // nagłówek i stopka mogą renderować bez niego, a strony treści dostają
  // fizycznie ten sam kod ramki (parytet HTML, zero CLS).
  const frame = useWidgetFrame(props);
  const {
    node,
    lang,
    editable,
    onContentChange,
    effectiveMode,
    activeTypography,
    aboveFold,
    c,
    canEdit,
    commit,
    wrap,
  } = frame;

  // Read-only widgets without inline editing - short-circuit via dispatcher.
  const simple = renderSimpleWidget(
    node,
    lang,
    effectiveMode,
    editable,
    onContentChange,
    activeTypography,
  );
  if (simple !== undefined) return wrap(simple);

  // Typy używane przez nagłówek i stopkę - wspólna implementacja.
  const chrome = renderChromeWidget(frame);
  if (chrome !== undefined) return chrome;

  switch (node.type) {
    case "tts": {
      const source = getStr(c, "source") || "post";
      // Pełny łańcuch fallbacków (żądany język -> PL -> EN). Bez ostatniego
      // ogniwa tekst wpisany wyłącznie po angielsku znikał w widoku PL, a
      // odtwarzacz dostawał pusty string i czytał treść posta zamiast własnej.
      const customText = pickI18n(c, "text", lang);
      const label =
        pickI18n(c, "label", lang) || (lang === "pl" ? "Odsłuchaj artykuł" : "Listen to article");
      const voiceId = getStr(c, "voiceId") || "JBFqnCBsd6RMkjVDRZzb";
      const model = getStr(c, "model") || "eleven_multilingual_v2";
      return wrap(
        <TtsPlayerHost
          source={source}
          customText={customText}
          label={label}
          voiceId={voiceId}
          model={model}
          nodeId={node.id}
        />,
      );
    }
    case "post-list": {
      return wrap(<PostListView c={c} lang={lang} typography={activeTypography ?? undefined} />);
    }
    case "carousel": {
      return wrap(
        <PostListView c={c} lang={lang} carousel typography={activeTypography ?? undefined} />,
      );
    }
    case "tailored-must-reads": {
      return wrap(<TailoredMustReadsView c={c} lang={lang} />);
    }
    case "news-ticker":
      return wrap(<NewsTickerView c={c} lang={lang} />);
    case "trending-now":
      return wrap(<TrendingNowView c={c} lang={lang} />);
    case "event-schedule":
      return wrap(<EventScheduleView c={c} lang={lang} />);
    case "event-list":
      return wrap(<EventsListView c={c} lang={lang} />);
    case "event-countdown":
      return wrap(<EventCountdownView c={c} lang={lang} />);
    case "event-countdown-card":
      return wrap(<EventCountdownCardView c={c} lang={lang} />);
    case "purchase-confirmation":
      return wrap(<PurchaseConfirmationView c={c} lang={lang} />);
    case "meeting-booking":
      return wrap(<MeetingBookingView c={c} lang={lang} />);
    case "event-sponsors":
      return wrap(<EventSponsorsView c={c} lang={lang} />);
    case "chart":
      return wrap(<ChartWidgetView node={node} lang={lang} />);
    case "data-map":
      return wrap(<DataMapWidgetView node={node} lang={lang} />);
    case "world-map":
      return wrap(<WorldMapWidgetView c={c} lang={lang} />);
    case "feature-timeline":
      return wrap(<TimelineWidgetView node={node} lang={lang} />);
    case "feature-sankey":
      return wrap(<SankeyWidgetView node={node} lang={lang} />);
    case "feature-compare":
      return wrap(<CompareWidgetView node={node} lang={lang} />);
    case "feature-risk-matrix":
      return wrap(<RiskMatrixWidgetView node={node} lang={lang} />);
    case "feature-indicator":
      return wrap(<IndicatorWidgetView node={node} lang={lang} />);
    case "feature-network":
      return wrap(<NetworkWidgetView node={node} lang={lang} />);
    case "feature-corridor-map":
      return wrap(<CorridorMapWidgetView node={node} lang={lang} />);
    case "feature-sources":
      return wrap(<SourcesWidgetView node={node} lang={lang} />);
    case "feature-methodology":
      return wrap(<MethodologyWidgetView node={node} lang={lang} />);
    case "podcast-latest":
      return wrap(<PodcastLatestView c={c} lang={lang} />);
    case "club-card":
      return wrap(<ClubCardView c={c} lang={lang} />);
    case "club-threads":
      return wrap(<ClubThreadsView c={c} lang={lang} />);
    case "club-hub":
      return wrap(<ClubHubView c={c} lang={lang} />);
    case "web-stories-carousel":
      return wrap(<WebStoriesCarouselView c={c} lang={lang} />);
    case "categories":
      return wrap(<CategoriesView lang={lang} />);
    case "tags":
      return wrap(<TagsView />);
    case "join-us": {
      // Live preview mirrors JoinUsForm's full variant set - including
      // "split-image" - so switching the variant in the property panel
      // updates the canvas immediately, no page refresh.
      const rawVariant = getStr(c, "variant") || "split";
      const variant = (
        rawVariant === "card" ||
        rawVariant === "split" ||
        rawVariant === "inline" ||
        rawVariant === "split-image"
          ? rawVariant
          : "split"
      ) as "card" | "split" | "inline" | "split-image";
      const showInterests = (getStr(c, "showInterests") ?? "1") !== "0";
      const interestsDisplay = (
        getStr(c, "interestsDisplay") === "chips" ? "chips" : "droplist"
      ) as "chips" | "droplist";

      const interestSlugsRaw = c.interestSlugs;
      const interestSlugs = Array.isArray(interestSlugsRaw)
        ? interestSlugsRaw.filter((x): x is string => typeof x === "string")
        : undefined;
      // Treści widgetu NIE mogą przeciekać między językami (PL strona + tekst
      // EN wpisany tylko w polu _en). Bierzemy wyłącznie wpis w bieżącym
      // języku; jeżeli go nie ma, komponent użyje domyślnego t() w tym języku.
      // Legacy klucz bezjęzykowy honorujemy tylko, gdy nie ma ŻADNEJ wersji
      // językowej - inaczej gubilibyśmy treść sprzed migracji na i18n.
      const pickStrict = (base: string) => {
        const own = c[`${base}_${lang}`];
        if (typeof own === "string" && own.trim()) return own;
        const pl = c[`${base}_pl`];
        const en = c[`${base}_en`];
        const hasLocalized =
          (typeof pl === "string" && pl.trim()) || (typeof en === "string" && en.trim());
        if (hasLocalized) return undefined;
        const legacy = c[base];
        return typeof legacy === "string" && legacy.trim() ? legacy : undefined;
      };
      const pick = pickStrict;

      // Image config for variant="split-image" - forwarded so the canvas
      // reflects URL/alt/gradient/overlay/focal-point edits instantly.
      const imageUrl = getStr(c, "imageUrl") || undefined;
      const imageAlt = getStr(c, "imageAlt") || undefined;
      const imageAltEn = getStr(c, "imageAltEn") || undefined;
      const imageGradient = getStr(c, "imageGradient") || undefined;
      const rawOverlay = getNum(c, "imageOverlay", -1);
      const imageOverlay = rawOverlay >= 0 && rawOverlay <= 100 ? rawOverlay : undefined;
      const imagePosition = getStr(c, "imagePosition") || undefined;
      const imageAspect = getStr(c, "imageAspect") || undefined;
      const rawFit = getStr(c, "imageFit");
      const imageFit = rawFit === "contain" ? "contain" : rawFit === "cover" ? "cover" : undefined;

      const isOn = (k: string) => getStr(c, k) === "1";
      const customFields = parseCustomFields(c.customFields);
      return wrap(
        <JoinUsForm
          variant={variant}
          bgLight={getStr(c, "bgLight") || undefined}
          bgDark={getStr(c, "bgDark") || undefined}
          perkIconColor={getStr(c, "perkIconColor") || undefined}
          imageUrl={imageUrl}
          imageAlt={imageAlt}
          imageAltEn={imageAltEn}
          imageGradient={imageGradient}
          imageOverlay={imageOverlay}
          imagePosition={imagePosition}
          imageAspect={imageAspect}
          imageFit={imageFit}
          showInterests={showInterests}
          interestsDisplay={interestsDisplay}
          title={pick("title")}
          subtitle={pick("subtitle")}
          perk1={pick("perk1")}
          perk2={pick("perk2")}
          perk3={pick("perk3")}
          interestsLabel={pick("interestsLabel")}
          submitLabel={pick("submitLabel")}
          submittingLabel={pick("submittingLabel")}
          consentText={pickStrict("consentText")}
          successText={pick("successText")}
          namePlaceholder={pick("namePlaceholder")}
          emailPlaceholder={pick("emailPlaceholder")}
          showFirstName={isOn("showFirstName")}
          showLastName={isOn("showLastName")}
          showPosition={isOn("showPosition")}
          showLinkedin={isOn("showLinkedin")}
          showPhone={isOn("showPhone")}
          showCompany={isOn("showCompany")}
          showCountry={isOn("showCountry")}
          requireFirstName={(getStr(c, "requireFirstName") ?? "0") === "1"}
          requireLastName={(getStr(c, "requireLastName") ?? "0") === "1"}
          requireEmail={(getStr(c, "requireEmail") ?? "1") === "1"}
          requirePosition={(getStr(c, "requirePosition") ?? "0") === "1"}
          requireLinkedin={(getStr(c, "requireLinkedin") ?? "0") === "1"}
          requirePhone={(getStr(c, "requirePhone") ?? "0") === "1"}
          requireCompany={(getStr(c, "requireCompany") ?? "0") === "1"}
          requireCountry={(getStr(c, "requireCountry") ?? "0") === "1"}
          requireInterests={(getStr(c, "requireInterests") ?? "0") === "1"}
          interestSlugs={interestSlugs}
          firstNamePlaceholder={pick("firstNamePlaceholder")}
          lastNamePlaceholder={pick("lastNamePlaceholder")}
          positionPlaceholder={pick("positionPlaceholder")}
          linkedinPlaceholder={pick("linkedinPlaceholder")}
          phonePlaceholder={pick("phonePlaceholder")}
          companyPlaceholder={pick("companyPlaceholder")}
          countryPlaceholder={pick("countryPlaceholder")}
          titleSize={getNum(c, "titleSize", 0) || undefined}
          descriptionSize={getNum(c, "descriptionSize", 0) || undefined}
          perkSize={getNum(c, "perkSize", 0) || undefined}
          labelSize={getNum(c, "labelSize", 0) || undefined}
          placeholderSize={getNum(c, "placeholderSize", 0) || undefined}
          buttonSize={getNum(c, "buttonSize", 0) || undefined}
          consentSize={getNum(c, "consentSize", 0) || undefined}
          iconSize={getNum(c, "iconSize", 0) || undefined}
          customFields={customFields}
          source={`widget:${node.id}`}
        />,
      );
    }

    case "customize-interests": {
      const variant = (getStr(c, "variant") || "full") as "full" | "compact";
      const showHeader = (getStr(c, "showHeader") ?? "1") !== "0";
      return wrap(<InterestsCustomizer variant={variant} showHeader={showHeader} />);
    }

    case "onboarding-form":
      return wrap(<OnboardingFormView c={c} lang={lang} />);

    case "progress-carousel":
      return wrap(<ProgressCarouselView c={c} lang={lang} />);

    case "circular-carousel":
      return wrap(<CircularCarouselView c={c} lang={lang} />);

    // Karta trasy. Widok sam rozpoznaje kanwę edytora (kontekst
    // `BuilderModeProvider`), bo tylko tam polubienie nie ma prawa zapisać
    // preferencji redaktora do `localStorage` przeglądarki.
    case "travel-route-card":
      return wrap(<TravelRouteCardView c={c} lang={lang} nodeId={node.id} />);

    // Karta z okładką: cała treść jest statyczna, więc widok nie potrzebuje
    // ani identyfikatora węzła, ani wiedzy o kanwie edytora.
    case "cover-overlay-card":
      return wrap(<CoverOverlayCardView c={c} lang={lang} />);

    // Karta promocyjna. Tryb wydarzenia czyta wiersz z modułu wydarzeń przez
    // react-query; prefetch SSR tego samego klucza stoi w lib/builder/prefetch,
    // więc serwer renderuje kartę z realnymi danymi i hydratacja nie ma czego
    // poprawiać.
    case "promo-card":
      return wrap(<PromoCardView c={c} lang={lang} />);

    case "tabs": {
      const tabs = Array.isArray(c.tabs) ? (c.tabs as Array<Record<string, string>>) : [];
      const orientation = c.orientation === "vertical" ? "vertical" : "horizontal";
      const rawAlign = typeof c.tabAlign === "string" ? c.tabAlign : "left";
      const tabAlign = (["left", "center", "right", "justify"] as const).includes(
        rawAlign as "left" | "center" | "right" | "justify",
      )
        ? (rawAlign as "left" | "center" | "right" | "justify")
        : "left";
      return wrap(
        <TabsBlock
          tabs={tabs}
          lang={lang}
          nodeId={node.id}
          orientation={orientation}
          tabAlign={tabAlign}
        />,
      );
    }
    case "rated-list":
      return wrap(<RatedListView c={c} lang={lang} mode={effectiveMode} />);

    case "dark-featured-card": {
      const badgeKey = `badge_${lang}`;
      const badge = pickI18n(c, "badge", lang);
      const title = pickI18n(c, "title", lang);
      const excerpt = pickI18n(c, "excerpt", lang);
      const img = safeImageUrl(getStr(c, "image"));
      const href = safeUrl(getStr(c, "href"));
      const cardBg =
        resolveColorForMode(node.style?.bgColor, effectiveMode) ?? "oklch(0.18 0.02 260)";
      const cardText = resolveColorForMode(node.style?.textColor, effectiveMode) ?? "#ffffff";
      const cardBorder = resolveColorForMode(node.style?.borderColor, effectiveMode);
      const badgeVariant = getStr(c, "badgeVariant") || "solid-red";
      const badgeRadius = getStr(c, "badgeRadius") || "none";
      const badgeSize = getStr(c, "badgeSize") || "xs";
      const radiusCls =
        badgeRadius === "sm"
          ? "rounded-sm"
          : badgeRadius === "md"
            ? "rounded-md"
            : badgeRadius === "lg"
              ? "rounded-lg"
              : badgeRadius === "full"
                ? "rounded-full"
                : "rounded-none";
      const sizeCls =
        badgeSize === "sm"
          ? "text-sm px-3.5 py-1.5"
          : badgeSize === "md"
            ? "text-base px-4 py-2"
            : "text-xs px-3 py-1";
      const variantCls =
        badgeVariant === "solid-brand"
          ? "bg-brand text-brand-foreground"
          : badgeVariant === "solid-dark"
            ? "bg-foreground text-background"
            : badgeVariant === "outline"
              ? "border border-white/60 text-white bg-transparent"
              : badgeVariant === "ghost"
                ? "bg-white/10 text-white backdrop-blur"
                : badgeVariant === "gradient"
                  ? "bg-gradient-to-r from-destructive to-brand text-white"
                  : "bg-destructive text-white";
      const badgeCls = `inline-block font-bold uppercase tracking-wider mb-3 ${sizeCls} ${variantCls} ${radiusCls}`;
      const badgeBg = getStr(c, "badgeBg");
      const badgeText = getStr(c, "badgeText");
      const badgeStyle: CSSProperties = {};
      if (badgeBg) {
        badgeStyle.background = badgeBg;
        badgeStyle.borderColor = badgeBg;
      }
      if (badgeText) badgeStyle.color = badgeText;
      const imageHover = getStr(c, "imageHover") || "zoom-in";
      // Keep dynamic-feature-card imagery consistent with other widgets:
      // fixed frame, responsive source candidates, and full-image contain fit.
      const imgAnimCls =
        imageHover === "zoom-in"
          ? "inset-0 transition-transform duration-500 ease-out group-hover/dfcimg:scale-105"
          : imageHover === "zoom-out"
            ? "inset-0 scale-105 transition-transform duration-500 ease-out group-hover/dfcimg:scale-100"
            : imageHover === "fade"
              ? "inset-0 transition-[filter,opacity] duration-500 ease-out group-hover/dfcimg:brightness-75"
              : imageHover === "brighten"
                ? "inset-0 brightness-90 transition-[filter] duration-500 ease-out group-hover/dfcimg:brightness-110"
                : imageHover === "tilt"
                  ? "inset-0 transition-transform duration-500 ease-out origin-center group-hover/dfcimg:rotate-1"
                  : "inset-0";
      const card = (
        <div
          className="relative p-6 rounded"
          style={{
            background: cardBg,
            color: cardText,
            borderColor: cardBorder,
            borderStyle: cardBorder ? "solid" : undefined,
            borderWidth: cardBorder ? "1px" : undefined,
          }}
        >
          {(badge || canEdit) &&
            (canEdit ? (
              <Editable
                as="div"
                value={badge}
                onCommit={(v) => commit(badgeKey, v)}
                className={badgeCls}
                style={badgeStyle}
                placeholder="Etykieta…"
              />
            ) : (
              <div className={badgeCls} style={badgeStyle}>
                {badge}
              </div>
            ))}
          {img && (
            <div
              data-widget-media
              className="group/dfcimg relative w-full overflow-hidden rounded bg-black/20"
              style={{ aspectRatio: "16 / 9" }}
            >
              <OptimizedImage
                src={img}
                alt=""
                responsive
                sizes={WIDGET_MEDIA_SPLIT_SIZES}
                priority={aboveFold}
                className={`absolute block h-full w-full object-contain ${imgAnimCls}`}
              />
            </div>
          )}
          <h3 className="mt-4 font-display text-2xl font-bold">{title}</h3>
          {excerpt && <p className="mt-2 text-sm opacity-70">{excerpt}</p>}
        </div>
      );
      return wrap(
        href ? (
          <AppLink href={href} className="block hover:opacity-95 transition">
            {card}
          </AppLink>
        ) : (
          card
        ),
      );
    }
    case "ad-slot": {
      const slotId = getStr(c, "slotId");
      return wrap(<AdSlotById slotId={slotId} />);
    }
    case "donations": {
      const variant = (getStr(c, "variant") || "hero") as
        "hero" | "progress" | "stats-strip" | "compact-card" | "inline-bar" | "thermometer";
      const title = lang === "pl" ? getStr(c, "title_pl") : getStr(c, "title_en");
      const subtitle = lang === "pl" ? getStr(c, "subtitle_pl") : getStr(c, "subtitle_en");
      const cta = lang === "pl" ? getStr(c, "cta_pl") : getStr(c, "cta_en");
      const truthy = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";
      const falsy = (v: unknown) => v === false || v === "false" || v === 0 || v === "0";
      const bool = (key: string, dflt: boolean) => {
        const v = c[key];
        if (truthy(v)) return true;
        if (falsy(v)) return false;
        return dflt;
      };
      return wrap(
        <DonationsWidgetView
          variant={variant}
          title={title || undefined}
          subtitle={subtitle || undefined}
          cta={cta || undefined}
          href={getStr(c, "href") || "/support"}
          goalCents={getNum(c, "goalCents", 0)}
          currency={getStr(c, "currency") || undefined}
          showMonth={bool("showMonth", true)}
          showCount={bool("showCount", true)}
          showRecent={bool("showRecent", false)}
          accent={getStr(c, "accent") || undefined}
          quickDonate={bool("quickDonate", false)}
          mode={
            getStr(c, "mode") === "quick" || getStr(c, "mode") === "form"
              ? (getStr(c, "mode") as "quick" | "form")
              : getStr(c, "mode") === "link"
                ? "link"
                : undefined
          }
          lang={lang}
        />,
      );
    }
    case "rich-text":
      // Embeds the blocks engine: the builder hosts full article-style content.
      return wrap(<RichTextView content={c} lang={lang} />);
    default:
      return null;
  }
});

WidgetView.displayName = "WidgetView";
