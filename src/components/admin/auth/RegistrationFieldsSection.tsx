// Sekcja "Pola rejestracji" osadzona w Admin → Strona logowania.
//
// Edytuje DOKŁADNIE ten sam rejestr pól co Admin → Popupy
// (`newsletter_settings.popup_fields`), więc zmiana etykiety, widoczności lub
// wymagalności obowiązuje jednocześnie na stronie /login,
// /membership-registration, w popupie rejestracji i w widgecie rejestracji.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldsTab } from "@/components/admin/popups/signup/FieldsTab";
import {
  defaultNewsletterSettings,
  useNewsletterSettings,
  useSaveNewsletterSettings,
  type NewsletterSettings,
} from "@/hooks/useNewsletterSettings";
import "@/lib/i18n-admin-popup-signup";

export function RegistrationFieldsSection() {
  const { t } = useTranslation();
  const { data } = useNewsletterSettings();
  const save = useSaveNewsletterSettings();
  const [draft, setDraft] = useState<NewsletterSettings | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data && !dirty) setDraft(data);
  }, [data, dirty]);

  const current = useMemo(
    () => draft ?? data ?? defaultNewsletterSettings(),
    [draft, data],
  );

  const update = (patch: Partial<NewsletterSettings>) => {
    setDirty(true);
    setDraft((prev) => ({ ...(prev ?? data ?? defaultNewsletterSettings()), ...patch }));
  };

  const onSave = async () => {
    try {
      await save.mutateAsync(current);
      setDirty(false);
      toast.success(t("adminPopupSignup.saved"));
    } catch {
      toast.error(t("adminPopupSignup.saveError"));
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card/50 p-5">
      <header className="space-y-1">
        <h2 className="text-base font-semibold">{t("adminPopupSignup.shared.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("adminPopupSignup.shared.desc")}</p>
      </header>
      <FieldsTab value={current} onChange={update} />
      <div className="flex items-center justify-end gap-2">
        {dirty && (
          <span className="mr-auto text-xs text-muted-foreground">
            {t("adminPopupSignup.unsaved")}
          </span>
        )}
        <Button onClick={() => void onSave()} disabled={!dirty || save.isPending}>
          <Save className="mr-2 h-4 w-4" />
          {t("adminPopupSignup.save")}
        </Button>
      </div>
    </section>
  );
}
