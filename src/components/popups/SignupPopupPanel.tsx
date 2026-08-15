// Panel popupu REJESTRACJI konta - wspólny dla strony publicznej i podglądu
// w Admin → Popupy. Jeden komponent = zero rozjazdu 1:1 między podglądem
// a produkcją (wcześniej podgląd miał własny, uproszczony markup).
//
// Kompozycja odwzorowuje projekt referencyjny: lewa kolumna to galeria
// (logo poziome z menu admina, mozaika kadrów, karta podpisu, hasło, kropki),
// prawa to nagłówek + formularz rejestracji. Wszystko - teksty PL/EN, kolory,
// kolejność bloków, wyrównania, szerokości - pochodzi z ustawień popupu.
import { useTranslation } from "react-i18next";
import { X } from "@/lib/lucide-shim";
import { PopupSignupForm } from "@/components/PopupSignupForm";
import { SignupShowcase } from "@/components/ui/signup-showcase";
import { useBrandLogoUrl } from "@/lib/brand/useBrandLogoUrl";
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";
import {
  popupPaletteVars,
  resolvePopupDesign,
  resolvePopupPalette,
  type PopupPalette,
} from "@/lib/newsletter/popupDesign";
import "@/lib/i18n-signup-popup";

export interface SignupPopupPanelProps {
  settings: NewsletterSettings;
  lang: "pl" | "en";
  /** Wariant palety - wyliczany z popup_design.colorScheme i motywu strony. */
  mode: "light" | "dark";
  source?: string;
  onSuccess?: () => void;
  /** Podgląd w adminie: formularz bez zapisów i bez auto-rotacji galerii. */
  previewOnly?: boolean;
  /** Renderuje przycisk zamykania w prawym górnym rogu. */
  onClose?: () => void;
  /** Id nagłówka dla aria-labelledby dialogu. */
  titleId?: string;
  className?: string;
}

/** Proporcje kolumn (galeria : formularz) dla wariantów `panel.split`. */
function galleryFraction(split: "half" | "gallery-wide" | "form-wide"): number {
  if (split === "gallery-wide") return 1.14;
  if (split === "form-wide") return 0.86;
  return 1;
}

export function SignupPopupPanel({
  settings,
  lang,
  mode,
  source = "popup",
  onSuccess,
  previewOnly = false,
  onClose,
  titleId = "signup-popup-title",
  className = "",
}: SignupPopupPanelProps) {
  const { t } = useTranslation();
  const design = resolvePopupDesign(settings.popup_design);
  const palette: PopupPalette = resolvePopupPalette(settings, mode);
  // Popup zawsze stoi na ciemnym kadrze galerii, wiec w obu motywach uzywamy
  // wariantu z jasnymi napisami (surface="dark").
  const themeLogo = useBrandLogoUrl("dark", "horizontal");
  const isPl = lang === "pl";

  const radiusPx = Math.max(0, settings.popup_border_radius_px ?? 6);
  const galleryRight = settings.popup_showcase_side === "right";
  const galleryFr = galleryFraction(design.panel.split);
  const formFr = 2 - galleryFr;
  const cols = galleryRight ? `${formFr}fr ${galleryFr}fr` : `${galleryFr}fr ${formFr}fr`;

  const images = (settings.popup_showcase_images ?? [])
    .filter((img) => Boolean(img?.url))
    .map((img) => ({
      url: img.url,
      caption: isPl ? img.caption_pl : img.caption_en,
      title: isPl ? img.title_pl : img.title_en,
    }));

  const eyebrow = isPl ? settings.popup_eyebrow_pl : settings.popup_eyebrow_en;
  const title = isPl ? settings.popup_title_pl : settings.popup_title_en;
  const desc = isPl ? settings.popup_description_pl : settings.popup_description_en;
  const brand = isPl ? settings.popup_showcase_brand_pl : settings.popup_showcase_brand_en;
  const tagline = isPl ? settings.popup_showcase_tagline_pl : settings.popup_showcase_tagline_en;
  const captionPrefix = isPl ? design.gallery.captionPrefixPl : design.gallery.captionPrefixEn;
  const alignLeft = design.form.align === "left";

  const shadow = design.panel.shadow;

  return (
    <div
      /* `nlp` = zakres stylów popupu (src/styles.css): kolor nagłówków, kreska
         checkboxa i utrzymanie dekoracji CTA w obrysie przycisku.
         `overflow-clip` (nie `hidden`): przycina tak samo, ale NIE tworzy
         kontenera przewijania, więc panelu nie da się przesunąć - ani gestem,
         ani programowo (np. gdy przeglądarka „dojeżdża" do focusowanego pola). */
      className={
        "nlp relative grid w-full grid-cols-1 overflow-clip md:[grid-template-columns:var(--nl-cols)] " +
        className
      }
      style={{
        ...popupPaletteVars(palette, radiusPx),
        ["--nl-cols" as string]: cols,
        backgroundColor: palette.bg,
        color: palette.fg,
        borderRadius: `${radiusPx}px`,
        maxWidth: `${design.panel.maxWidthPx}px`,
        border: design.panel.showBorder
          ? `1px solid color-mix(in srgb, ${palette.fg} 12%, transparent)`
          : undefined,
        boxShadow:
          shadow > 0
            ? `0 ${Math.round(shadow / 3)}px ${shadow}px rgba(0,0,0,${(shadow / 100) * 0.45})`
            : undefined,
      }}
    >
      {onClose && (
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={onClose}
          className="absolute right-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full border transition-colors hover:opacity-80"
          style={{
            backgroundColor: "color-mix(in srgb, var(--nl-bg) 70%, transparent)",
            borderColor: "color-mix(in srgb, var(--nl-fg) 16%, transparent)",
            color: "var(--nl-fg)",
            backdropFilter: "blur(4px)",
          }}
        >
          <X className="h-4 w-4" />
        </button>
      )}

      <div
        className={
          "relative min-w-0 md:max-h-[92vh] md:overflow-clip " +
          (galleryRight ? "md:order-2" : "md:order-1")
        }
      >
        <SignupShowcase
          images={images}
          design={design.gallery}
          palette={palette}
          brand={brand}
          logoUrl={design.gallery.logoUrl || themeLogo}
          tagline={tagline}
          captionPrefix={captionPrefix}
          radiusPx={radiusPx}
          rotateMs={settings.popup_showcase_rotate_ms}
          showBrand={settings.popup_showcase_show_brand}
          showCaption={settings.popup_showcase_show_caption}
          showDots={settings.popup_showcase_show_dots}
          dotLabel={t("signupPopup.slide")}
          nextLabel={t("signupPopup.next")}
          autoRotate={!previewOnly}
        />
      </div>

      {/* Kolumna formularza przewija się TYLKO w pionie i tylko wtedy, gdy
          treść nie mieści się w 92vh. `overflow-x-clip` jest tu konieczne:
          `overflow-y: auto` sam z siebie wymusza `overflow-x: auto` (spec CSS
          nie dopuszcza `visible` na jednej osi obok `auto` na drugiej), a każdy
          element wystający w bok - dekoracja przycisku, ring focusa, długa
          etykieta - robił z tego poziomą przestrzeń do przewijania i całą
          zawartość popupu dało się przesunąć trackpadem. `overscroll-contain`
          zatrzymuje gest w popupie, bez przenoszenia go na stronę pod spodem. */}
      <div
        className={
          "flex min-w-0 flex-col justify-center overscroll-contain p-5 sm:p-7 md:max-h-[92vh] md:overflow-y-auto md:overflow-x-clip md:p-8 lg:p-10 " +
          (galleryRight ? "md:order-1" : "md:order-2")
        }
      >
        <div
          className={"mx-auto w-full " + (alignLeft ? "text-left" : "text-center")}
          style={{ maxWidth: `${design.form.maxWidthPx}px` }}
        >
          {design.form.showEyebrow && eyebrow && (
            <p
              className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.3em]"
              style={{ color: "var(--nl-accent)" }}
            >
              {eyebrow}
            </p>
          )}

          <h2
            id={titleId}
            className={
              "font-display font-semibold leading-[1.06] tracking-[-0.035em] " +
              (design.form.titleNoWrap ? "whitespace-nowrap " : "") +
              (onClose && !alignLeft ? "pr-10 md:pr-0" : "")
            }
            style={{
              color: "var(--nl-fg)",
              fontSize: `clamp(1.55rem, 3.4vw, ${design.form.titleSizePx}px)`,
            }}
          >
            {title}
          </h2>

          {desc && (
            <p
              className={
                "mt-3 text-[13.5px] leading-relaxed " + (alignLeft ? "" : "mx-auto max-w-[38ch]")
              }
              style={{ color: "var(--nl-muted)" }}
            >
              {desc}
            </p>
          )}

          <div className="mt-5 sm:mt-7">
            <PopupSignupForm
              settings={settings}
              lang={lang}
              source={source}
              onSuccess={onSuccess}
              previewOnly={previewOnly}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
