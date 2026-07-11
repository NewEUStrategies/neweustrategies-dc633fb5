import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminShell } from "@/components/admin/AdminShell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  DEFAULT_PERSONALIZED_SETTINGS,
  PERSONALIZED_SETTINGS_KEY,
  type PersonalizedSettings,
  type PersonalizedSectionConfig,
} from "@/hooks/usePersonalizedSettings";

export const Route = createFileRoute("/admin/personalized")({ component: PersonalizedAdmin });

function PersonalizedAdmin() {
  const { t, i18n } = useTranslation();
  const isPl = !(i18n.language ?? "pl").startsWith("en");
  const [s, setS] = useState<PersonalizedSettings>(DEFAULT_PERSONALIZED_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    supabase
      .from("site_settings")
      .select("value")
      .eq("key", PERSONALIZED_SETTINGS_KEY)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value)
          setS({
            ...DEFAULT_PERSONALIZED_SETTINGS,
            ...(data.value as Partial<PersonalizedSettings>),
          });
        setLoaded(true);
      });
  }, []);

  const save = async () => {
    setBusy(true);
    const { error } = await supabase
      .from("site_settings")
      .upsert({ key: PERSONALIZED_SETTINGS_KEY, value: s as never }, { onConflict: "key" });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success(t("admin.saved"));
  };

  const updateSection = (
    k: "saved" | "followed" | "recommended",
    patch: Partial<PersonalizedSectionConfig>,
  ) => setS({ ...s, sections: { ...s.sections, [k]: { ...s.sections[k], ...patch } } });

  if (!loaded)
    return (
      <AdminShell hideSidebar>
        <p>{t("admin.loading")}</p>
      </AdminShell>
    );

  return (
    <AdminShell hideSidebar>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl">{t("admin.personalized.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("admin.personalized.subtitle")}</p>
        </div>
        <Button onClick={save} disabled={busy}>
          {busy ? t("admin.saving") : t("admin.save")}
        </Button>
      </div>

      <Tabs defaultValue="global">
        <TabsList>
          <TabsTrigger value="global">{t("admin.personalized.tabs.global")}</TabsTrigger>
          <TabsTrigger value="saved">{t("admin.personalized.tabs.saved")}</TabsTrigger>
          <TabsTrigger value="followed">{t("admin.personalized.tabs.followed")}</TabsTrigger>
          <TabsTrigger value="recommended">{t("admin.personalized.tabs.recommended")}</TabsTrigger>
        </TabsList>

        <TabsContent value="global" className="space-y-6 mt-6">
          <Row label={t("admin.personalized.enabled")} hint={t("admin.personalized.enabledHint")}>
            <Switch checked={s.enabled} onCheckedChange={(v) => setS({ ...s, enabled: v })} />
          </Row>
          <Row
            label={t("admin.personalized.allowGuests")}
            hint={t("admin.personalized.allowGuestsHint")}
          >
            <Switch
              checked={s.allowGuests}
              onCheckedChange={(v) => setS({ ...s, allowGuests: v })}
            />
          </Row>
          <Row label={t("admin.personalized.popup")} hint={t("admin.personalized.popupHint")}>
            <Switch
              checked={s.popupNotification}
              onCheckedChange={(v) => setS({ ...s, popupNotification: v })}
            />
          </Row>
          {/* Pole "userExpirationDays" usunięto: zapisy zalogowanych żyją w
              bazie (user_bookmarks / user_follows) i klient nie ma mechanizmu
              retencji, który mógłby to ustawienie egzekwować - była to martwa
              opcja sugerująca nieistniejące zachowanie. */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t("admin.personalized.guestExpiration")}</Label>
              <Input
                type="number"
                value={s.guestExpirationDays}
                onChange={(e) => setS({ ...s, guestExpirationDays: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {isPl
                  ? "Po tylu dniach artykuły zapisane przez gościa (localStorage) wygasają na urządzeniu i nie są scalane z kontem po zalogowaniu. 0 = bez wygasania."
                  : "Guest-saved articles (localStorage) expire on the device after this many days and are not merged into the account at sign-in. 0 = never expire."}
              </p>
            </div>
          </div>
          <div className="border-t border-border pt-6 space-y-4">
            <h3 className="font-medium">{t("admin.personalized.restricted")}</h3>
            <div>
              <Label>{t("admin.personalized.restrictedTitle")}</Label>
              <Input
                value={s.restrictedTitle}
                onChange={(e) => setS({ ...s, restrictedTitle: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("admin.personalized.restrictedDesc")}</Label>
              <Textarea
                value={s.restrictedDescription}
                onChange={(e) => setS({ ...s, restrictedDescription: e.target.value })}
              />
            </div>
          </div>
          <div className="border-t border-border pt-6 space-y-4">
            <h3 className="font-medium">{t("admin.personalized.followHeaders")}</h3>
            <Row label={t("admin.personalized.followCategory")}>
              <Switch
                checked={s.followInCategoryHeader}
                onCheckedChange={(v) => setS({ ...s, followInCategoryHeader: v })}
              />
            </Row>
            <Row label={t("admin.personalized.followTag")}>
              <Switch
                checked={s.followInTagHeader}
                onCheckedChange={(v) => setS({ ...s, followInTagHeader: v })}
              />
            </Row>
            <Row label={t("admin.personalized.followAuthor")}>
              <Switch
                checked={s.followInAuthorHeader}
                onCheckedChange={(v) => setS({ ...s, followInAuthorHeader: v })}
              />
            </Row>
          </div>
          <div className="border-t border-border pt-6">
            <Label>{t("admin.personalized.readingListUrl")}</Label>
            <Input
              value={s.readingListPath}
              onChange={(e) => setS({ ...s, readingListPath: e.target.value })}
              placeholder="/reading-list"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {isPl
                ? 'Dokąd prowadzą linki "listy do przeczytania" (np. akcja w powiadomieniu po zapisaniu artykułu). Sama strona pozostaje pod /reading-list; nieprawidłowa ścieżka wraca do wartości domyślnej.'
                : 'Where "reading list" links point (e.g. the toast action after saving an article). The page itself stays at /reading-list; an invalid path falls back to the default.'}
            </p>
          </div>
        </TabsContent>

        {(["saved", "followed", "recommended"] as const).map((key) => (
          <TabsContent key={key} value={key} className="space-y-4 mt-6">
            <Row label={t("admin.personalized.sectionEnabled")}>
              <Switch
                checked={s.sections[key].enabled}
                onCheckedChange={(v) => updateSection(key, { enabled: v })}
              />
            </Row>
            <div>
              <Label>{t("admin.personalized.sectionHeading")}</Label>
              <Input
                value={s.sections[key].heading}
                onChange={(e) => updateSection(key, { heading: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("admin.personalized.sectionDescription")}</Label>
              <Textarea
                value={s.sections[key].description}
                onChange={(e) => updateSection(key, { description: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("admin.personalized.sectionColumns")}</Label>
              <Input
                type="number"
                min={2}
                max={4}
                value={s.sections[key].columns}
                onChange={(e) => updateSection(key, { columns: Number(e.target.value) })}
              />
            </div>
            {key === "recommended" && (
              <div>
                <Label>{t("admin.personalized.recommendedCount")}</Label>
                <Input
                  type="number"
                  min={3}
                  max={30}
                  value={s.sections.recommended.postsPerPage ?? 9}
                  onChange={(e) =>
                    updateSection("recommended", { postsPerPage: Number(e.target.value) })
                  }
                />
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </AdminShell>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
