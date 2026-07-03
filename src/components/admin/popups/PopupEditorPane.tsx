// Popup editor: the full visual Builder (scope "popup") + display settings.
// The popup document and settings live in builder_popups; Save persists both.
// Zapis jest ręczny (bez autosave), więc guard niezapisanych zmian porównuje
// bieżący stan z migawką z ostatniego zapisu - wyjście z edytora lub
// zamknięcie karty z brudnym stanem wymaga potwierdzenia.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { Builder } from "@/components/admin/builder/Builder";
import { PopupSettingsPane } from "./PopupSettingsPane";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Save } from "@/lib/lucide-shim";
import type { BuilderDocument } from "@/lib/builder/types";
import { usePopupEditor, type PopupSettings, type PopupStatus } from "@/lib/builder/popups";

export function PopupEditorPane({ popupId }: { popupId: string }) {
  const { t } = useTranslation();
  const { popup, loading, save } = usePopupEditor(popupId);

  const [name, setName] = useState("");
  const [status, setStatus] = useState<PopupStatus>("draft");
  const [doc, setDoc] = useState<BuilderDocument | null>(null);
  const [settings, setSettings] = useState<PopupSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [lang, setLang] = useState<"pl" | "en">("pl");
  // Migawka stanu z ostatniego zapisu (null = rekord jeszcze nie zaladowany).
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);

  // Seed local editing state once the record arrives.
  useEffect(() => {
    if (!popup || doc) return;
    setName(popup.name);
    setStatus(popup.status);
    setDoc(popup.builder_data);
    setSettings(popup.settings);
    setSavedSnapshot(
      JSON.stringify({
        name: popup.name,
        status: popup.status,
        doc: popup.builder_data,
        settings: popup.settings,
      }),
    );
  }, [popup, doc]);

  const currentSnapshot = useMemo(
    () => JSON.stringify({ name, status, doc, settings }),
    [name, status, doc, settings],
  );
  const isDirty = savedSnapshot !== null && currentSnapshot !== savedSnapshot;
  // Tab close / route change with unsaved edits -> confirmation prompt.
  useUnsavedChangesGuard(isDirty || saving);

  const onSave = useCallback(async () => {
    if (!doc || !settings) return;
    setSaving(true);
    const ok = await save({ name: name.trim() || "Popup", status, builder_data: doc, settings });
    setSaving(false);
    if (ok) {
      setSavedSnapshot(JSON.stringify({ name, status, doc, settings }));
      toast.success(t("admin.popups.saved", { defaultValue: "Zapisano popup" }));
    } else {
      toast.error(t("admin.popups.saveError", { defaultValue: "Nie udało się zapisać popupu" }));
    }
  }, [doc, settings, name, status, save, t]);

  if (loading || (!popup && !doc)) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {t("admin.popups.loading", { defaultValue: "Ładowanie…" })}
      </p>
    );
  }
  if (!popup && !loading) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-muted-foreground">
          {t("admin.popups.notFound", { defaultValue: "Nie znaleziono popupu." })}
        </p>
        <Link
          to="/admin/popups"
          className="text-sm text-brand hover:underline inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" />{" "}
          {t("admin.popups.backToList", { defaultValue: "Wróć do listy popupów" })}
        </Link>
      </div>
    );
  }
  if (!doc || !settings) return null;

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to="/admin/popups"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm shrink-0"
          >
            <ArrowLeft className="w-4 h-4" /> {t("admin.popups.title", { defaultValue: "Popupy" })}
          </Link>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 w-64 font-medium"
            placeholder={t("admin.popups.namePlaceholder", { defaultValue: "Nazwa popupu" })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as PopupStatus)}>
            <SelectTrigger className="w-40 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">
                {t("admin.popups.statusDraft", { defaultValue: "Szkic" })}
              </SelectItem>
              <SelectItem value="active">
                {t("admin.popups.statusActive", { defaultValue: "Aktywny" })}
              </SelectItem>
              <SelectItem value="archived">
                {t("admin.popups.statusArchived", { defaultValue: "Zarchiwizowany" })}
              </SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => void onSave()} disabled={saving}>
            <Save className="w-4 h-4 mr-2" />
            {saving
              ? t("admin.popups.saving", { defaultValue: "Zapisywanie…" })
              : t("admin.popups.save", { defaultValue: "Zapisz" })}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="builder">
        <TabsList>
          <TabsTrigger value="builder">
            {t("admin.popups.tabBuilder", { defaultValue: "Builder" })}
          </TabsTrigger>
          <TabsTrigger value="settings">
            {t("admin.popups.tabSettings", { defaultValue: "Ustawienia" })}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="builder" className="mt-3">
          <Builder
            value={doc}
            onChange={setDoc}
            lang={lang}
            onLangChange={setLang}
            hideChrome
            scope="popup"
          />
        </TabsContent>
        <TabsContent value="settings" className="mt-3">
          <PopupSettingsPane value={settings} onChange={setSettings} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
