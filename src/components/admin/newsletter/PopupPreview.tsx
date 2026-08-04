// Podgląd popupu rejestracji dla panelu administracyjnego.
// Wariant "showcase" renderuje DOKŁADNIE ten sam komponent co strona publiczna
// (SignupPopupPanel), więc podgląd jest 1:1 - nie ma drugiego, uproszczonego
// markupu, który mógłby się rozjechać z produkcją. Pozostałe układy (dokument
// z buildera, legacy stacked) mają lekki podgląd korzystający z tej samej palety.
import { NewsletterDocRenderer } from "@/components/newsletter/NewsletterDocRenderer";
import { SignupPopupPanel } from "@/components/popups/SignupPopupPanel";
import { sanitizeHtml } from "@/lib/sanitize";
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";
import {
  effectivePopupMode,
  popupPaletteVars,
  resolvePopupDesign,
  resolvePopupPalette,
} from "@/lib/newsletter/popupDesign";

export interface PopupPreviewProps {
  settings: NewsletterSettings;
  lang: "pl" | "en";
  /** Wymuszony wariant palety (przełącznik w panelu); brak = jak w ustawieniach. */
  mode?: "light" | "dark";
}

export function PopupPreview({ settings, lang, mode }: PopupPreviewProps) {
  const design = resolvePopupDesign(settings.popup_design);
  // Bez wymuszenia: "auto" pokazujemy w wariancie ciemnym (tak jak większość
  // odsłon), a jawne ustawienie light/dark honorujemy 1:1.
  const resolvedMode = mode ?? effectivePopupMode(design, "dark");
  const palette = resolvePopupPalette(settings, resolvedMode);
  const radiusPx = Math.max(0, settings.popup_border_radius_px ?? 6);

  if (!settings.popup_enabled) {
    return <p className="text-center text-sm text-muted-foreground py-16">Popup jest wyłączony.</p>;
  }

  if (settings.popup_layout === "showcase") {
    return (
      <div
        className="flex justify-center p-4"
        style={{ backgroundColor: palette.overlay || undefined }}
      >
        <SignupPopupPanel
          settings={settings}
          lang={lang}
          mode={resolvedMode}
          source="admin-preview"
          previewOnly
          titleId="popup-preview-title"
        />
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
            ...popupPaletteVars(palette, radiusPx),
            backgroundColor: p.bg ?? palette.bg,
            color: p.fg ?? palette.fg,
            borderRadius: `${p.radius ?? radiusPx}px`,
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
        className="w-full max-w-sm overflow-hidden shadow-2xl border border-white/10"
        style={{
          ...popupPaletteVars(palette, radiusPx),
          backgroundColor: palette.bg,
          color: palette.fg,
          borderRadius: `${radiusPx}px`,
        }}
      >
        {settings.popup_cover_url && (
          <img src={settings.popup_cover_url} alt="" className="w-full h-24 object-cover" />
        )}
        <div className="p-5 space-y-3">
          <h4 className="font-display text-lg" style={{ color: palette.fg }}>
            {title || "-"}
          </h4>
          {desc && (
            <p className="text-xs" style={{ color: palette.muted }}>
              {desc}
            </p>
          )}
          <input
            className="w-full px-3 py-2 text-xs"
            style={{
              background: "color-mix(in srgb, var(--nl-fg) 8%, transparent)",
              color: palette.fg,
              borderRadius: `${Math.min(radiusPx, 8)}px`,
            }}
            placeholder={emailPh}
            readOnly
          />
          <button
            type="button"
            className="w-full px-4 py-2 text-xs font-medium"
            style={{
              backgroundColor: palette.accent,
              color: palette.accentFg,
              borderRadius: `${Math.min(radiusPx, 8)}px`,
            }}
          >
            {cta || (lang === "pl" ? "Zapisz się" : "Subscribe")}
          </button>
          {policyHtml && (
            <p
              className="text-[10px] leading-relaxed [&_a]:underline"
              style={{ color: palette.muted }}
              dangerouslySetInnerHTML={{ __html: policyHtml }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
