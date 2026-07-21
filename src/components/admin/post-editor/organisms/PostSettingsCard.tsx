// Organizm "Ustawienia wpisu": workflow (status/publikacja) + zaawansowany typ
// edytora + slug + strona nadrzędna + czas czytania + okładka. Składa molekułę
// WorkflowStatusSection i atomy SidebarSection / InfoHint. Wyodrębnione 1:1 z
// PostEditorCards - zachowanie bez zmian.
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Settings as SettingsIcon, Layers } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { CoverImagePicker } from "@/components/admin/CoverImagePicker";
import { PageParentSelect } from "@/components/admin/PageParentSelect";
import { migratePostToBlocks } from "@/lib/posts-migrate.functions";
import { toastError } from "@/lib/toastError";
import { SidebarSection, InfoHint } from "../atoms";
import { WorkflowStatusSection } from "../molecules";
import type { AutoReadMinutes, EditorType } from "../types";
import type { PostEditorData, PostEditorFormApi } from "../hooks";

export function PostSettingsCard({
  formApi,
  data,
  routeSlug,
  uiLang,
  autoReadMinutes,
}: {
  formApi: PostEditorFormApi;
  data: PostEditorData;
  routeSlug: string;
  uiLang: string;
  autoReadMinutes: AutoReadMinutes;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const migrate$ = useServerFn(migratePostToBlocks);
  const { form, set, canPublish, busy, statusOptions, scheduledInPast } = formApi;
  if (!form) return null;

  const workflowSection = (
    <WorkflowStatusSection
      status={form.status}
      publishAt={form.publish_at}
      publishedAt={form.published_at}
      canPublish={canPublish}
      busy={busy}
      statusOptions={statusOptions}
      scheduledInPast={scheduledInPast}
      uiLang={uiLang}
      onStatusChange={(v) => {
        // Zmiana w select też przechodzi przez bramkę - to główna ścieżka
        // publikacji (status -> published, potem Zapisz).
        void (async () => {
          if (await formApi.confirmPublishGaps(v)) set("status", v);
        })();
      }}
      onPublishAtChange={(v) => set("publish_at", v)}
      onApplyStatus={formApi.applyStatus}
    />
  );

  return (
    <SidebarSection
      title={t("admin.posts.settingsCard", { defaultValue: "Ustawienia wpisu" })}
      icon={SettingsIcon}
    >
      {workflowSection}
      <SidebarSection
        title={t("admin.posts.editorAdvanced", { defaultValue: "Zaawansowane: typ edytora" })}
        icon={Layers}
        defaultOpen={false}
      >
        <p className="text-[11px] text-muted-foreground -mt-1">
          {t("admin.posts.editorAdvancedHint", {
            defaultValue:
              "Domyślnie używany jest edytor blokowy. Zmień tylko jeśli wiesz, czego potrzebujesz.",
          })}
        </p>
        <div>
          <Label className="inline-flex items-center gap-1">
            {t("admin.posts.editor")}
            <InfoHint
              text={t("admin.posts.editorHint", {
                defaultValue:
                  "Bloki = zalecany edytor. Visual Builder = układ przeciągnij-i-upuść. Rich text / Markdown = starsze tryby tekstowe.",
              })}
            />
          </Label>
          <Select value={form.editor} onValueChange={(v) => set("editor", v as EditorType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="blocks">
                {t("admin.posts.editorBlocks", { defaultValue: "Block editor (zalecane)" })}
              </SelectItem>
              <SelectItem value="builder">
                {t("admin.posts.editorBuilder", { defaultValue: "Visual Builder (Elementor)" })}
              </SelectItem>
              <SelectItem value="richtext">
                {t("admin.posts.editorRichtext", { defaultValue: "Rich text (legacy)" })}
              </SelectItem>
              <SelectItem value="markdown">
                {t("admin.posts.editorMarkdown", { defaultValue: "Markdown (legacy)" })}
              </SelectItem>
            </SelectContent>
          </Select>
          {form.editor !== "blocks" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={async () => {
                try {
                  const res = await migrate$({ data: { id: form.id } });
                  toast.success(
                    t("admin.posts.migrateOk", {
                      defaultValue: "Skonwertowano na bloki (źródło: {{src}})",
                      src: res.source,
                    }),
                  );
                  await qc.invalidateQueries({
                    queryKey: ["post-by-slug", data.tenantId, routeSlug],
                  });
                } catch (e) {
                  toastError(e, "generic");
                }
              }}
            >
              {t("admin.posts.migrateToBlocks", { defaultValue: "Konwertuj na bloki" })}
            </Button>
          )}
        </div>
      </SidebarSection>
      <div>
        <Label className="inline-flex items-center gap-1">
          Slug
          <InfoHint
            text={t("admin.posts.slugHint", {
              defaultValue:
                "Część adresu URL wpisu. Zmiana slug zmienia link; przy kolizji serwer dopisze sufiks.",
            })}
          />
        </Label>
        <Input value={form.slug} onChange={(e) => set("slug", e.target.value)} />
      </div>
      <div>
        <Label className="inline-flex items-center gap-1">
          {t("admin.posts.parentLabel", { defaultValue: "Strona nadrzędna" })}
          <InfoHint
            text={t("admin.posts.parentHint", {
              defaultValue:
                "Umieszcza wpis w ścieżce URL wybranej strony i wpływa na nawigację/breadcrumbs.",
            })}
          />
        </Label>
        <PageParentSelect
          tenantId={data.tenantId}
          value={form.parent_page_id}
          onChange={(v) => v && set("parent_page_id", v)}
          label=""
          noneLabel={t("admin.posts.parentNone", { defaultValue: "- wybierz stronę -" })}
        />
      </div>
      <div>
        <Label>{t("admin.posts.readMinutes")}</Label>
        <Input
          type="number"
          value={form.read_minutes ?? ""}
          onChange={(e) => set("read_minutes", e.target.value ? Number(e.target.value) : null)}
          placeholder={t("admin.posts.readMinutesAuto", { defaultValue: "auto" })}
        />
        {/* Symultaniczny podgląd automatu dla OBU wersji językowych, liczony
            tym samym rdzeniem i ustawieniami co strona publiczna
            (/admin/reading-time). Puste pole = czytelnik dostaje automat. */}
        <p className="mt-1 text-xs text-muted-foreground">
          {t("admin.posts.readMinutesHint", {
            defaultValue: "Auto: PL {{pl}} min · EN {{en}} min. Puste pole = automat.",
            pl: autoReadMinutes.pl.minutes,
            en: autoReadMinutes.en.minutes,
          })}
        </p>
      </div>
      <div>
        <CoverImagePicker
          label={t("admin.posts.cover")}
          value={form.cover_image_url ?? ""}
          onChange={(v: string) => set("cover_image_url", v || null)}
        />
      </div>
    </SidebarSection>
  );
}
