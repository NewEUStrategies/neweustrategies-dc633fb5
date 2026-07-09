// Pane with global "Theme Design" styles - block headings, thumbnails,
// "Read more" buttons, meta info, toolbar buttons, mode switcher, social icons
// + global slider/carousel defaults.
// Embedded as a section inside ThemeOptionsPane (under "Style treści").
import { useEffect, useState, type CSSProperties } from "react";
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
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";

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
  useSaveThemeDesign,
  THEME_DESIGN_DEFAULTS,
  type ThemeDesign,
} from "@/lib/theme/themeDesign";
import {
  useCarouselDefaults,
  useSaveCarouselDefaults,
  CAROUSEL_DEFAULTS,
  type CarouselDefaults,
} from "@/lib/theme/carouselDefaults";

export function ThemeDesignPane() {
  const { data: td, isLoading: tdLoading } = useThemeDesign();
  const { data: cd, isLoading: cdLoading } = useCarouselDefaults();
  const saveTd = useSaveThemeDesign();
  const saveCd = useSaveCarouselDefaults();

  const [draft, setDraft] = useState<ThemeDesign | null>(null);
  const [cDraft, setCDraft] = useState<CarouselDefaults | null>(null);
  useEffect(() => {
    if (td && !draft) setDraft(td);
  }, [td, draft]);
  useEffect(() => {
    if (cd && !cDraft) setCDraft(cd);
  }, [cd, cDraft]);

  if (tdLoading || cdLoading || !draft || !cDraft) {
    return <p className="text-sm text-muted-foreground">Ładowanie...</p>;
  }

  const set = <K extends keyof ThemeDesign>(k: K, patch: Partial<ThemeDesign[K]>) =>
    setDraft({ ...draft, [k]: { ...draft[k], ...patch } });

  const saveAll = () => {
    saveTd.mutate(draft);
    saveCd.mutate(cDraft);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Globalne style dla nagłówków bloków, miniatur, przycisku „Czytaj więcej” oraz informacji
        meta. Wartości są aplikowane jako zmienne CSS (<code>--td-*</code>) i nadpisują domyślny
        wygląd kart i widgetów.
      </p>

      <Tabs defaultValue="block-heading" className="space-y-4">
        <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/70 border-b border-border">
          <TabsList className="flex flex-wrap h-auto gap-1.5 justify-start bg-transparent p-0">
            {[
              { v: "block-heading",  label: "Nagłówki bloków" },
              { v: "thumbnail",      label: "Miniatury" },
              { v: "read-more",      label: "Czytaj więcej" },
              { v: "meta",           label: "Meta wpisu" },
              { v: "toolbar",        label: "Toolbar" },
              { v: "mode-switch",    label: "Tryb jasny/ciemny" },
              { v: "social",         label: "Social" },
              { v: "post-title",     label: "Tytuły wpisów" },
              { v: "post-excerpt",   label: "Excerpt" },
              { v: "list-index",     label: "Numeracja list" },
              { v: "carousel",       label: "Karuzela" },
              { v: "overlay",        label: "Overlay wpisu" },
            ].map((t) => (
              <TabsTrigger
                key={t.v}
                value={t.v}
                className="h-8 px-3 rounded-md text-xs font-medium bg-muted/40 border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted transition-colors data-[state=active]:bg-brand data-[state=active]:text-[color:var(--brand-foreground)] data-[state=active]:border-brand data-[state=active]:shadow-sm"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="block-heading" className="mt-0">
<Section title="Nagłówki bloków">
        <Grid>
          <Field label="Rozmiar (px)">
            <PxStepper value={draft.blockHeading.fontSize} onChange={(v) => set("blockHeading", { fontSize: v })} />
          </Field>
          <Field label="Grubość">
            <NumStepper value={draft.blockHeading.fontWeight} onChange={(v) => set("blockHeading", { fontWeight: v })} />
          </Field>
          <Field label="Kolor">
            <AdminColorPicker value={draft.blockHeading.color} onChange={(v) => set("blockHeading", { color: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Transformacja">
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
                <SelectItem value="none">Brak</SelectItem>
                <SelectItem value="uppercase">WIELKIE</SelectItem>
                <SelectItem value="lowercase">małe</SelectItem>
                <SelectItem value="capitalize">Tytuł</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Odstęp liter (px)">
            <PxStepper value={draft.blockHeading.letterSpacing} onChange={(v) => set("blockHeading", { letterSpacing: v })} />
          </Field>
          <Field label="Margines dolny (px)">
            <PxStepper value={draft.blockHeading.marginBottom} onChange={(v) => set("blockHeading", { marginBottom: v })} />
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
            Najnowsze artykuły
          </h3>
        </Preview>
      </Section>
</TabsContent>

      <TabsContent value="thumbnail" className="mt-0">
<Section title="Miniatury wpisów">
        <Grid>
          <Field label="Zaokrąglenie (px)">
            <PxStepper value={draft.thumbnail.radius} onChange={(v) => set("thumbnail", { radius: v })} />
          </Field>
          <Field label="Proporcje (np. 16/9)">
            <Input
              value={draft.thumbnail.aspectRatio}
              onChange={(e) => set("thumbnail", { aspectRatio: e.target.value })}
            />
          </Field>
          <Field label="Efekt hover">
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
                <SelectItem value="none">Brak</SelectItem>
                <SelectItem value="zoom">Zoom</SelectItem>
                <SelectItem value="fade">Fade</SelectItem>
                <SelectItem value="slide">Slide</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Cień">
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
                <SelectItem value="none">Brak</SelectItem>
                <SelectItem value="sm">Mały</SelectItem>
                <SelectItem value="md">Średni</SelectItem>
                <SelectItem value="lg">Duży</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </Grid>
      </Section>
</TabsContent>

      <TabsContent value="read-more" className="mt-0">
<Section title={"Przycisk „Czytaj więcej”"}>
        <Grid>
          <Field label="Kolor tła">
            <AdminColorPicker value={draft.readMoreButton.bgColor} onChange={(v) => set("readMoreButton", { bgColor: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Kolor tekstu">
            <AdminColorPicker value={draft.readMoreButton.color} onChange={(v) => set("readMoreButton", { color: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Kolor obramowania">
            <AdminColorPicker value={draft.readMoreButton.borderColor} onChange={(v) => set("readMoreButton", { borderColor: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Zaokrąglenie (px)">
            <PxStepper value={draft.readMoreButton.radius} onChange={(v) => set("readMoreButton", { radius: v })} />
          </Field>
          <Field label="Padding X (px)">
            <PxStepper value={draft.readMoreButton.paddingX} onChange={(v) => set("readMoreButton", { paddingX: v })} />
          </Field>
          <Field label="Padding Y (px)">
            <PxStepper value={draft.readMoreButton.paddingY} onChange={(v) => set("readMoreButton", { paddingY: v })} />
          </Field>
          <Field label="Grubość">
            <NumStepper value={draft.readMoreButton.fontWeight} onChange={(v) => set("readMoreButton", { fontWeight: v })} />
          </Field>
          <ToggleField
            label="WIELKIE LITERY"
            checked={draft.readMoreButton.uppercase}
            onChange={(v) => set("readMoreButton", { uppercase: v })}
          />
          <ToggleField
            label="Strzałka →"
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
            Czytaj więcej {draft.readMoreButton.arrow && <span aria-hidden>→</span>}
          </button>
        </Preview>
      </Section>
</TabsContent>

      <TabsContent value="meta" className="mt-0">
<Section title="Informacje meta (autor, data, kategoria)">
        <Grid>
          <Field label="Rozmiar (px)">
            <PxStepper value={draft.metaInfo.fontSize} onChange={(v) => set("metaInfo", { fontSize: v })} />
          </Field>
          <Field label="Kolor">
            <AdminColorPicker value={draft.metaInfo.color} onChange={(v) => set("metaInfo", { color: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Odstęp między (px)">
            <PxStepper value={draft.metaInfo.gap} onChange={(v) => set("metaInfo", { gap: v })} />
          </Field>
          <Field label="Separator">
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
                <SelectItem value="none">Brak</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <ToggleField
            label="WIELKIE LITERY"
            checked={draft.metaInfo.uppercase}
            onChange={(v) => set("metaInfo", { uppercase: v })}
          />
        </Grid>
      </Section>
</TabsContent>

      <TabsContent value="toolbar" className="mt-0">
<Section title="Przyciski toolbara (undo, redo, język, urządzenie)">
        <Grid>
          <Field label="Tło">
            <AdminColorPicker value={draft.toolbarButton.bgColor} onChange={(v) => set("toolbarButton", { bgColor: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Kolor ikony/tekstu">
            <AdminColorPicker value={draft.toolbarButton.color} onChange={(v) => set("toolbarButton", { color: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Hover - tło">
            <AdminColorPicker value={draft.toolbarButton.hoverBgColor} onChange={(v) => set("toolbarButton", { hoverBgColor: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Hover - kolor">
            <AdminColorPicker value={draft.toolbarButton.hoverColor} onChange={(v) => set("toolbarButton", { hoverColor: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Aktywny - tło">
            <AdminColorPicker value={draft.toolbarButton.activeBgColor} onChange={(v) => set("toolbarButton", { activeBgColor: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Aktywny - kolor">
            <AdminColorPicker value={draft.toolbarButton.activeColor} onChange={(v) => set("toolbarButton", { activeColor: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Zaokrąglenie (px)">
            <PxStepper value={draft.toolbarButton.radius} onChange={(v) => set("toolbarButton", { radius: v })} />
          </Field>
          <Field label="Padding X (px)">
            <PxStepper value={draft.toolbarButton.paddingX} onChange={(v) => set("toolbarButton", { paddingX: v })} />
          </Field>
          <Field label="Padding Y (px)">
            <PxStepper value={draft.toolbarButton.paddingY} onChange={(v) => set("toolbarButton", { paddingY: v })} />
          </Field>
          <Field label="Rozmiar ikony (px)">
            <PxStepper value={draft.toolbarButton.size} onChange={(v) => set("toolbarButton", { size: v })} />
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
            <button className="cms-tb-btn" data-active="true" title="Aktywny">
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
<Section title="Przełącznik trybu jasny/ciemny">
        <Grid>
          <Field label="Tło toru">
            <AdminColorPicker value={draft.modeSwitcher.trackBg} onChange={(v) => set("modeSwitcher", { trackBg: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Obramowanie toru">
            <AdminColorPicker value={draft.modeSwitcher.trackBorder} onChange={(v) => set("modeSwitcher", { trackBorder: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Kolor nieaktywny">
            <AdminColorPicker value={draft.modeSwitcher.inactiveColor} onChange={(v) => set("modeSwitcher", { inactiveColor: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Aktywny - tło">
            <AdminColorPicker value={draft.modeSwitcher.activeBg} onChange={(v) => set("modeSwitcher", { activeBg: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Aktywny - kolor">
            <AdminColorPicker value={draft.modeSwitcher.activeColor} onChange={(v) => set("modeSwitcher", { activeColor: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Zaokrąglenie (px)">
            <PxStepper value={draft.modeSwitcher.radius} onChange={(v) => set("modeSwitcher", { radius: v })} />
          </Field>
          <ToggleField
            label="Pokaż etykiety (Jasny/Ciemny)"
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
                <Sun className="w-3.5 h-3.5" /> {draft.modeSwitcher.showLabel && "Jasny"}
              </button>
              <button className="cms-mode-switch__btn">
                <Moon className="w-3.5 h-3.5" /> {draft.modeSwitcher.showLabel && "Ciemny"}
              </button>
            </div>
          </div>
        </Preview>
      </Section>
</TabsContent>

      <TabsContent value="social" className="mt-0">
<Section title="Ikony social media">
        <Grid>
          <Field label="Kolor ikony">
            <AdminColorPicker value={draft.socialIcons.color} onChange={(v) => set("socialIcons", { color: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Hover - kolor">
            <AdminColorPicker value={draft.socialIcons.hoverColor} onChange={(v) => set("socialIcons", { hoverColor: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Tło">
            <AdminColorPicker value={draft.socialIcons.bgColor} onChange={(v) => set("socialIcons", { bgColor: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Hover - tło">
            <AdminColorPicker value={draft.socialIcons.hoverBgColor} onChange={(v) => set("socialIcons", { hoverBgColor: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Rozmiar (px)">
            <PxStepper value={draft.socialIcons.size} onChange={(v) => set("socialIcons", { size: v })} />
          </Field>
          <Field label="Odstęp (px)">
            <PxStepper value={draft.socialIcons.gap} onChange={(v) => set("socialIcons", { gap: v })} />
          </Field>
          <Field label="Zaokrąglenie (px)">
            <PxStepper value={draft.socialIcons.radius} onChange={(v) => set("socialIcons", { radius: v })} />
          </Field>
          <Field label="Padding X (px)">
            <PxStepper value={draft.socialIcons.paddingX} onChange={(v) => set("socialIcons", { paddingX: v })} />
          </Field>
          <Field label="Padding Y (px)">
            <PxStepper value={draft.socialIcons.paddingY} onChange={(v) => set("socialIcons", { paddingY: v })} />
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
<Section title="Tytuły wpisów (wszystkie widgety)">
        <p className="text-xs text-muted-foreground -mt-2">
          Ujednolicony styl tytułów we wszystkich widgetach (lista, slider, grid, galeria, ranking,
          ticker, podcast). Aplikowane przez klasę <code>.cms-post-title</code>.
        </p>
        <Grid>
          <Field label="Krój pisma (CSS font-family)">
            <Input
              value={draft.postTitle.fontFamily}
              onChange={(e) => set("postTitle", { fontFamily: e.target.value })}
            />
          </Field>
          <Field label="Rozmiar desktop (px)">
            <PxStepper value={draft.postTitle.fontSize} onChange={(v) => set("postTitle", { fontSize: v })} />
          </Field>
          <Field label="Rozmiar mobile (px)">
            <PxStepper value={draft.postTitle.fontSizeSm} onChange={(v) => set("postTitle", { fontSizeSm: v })} />
          </Field>
          <Field label="Grubość">
            <NumStepper value={draft.postTitle.fontWeight} onChange={(v) => set("postTitle", { fontWeight: v })} />
          </Field>
          <Field label="Interlinia (line-height)">
            <Input
              value={String(draft.postTitle.lineHeight)}
              onChange={(e) => set("postTitle", { lineHeight: e.target.value })}
            />
          </Field>
          <Field label="Kolor">
            <AdminColorPicker value={draft.postTitle.color} onChange={(v) => set("postTitle", { color: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Kolor hover">
            <AdminColorPicker value={draft.postTitle.hoverColor} onChange={(v) => set("postTitle", { hoverColor: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Transformacja">
            <Select
              value={draft.postTitle.textTransform}
              onValueChange={(v) =>
                set("postTitle", { textTransform: v as ThemeDesign["postTitle"]["textTransform"] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Brak</SelectItem>
                <SelectItem value="uppercase">WIELKIE</SelectItem>
                <SelectItem value="lowercase">małe</SelectItem>
                <SelectItem value="capitalize">Tytuł</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Odstęp liter (px)">
            <PxStepper value={draft.postTitle.letterSpacing} onChange={(v) => set("postTitle", { letterSpacing: v })} />
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
            <h3 className="cms-post-title">
              Przykładowy tytuł artykułu - jak będzie wyglądać w widgetach
            </h3>
          </div>
        </Preview>
      </Section>
</TabsContent>

      <TabsContent value="post-excerpt" className="mt-0">
<Section title="Excerpt / lead wpisów">
        <Grid>
          <Field label="Krój pisma (CSS font-family)">
            <Input
              value={draft.postExcerpt.fontFamily}
              onChange={(e) => set("postExcerpt", { fontFamily: e.target.value })}
            />
          </Field>
          <Field label="Rozmiar (px)">
            <PxStepper value={draft.postExcerpt.fontSize} onChange={(v) => set("postExcerpt", { fontSize: v })} />
          </Field>
          <Field label="Grubość">
            <NumStepper value={draft.postExcerpt.fontWeight} onChange={(v) => set("postExcerpt", { fontWeight: v })} />
          </Field>
          <Field label="Interlinia">
            <Input
              value={String(draft.postExcerpt.lineHeight)}
              onChange={(e) => set("postExcerpt", { lineHeight: e.target.value })}
            />
          </Field>
          <Field label="Kolor">
            <AdminColorPicker value={draft.postExcerpt.color} onChange={(v) => set("postExcerpt", { color: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Margines górny (px)">
            <PxStepper value={draft.postExcerpt.marginTop} onChange={(v) => set("postExcerpt", { marginTop: v })} />
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
            <p className="cms-post-excerpt">
              Krótki opis artykułu pojawiający się pod tytułem w kartach widgetów. Zachowuje
              spójność na całej platformie.
            </p>
          </div>
        </Preview>
      </Section>
</TabsContent>

      <TabsContent value="list-index" className="mt-0">
<Section title="Numeracja list (warianty „Numbered” / „Ranking”)">
        <p className="text-xs text-muted-foreground -mt-2">
          Globalne kolory dużych translucentnych cyfr (01, 02, 03...) za tytułami w listach
          rankingowych. Każdy widget może je nadpisać swoim własnym kolorem.
        </p>
        <Grid>
          <Field label="Kolor (light mode)">
            <AdminColorPicker value={draft.listIndex.colorLight} onChange={(v) => set("listIndex", { colorLight: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Kolor (dark mode)">
            <AdminColorPicker value={draft.listIndex.colorDark} onChange={(v) => set("listIndex", { colorDark: v ?? "" })} allowTransparent />
          </Field>
          <Field label="Przezroczystość (0 - 1)">
            <Input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={draft.listIndex.opacity}
              onChange={(e) =>
                set("listIndex", { opacity: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })
              }
            />
          </Field>
          <Field label="Grubość">
            <Input
              type="number"
              value={draft.listIndex.weight}
              onChange={(e) => set("listIndex", { weight: Number(e.target.value) || 800 })}
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
<Section title="Slider / karuzela - ustawienia globalne">
        <p className="text-xs text-muted-foreground -mt-2">
          Wartości używane domyślnie przez każdy widget slidera/karuzeli. Można je nadpisać w
          ustawieniach pojedynczego widgetu.
        </p>
        <Grid>
          <ToggleField
            label="Autoodtwarzanie"
            checked={cDraft.autoplay}
            onChange={(v) => setCDraft({ ...cDraft, autoplay: v })}
          />
          <ToggleField
            label="Pętla"
            checked={cDraft.loop}
            onChange={(v) => setCDraft({ ...cDraft, loop: v })}
          />
          <ToggleField
            label="Pauza na hover"
            checked={cDraft.pauseOnHover}
            onChange={(v) => setCDraft({ ...cDraft, pauseOnHover: v })}
          />
          <Field label="Czas slajdu (ms)">
            <Input
              type="number"
              min={1000}
              max={30000}
              step={500}
              value={cDraft.intervalMs}
              onChange={(e) => setCDraft({ ...cDraft, intervalMs: Number(e.target.value) })}
            />
          </Field>
          <Field label="Czas przejścia (ms)">
            <Input
              type="number"
              min={100}
              max={3000}
              step={50}
              value={cDraft.speedMs}
              onChange={(e) => setCDraft({ ...cDraft, speedMs: Number(e.target.value) })}
            />
          </Field>
          <Field label="Typ przejścia">
            <Select
              value={cDraft.transition}
              onValueChange={(v) =>
                setCDraft({ ...cDraft, transition: v as CarouselDefaults["transition"] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="slide">Slide</SelectItem>
                <SelectItem value="fade">Fade</SelectItem>
                <SelectItem value="zoom">Zoom</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </Grid>
      </Section>
</TabsContent>

        <TabsContent value="overlay" className="mt-0">
          <OverlayTypographyTab />
        </TabsContent>
      </Tabs>

      <div className="flex gap-2 pt-2">
        <Button onClick={saveAll} disabled={saveTd.isPending || saveCd.isPending}>
          <Save className="w-4 h-4 mr-1.5" /> Zapisz wszystko
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setDraft(THEME_DESIGN_DEFAULTS);
            setCDraft(CAROUSEL_DEFAULTS);
          }}
        >
          Przywróć domyślne
        </Button>
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
  return (
    <div className="mt-2 p-4 rounded-md border border-dashed border-border bg-muted/30">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Podgląd</div>
      {children}
    </div>
  );
}


function PxStepper({ value, onChange, step = 1, min = 0, max = 999 }: { value: string; onChange: (v: string) => void; step?: number; min?: number; max?: number }) {
  const n = Number(String(value).replace(/px$/, "")) || 0;
  const clamp = (x: number) => Math.max(min, Math.min(max, x));
  const commit = (x: number) => onChange(`${clamp(x)}px`);
  return (
    <div className="relative">
      <Input
        type="number"
        value={n}
        min={min}
        max={max}
        step={step}
        onChange={(e) => commit(Number(e.target.value) || 0)}
        className="pr-7"
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col">
        <button type="button" aria-label="Zwiększ" className="h-3.5 w-5 flex items-center justify-center hover:bg-muted rounded-sm" onClick={() => commit(n + step)}>
          <ChevronUp className="w-3 h-3" />
        </button>
        <button type="button" aria-label="Zmniejsz" className="h-3.5 w-5 flex items-center justify-center hover:bg-muted rounded-sm" onClick={() => commit(n - step)}>
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function NumStepper({ value, onChange, step = 100, min = 0, max = 9999 }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  const clamp = (x: number) => Math.max(min, Math.min(max, x));
  return (
    <div className="relative">
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
        className="pr-7"
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col">
        <button type="button" aria-label="Zwiększ" className="h-3.5 w-5 flex items-center justify-center hover:bg-muted rounded-sm" onClick={() => onChange(clamp(value + step))}>
          <ChevronUp className="w-3 h-3" />
        </button>
        <button type="button" aria-label="Zmniejsz" className="h-3.5 w-5 flex items-center justify-center hover:bg-muted rounded-sm" onClick={() => onChange(clamp(value - step))}>
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}


function OverlayTypographyTab() {
  const { data, isLoading } = usePostLayoutSettings();
  const save = useSavePostLayoutSettings();
  if (isLoading || !data) {
    return <p className="text-sm text-muted-foreground">Ładowanie...</p>;
  }
  const patch = (p: Partial<typeof data>) => {
    save.mutate(p, {
      onSuccess: () => toast.success("Zapisano rozmiary overlay"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Błąd zapisu"),
    });
  };
  const Row = ({
    label,
    field,
  }: {
    label: string;
    field: "overlay_title_size" | "overlay_excerpt_size" | "header_title_size" | "header_excerpt_size";
  }) => (
    <div className="space-y-2">
      <Label className="text-xs font-semibold">{label}</Label>
      <div className="grid grid-cols-3 gap-3">
        {(["base", "md", "lg"] as const).map((bp) => {
          const key = `${field}_${bp}` as const;
          const bpLabel = bp === "base" ? "Mobile (base)" : bp === "md" ? "Tablet (md ≥768)" : "Desktop (lg ≥1024)";
          return (
            <div key={bp} className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">{bpLabel}</Label>
              <NumStepper
                value={data[key] as number}
                onChange={(v) => patch({ [key]: v } as Partial<typeof data>)}
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
        <h2 className="text-base font-semibold">Typografia overlay wpisu (cover photo)</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Rozmiary czcionek (px) dla tytułu, podtytułu i meta (autor / data / czas czytania) renderowanych na cover photo
          oraz w klasycznym nagłówku wpisu. Wartości są responsywne per breakpoint i synchronizowane z ustawieniami w
          <code className="mx-1">/admin/post-layouts</code>. Zmiana zapisuje się natychmiast.
        </p>
      </div>
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Overlay (na cover photo)</h3>
        <Row label="Tytuł" field="overlay_title_size" />
        <Row label="Podtytuł / excerpt" field="overlay_excerpt_size" />
      </div>
      <div className="space-y-4 pt-3 border-t border-border">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Nagłówek klasyczny (bez cover)</h3>
        <Row label="Tytuł" field="header_title_size" />
        <Row label="Podtytuł / excerpt" field="header_excerpt_size" />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Rozmiar meta bara (autor · data · czas czytania) jest sterowany w zakładce „Meta wpisu" (globalny --td-meta-size).
      </p>
    </section>
  );
}

function px(val: string): string {
  return val.replace(/px$/, "");
}
