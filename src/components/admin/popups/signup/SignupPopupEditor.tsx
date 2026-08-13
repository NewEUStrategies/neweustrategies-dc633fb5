// Edytor popupu REJESTRACJI konta (Admin → Popupy). Zakładki pokrywają każdy
// element popupu: układ, lewa strona (galeria), prawa strona (teksty i
// prezentacja), pola formularza, zgody i kolory - wszystko z wersjami PL/EN.
// Pod spodem podgląd na żywo renderujący dokładnie ten sam komponent, który
// widzi odwiedzający (SignupPopupPanel), z przełącznikiem języka i palety.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, LayoutGrid, ListChecks, PanelLeft, Palette, ShieldCheck, Type } from "lucide-react";
import { PopupPreview } from "@/components/admin/newsletter/PopupPreview";
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";
import {
  effectivePopupMode,
  resolvePopupDesign,
  type PopupColorScheme,
  type PopupControlColors,
  type PopupFormDesign,
  type PopupGalleryDesign,
  type PopupPanelDesign,
  type PopupThemeColors,
} from "@/lib/newsletter/popupDesign";
import { LayoutTab } from "./LayoutTab";
import { GalleryTab } from "./GalleryTab";
import { FormTab } from "./FormTab";
import { FieldsTab } from "./FieldsTab";
import { ConsentsTab } from "./ConsentsTab";
import { ColorsTab } from "./ColorsTab";
import type { SignupPopupTabProps } from "./types";
import "@/lib/i18n-admin-popup-signup";

const TABS = [
  { id: "layout", icon: LayoutGrid },
  { id: "gallery", icon: PanelLeft },
  { id: "form", icon: Type },
  { id: "fields", icon: ListChecks },
  { id: "consents", icon: ShieldCheck },
  { id: "colors", icon: Palette },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface Props {
  value: NewsletterSettings;
  onChange: (patch: Partial<NewsletterSettings>) => void;
}

export function SignupPopupEditor({ value, onChange }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>("layout");
  const [lang, setLang] = useState<"pl" | "en">("pl");
  const [previewMode, setPreviewMode] = useState<"light" | "dark" | null>(null);

  const design = useMemo(() => resolvePopupDesign(value.popup_design), [value.popup_design]);

  // Każdy patch zapisuje CAŁY, rozwiązany obiekt - dzięki temu w bazie nigdy
  // nie ląduje częściowy JSON, a stare tenanty dostają komplet defaultów.
  const patchPanel = (patch: Partial<PopupPanelDesign>) =>
    onChange({ popup_design: { ...design, panel: { ...design.panel, ...patch } } });
  const patchGallery = (patch: Partial<PopupGalleryDesign>) =>
    onChange({ popup_design: { ...design, gallery: { ...design.gallery, ...patch } } });
  const patchForm = (patch: Partial<PopupFormDesign>) =>
    onChange({ popup_design: { ...design, form: { ...design.form, ...patch } } });
  const patchLight = (patch: Partial<PopupThemeColors>) =>
    onChange({ popup_design: { ...design, light: { ...design.light, ...patch } } });
  const patchControls = (mode: "dark" | "light", patch: Partial<PopupControlColors>) =>
    onChange({
      popup_design: {
        ...design,
        controls: { ...design.controls, [mode]: { ...design.controls[mode], ...patch } },
      },
    });
  const setColorScheme = (colorScheme: PopupColorScheme) =>
    onChange({ popup_design: { ...design, colorScheme } });

  const tabProps: SignupPopupTabProps = {
    value,
    design,
    onChange,
    patchPanel,
    patchGallery,
    patchForm,
    patchLight,
    patchControls,
    setColorScheme,
  };

  const resolvedPreviewMode = previewMode ?? effectivePopupMode(design, "dark");

  return (
    <section className="space-y-5 rounded-xl border border-border bg-card p-5">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-display text-lg">{t("adminPopupSignup.title")}</h3>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("adminPopupSignup.subtitle")}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {TABS.map((entry) => {
          const Icon = entry.icon;
          const active = tab === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              aria-pressed={active}
              className={
                "flex items-center justify-center gap-2 whitespace-nowrap rounded-md border px-3 py-2 text-sm transition-colors " +
                (active
                  ? "border-primary bg-primary/10 text-foreground shadow-sm"
                  : "border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground")
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {t(`adminPopupSignup.tabs.${entry.id}`)}
            </button>
          );
        })}
      </div>

      {tab === "layout" && <LayoutTab {...tabProps} />}
      {tab === "gallery" && <GalleryTab {...tabProps} />}
      {tab === "form" && <FormTab {...tabProps} />}
      {tab === "fields" && <FieldsTab {...tabProps} />}
      {tab === "consents" && <ConsentsTab {...tabProps} />}
      {tab === "colors" && <ColorsTab {...tabProps} />}

      <div className="space-y-2 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold">{t("adminPopupSignup.preview.heading")}</h4>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1">
              {(["pl", "en"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLang(code)}
                  aria-pressed={lang === code}
                  className={
                    "rounded-md px-2.5 py-1 text-xs transition-colors " +
                    (lang === code
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground")
                  }
                >
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {(
                [
                  { mode: "light" as const, label: t("adminPopupSignup.preview.light") },
                  { mode: "dark" as const, label: t("adminPopupSignup.preview.dark") },
                ] satisfies Array<{ mode: "light" | "dark"; label: string }>
              ).map((entry) => (
                <button
                  key={entry.mode}
                  type="button"
                  onClick={() => setPreviewMode(entry.mode)}
                  aria-pressed={resolvedPreviewMode === entry.mode}
                  className={
                    "rounded-md px-2.5 py-1 text-xs transition-colors " +
                    (resolvedPreviewMode === entry.mode
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground")
                  }
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">{t("adminPopupSignup.preview.hint")}</p>
        <div className="overflow-hidden rounded-md border border-border bg-gradient-to-br from-muted/40 to-muted/10">
          <PopupPreview settings={value} lang={lang} mode={resolvedPreviewMode} />
        </div>
      </div>
    </section>
  );
}
