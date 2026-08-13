// Zakładka "Kolory": tryb (ciemny / jasny / automatyczny za motywem strony)
// oraz dwie pełne palety. Paleta ciemna to kolumny `popup_*_color` (zgodność
// wstecz), jasna żyje w `popup_design.light`. Kontrast tekstu do tła jest
// sprawdzany na bieżąco - WCAG AA wymaga 4.5:1.
import { useTranslation } from "react-i18next";
import { CheckSquare, Palette, SunMoon } from "lucide-react";
import { ColorRow, ContrastNote, SectionCard, SegmentedRow, TextRow } from "./controls";
import type { SignupPopupTabProps } from "./types";
import {
  defaultPopupDesign,
  emptyPopupControlColors,
  type PopupColorScheme,
  type PopupControlColors,
} from "@/lib/newsletter/popupDesign";

/** Pola sekcji kontrolek - jedna lista dla obu palet (DRY, brak rozjazdu). */
const CONTROL_FIELDS = [
  { key: "checkboxBorder", label: "cbBorder" },
  { key: "checkboxHover", label: "cbHover" },
  { key: "checkboxChecked", label: "cbChecked" },
  { key: "checkboxLabel", label: "cbLabel" },
  { key: "checkboxLink", label: "cbLink" },
  { key: "buttonBg", label: "btnBg" },
  { key: "buttonFg", label: "btnFg" },
  { key: "buttonBorder", label: "btnBorder" },
  { key: "buttonHoverBg", label: "btnHoverBg" },
] as const satisfies ReadonlyArray<{ key: keyof PopupControlColors; label: string }>;

export function ColorsTab({
  value,
  design,
  onChange,
  patchLight,
  patchControls,
  setColorScheme,
}: SignupPopupTabProps) {
  const { t } = useTranslation();
  const light = design.light;
  const darkDefaults = defaultPopupDesign();

  return (
    <div className="space-y-4">
      <SectionCard
        title={t("adminPopupSignup.colors.scheme")}
        hint={t("adminPopupSignup.colors.schemeHint")}
        icon={<SunMoon className="h-3.5 w-3.5" />}
      >
        <SegmentedRow<PopupColorScheme>
          value={design.colorScheme}
          onChange={setColorScheme}
          columns={3}
          options={[
            { value: "dark", label: t("adminPopupSignup.colors.schemeDark") },
            { value: "light", label: t("adminPopupSignup.colors.schemeLight") },
            { value: "auto", label: t("adminPopupSignup.colors.schemeAuto") },
          ]}
        />
      </SectionCard>

      <SectionCard
        title={t("adminPopupSignup.colors.darkHeading")}
        icon={<Palette className="h-3.5 w-3.5" />}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ColorRow
            label={t("adminPopupSignup.colors.bg")}
            value={value.popup_bg_color}
            onChange={(popup_bg_color) => onChange({ popup_bg_color })}
          />
          <ColorRow
            label={t("adminPopupSignup.colors.text")}
            value={value.popup_text_color}
            onChange={(popup_text_color) => onChange({ popup_text_color })}
          />
          <ColorRow
            label={t("adminPopupSignup.colors.muted")}
            value={value.popup_muted_color}
            onChange={(popup_muted_color) => onChange({ popup_muted_color })}
          />
          <ColorRow
            label={t("adminPopupSignup.colors.accent")}
            value={value.popup_accent_color}
            onChange={(popup_accent_color) => onChange({ popup_accent_color })}
          />
          <ColorRow
            label={t("adminPopupSignup.colors.accentText")}
            value={value.popup_accent_text_color}
            onChange={(popup_accent_text_color) => onChange({ popup_accent_text_color })}
          />
          <TextRow
            label={t("adminPopupSignup.colors.overlay")}
            value={value.popup_overlay_color}
            onChange={(popup_overlay_color) => onChange({ popup_overlay_color })}
            placeholder="rgba(0,0,0,0.7)"
          />
          <ColorRow
            label={t("adminPopupSignup.colors.gradFrom")}
            value={value.popup_showcase_grad_from ?? value.popup_accent_color}
            onChange={(popup_showcase_grad_from) => onChange({ popup_showcase_grad_from })}
          />
          <ColorRow
            label={t("adminPopupSignup.colors.gradTo")}
            value={value.popup_showcase_grad_to ?? value.popup_bg_color}
            onChange={(popup_showcase_grad_to) => onChange({ popup_showcase_grad_to })}
          />
        </div>
        <ContrastNote
          bg={value.popup_bg_color}
          fg={value.popup_muted_color}
          message={(ratio) => t("adminPopupSignup.colors.contrastWarn", { ratio })}
        />
      </SectionCard>

      <SectionCard
        title={t("adminPopupSignup.colors.lightHeading")}
        icon={<Palette className="h-3.5 w-3.5" />}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ColorRow
            label={t("adminPopupSignup.colors.bg")}
            value={light.bg}
            onChange={(bg) => patchLight({ bg })}
          />
          <ColorRow
            label={t("adminPopupSignup.colors.text")}
            value={light.fg}
            onChange={(fg) => patchLight({ fg })}
          />
          <ColorRow
            label={t("adminPopupSignup.colors.muted")}
            value={light.muted}
            onChange={(muted) => patchLight({ muted })}
          />
          <ColorRow
            label={t("adminPopupSignup.colors.accent")}
            value={light.accent}
            onChange={(accent) => patchLight({ accent })}
          />
          <ColorRow
            label={t("adminPopupSignup.colors.accentText")}
            value={light.accentFg}
            onChange={(accentFg) => patchLight({ accentFg })}
          />
          <TextRow
            label={t("adminPopupSignup.colors.overlay")}
            value={light.overlay}
            onChange={(overlay) => patchLight({ overlay })}
            placeholder={darkDefaults.light.overlay}
          />
          <ColorRow
            label={t("adminPopupSignup.colors.gradFrom")}
            value={light.gradFrom}
            onChange={(gradFrom) => patchLight({ gradFrom })}
          />
          <ColorRow
            label={t("adminPopupSignup.colors.gradTo")}
            value={light.gradTo}
            onChange={(gradTo) => patchLight({ gradTo })}
          />
        </div>
        <ContrastNote
          bg={light.bg}
          fg={light.muted}
          message={(ratio) => t("adminPopupSignup.colors.contrastWarn", { ratio })}
        />
      </SectionCard>
    
      {(["dark", "light"] as const).map((mode) => (
        <SectionCard
          key={mode}
          title={t(
            mode === "dark"
              ? "adminPopupSignup.colors.controlsDarkHeading"
              : "adminPopupSignup.colors.controlsLightHeading",
          )}
          hint={t("adminPopupSignup.colors.controlsHint")}
          icon={<CheckSquare className="h-3.5 w-3.5" />}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CONTROL_FIELDS.map((field) => (
              <ColorRow
                key={field.key}
                label={t(`adminPopupSignup.colors.${field.label}`)}
                value={design.controls[mode][field.key]}
                onChange={(next) => patchControls(mode, { [field.key]: next })}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => patchControls(mode, emptyPopupControlColors())}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            {t("adminPopupSignup.colors.reset")}
          </button>
        </SectionCard>
      ))}
    </div>
  );
}
