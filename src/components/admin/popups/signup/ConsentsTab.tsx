// Zakładka "Zgody": zgoda na politykę prywatności i regulamin. Checkboxy
// w popupie używają domyślnego komponentu platformy (animowany SVG, 6px),
// a HTML treści jest sanityzowany przed wyświetleniem.
//
// I9d-Y2b (wariant (b) - każda zgoda ma osobne pole): pole „prywatność" jest
// WYMAGANE, więc nie może nieść zgody na newsletter (uzależnienie rejestracji
// od zgody marketingowej - art. 7 ust. 4 RODO). Dlatego pole NIE spada już
// na treść zgody na newsletter (`policy_html_*`): puste pole pokazuje
// w placeholderze domyślną akceptację polityki (`privacyAcceptanceHtml`) -
// tę samą, którą popup wyświetla przy pustym polu. Kopie treści zgody na
// newsletter zapisane tu wcześniej czyści migracja 20261023090000.
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { privacyAcceptanceHtml } from "@/lib/newsletter/consentText";
import { BilingualRow, SectionCard, ToggleRow } from "./controls";
import type { SignupPopupTabProps } from "./types";

export function ConsentsTab({ value, onChange }: SignupPopupTabProps) {
  const { t } = useTranslation();

  return (
    <SectionCard
      title={t("adminPopupSignup.consents.heading")}
      hint={t("adminPopupSignup.consents.hint")}
      icon={<ShieldCheck className="h-3.5 w-3.5" />}
    >
      <ToggleRow
        label={t("adminPopupSignup.consents.requirePrivacy")}
        checked={value.popup_require_privacy}
        onChange={(popup_require_privacy) => onChange({ popup_require_privacy })}
      />
      <BilingualRow
        multiline
        rows={3}
        label={t("adminPopupSignup.consents.privacy")}
        pl={value.popup_privacy_html_pl ?? ""}
        en={value.popup_privacy_html_en ?? ""}
        placeholderPl={privacyAcceptanceHtml("pl")}
        placeholderEn={privacyAcceptanceHtml("en")}
        onPl={(v) => onChange({ popup_privacy_html_pl: v || null })}
        onEn={(v) => onChange({ popup_privacy_html_en: v || null })}
        hint={t("adminPopupSignup.consents.htmlHint")}
      />

      <ToggleRow
        label={t("adminPopupSignup.consents.requireTerms")}
        checked={value.popup_require_terms}
        onChange={(popup_require_terms) => onChange({ popup_require_terms })}
      />
      <BilingualRow
        multiline
        rows={2}
        label={t("adminPopupSignup.consents.terms")}
        pl={value.popup_terms_html_pl ?? ""}
        en={value.popup_terms_html_en ?? ""}
        onPl={(v) => onChange({ popup_terms_html_pl: v || null })}
        onEn={(v) => onChange({ popup_terms_html_en: v || null })}
      />
    </SectionCard>
  );
}
