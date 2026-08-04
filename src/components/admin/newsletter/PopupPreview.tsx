// Podgląd popupu newslettera dla panelu administracyjnego.
// Wspólny komponent używany zarówno w sekcji "Podgląd na żywo" (Overview),
// jak i bezpośrednio w sekcji "Popup - układ i galeria", żeby zmiany kafli,
// marki, hasła i rotacji były widoczne od razu przy edycji.
import { NewsletterDocRenderer } from "@/components/newsletter/NewsletterDocRenderer";
import { NewsletterShowcase } from "@/components/ui/newsletter-showcase";
import { sanitizeHtml } from "@/lib/sanitize";
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";

export interface PopupPreviewProps {
  settings: NewsletterSettings;
  lang: "pl" | "en";
}

export function PopupPreview({ settings, lang }: PopupPreviewProps) {
  if (!settings.popup_enabled) {
    return (
      <p className="text-center text-sm text-muted-foreground py-16">Popup jest wyłączony.</p>
    );
  }

  if (settings.popup_layout === "showcase") {
    const images = (settings.popup_showcase_images ?? [])
      .filter((img) => Boolean(img?.url))
      .map((img) => ({ url: img.url, caption: lang === "pl" ? img.caption_pl : img.caption_en }));
    const right = settings.popup_showcase_side === "right";
    const radius = `${settings.popup_border_radius_px}px`;
    return (
      <div
        className="m-4 grid grid-cols-1 sm:grid-cols-2 overflow-hidden border border-white/10"
        style={{
          backgroundColor: settings.popup_bg_color,
          color: settings.popup_text_color,
          borderRadius: radius,
          ["--nl-bg" as string]: settings.popup_bg_color,
          ["--nl-fg" as string]: settings.popup_text_color,
          ["--nl-muted" as string]: settings.popup_muted_color,
          ["--nl-accent" as string]: settings.popup_accent_color,
          ["--nl-accent-fg" as string]: settings.popup_accent_text_color,
          ["--nl-radius" as string]: radius,
          ["--brand" as string]: settings.popup_accent_color,
        }}
      >
        <div className={right ? "sm:order-2" : "sm:order-1"}>
          <NewsletterShowcase
            images={images}
            brand={
              lang === "pl" ? settings.popup_showcase_brand_pl : settings.popup_showcase_brand_en
            }
            tagline={
              lang === "pl"
                ? settings.popup_showcase_tagline_pl
                : settings.popup_showcase_tagline_en
            }
            rotateMs={settings.popup_showcase_rotate_ms}
            dotLabel={lang === "pl" ? "Slajd" : "Slide"}
            gradFrom={settings.popup_showcase_grad_from}
            gradTo={settings.popup_showcase_grad_to}
            showBrand={settings.popup_showcase_show_brand}
            showCaption={settings.popup_showcase_show_caption}
            showDots={settings.popup_showcase_show_dots}
          />
        </div>
        <div className={"p-5 space-y-3 " + (right ? "sm:order-1" : "sm:order-2")}>
          <h3 className="font-display text-xl">
            {lang === "pl" ? settings.popup_title_pl : settings.popup_title_en}
          </h3>
          <p className="text-sm" style={{ color: settings.popup_muted_color }}>
            {lang === "pl" ? settings.popup_description_pl : settings.popup_description_en}
          </p>
          {/* Podgląd formularza - interakcje wyłączone, żeby admin nie zapisał
              przypadkowo testowego adresu do bazy subskrybentów. */}
          <div className="pointer-events-none select-none" aria-hidden="true">
            <NewsletterPopupForm
              settings={settings}
              lang={lang}
              source="admin-preview"
              compact
            />
          </div>
        </div>
      </div>
    );
  }


  // Zsynchronizowane z /admin/newsletter/popup - renderujemy dokument z buildera
  // gdy jest zapisany. Legacy fallback tylko dla starych tenantow bez popup_doc.
  if (settings.popup_doc) {
    const p = settings.popup_doc.popup ?? {};
    return (
      <div className="p-6 flex items-center justify-center">
        <div
          className="w-full max-w-sm overflow-hidden shadow-2xl border border-white/10"
          style={{
            backgroundColor: p.bg ?? settings.popup_bg_color,
            color: p.fg ?? settings.popup_text_color,
            borderRadius: `${p.radius ?? settings.popup_border_radius_px}px`,
          }}
        >
          <div className="p-5">
            <NewsletterDocRenderer
              doc={settings.popup_doc}
              settings={settings}
              lang={lang}
              source="admin-preview"
            />
          </div>
        </div>
      </div>
    );
  }

  const title = lang === "pl" ? settings.popup_title_pl : settings.popup_title_en;
  const desc = lang === "pl" ? settings.popup_description_pl : settings.popup_description_en;
  const cta = lang === "pl" ? settings.popup_cta_pl : settings.popup_cta_en;
  const policyHtml = sanitizeHtml(
    (lang === "pl" ? settings.policy_html_pl : settings.policy_html_en) ?? "",
  );
  const emailPh = lang === "pl" ? "twoj@email.pl" : "you@email.com";

  return (
    <div className="p-6 flex items-center justify-center">
      <div
        className="w-full max-w-sm rounded-xl overflow-hidden shadow-2xl border border-white/10"
        style={{
          backgroundColor: settings.popup_bg_color,
          color: settings.popup_text_color,
          borderRadius: `${settings.popup_border_radius_px}px`,
        }}
      >
        {settings.popup_cover_url && (
          <img src={settings.popup_cover_url} alt="" className="w-full h-24 object-cover" />
        )}
        <div className="p-5 space-y-3">
          <h4 className="font-display text-lg" style={{ color: settings.popup_text_color }}>
            {title || "-"}
          </h4>
          {desc && (
            <p className="text-xs" style={{ color: settings.popup_muted_color }}>
              {desc}
            </p>
          )}
          <input
            className="w-full px-3 py-2 rounded text-xs"
            style={{ background: "rgba(255,255,255,0.08)", color: settings.popup_text_color }}
            placeholder={emailPh}
            readOnly
          />
          <button
            type="button"
            className="w-full px-4 py-2 rounded text-xs font-medium"
            style={{
              backgroundColor: settings.popup_accent_color,
              color: settings.popup_accent_text_color,
            }}
          >
            {cta || (lang === "pl" ? "Zapisz się" : "Subscribe")}
          </button>
          {policyHtml && (
            <p
              className="text-[10px] leading-relaxed [&_a]:underline"
              style={{ color: settings.popup_muted_color }}
              dangerouslySetInnerHTML={{ __html: policyHtml }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
