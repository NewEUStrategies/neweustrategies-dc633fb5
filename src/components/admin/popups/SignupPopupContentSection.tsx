// Sekcja "Popup - układ, galeria i treść" w Admin -> Popupy.
// Przeniesiona z Admin -> Newsletter -> Podsumowanie: zarządza ustawieniami
// popupu rejestracyjnego (newsletter_settings) i ma własny zapis.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PopupShowcasePanel } from "@/components/admin/newsletter/PopupShowcasePanel";
import {
  useNewsletterSettings,
  useSaveNewsletterSettings,
  defaultNewsletterSettings,
  type NewsletterSettings,
} from "@/hooks/useNewsletterSettings";

export function SignupPopupContentSection() {
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
      toast.success(t("admin.popups.content.saved", { defaultValue: "Zapisano ustawienia popupu" }));
    } catch {
      toast.error(t("admin.popups.content.saveError", { defaultValue: "Nie udało się zapisać" }));
    }
  };

  return (
    <div className="space-y-4">
      <PopupShowcasePanel value={current} onChange={update} />
      <div className="flex justify-end">
        <Button onClick={() => void onSave()} disabled={!dirty || save.isPending}>
          <Save className="w-4 h-4 mr-2" />
          {t("admin.popups.content.save", { defaultValue: "Zapisz ustawienia popupu" })}
        </Button>
      </div>
    </div>
  );
}
