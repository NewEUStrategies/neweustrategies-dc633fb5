// Pane with global "Theme Design" styles - block headings, thumbnails,
// "Read more" buttons, meta info, toolbar buttons, mode switcher, social icons
// + global slider/carousel defaults.
// Embedded as a section inside ThemeOptionsPane (under "Style treści").
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import "@/lib/i18n-admin-theme-design";
import {
  Save,
  Sun,
  Moon,
  Undo,
  Redo,
  Monitor,
  Tablet,
  Smartphone,
  Facebook,
  Instagram,
  Youtube,
  Linkedin,
  Mail,
} from "lucide-react";
import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";
import { NumberInput, StepperInput } from "@/components/admin/builder/ui/atoms";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { usePostLayoutSettings, useSavePostLayoutSettings } from "@/hooks/usePostLayoutSettings";
import { toast } from "sonner";
import {
  useThemeDesign,
  useThemeDesignEn,
  useSaveThemeDesign,
  useThemeDesignLangMode,
  useSaveThemeDesignLangMode,
  useLiveThemeDesignPreview,
  themeDesignToCss,
  themeDesignToStyleVars,
  THEME_DESIGN_DEFAULTS,
  THEME_DESIGN_COLOR_INHERITANCE,
  type ThemeDesign,
  type ThemeDesignLang,
} from "@/lib/theme/themeDesign";
import { hardenStyleCss } from "@/lib/sanitize";
import {
  useCarouselDefaults,
  useSaveCarouselDefaults,
  CAROUSEL_DEFAULTS,
  type CarouselDefaults,
} from "@/lib/theme/carouselDefaults";
import { Languages, Eye, EyeOff } from "lucide-react";

type PreviewSection =
  | "block-heading"
  | "thumbnail"
  | "read-more"
  | "meta"
  | "toolbar"
  | "mode-switch"
  | "social"
  | "post-title"
  | "post-excerpt"
  | "list-index"
  | "carousel"
  | "overlay";

export function ThemeDesignPane() {
  const { t } = useTranslation();
  const { data: tdPl, isLoading: tdPlLoading } = useThemeDesign();
  const { data: tdEn, isLoading: tdEnLoading } = useThemeDesignEn();
  const { data: langMode } = useThemeDesignLangMode();
  const { data: cd, isLoading: cdLoading } = useCarouselDefaults();
  const { data: overlayData, isLoading: overlayLoading } = usePostLayoutSettings();
  const saveTd = useSaveThemeDesign();
  const saveLangMode = useSaveThemeDesignLangMode();
  const saveCd = useSaveCarouselDefaults();
  const saveOverlay = useSavePostLayoutSettings();

  const mode: "shared" | "split" = langMode?.mode ?? "shared";
  // The language slot we are currently editing. In "shared" mode we always
  // edit the PL slot (which is the effective source of truth for both langs).
  const [editLang, setEditLang] = useState<ThemeDesignLang>("pl");
  const activeLang: ThemeDesignLang = mode === "split" ? editLang : "pl";

  const [draftPl, setDraftPl] = useState<ThemeDesign | null>(null);
  const [draftEn, setDraftEn] = useState<ThemeDesign | null>(null);
  const [cDraft, setCDraft] = useState<CarouselDefaults | null>(null);
  const [overlayDraft, setOverlayDraft] = useState<NonNullable<typeof overlayData> | null>(null);
  const [liveSync, setLiveSync] = useState<boolean>(false);
  const [previewLang, setPreviewLang] = useState<ThemeDesignLang>("pl");
  const [previewMode, setPreviewMode] = useState<"light" | "dark">("light");
  const [activeTab, setActiveTab] = useState<PreviewSection>("block-heading");

  useEffect(() => {
    if (tdPl && !draftPl) setDraftPl(tdPl);
  }, [tdPl, draftPl]);
  useEffect(() => {
    if (tdEn && !draftEn) setDraftEn(tdEn);
  }, [tdEn, draftEn]);
  useEffect(() => {
    if (cd && !cDraft) setCDraft(cd);
  }, [cd, cDraft]);
  useEffect(() => {
    if (overlayData && !overlayDraft) setOverlayDraft(overlayData);
  }, [overlayData, overlayDraft]);

  const draft: ThemeDesign | null = activeLang === "en" ? draftEn : draftPl;
  const setDraft = (next: ThemeDesign) => {
    if (activeLang === "en") setDraftEn(next);
    else setDraftPl(next);
  };

  // Live-mirror the current draft (in the language that will actually render
  // on the public site + CMS canvases) into the react-query cache. This makes
  // Gutenberg/Elementor previews and the whole app reflect the draft instantly.
  const livePreviewDraft = mode === "split" ? draft : draftPl;
  useLiveThemeDesignPreview(livePreviewDraft, liveSync, activeLang);

  // Live-mirror overlay typography draft (post_layout_settings) into the
  // react-query cache so overlay/header size changes reflect immediately in
  // the preview and across the app, without persisting to the DB until the
  // user hits "Zapisz wszystko".
  const qcLive = useQueryClient();
  useEffect(() => {
    if (!overlayDraft) return;
    const key = ["post-layout-settings"] as const;
    const prev = qcLive.getQueryData(key);
    qcLive.setQueryData(key, overlayDraft);
    return () => {
      if (prev) qcLive.setQueryData(key, prev);
      else qcLive.invalidateQueries({ queryKey: key });
    };
  }, [overlayDraft, qcLive]);

  if (
    tdPlLoading ||
    tdEnLoading ||
    cdLoading ||
    overlayLoading ||
    !draft ||
    !cDraft ||
    !draftPl ||
    !overlayDraft
  ) {
    return <p className="text-sm text-muted-foreground">{t("adminThemeDesign.loading")}</p>;
  }

  const set = <K extends keyof ThemeDesign>(k: K, patch: Partial<ThemeDesign[K]>) => {
    setDraft({ ...draft, [k]: { ...draft[k], ...patch } });
  };

  /** Writes a color-typed field to either the light slot (section[field]) or
   *  the dark override (darkOverrides[section][field]) depending on preview mode.
   *  Passing null/"" for dark clears the override so the light value / global
   *  token wins. */
  const setColor = (section: string, field: string, value: string | null) => {
    if (previewMode === "light") {
      setDraft({
        ...draft,
        [section]: {
          ...((draft as Record<string, unknown>)[section] as object),
          [field]: value ?? "",
        },
      } as ThemeDesign);
      return;
    }
    const overrides = { ...(draft.darkOverrides ?? {}) };
    const sec = { ...(overrides[section] ?? {}) };
    if (value == null || value === "") delete sec[field];
    else sec[field] = value;
    if (Object.keys(sec).length === 0) delete overrides[section];
    else overrides[section] = sec;
    setDraft({ ...draft, darkOverrides: overrides });
  };

  const saveAll = () => {
    if (mode === "split") {
      if (draftPl) saveTd.mutate({ next: draftPl, lang: "pl" });
      if (draftEn) saveTd.mutate({ next: draftEn, lang: "en" });
    } else {
      saveTd.mutate({ next: draftPl, lang: "pl" });
    }
    saveCd.mutate(cDraft);
    // Overlay typography: only push the fields that actually changed vs. the
    // server snapshot, so we don't overwrite unrelated columns.
    if (overlayData && overlayDraft) {
      const patch: Record<string, unknown> = {};
      const draftRec = overlayDraft as unknown as Record<string, unknown>;
      const dataRec = overlayData as unknown as Record<string, unknown>;
      for (const key of Object.keys(draftRec)) {
        if (draftRec[key] !== dataRec[key]) {
          patch[key] = draftRec[key];
        }
      }
      if (Object.keys(patch).length > 0) saveOverlay.mutate(patch);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("adminThemeDesign.introPre")}
        <code>--td-*</code>
        {t("adminThemeDesign.introPost")}
      </p>

      <I18nAndLiveToolbar
        mode={mode}
        onModeChange={(m) => saveLangMode.mutate({ mode: m })}
        editLang={editLang}
        onEditLangChange={setEditLang}
        liveSync={liveSync}
        onLiveSyncChange={setLiveSync}
        savingMode={saveLangMode.isPending}
      />

      <LivePostPreview
        draft={draft}
        previewLang={previewLang}
        onLangChange={setPreviewLang}
        previewMode={previewMode}
        onModeChange={setPreviewMode}
        activeTab={activeTab}
      />

      <div className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
        <span className="text-xs text-muted-foreground pl-1">
          {t("adminThemeDesign.editColorsForMode")}
        </span>
        <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
          <button
            type="button"
            onClick={() => setPreviewMode("light")}
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-sm text-xs font-medium transition-colors",
              previewMode === "light"
                ? "bg-brand text-[color:var(--brand-foreground)] shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Sun className="h-3.5 w-3.5" /> Light
          </button>
          <button
            type="button"
            onClick={() => setPreviewMode("dark")}
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-sm text-xs font-medium transition-colors",
              previewMode === "dark"
                ? "bg-brand text-[color:var(--brand-foreground)] shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Moon className="h-3.5 w-3.5" /> Dark
          </button>
        </div>
        <span className="text-[11px] text-muted-foreground ml-auto pr-1">
          {t("adminThemeDesign.emptyInherit")}
        </span>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as PreviewSection)}
        className="space-y-4"
      >
        <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/70 border-b border-border">
          <TabsList className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 h-auto gap-1.5 bg-transparent p-0">
            {[
              { v: "block-heading", label: t("adminThemeDesign.tabs.blockHeading") },
              { v: "thumbnail", label: t("adminThemeDesign.tabs.thumbnail") },
              { v: "read-more", label: t("adminThemeDesign.tabs.readMore") },
              { v: "meta", label: t("adminThemeDesign.tabs.meta") },
              { v: "toolbar", label: t("adminThemeDesign.tabs.toolbar") },
              { v: "mode-switch", label: t("adminThemeDesign.tabs.modeSwitch") },
              { v: "social", label: t("adminThemeDesign.tabs.social") },
              { v: "post-title", label: t("adminThemeDesign.tabs.postTitle") },
              { v: "post-excerpt", label: t("adminThemeDesign.tabs.postExcerpt") },
              { v: "list-index", label: t("adminThemeDesign.tabs.listIndex") },
              { v: "carousel", label: t("adminThemeDesign.tabs.carousel") },
              { v: "overlay", label: t("adminThemeDesign.tabs.overlay") },
            ].map((tab) => (
              <TabsTrigger
                key={tab.v}
                value={tab.v}
                className="w-full h-9 px-3 rounded-none text-xs font-medium bg-muted/40 border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors data-[state=active]:bg-brand data-[state=active]:text-[color:var(--brand-foreground)] data-[state=active]:border-brand data-[state=active]:shadow-sm"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="block-heading" className="mt-0">
          <Section title={t("adminThemeDesign.sections.blockHeading")}>
            <Grid>
              <Field label={t("adminThemeDesign.f.sizePx")}>
                <PxStepper
                  value={draft.blockHeading.fontSize}
                  onChange={(v) => set("blockHeading", { fontSize: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.weight")}>
                <NumStepper
                  value={draft.blockHeading.fontWeight}
                  onChange={(v) => set("blockHeading", { fontWeight: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.color")}>
                <TdColorField
                  section="blockHeading"
                  field="color"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.transform")}>
                <Select
                  value={draft.blockHeading.textTransform}
                  onValueChange={(v) =>
                    set("blockHeading", {
                      textTransform: v as ThemeDesign["blockHeading"]["textTransform"],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("adminThemeDesign.opt.none")}</SelectItem>
                    <SelectItem value="uppercase">{t("adminThemeDesign.opt.upper")}</SelectItem>
                    <SelectItem value="lowercase">{t("adminThemeDesign.opt.lower")}</SelectItem>
                    <SelectItem value="capitalize">
                      {t("adminThemeDesign.opt.titleCase")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("adminThemeDesign.f.letterSpacing")}>
                <PxStepper
                  value={draft.blockHeading.letterSpacing}
                  onChange={(v) => set("blockHeading", { letterSpacing: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.marginBottom")}>
                <PxStepper
                  value={draft.blockHeading.marginBottom}
                  onChange={(v) => set("blockHeading", { marginBottom: v })}
                />
              </Field>
            </Grid>
            <Preview>
              <h3
                className="cms-block-heading"
                style={{
                  fontSize: draft.blockHeading.fontSize,
                  fontWeight: draft.blockHeading.fontWeight,
                  color: draft.blockHeading.color,
                  textTransform: draft.blockHeading.textTransform,
                  letterSpacing: draft.blockHeading.letterSpacing,
                  marginBottom: draft.blockHeading.marginBottom,
                }}
              >
                {t("adminThemeDesign.preview.latestArticles")}
              </h3>
            </Preview>
          </Section>
        </TabsContent>

        <TabsContent value="thumbnail" className="mt-0">
          <Section title={t("adminThemeDesign.sections.thumbnails")}>
            <Grid>
              <Field label={t("adminThemeDesign.f.radius")}>
                <PxStepper
                  value={draft.thumbnail.radius}
                  onChange={(v) => set("thumbnail", { radius: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.aspectRatio")}>
                <Input
                  value={draft.thumbnail.aspectRatio}
                  onChange={(e) => set("thumbnail", { aspectRatio: e.target.value })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.hoverEffect")}>
                <Select
                  value={draft.thumbnail.hoverEffect}
                  onValueChange={(v) =>
                    set("thumbnail", { hoverEffect: v as ThemeDesign["thumbnail"]["hoverEffect"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("adminThemeDesign.opt.none")}</SelectItem>
                    <SelectItem value="zoom">Zoom</SelectItem>
                    <SelectItem value="fade">Fade</SelectItem>
                    <SelectItem value="slide">Slide</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("adminThemeDesign.f.shadow")}>
                <Select
                  value={draft.thumbnail.shadow}
                  onValueChange={(v) =>
                    set("thumbnail", { shadow: v as ThemeDesign["thumbnail"]["shadow"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("adminThemeDesign.opt.none")}</SelectItem>
                    <SelectItem value="sm">{t("adminThemeDesign.opt.shadowSm")}</SelectItem>
                    <SelectItem value="md">{t("adminThemeDesign.opt.shadowMd")}</SelectItem>
                    <SelectItem value="lg">{t("adminThemeDesign.opt.shadowLg")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </Grid>
          </Section>
        </TabsContent>

        <TabsContent value="read-more" className="mt-0">
          <Section title={t("adminThemeDesign.sections.readMore")}>
            <Grid>
              <Field label={t("adminThemeDesign.f.bgColor")}>
                <TdColorField
                  section="readMoreButton"
                  field="bgColor"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.textColor")}>
                <TdColorField
                  section="readMoreButton"
                  field="color"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.borderColor")}>
                <TdColorField
                  section="readMoreButton"
                  field="borderColor"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.radius")}>
                <PxStepper
                  value={draft.readMoreButton.radius}
                  onChange={(v) => set("readMoreButton", { radius: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.paddingX")}>
                <PxStepper
                  value={draft.readMoreButton.paddingX}
                  onChange={(v) => set("readMoreButton", { paddingX: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.paddingY")}>
                <PxStepper
                  value={draft.readMoreButton.paddingY}
                  onChange={(v) => set("readMoreButton", { paddingY: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.weight")}>
                <NumStepper
                  value={draft.readMoreButton.fontWeight}
                  onChange={(v) => set("readMoreButton", { fontWeight: v })}
                />
              </Field>
              <ToggleField
                label={t("adminThemeDesign.toggle.uppercase")}
                checked={draft.readMoreButton.uppercase}
                onChange={(v) => set("readMoreButton", { uppercase: v })}
              />
              <ToggleField
                label={t("adminThemeDesign.toggle.arrow")}
                checked={draft.readMoreButton.arrow}
                onChange={(v) => set("readMoreButton", { arrow: v })}
              />
            </Grid>
            <Preview>
              <button
                type="button"
                className="cms-read-more inline-flex items-center gap-1 border"
                style={{
                  backgroundColor: draft.readMoreButton.bgColor,
                  color: draft.readMoreButton.color,
                  borderColor: draft.readMoreButton.borderColor,
                  borderRadius: draft.readMoreButton.radius,
                  padding: `${draft.readMoreButton.paddingY} ${draft.readMoreButton.paddingX}`,
                  fontWeight: draft.readMoreButton.fontWeight,
                  textTransform: draft.readMoreButton.uppercase ? "uppercase" : "none",
                }}
              >
                {t("adminThemeDesign.preview.readMore")}{" "}
                {draft.readMoreButton.arrow && <span aria-hidden>→</span>}
              </button>
            </Preview>
          </Section>
        </TabsContent>

        <TabsContent value="meta" className="mt-0">
          <Section title={t("adminThemeDesign.sections.meta")}>
            <Grid>
              <Field label={t("adminThemeDesign.f.sizePx")}>
                <PxStepper
                  value={draft.metaInfo.fontSize}
                  onChange={(v) => set("metaInfo", { fontSize: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.color")}>
                <TdColorField
                  section="metaInfo"
                  field="color"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.gapBetween")}>
                <PxStepper
                  value={draft.metaInfo.gap}
                  onChange={(v) => set("metaInfo", { gap: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.separator")}>
                <Select
                  value={draft.metaInfo.separator}
                  onValueChange={(v) =>
                    set("metaInfo", { separator: v as ThemeDesign["metaInfo"]["separator"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dot">•</SelectItem>
                    <SelectItem value="slash">/</SelectItem>
                    <SelectItem value="pipe">|</SelectItem>
                    <SelectItem value="none">{t("adminThemeDesign.opt.none")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <ToggleField
                label={t("adminThemeDesign.toggle.uppercase")}
                checked={draft.metaInfo.uppercase}
                onChange={(v) => set("metaInfo", { uppercase: v })}
              />
            </Grid>
          </Section>
        </TabsContent>

        <TabsContent value="toolbar" className="mt-0">
          <Section title={t("adminThemeDesign.sections.toolbar")}>
            <Grid>
              <Field label={t("adminThemeDesign.f.bg")}>
                <TdColorField
                  section="toolbarButton"
                  field="bgColor"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.iconTextColor")}>
                <TdColorField
                  section="toolbarButton"
                  field="color"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.hoverBg")}>
                <TdColorField
                  section="toolbarButton"
                  field="hoverBgColor"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.hoverColor")}>
                <TdColorField
                  section="toolbarButton"
                  field="hoverColor"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.activeBg")}>
                <TdColorField
                  section="toolbarButton"
                  field="activeBgColor"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.activeColor")}>
                <TdColorField
                  section="toolbarButton"
                  field="activeColor"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.radius")}>
                <PxStepper
                  value={draft.toolbarButton.radius}
                  onChange={(v) => set("toolbarButton", { radius: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.paddingX")}>
                <PxStepper
                  value={draft.toolbarButton.paddingX}
                  onChange={(v) => set("toolbarButton", { paddingX: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.paddingY")}>
                <PxStepper
                  value={draft.toolbarButton.paddingY}
                  onChange={(v) => set("toolbarButton", { paddingY: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.iconSizePx")}>
                <PxStepper
                  value={draft.toolbarButton.size}
                  onChange={(v) => set("toolbarButton", { size: v })}
                />
              </Field>
            </Grid>
            <Preview>
              <div
                style={
                  {
                    ["--td-tb-bg" as string]: draft.toolbarButton.bgColor,
                    ["--td-tb-color" as string]: draft.toolbarButton.color,
                    ["--td-tb-hover-bg" as string]: draft.toolbarButton.hoverBgColor,
                    ["--td-tb-hover-color" as string]: draft.toolbarButton.hoverColor,
                    ["--td-tb-active-bg" as string]: draft.toolbarButton.activeBgColor,
                    ["--td-tb-active-color" as string]: draft.toolbarButton.activeColor,
                    ["--td-tb-radius" as string]: draft.toolbarButton.radius,
                    ["--td-tb-px" as string]: draft.toolbarButton.paddingX,
                    ["--td-tb-py" as string]: draft.toolbarButton.paddingY,
                    ["--td-tb-size" as string]: draft.toolbarButton.size,
                  } as CSSProperties
                }
                className="flex flex-wrap items-center gap-2"
              >
                <button
                  className="cms-tb-btn"
                  data-active="true"
                  title={t("adminThemeDesign.activeTitle")}
                >
                  <Monitor />
                </button>
                <button className="cms-tb-btn">
                  <Tablet />
                </button>
                <button className="cms-tb-btn">
                  <Smartphone />
                </button>
                <button className="cms-tb-btn">
                  <Undo />
                </button>
                <button className="cms-tb-btn">
                  <Redo />
                </button>
                <button className="cms-tb-btn" disabled>
                  <Redo />
                </button>
              </div>
            </Preview>
          </Section>
        </TabsContent>

        <TabsContent value="mode-switch" className="mt-0">
          <Section title={t("adminThemeDesign.sections.modeSwitch")}>
            <Grid>
              <Field label={t("adminThemeDesign.f.trackBg")}>
                <TdColorField
                  section="modeSwitcher"
                  field="trackBg"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.trackBorder")}>
                <TdColorField
                  section="modeSwitcher"
                  field="trackBorder"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.inactiveColor")}>
                <TdColorField
                  section="modeSwitcher"
                  field="inactiveColor"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.activeBg")}>
                <TdColorField
                  section="modeSwitcher"
                  field="activeBg"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.activeColor")}>
                <TdColorField
                  section="modeSwitcher"
                  field="activeColor"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.radius")}>
                <PxStepper
                  value={draft.modeSwitcher.radius}
                  onChange={(v) => set("modeSwitcher", { radius: v })}
                />
              </Field>
              <ToggleField
                label={t("adminThemeDesign.toggle.showLabels")}
                checked={draft.modeSwitcher.showLabel}
                onChange={(v) => set("modeSwitcher", { showLabel: v })}
              />
            </Grid>
            <Preview>
              <div
                style={
                  {
                    ["--td-ms-track-bg" as string]: draft.modeSwitcher.trackBg,
                    ["--td-ms-track-border" as string]: draft.modeSwitcher.trackBorder,
                    ["--td-ms-inactive" as string]: draft.modeSwitcher.inactiveColor,
                    ["--td-ms-active-bg" as string]: draft.modeSwitcher.activeBg,
                    ["--td-ms-active-color" as string]: draft.modeSwitcher.activeColor,
                    ["--td-ms-radius" as string]: draft.modeSwitcher.radius,
                  } as CSSProperties
                }
              >
                <div className="cms-mode-switch">
                  <button className="cms-mode-switch__btn" data-active="true">
                    <Sun className="w-3.5 h-3.5" />{" "}
                    {draft.modeSwitcher.showLabel && t("adminThemeDesign.lightLabel")}
                  </button>
                  <button className="cms-mode-switch__btn">
                    <Moon className="w-3.5 h-3.5" />{" "}
                    {draft.modeSwitcher.showLabel && t("adminThemeDesign.darkLabel")}
                  </button>
                </div>
              </div>
            </Preview>
          </Section>
        </TabsContent>

        <TabsContent value="social" className="mt-0">
          <Section title={t("adminThemeDesign.sections.social")}>
            <Grid>
              <Field label={t("adminThemeDesign.f.iconColor")}>
                <TdColorField
                  section="socialIcons"
                  field="color"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.hoverColor")}>
                <TdColorField
                  section="socialIcons"
                  field="hoverColor"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.bg")}>
                <TdColorField
                  section="socialIcons"
                  field="bgColor"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.hoverBg")}>
                <TdColorField
                  section="socialIcons"
                  field="hoverBgColor"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.sizePx")}>
                <PxStepper
                  value={draft.socialIcons.size}
                  onChange={(v) => set("socialIcons", { size: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.gap")}>
                <PxStepper
                  value={draft.socialIcons.gap}
                  onChange={(v) => set("socialIcons", { gap: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.radius")}>
                <PxStepper
                  value={draft.socialIcons.radius}
                  onChange={(v) => set("socialIcons", { radius: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.paddingX")}>
                <PxStepper
                  value={draft.socialIcons.paddingX}
                  onChange={(v) => set("socialIcons", { paddingX: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.paddingY")}>
                <PxStepper
                  value={draft.socialIcons.paddingY}
                  onChange={(v) => set("socialIcons", { paddingY: v })}
                />
              </Field>
            </Grid>
            <Preview>
              <div
                style={
                  {
                    ["--td-si-color" as string]: draft.socialIcons.color,
                    ["--td-si-hover-color" as string]: draft.socialIcons.hoverColor,
                    ["--td-si-bg" as string]: draft.socialIcons.bgColor,
                    ["--td-si-hover-bg" as string]: draft.socialIcons.hoverBgColor,
                    ["--td-si-size" as string]: draft.socialIcons.size,
                    ["--td-si-gap" as string]: draft.socialIcons.gap,
                    ["--td-si-radius" as string]: draft.socialIcons.radius,
                    ["--td-si-px" as string]: draft.socialIcons.paddingX,
                    ["--td-si-py" as string]: draft.socialIcons.paddingY,
                  } as CSSProperties
                }
              >
                <div className="cms-social">
                  <button className="cms-social__btn" aria-label="Facebook">
                    <Facebook />
                  </button>
                  <button className="cms-social__btn" aria-label="Instagram">
                    <Instagram />
                  </button>
                  <button className="cms-social__btn" aria-label="YouTube">
                    <Youtube />
                  </button>
                  <button className="cms-social__btn" aria-label="LinkedIn">
                    <Linkedin />
                  </button>
                  <button className="cms-social__btn" aria-label="Email">
                    <Mail />
                  </button>
                </div>
              </div>
            </Preview>
          </Section>
        </TabsContent>

        <TabsContent value="post-title" className="mt-0">
          <Section title={t("adminThemeDesign.sections.postTitle")}>
            <p className="text-xs text-muted-foreground -mt-2">
              {t("adminThemeDesign.desc.postTitlePre")}
              <code>.cms-post-title</code>
              {t("adminThemeDesign.desc.postTitlePost")}
            </p>
            <Grid>
              <Field label={t("adminThemeDesign.f.fontFamily")}>
                <Input
                  value={draft.postTitle.fontFamily}
                  onChange={(e) => set("postTitle", { fontFamily: e.target.value })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.sizeDesktop")}>
                <PxStepper
                  value={draft.postTitle.fontSize}
                  onChange={(v) => set("postTitle", { fontSize: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.sizeMobile")}>
                <PxStepper
                  value={draft.postTitle.fontSizeSm}
                  onChange={(v) => set("postTitle", { fontSizeSm: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.weight")}>
                <NumStepper
                  value={draft.postTitle.fontWeight}
                  onChange={(v) => set("postTitle", { fontWeight: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.lineHeightLh")}>
                <Input
                  value={String(draft.postTitle.lineHeight)}
                  onChange={(e) => set("postTitle", { lineHeight: e.target.value })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.color")}>
                <TdColorField
                  section="postTitle"
                  field="color"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.colorHover")}>
                <TdColorField
                  section="postTitle"
                  field="hoverColor"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.transform")}>
                <Select
                  value={draft.postTitle.textTransform}
                  onValueChange={(v) =>
                    set("postTitle", {
                      textTransform: v as ThemeDesign["postTitle"]["textTransform"],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("adminThemeDesign.opt.none")}</SelectItem>
                    <SelectItem value="uppercase">{t("adminThemeDesign.opt.upper")}</SelectItem>
                    <SelectItem value="lowercase">{t("adminThemeDesign.opt.lower")}</SelectItem>
                    <SelectItem value="capitalize">
                      {t("adminThemeDesign.opt.titleCase")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("adminThemeDesign.f.letterSpacing")}>
                <PxStepper
                  value={draft.postTitle.letterSpacing}
                  onChange={(v) => set("postTitle", { letterSpacing: v })}
                />
              </Field>
            </Grid>
            <Preview>
              <div
                style={
                  {
                    ["--td-pt-family" as string]: draft.postTitle.fontFamily,
                    ["--td-pt-size" as string]: draft.postTitle.fontSize,
                    ["--td-pt-size-sm" as string]: draft.postTitle.fontSizeSm,
                    ["--td-pt-weight" as string]: String(draft.postTitle.fontWeight),
                    ["--td-pt-lh" as string]: String(draft.postTitle.lineHeight),
                    ["--td-pt-color" as string]: draft.postTitle.color,
                    ["--td-pt-hover" as string]: draft.postTitle.hoverColor,
                    ["--td-pt-transform" as string]: draft.postTitle.textTransform,
                    ["--td-pt-spacing" as string]: draft.postTitle.letterSpacing,
                  } as CSSProperties
                }
              >
                <h3 className="cms-post-title">{t("adminThemeDesign.preview.sampleTitle")}</h3>
              </div>
            </Preview>
          </Section>
        </TabsContent>

        <TabsContent value="post-excerpt" className="mt-0">
          <Section title={t("adminThemeDesign.sections.postExcerpt")}>
            <Grid>
              <Field label={t("adminThemeDesign.f.fontFamily")}>
                <Input
                  value={draft.postExcerpt.fontFamily}
                  onChange={(e) => set("postExcerpt", { fontFamily: e.target.value })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.sizePx")}>
                <PxStepper
                  value={draft.postExcerpt.fontSize}
                  onChange={(v) => set("postExcerpt", { fontSize: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.weight")}>
                <NumStepper
                  value={draft.postExcerpt.fontWeight}
                  onChange={(v) => set("postExcerpt", { fontWeight: v })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.lineHeight")}>
                <Input
                  value={String(draft.postExcerpt.lineHeight)}
                  onChange={(e) => set("postExcerpt", { lineHeight: e.target.value })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.color")}>
                <TdColorField
                  section="postExcerpt"
                  field="color"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.marginTop")}>
                <PxStepper
                  value={draft.postExcerpt.marginTop}
                  onChange={(v) => set("postExcerpt", { marginTop: v })}
                />
              </Field>
            </Grid>
            <Preview>
              <div
                style={
                  {
                    ["--td-pe-family" as string]: draft.postExcerpt.fontFamily,
                    ["--td-pe-size" as string]: draft.postExcerpt.fontSize,
                    ["--td-pe-weight" as string]: String(draft.postExcerpt.fontWeight),
                    ["--td-pe-lh" as string]: String(draft.postExcerpt.lineHeight),
                    ["--td-pe-color" as string]: draft.postExcerpt.color,
                    ["--td-pe-mt" as string]: draft.postExcerpt.marginTop,
                  } as CSSProperties
                }
              >
                <p className="cms-post-excerpt">{t("adminThemeDesign.preview.sampleExcerpt")}</p>
              </div>
            </Preview>
          </Section>
        </TabsContent>

        <TabsContent value="list-index" className="mt-0">
          <Section title={t("adminThemeDesign.sections.listIndex")}>
            <p className="text-xs text-muted-foreground -mt-2">
              {t("adminThemeDesign.desc.listIndex")}
            </p>
            <Grid>
              <Field label={t("adminThemeDesign.f.colorLight")}>
                <TdColorField
                  section="listIndex"
                  field="colorLight"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.colorDark")}>
                <TdColorField
                  section="listIndex"
                  field="colorDark"
                  mode={previewMode}
                  draft={draft}
                  setColor={setColor}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.opacity")}>
                <NumberInput
                  step={0.01}
                  min={0}
                  max={1}
                  value={draft.listIndex.opacity}
                  onChange={(value) =>
                    set("listIndex", { opacity: Math.max(0, Math.min(1, value ?? 0)) })
                  }
                />
              </Field>
              <Field label={t("adminThemeDesign.f.weight")}>
                <NumberInput
                  value={draft.listIndex.weight}
                  onChange={(value) => set("listIndex", { weight: value ?? 800 })}
                  min={100}
                  max={1000}
                  step={100}
                />
              </Field>
            </Grid>
            <Preview>
              <div className="flex items-center gap-6">
                {[1, 2, 3].map((n) => (
                  <span
                    key={n}
                    className="font-display tabular-nums leading-none"
                    style={{
                      fontSize: "72px",
                      fontWeight: draft.listIndex.weight,
                      color: draft.listIndex.colorLight,
                      opacity: draft.listIndex.opacity,
                    }}
                  >
                    {String(n).padStart(2, "0")}
                  </span>
                ))}
              </div>
            </Preview>
          </Section>
        </TabsContent>

        <TabsContent value="carousel" className="mt-0">
          <Section title={t("adminThemeDesign.sections.carousel")}>
            <p className="text-xs text-muted-foreground -mt-2">
              {t("adminThemeDesign.desc.carousel")}
            </p>
            <Grid>
              <ToggleField
                label={t("adminThemeDesign.toggle.autoplay")}
                checked={cDraft.autoplay}
                onChange={(v) => setCDraft({ ...cDraft, autoplay: v })}
              />
              <ToggleField
                label={t("adminThemeDesign.toggle.loop")}
                checked={cDraft.loop}
                onChange={(v) => setCDraft({ ...cDraft, loop: v })}
              />
              <ToggleField
                label={t("adminThemeDesign.toggle.pauseHover")}
                checked={cDraft.pauseOnHover}
                onChange={(v) => setCDraft({ ...cDraft, pauseOnHover: v })}
              />
              <Field label={t("adminThemeDesign.f.slideTime")}>
                <NumberInput
                  min={1000}
                  max={30000}
                  step={500}
                  value={cDraft.intervalMs}
                  onChange={(value) => setCDraft({ ...cDraft, intervalMs: value ?? 1000 })}
                />
              </Field>
              <Field label={t("adminThemeDesign.f.transitionTime")}>
                <NumberInput
                  min={100}
                  max={3000}
                  step={50}
                  value={cDraft.speedMs}
                  onChange={(value) => setCDraft({ ...cDraft, speedMs: value ?? 100 })}
                />
              </Field>
            </Grid>
          </Section>
        </TabsContent>

        <TabsContent value="overlay" className="mt-0">
          <OverlayTypographyTab draft={overlayDraft} onChange={setOverlayDraft} />
        </TabsContent>
      </Tabs>

      <div className="flex gap-2 pt-2">
        <Button
          onClick={saveAll}
          disabled={saveTd.isPending || saveCd.isPending || saveOverlay.isPending}
        >
          <Save className="w-4 h-4 mr-1.5" /> {t("adminThemeDesign.saveAll")}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setDraft(THEME_DESIGN_DEFAULTS);
            setCDraft(CAROUSEL_DEFAULTS);
          }}
        >
          {t("adminThemeDesign.restoreDefaults")}
        </Button>
      </div>
    </div>
  );
}

// ---------- i18n + live-sync toolbar ----------

function I18nAndLiveToolbar({
  mode,
  onModeChange,
  editLang,
  onEditLangChange,
  liveSync,
  onLiveSyncChange,
  savingMode,
}: {
  mode: "shared" | "split";
  onModeChange: (m: "shared" | "split") => void;
  editLang: ThemeDesignLang;
  onEditLangChange: (l: ThemeDesignLang) => void;
  liveSync: boolean;
  onLiveSyncChange: (v: boolean) => void;
  savingMode: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-border bg-card p-3 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Languages className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium">{t("adminThemeDesign.langBar.stylePerLang")}</span>
        </div>
        <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => onModeChange("shared")}
            disabled={savingMode}
            className={cn(
              "px-3 py-1.5 transition-colors",
              mode === "shared"
                ? "bg-brand text-[color:var(--brand-foreground)] font-semibold"
                : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            {t("adminThemeDesign.langBar.sharedPlEn")}
          </button>
          <button
            type="button"
            onClick={() => onModeChange("split")}
            disabled={savingMode}
            className={cn(
              "px-3 py-1.5 transition-colors border-l border-border",
              mode === "split"
                ? "bg-brand text-[color:var(--brand-foreground)] font-semibold"
                : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            {t("adminThemeDesign.langBar.splitPerLang")}
          </button>
        </div>
      </div>

      {mode === "split" && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("adminThemeDesign.langBar.editing")}
          </span>
          <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
            {(["pl", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onEditLangChange(l)}
                className={cn(
                  "px-3 py-1.5 uppercase tracking-wide transition-colors",
                  l !== "pl" && "border-l border-border",
                  editLang === l
                    ? "bg-foreground text-background font-semibold"
                    : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                {l === "pl" ? "🇵🇱 PL" : "🇬🇧 EN"}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="ml-auto flex items-center gap-2 cursor-pointer select-none">
        {liveSync ? (
          <Eye className="w-4 h-4 text-brand" />
        ) : (
          <EyeOff className="w-4 h-4 text-muted-foreground" />
        )}
        <div className="flex flex-col leading-tight">
          <span className="text-xs font-medium">
            {t("adminThemeDesign.langBar.livePreviewCms")}{" "}
            {liveSync
              ? t("adminThemeDesign.langBar.active")
              : t("adminThemeDesign.langBar.disabled")}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {t("adminThemeDesign.langBar.livePreviewDesc")}
          </span>
        </div>
        <Switch checked={liveSync} onCheckedChange={onLiveSyncChange} className="ml-1" />
      </label>
    </div>
  );
}

// ---------- Live post preview ----------

function LivePostPreview({
  draft,
  previewLang,
  onLangChange,
  previewMode,
  onModeChange,
  activeTab,
}: {
  draft: ThemeDesign;
  previewLang: ThemeDesignLang;
  onLangChange: (l: ThemeDesignLang) => void;
  previewMode: "light" | "dark";
  onModeChange: (m: "light" | "dark") => void;
  activeTab: PreviewSection;
}) {
  const { t } = useTranslation();
  // Scope the generated tokens to the preview root so unsaved values do not
  // leak into the rest of the admin chrome. `themeDesignToCss` emits `:root{}`
  // and `.dark{}`; we rescope both to the preview root and its .dark child.
  const scopedCss = useMemo(() => {
    const base = themeDesignToCss(draft);
    return base
      .replace(":root,.light{", ".theme-design-live-preview,.theme-design-live-preview.light{")
      .replace(":root{", ".theme-design-live-preview{")
      .replace(".dark{", ".theme-design-live-preview.dark{");
  }, [draft]);

  // Parallel path: apply the same tokens as React inline style variables on
  // the preview root. React diffs and writes each variable directly on the
  // element on every draft change, which is bulletproof reactive even when
  // the `<style>` innerHTML update path gets throttled or stale.
  const inlineVars = useMemo(
    () => themeDesignToStyleVars(draft, previewMode),
    [draft, previewMode],
  );

  const copy =
    previewLang === "en"
      ? {
          eyebrow: "Latest analyses",
          category: "Diplomacy",
          title: "How trade routes reshape modern statecraft",
          excerpt:
            "A concise take on how logistics corridors are redefining sovereignty, alliances and long-range planning.",
          author: "Anna Kowalska",
          published: "09/07/2026",
          read: "6 min read",
          readMore: "Read more",
          listHeader: "Ranked stories",
          toolbar: "Toolbar",
          modeSwitcher: "Reader mode",
          modeItems: ["Light", "Sepia", "Dark"] as const,
          social: "Follow us",
          overlayCategory: "Analysis",
          items: [
            "Container flows above 2019 peak",
            "New arctic corridor opens",
            "AI in customs risk scoring",
          ],
        }
      : {
          eyebrow: "Najnowsze analizy",
          category: "Dyplomacja",
          title: "Jak szlaki handlowe redefiniują nowoczesną politykę państw",
          excerpt:
            "Zwięzła analiza tego, jak korytarze logistyczne zmieniają suwerenność, sojusze i planowanie długoterminowe.",
          author: "Anna Kowalska",
          published: "09/07/2026",
          read: "6 min czytania",
          readMore: "Czytaj więcej",
          listHeader: "Ranking artykułów",
          toolbar: "Pasek narzędzi",
          modeSwitcher: "Tryb czytnika",
          modeItems: ["Jasny", "Sepia", "Ciemny"] as const,
          social: "Obserwuj",
          overlayCategory: "Analiza",
          items: [
            "Przepływy kontenerowe powyżej szczytu 2019",
            "Nowy korytarz arktyczny",
            "AI w scoringu ryzyka celnego",
          ],
        };

  const isDark = previewMode === "dark";
  const rootStyle: CSSProperties = {
    ...(inlineVars as CSSProperties),
    background: "var(--gc-body-bg, var(--background))",
    color: "var(--gc-body-text, var(--foreground))",
  };

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
            {t("adminThemeDesign.live.title")}
          </span>
          <span className="text-[11px] text-muted-foreground truncate">
            {t("adminThemeDesign.live.subtitle")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Light/Dark preview toggle */}
          <div className="inline-flex rounded-md border border-border overflow-hidden text-[11px]">
            {(["light", "dark"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange(m)}
                className={cn(
                  "inline-flex items-center gap-1 px-2.5 py-1 transition-colors",
                  m === "dark" && "border-l border-border",
                  previewMode === m
                    ? "bg-foreground text-background font-semibold"
                    : "bg-transparent text-muted-foreground hover:text-foreground",
                )}
                aria-pressed={previewMode === m}
              >
                {m === "light" ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
                {m === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
          {/* Language toggle */}
          <div className="inline-flex rounded-md border border-border overflow-hidden text-[11px]">
            {(["pl", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onLangChange(l)}
                className={cn(
                  "px-2.5 py-1 uppercase tracking-wide transition-colors",
                  l !== "pl" && "border-l border-border",
                  previewLang === l
                    ? "bg-foreground text-background font-semibold"
                    : "bg-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {l === "pl" ? "🇵🇱 PL" : "🇬🇧 EN"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: hardenStyleCss(scopedCss) }} />

      <div
        data-builder-renderer="theme-design-preview"
        data-device="desktop"
        className={cn(
          "theme-design-live-preview cms-widget p-6 transition-colors",
          isDark ? "dark" : "light",
        )}
        style={rootStyle}
      >
        <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-widest opacity-60 font-semibold">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
          <span>
            {t("adminThemeDesign.live.tabPrefix")} {tabTitle(activeTab, previewLang)}
          </span>
        </div>

        {activeTab === "block-heading" && (
          <div className="space-y-3">
            <h2 className="cms-block-heading">{copy.eyebrow}</h2>
            <h2 className="cms-block-heading">{copy.listHeader}</h2>
          </div>
        )}

        {activeTab === "thumbnail" && (
          <div className="grid sm:grid-cols-2 gap-6 max-w-xl">
            <div
              className="cms-thumb relative overflow-hidden"
              style={{
                aspectRatio: draft.thumbnail.aspectRatio,
                background: "linear-gradient(135deg, #fa9346 0%, #b0552a 100%)",
              }}
            >
              <span
                className="absolute left-3 top-3 rounded-sm px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                style={{ background: "rgba(0,0,0,.65)", color: "#fff" }}
              >
                {copy.category}
              </span>
            </div>
            <div
              className="cms-thumb relative overflow-hidden"
              style={{
                aspectRatio: draft.thumbnail.aspectRatio,
                background: "linear-gradient(135deg, #2b3550 0%, #0f172a 100%)",
              }}
            />
          </div>
        )}

        {activeTab === "read-more" && (
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" className="cms-read-more inline-flex items-center gap-1 border">
              {copy.readMore}
              {draft.readMoreButton.arrow && <span aria-hidden>→</span>}
            </button>
            <button
              type="button"
              className="cms-read-more inline-flex items-center gap-1 border opacity-70"
            >
              {copy.readMore}
            </button>
          </div>
        )}

        {activeTab === "meta" && (
          <div
            className="cms-meta-info inline-flex flex-wrap items-center"
            style={{
              gap: draft.metaInfo.gap,
              fontSize: draft.metaInfo.fontSize,
              textTransform: draft.metaInfo.uppercase ? "uppercase" : "none",
            }}
          >
            <span>{copy.author}</span>
            <SepPreview kind={draft.metaInfo.separator} />
            <span>{copy.published}</span>
            <SepPreview kind={draft.metaInfo.separator} />
            <span>{copy.read}</span>
          </div>
        )}

        {activeTab === "toolbar" && (
          <div className="space-y-2">
            <div
              className="inline-flex items-center gap-1 rounded-md p-1"
              style={{ background: "color-mix(in oklab, currentColor 6%, transparent)" }}
            >
              <ToolbarBtnPreview t={draft} icon="B" />
              <ToolbarBtnPreview t={draft} icon="I" />
              <ToolbarBtnPreview t={draft} icon="U" active />
              <ToolbarBtnPreview t={draft} icon="•" />
              <ToolbarBtnPreview t={draft} icon="⧉" />
            </div>
            <p className="text-[10px] opacity-60">{t("adminThemeDesign.live.activeStateNote")}</p>
          </div>
        )}

        {activeTab === "mode-switch" && (
          <div
            className="inline-flex p-0.5 border"
            style={{
              background: "var(--td-ms-track-bg, transparent)",
              borderColor: "var(--td-ms-track-border, currentColor)",
              borderRadius: draft.modeSwitcher.radius,
            }}
          >
            {copy.modeItems.map((m, i) => {
              const active = i === (isDark ? 2 : 0);
              return (
                <span
                  key={m}
                  className="px-3 py-1.5 text-[12px] font-medium transition-colors"
                  style={{
                    background: active ? "var(--td-ms-active-bg, transparent)" : "transparent",
                    color: active
                      ? "var(--td-ms-active-color, currentColor)"
                      : "var(--td-ms-inactive, currentColor)",
                    borderRadius: `calc(${draft.modeSwitcher.radius} - 2px)`,
                  }}
                >
                  {m}
                </span>
              );
            })}
          </div>
        )}

        {activeTab === "social" && (
          <div className="inline-flex items-center" style={{ gap: draft.socialIcons.gap }}>
            {[Facebook, Instagram, Youtube, Linkedin, Mail].map((Ico, i) => (
              <span
                key={i}
                className="inline-flex items-center justify-center"
                style={{
                  background: "var(--td-si-bg, transparent)",
                  color: "var(--td-si-color, currentColor)",
                  padding: `${draft.socialIcons.paddingY} ${draft.socialIcons.paddingX}`,
                  borderRadius: draft.socialIcons.radius,
                }}
              >
                <Ico
                  style={{
                    width: draft.socialIcons.size,
                    height: draft.socialIcons.size,
                  }}
                />
              </span>
            ))}
          </div>
        )}

        {activeTab === "post-title" && (
          <div className="space-y-3 max-w-2xl">
            <h3 className="cms-post-title">
              <a href="#" onClick={(e) => e.preventDefault()}>
                {copy.title}
              </a>
            </h3>
            <h3 className="cms-post-title" style={{ fontSize: "15px" }}>
              {copy.items[0]}
            </h3>
          </div>
        )}

        {activeTab === "post-excerpt" && (
          <p className="cms-post-excerpt max-w-2xl">{copy.excerpt}</p>
        )}

        {activeTab === "list-index" && (
          <ol className="grid sm:grid-cols-3 gap-4 max-w-3xl">
            {copy.items.map((item, i) => (
              <li
                key={item}
                className="flex items-start gap-3 pb-3 border-b"
                style={{ borderColor: "color-mix(in oklab, currentColor 12%, transparent)" }}
              >
                <span
                  className="font-display tabular-nums leading-none shrink-0"
                  style={{
                    fontSize: "44px",
                    fontWeight: draft.listIndex.weight,
                    color: isDark ? draft.listIndex.colorDark : draft.listIndex.colorLight,
                    opacity: draft.listIndex.opacity,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <a
                  href="#"
                  onClick={(e) => e.preventDefault()}
                  className="cms-post-title"
                  style={{ fontSize: "15px" }}
                >
                  {item}
                </a>
              </li>
            ))}
          </ol>
        )}

        {activeTab === "carousel" && (
          <div className="space-y-3">
            <div className="flex gap-4 overflow-hidden">
              {[0, 1, 2].map((i) => (
                <article key={i} className="w-56 shrink-0 space-y-2">
                  <div
                    className="cms-thumb relative overflow-hidden"
                    style={{
                      aspectRatio: draft.thumbnail.aspectRatio,
                      background:
                        i % 2
                          ? "linear-gradient(135deg, #2b3550 0%, #0f172a 100%)"
                          : "linear-gradient(135deg, #fa9346 0%, #b0552a 100%)",
                    }}
                  />
                  <h3 className="cms-post-title" style={{ fontSize: "14px" }}>
                    {copy.items[i] ?? copy.title}
                  </h3>
                </article>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 rounded-full"
                  style={{
                    width: i === 0 ? 20 : 8,
                    background:
                      i === 0
                        ? "var(--brand, currentColor)"
                        : "color-mix(in oklab, currentColor 25%, transparent)",
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {activeTab === "overlay" && (
          <article className="max-w-2xl">
            <div
              className="cms-thumb relative overflow-hidden"
              style={{
                aspectRatio: draft.thumbnail.aspectRatio,
                background: "linear-gradient(135deg, #fa9346 0%, #b0552a 55%, #3a1e10 100%)",
              }}
            >
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background: "linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,.72) 100%)",
                }}
              />
              <span
                className="absolute left-4 top-4 rounded-sm px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
                style={{ background: "rgba(0,0,0,.65)", color: "#fff" }}
              >
                {copy.overlayCategory}
              </span>
              <div className="absolute inset-x-0 bottom-0 p-4 md:p-5 space-y-2 text-white">
                <h3
                  className="cms-post-title"
                  style={{ color: "#fff", textShadow: "0 2px 12px rgba(0,0,0,.35)" }}
                >
                  {copy.title}
                </h3>
                <p
                  className="cms-post-excerpt"
                  style={{ color: "rgba(255,255,255,.85)", marginTop: 0 }}
                >
                  {copy.excerpt}
                </p>
                <div
                  className="cms-meta-info inline-flex flex-wrap items-center"
                  style={{
                    gap: draft.metaInfo.gap,
                    fontSize: draft.metaInfo.fontSize,
                    textTransform: draft.metaInfo.uppercase ? "uppercase" : "none",
                    color: "rgba(255,255,255,.85)",
                  }}
                >
                  <span>{copy.author}</span>
                  <SepPreview kind={draft.metaInfo.separator} />
                  <span>{copy.published}</span>
                </div>
              </div>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}

function ToolbarBtnPreview({
  t,
  icon,
  active = false,
}: {
  t: ThemeDesign;
  icon: string;
  active?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center justify-center font-semibold transition-colors"
      style={{
        background: active
          ? "var(--td-tb-active-bg, currentColor)"
          : "var(--td-tb-bg, transparent)",
        color: active ? "var(--td-tb-active-color, #fff)" : "var(--td-tb-color, currentColor)",
        borderRadius: t.toolbarButton.radius,
        padding: `${t.toolbarButton.paddingY} ${t.toolbarButton.paddingX}`,
        fontSize: t.toolbarButton.size,
        lineHeight: 1,
        minWidth: `calc(${t.toolbarButton.size} + ${t.toolbarButton.paddingX} * 2)`,
      }}
    >
      {icon}
    </span>
  );
}

function tabTitle(t: PreviewSection, lang: ThemeDesignLang): string {
  const map: Record<PreviewSection, [string, string]> = {
    "block-heading": ["Nagłówki bloków", "Block headings"],
    thumbnail: ["Miniatury", "Thumbnails"],
    "read-more": ["Czytaj więcej", "Read more"],
    meta: ["Meta wpisu", "Post meta"],
    toolbar: ["Toolbar", "Toolbar"],
    "mode-switch": ["Tryb jasny/ciemny", "Light/Dark mode"],
    social: ["Social", "Social"],
    "post-title": ["Tytuły wpisów", "Post titles"],
    "post-excerpt": ["Excerpt", "Excerpt"],
    "list-index": ["Numeracja list", "List index"],
    carousel: ["Karuzela", "Carousel"],
    overlay: ["Overlay wpisu", "Post overlay"],
  };
  return map[t][lang === "en" ? 1 : 0];
}

function SepPreview({ kind }: { kind: ThemeDesign["metaInfo"]["separator"] }) {
  if (kind === "none") return null;
  const ch = kind === "dot" ? "•" : kind === "slash" ? "/" : "|";
  return (
    <span aria-hidden className="cms-meta-sep opacity-60">
      {ch}
    </span>
  );
}

/** Default inheritance token per (section, field). When the user clicks
 *  "Dziedzicz" we reset the value to this token (light mode) or clear the
 *  dark override (dark mode). These tokens already flip automatically with
 *  the site's global light/dark scheme, so inheritance from
 *  Kolory linków / Kolory ikon / Pola tekstowe / Kolory pól tekstowych is
 *  effectively free. */
const INHERIT_DEFAULTS: Record<
  string,
  Record<string, { token: string; hint: string }>
> = THEME_DESIGN_COLOR_INHERITANCE;

function TdColorField({
  section,
  field,
  mode,
  draft,
  setColor,
}: {
  section: string;
  field: string;
  mode: "light" | "dark";
  draft: ThemeDesign;
  setColor: (section: string, field: string, value: string | null) => void;
}) {
  const { t } = useTranslation();
  const lightVal =
    ((draft as unknown as Record<string, Record<string, unknown>>)[section]?.[field] as
      | string
      | undefined) ?? "";
  const darkVal = (draft.darkOverrides?.[section]?.[field] as string | undefined) ?? "";
  const value = mode === "light" ? lightVal : darkVal;
  const inherit = INHERIT_DEFAULTS[section]?.[field];
  const inheritedValue = mode === "dark" ? lightVal || inherit?.token : inherit?.token;
  const placeholder =
    mode === "dark" ? lightVal || inherit?.token || "auto" : inherit?.token || "auto";

  const reset = () => {
    if (mode === "dark") setColor(section, field, null);
    else setColor(section, field, inherit?.token ?? "");
  };

  return (
    <div className="space-y-1">
      <AdminColorPicker
        value={value}
        onChange={(v) =>
          setColor(section, field, v ?? (mode === "light" ? (inherit?.token ?? null) : null))
        }
        allowTransparent
        inheritedValue={inheritedValue}
        placeholder={placeholder}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground truncate">
          {mode === "dark" && !darkVal
            ? t("adminThemeDesign.inherit.fromLight", {
                val: lightVal || inherit?.hint || "auto",
              })
            : inherit
              ? t("adminThemeDesign.inherit.defaultHint", { hint: inherit.hint })
              : ""}
        </span>
        {(mode === "light" ? !!lightVal && lightVal !== inherit?.token : !!darkVal) && (
          <button
            type="button"
            onClick={reset}
            className="text-[10px] text-muted-foreground hover:text-foreground underline decoration-dotted underline-offset-2"
          >
            {t("adminThemeDesign.inherit.button")}
          </button>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-2 rounded-md border border-border">
      <Label className="text-xs">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Preview({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 p-4 rounded-md border border-dashed border-border bg-muted/30">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
        {t("adminThemeDesign.previewLabel")}
      </div>
      {children}
    </div>
  );
}

function PxStepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 999,
}: {
  value: string;
  onChange: (v: string) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <StepperInput
      value={value}
      onChange={(next) => onChange(next ?? `${min}px`)}
      step={step}
      min={min}
      max={max}
    />
  );
}

function NumStepper({
  value,
  onChange,
  step = 100,
  min = 0,
  max = 9999,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <NumberInput
      value={value}
      onChange={(next) => onChange(next ?? min)}
      step={step}
      min={min}
      max={max}
    />
  );
}

function OverlayTypographyTab({
  draft,
  onChange,
}: {
  draft: NonNullable<ReturnType<typeof usePostLayoutSettings>["data"]>;
  onChange: (next: NonNullable<ReturnType<typeof usePostLayoutSettings>["data"]>) => void;
}) {
  const { t } = useTranslation();
  const patch = (p: Partial<typeof draft>) => {
    onChange({ ...draft, ...p });
  };
  const Row = ({
    label,
    field,
  }: {
    label: string;
    field:
      | "overlay_title_size"
      | "overlay_excerpt_size"
      | "header_title_size"
      | "header_excerpt_size";
  }) => (
    <div className="space-y-2">
      <Label className="text-xs font-semibold">{label}</Label>
      <div className="grid grid-cols-3 gap-3">
        {(["base", "md", "lg"] as const).map((bp) => {
          const key = `${field}_${bp}` as const;
          const bpLabel =
            bp === "base"
              ? t("adminThemeDesign.overlay.bpMobile")
              : bp === "md"
                ? t("adminThemeDesign.overlay.bpTablet")
                : t("adminThemeDesign.overlay.bpDesktop");
          return (
            <div key={bp} className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {bpLabel}
              </Label>
              <NumStepper
                value={draft[key] as number}
                onChange={(v) => patch({ [key]: v } as Partial<typeof draft>)}
                step={1}
                min={8}
                max={200}
              />
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <section className="space-y-5 rounded-lg border border-border bg-card p-5">
      <div>
        <h2 className="text-base font-semibold">{t("adminThemeDesign.overlay.title")}</h2>
        <p className="text-xs text-muted-foreground mt-1">
          {t("adminThemeDesign.overlay.descPre")}
          <code className="mx-1">/admin/post-layouts</code>
          {t("adminThemeDesign.overlay.descPost")}
        </p>
      </div>
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {t("adminThemeDesign.overlay.onCover")}
        </h3>
        <Row label={t("adminThemeDesign.overlay.rowTitle")} field="overlay_title_size" />
        <Row label={t("adminThemeDesign.overlay.rowSubtitle")} field="overlay_excerpt_size" />
      </div>
      <div className="space-y-4 pt-3 border-t border-border">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {t("adminThemeDesign.overlay.classicHeader")}
        </h3>
        <Row label={t("adminThemeDesign.overlay.rowTitle")} field="header_title_size" />
        <Row label={t("adminThemeDesign.overlay.rowSubtitle")} field="header_excerpt_size" />
      </div>
      <p className="text-[11px] text-muted-foreground">{t("adminThemeDesign.overlay.metaNote")}</p>
    </section>
  );
}

function px(val: string): string {
  return val.replace(/px$/, "");
}
