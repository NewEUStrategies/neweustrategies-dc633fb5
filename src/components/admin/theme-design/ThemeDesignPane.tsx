// Page / template: global "Theme Design" styles pane.
//
// Controls block headings, thumbnails, "Read more" buttons, meta info, toolbar
// buttons, the light/dark mode switcher, social icons, post titles/excerpts,
// list-index numerals, global carousel defaults and post-overlay typography.
// Embedded as a section inside ThemeOptionsPane (under "Style treści").
//
// This is a thin composition root: all state + persistence live in
// `useThemeDesignDrafts`, all UI in the atoms/molecules/organisms tree.
import { useTranslation } from "react-i18next";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import "@/lib/i18n-admin-theme-design";
import { ColorModeScopeBar } from "./molecules";
import {
  I18nAndLiveToolbar,
  SectionTabsNav,
  LivePostPreview,
  BlockHeadingSection,
  ThumbnailSection,
  ReadMoreSection,
  MetaSection,
  ToolbarSection,
  ModeSwitchSection,
  SocialSection,
  PostTitleSection,
  PostExcerptSection,
  ListIndexSection,
  CarouselSection,
  OverlayTypographySection,
} from "./organisms";
import { isPreviewSection } from "./lib";
import { useThemeDesignDrafts } from "./hooks";
import type { SectionEditorProps } from "./types";

export function ThemeDesignPane() {
  const { t } = useTranslation();
  const c = useThemeDesignDrafts();

  if (c.loading || !c.draft || !c.carouselDraft || !c.overlayDraft) {
    return <p className="text-sm text-muted-foreground">{t("adminThemeDesign.loading")}</p>;
  }

  // Uniform contract shared by every ThemeDesign-editing section.
  const editorProps: SectionEditorProps = {
    draft: c.draft,
    set: c.set,
    setColor: c.setColor,
    previewMode: c.previewMode,
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("adminThemeDesign.introPre")}
        <code>--td-*</code>
        {t("adminThemeDesign.introPost")}
      </p>

      <I18nAndLiveToolbar
        mode={c.mode}
        onModeChange={c.onModeChange}
        editLang={c.editLang}
        onEditLangChange={c.setEditLang}
        liveSync={c.liveSync}
        onLiveSyncChange={c.setLiveSync}
        savingMode={c.savingMode}
      />

      <LivePostPreview
        draft={c.draft}
        previewLang={c.previewLang}
        onLangChange={c.setPreviewLang}
        previewMode={c.previewMode}
        onModeChange={c.setPreviewMode}
        activeTab={c.activeTab}
      />

      <ColorModeScopeBar mode={c.previewMode} onModeChange={c.setPreviewMode} />

      <Tabs
        value={c.activeTab}
        onValueChange={(value) => {
          if (isPreviewSection(value)) c.setActiveTab(value);
        }}
        className="space-y-4"
      >
        <SectionTabsNav />

        <TabsContent value="block-heading" className="mt-0">
          <BlockHeadingSection {...editorProps} />
        </TabsContent>
        <TabsContent value="thumbnail" className="mt-0">
          <ThumbnailSection {...editorProps} />
        </TabsContent>
        <TabsContent value="read-more" className="mt-0">
          <ReadMoreSection {...editorProps} />
        </TabsContent>
        <TabsContent value="meta" className="mt-0">
          <MetaSection {...editorProps} />
        </TabsContent>
        <TabsContent value="toolbar" className="mt-0">
          <ToolbarSection {...editorProps} />
        </TabsContent>
        <TabsContent value="mode-switch" className="mt-0">
          <ModeSwitchSection {...editorProps} />
        </TabsContent>
        <TabsContent value="social" className="mt-0">
          <SocialSection {...editorProps} />
        </TabsContent>
        <TabsContent value="post-title" className="mt-0">
          <PostTitleSection {...editorProps} />
        </TabsContent>
        <TabsContent value="post-excerpt" className="mt-0">
          <PostExcerptSection {...editorProps} />
        </TabsContent>
        <TabsContent value="list-index" className="mt-0">
          <ListIndexSection {...editorProps} />
        </TabsContent>
        <TabsContent value="carousel" className="mt-0">
          <CarouselSection draft={c.carouselDraft} onChange={c.setCarouselDraft} />
        </TabsContent>
        <TabsContent value="overlay" className="mt-0">
          <OverlayTypographySection draft={c.overlayDraft} onChange={c.setOverlayDraft} />
        </TabsContent>
      </Tabs>

      <div className="flex gap-2 pt-2">
        <Button onClick={c.saveAll} disabled={c.saving}>
          <Save className="w-4 h-4 mr-1.5" /> {t("adminThemeDesign.saveAll")}
        </Button>
        <Button variant="outline" onClick={c.restoreDefaults}>
          {t("adminThemeDesign.restoreDefaults")}
        </Button>
      </div>
    </div>
  );
}
