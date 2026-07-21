// Organizm: krok "Treść" edytora wpisu. Przełącznik silnika (Gutenberg /
// Elementor), a pod nim właściwy edytor: bloki (z kanwą owiniętą w layout
// wpisu), Visual Builder lub starsze tryby tekstowe (rich text / markdown).
// Wyodrębnione 1:1 z trasy admin.posts.$slug.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PostEditor } from "@/components/admin/PostEditor";
import { PostBlockEditor } from "@/components/admin/blocks/PostBlockEditor";
import { EMPTY_BLOCKS_DOC } from "@/lib/blocks/types";
import { LayoutScaffold } from "@/components/admin/blocks/LayoutScaffold";
import { mergeOverrides, pickLayoutId } from "@/lib/postLayouts";
import type { LayoutOverrides, PostFormat, PostLayoutSettings } from "@/lib/postLayouts";
import { promptDialog } from "@/lib/appDialogs";
import { EditorModeToggle } from "../molecules";
import { PostSidebarBundle } from "./PostSidebarBundle";
import { BuilderPane } from "./BuilderPane";
import type { AutoReadMinutes } from "../types";
import type { InlineTaxonomyApi, PostEditorData, PostEditorFormApi } from "../hooks";
import "@/lib/i18n-admin-post-panes";

export function PostContentEditor({
  formApi,
  data,
  routeSlug,
  uiLang,
  autoReadMinutes,
  taxonomy,
  globalLayout,
  ov,
  currentFormat,
  layoutCard,
}: {
  formApi: PostEditorFormApi;
  data: PostEditorData;
  routeSlug: string;
  uiLang: string;
  autoReadMinutes: AutoReadMinutes;
  taxonomy: InlineTaxonomyApi;
  globalLayout: PostLayoutSettings | undefined;
  ov: LayoutOverrides;
  currentFormat: PostFormat;
  layoutCard: ReactNode;
}) {
  const { t } = useTranslation();
  const { form, set } = formApi;
  if (!form) return null;

  const pickImage = async (): Promise<string | null> =>
    promptDialog({
      title: t("admin.imageUrlTitle", { defaultValue: "Adres URL obrazka" }),
      placeholder: "https://…",
      confirmLabel: t("admin.insert", { defaultValue: "Wstaw" }),
    });

  return (
    <div className="space-y-5">
      <EditorModeToggle editor={form.editor} onEditorChange={(next) => set("editor", next)} />
      {form.editor === "blocks" ? (
        <PostBlockEditor
          value={form.blocks_data ?? { pl: EMPTY_BLOCKS_DOC, en: EMPTY_BLOCKS_DOC }}
          onChange={(v) => set("blocks_data", v)}
          canvasWrap={(canvas, lang) => {
            if (!globalLayout) return canvas;
            const effective = mergeOverrides(globalLayout, ov);
            const layoutId = pickLayoutId(globalLayout, currentFormat, ov.layout);
            const title =
              lang === "en" ? form.title_en || form.title_pl : form.title_pl || form.title_en;
            const excerpt = lang === "en" ? form.excerpt_en : form.excerpt_pl;
            return (
              <LayoutScaffold
                format={currentFormat}
                layoutId={layoutId}
                settings={effective}
                title={title}
                excerpt={excerpt}
                coverImageUrl={form.cover_image_url}
              >
                {canvas}
              </LayoutScaffold>
            );
          }}
          documentPane={
            <PostSidebarBundle
              scope="document"
              formApi={formApi}
              data={data}
              routeSlug={routeSlug}
              uiLang={uiLang}
              autoReadMinutes={autoReadMinutes}
              taxonomy={taxonomy}
              layoutCard={layoutCard}
            />
          }
        />
      ) : form.editor === "builder" ? (
        <BuilderPane form={form} set={set} />
      ) : (
        <Tabs defaultValue="pl">
          <TabsList>
            <TabsTrigger value="pl">🇵🇱 {t("adminPostPanes.editor.langPl")}</TabsTrigger>
            <TabsTrigger value="en">🇬🇧 {t("adminPostPanes.editor.langEn")}</TabsTrigger>
          </TabsList>
          <TabsContent value="pl" className="space-y-4 mt-4">
            <div>
              <Label>{t("admin.posts.content")} (PL)</Label>
              <PostEditor
                mode={form.editor === "markdown" ? "markdown" : "richtext"}
                value={form.content_pl ?? ""}
                onChange={(v) => set("content_pl", v)}
                onPickImage={pickImage}
              />
            </div>
          </TabsContent>
          <TabsContent value="en" className="space-y-4 mt-4">
            <div>
              <Label>{t("admin.posts.content")} (EN)</Label>
              <PostEditor
                mode={form.editor === "markdown" ? "markdown" : "richtext"}
                value={form.content_en ?? ""}
                onChange={(v) => set("content_en", v)}
                onPickImage={pickImage}
              />
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
