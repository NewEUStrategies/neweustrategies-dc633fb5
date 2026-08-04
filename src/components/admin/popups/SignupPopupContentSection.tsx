// Sekcja "Popup rejestracji" w Admin → Popupy: pełny edytor treści, układu,
// pól i kolorów popupu rejestracji konta (newsletter_settings) z własnym
// zapisem i podglądem 1:1. Popup zakłada realne konto - newsletter jest w nim
// wyłącznie opcjonalnym checkboxem.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignupPopupEditor } from "@/components/admin/popups/signup/SignupPopupEditor";
import {
  useNewsletterSettings,
  useSaveNewsletterSettings,
  defaultNewsletterSettings,
  type NewsletterSettings,
} from "@/hooks/useNewsletterSettings";
import { defaultPopupDesign } from "@/lib/newsletter/popupDesign";
import "@/lib/i18n-admin-popup-signup";

export function SignupPopupContentSection() {
  const { t } = useTranslation();
  const { data } = useNewsletterSettings();
  const save = useSaveNewsletterSettings();
  const [draft, setDraft] = useState<NewsletterSettings | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data && !dirty) setDraft(data);
  }, [data, dirty]);

  const current = useMemo(() => draft ?? data ?? defaultNewsletterSettings(), [draft, data]);

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
    <div className="space-y-4">
      <SignupPopupEditor value={current} onChange={update} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {dirty && (
          <span className="mr-auto text-xs text-muted-foreground">
            {t("adminPopupSignup.unsaved")}
          </span>
        )}
        <Button
          variant="outline"
          onClick={() => {
            update({ popup_design: defaultPopupDesign() });
            toast.success(t("adminPopupSignup.resetDone"));
          }}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          {t("adminPopupSignup.reset")}
        </Button>
        <Button onClick={() => void onSave()} disabled={!dirty || save.isPending}>
          <Save className="mr-2 h-4 w-4" />
          {t("adminPopupSignup.save")}
        </Button>
      </div>
    </div>
  );
}
