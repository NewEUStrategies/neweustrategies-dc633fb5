// Zakładka "Prawa strona": wszystkie teksty formularza w PL i EN oraz
// prezentacja - wyrównanie, rozmiar tytułu, szerokość, kolumny par pól
// i link do logowania. Etykiety pól zachowują się jak w formularzach
// kontaktowych (platformowa etykieta pływająca), więc nie ma tu wyboru stylu.
import { useTranslation } from "react-i18next";
import { Type, SlidersHorizontal, LogIn } from "lucide-react";
import { BilingualRow } from "@/components/admin/atoms/BilingualRow";
import { IconRow, NumberRow, SectionCard, SegmentedRow, TextRow, ToggleRow } from "./controls";
import type { SignupPopupTabProps } from "./types";

export function FormTab({ value, design, onChange, patchForm }: SignupPopupTabProps) {
  const { t } = useTranslation();
  const f = design.form;

  return (
    <div className="space-y-4">
      <SectionCard title={t("adminPopupSignup.form.texts")} icon={<Type className="h-3.5 w-3.5" />}>
        <ToggleRow
          label={t("adminPopupSignup.form.showEyebrow")}
          checked={f.showEyebrow}
          onChange={(showEyebrow) => patchForm({ showEyebrow })}
        />
        <BilingualRow
          label={t("adminPopupSignup.form.eyebrow")}
          pl={value.popup_eyebrow_pl}
          en={value.popup_eyebrow_en}
          onPl={(popup_eyebrow_pl) => onChange({ popup_eyebrow_pl })}
          onEn={(popup_eyebrow_en) => onChange({ popup_eyebrow_en })}
        />
        <BilingualRow
          label={t("adminPopupSignup.form.heading")}
          pl={value.popup_title_pl}
          en={value.popup_title_en}
          onPl={(popup_title_pl) => onChange({ popup_title_pl })}
          onEn={(popup_title_en) => onChange({ popup_title_en })}
          placeholderPl="Załóż konto"
          placeholderEn="Create an account"
        />
        <BilingualRow
          multiline
          label={t("adminPopupSignup.form.description")}
          pl={value.popup_description_pl}
          en={value.popup_description_en}
          onPl={(popup_description_pl) => onChange({ popup_description_pl })}
          onEn={(popup_description_en) => onChange({ popup_description_en })}
        />
        <BilingualRow
          label={t("adminPopupSignup.form.hint")}
          pl={f.hintPl}
          en={f.hintEn}
          onPl={(hintPl) => patchForm({ hintPl })}
          onEn={(hintEn) => patchForm({ hintEn })}
        />
        <BilingualRow
          label={t("adminPopupSignup.form.cta")}
          pl={value.popup_cta_pl}
          en={value.popup_cta_en}
          onPl={(popup_cta_pl) => onChange({ popup_cta_pl })}
          onEn={(popup_cta_en) => onChange({ popup_cta_en })}
          placeholderPl="Załóż konto"
          placeholderEn="Create account"
        />
        <IconRow
          label={t("adminPopupSignup.form.ctaIcon")}
          hint={t("adminPopupSignup.form.ctaIconHint")}
          clearLabel={t("adminPopupSignup.form.ctaIconClear")}
          previewLabel={t("adminPopupSignup.form.ctaIconPreview")}
          value={f.ctaIcon}
          onChange={(ctaIcon) => patchForm({ ctaIcon })}
        />
        <BilingualRow
          label={t("adminPopupSignup.form.note")}
          pl={value.popup_note_pl ?? ""}
          en={value.popup_note_en ?? ""}
          onPl={(v) => onChange({ popup_note_pl: v || null })}
          onEn={(v) => onChange({ popup_note_en: v || null })}
        />
      </SectionCard>

      <SectionCard
        title={t("adminPopupSignup.form.presentation")}
        icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <SegmentedRow<"center" | "left">
            label={t("adminPopupSignup.form.align")}
            value={f.align}
            onChange={(align) => patchForm({ align })}
            columns={2}
            options={[
              { value: "center", label: t("adminPopupSignup.form.alignCenter") },
              { value: "left", label: t("adminPopupSignup.form.alignLeft") },
            ]}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NumberRow
            label={t("adminPopupSignup.form.titleSize")}
            value={f.titleSizePx}
            min={18}
            max={64}
            onChange={(titleSizePx) => patchForm({ titleSizePx })}
          />
          <NumberRow
            label={t("adminPopupSignup.form.maxWidth")}
            value={f.maxWidthPx}
            min={280}
            max={720}
            step={10}
            onChange={(maxWidthPx) => patchForm({ maxWidthPx })}
          />
          <div className="flex items-end">
            <ToggleRow
              label={t("adminPopupSignup.form.titleNoWrap")}
              checked={f.titleNoWrap}
              onChange={(titleNoWrap) => patchForm({ titleNoWrap })}
            />
          </div>
          <div className="flex items-end">
            <ToggleRow
              label={t("adminPopupSignup.form.twoColumnPairs")}
              checked={f.twoColumnPairs}
              onChange={(twoColumnPairs) => patchForm({ twoColumnPairs })}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t("adminPopupSignup.form.loginLink")}
        icon={<LogIn className="h-3.5 w-3.5" />}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ToggleRow
            label={t("adminPopupSignup.form.showLoginLink")}
            checked={f.showLoginLink}
            onChange={(showLoginLink) => patchForm({ showLoginLink })}
          />
          <TextRow
            label={t("adminPopupSignup.form.loginLinkHref")}
            value={f.loginLinkHref}
            onChange={(loginLinkHref) => patchForm({ loginLinkHref })}
            placeholder="/login"
          />
        </div>
        <BilingualRow
          label={t("adminPopupSignup.form.loginLinkLabel")}
          pl={f.loginLinkPl}
          en={f.loginLinkEn}
          onPl={(loginLinkPl) => patchForm({ loginLinkPl })}
          onEn={(loginLinkEn) => patchForm({ loginLinkEn })}
        />
      </SectionCard>
    </div>
  );
}
