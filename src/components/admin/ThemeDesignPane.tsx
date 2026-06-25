// Pane with global "Theme Design" styles - block headings, thumbnails,
// "Read more" buttons, meta info, toolbar buttons, mode switcher, social icons
// + global slider/carousel defaults.
// Embedded as a section inside ThemeOptionsPane (under "Style treści").
import { useEffect, useState } from "react";
import { Save, Sun, Moon, Undo, Redo, Monitor, Tablet, Smartphone, Facebook, Instagram, Youtube, Linkedin, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  useEffect(() => { if (td && !draft) setDraft(td); }, [td, draft]);
  useEffect(() => { if (cd && !cDraft) setCDraft(cd); }, [cd, cDraft]);

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
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Globalne style dla nagłówków bloków, miniatur, przycisku „Czytaj więcej” oraz informacji
        meta. Wartości są aplikowane jako zmienne CSS (<code>--td-*</code>) i nadpisują domyślny
        wygląd kart i widgetów.
      </p>

      <Section title="Nagłówki bloków">
        <Grid>
          <Field label="Rozmiar (px)">
            <Input value={px(draft.blockHeading.fontSize)} onChange={(e) => set("blockHeading", { fontSize: `${e.target.value}px` })} />
          </Field>
          <Field label="Grubość">
            <Input type="number" value={draft.blockHeading.fontWeight} onChange={(e) => set("blockHeading", { fontWeight: Number(e.target.value) })} />
          </Field>
          <Field label="Kolor">
            <Input value={draft.blockHeading.color} onChange={(e) => set("blockHeading", { color: e.target.value })} />
          </Field>
          <Field label="Transformacja">
            <Select value={draft.blockHeading.textTransform} onValueChange={(v) => set("blockHeading", { textTransform: v as ThemeDesign["blockHeading"]["textTransform"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Brak</SelectItem>
                <SelectItem value="uppercase">WIELKIE</SelectItem>
                <SelectItem value="lowercase">małe</SelectItem>
                <SelectItem value="capitalize">Tytuł</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Odstęp liter (px)">
            <Input value={px(draft.blockHeading.letterSpacing)} onChange={(e) => set("blockHeading", { letterSpacing: `${e.target.value}px` })} />
          </Field>
          <Field label="Margines dolny (px)">
            <Input value={px(draft.blockHeading.marginBottom)} onChange={(e) => set("blockHeading", { marginBottom: `${e.target.value}px` })} />
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

      <Section title="Miniatury wpisów">
        <Grid>
          <Field label="Zaokrąglenie (px)">
            <Input value={px(draft.thumbnail.radius)} onChange={(e) => set("thumbnail", { radius: `${e.target.value}px` })} />
          </Field>
          <Field label="Proporcje (np. 16/9)">
            <Input value={draft.thumbnail.aspectRatio} onChange={(e) => set("thumbnail", { aspectRatio: e.target.value })} />
          </Field>
          <Field label="Efekt hover">
            <Select value={draft.thumbnail.hoverEffect} onValueChange={(v) => set("thumbnail", { hoverEffect: v as ThemeDesign["thumbnail"]["hoverEffect"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Brak</SelectItem>
                <SelectItem value="zoom">Zoom</SelectItem>
                <SelectItem value="fade">Fade</SelectItem>
                <SelectItem value="slide">Slide</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Cień">
            <Select value={draft.thumbnail.shadow} onValueChange={(v) => set("thumbnail", { shadow: v as ThemeDesign["thumbnail"]["shadow"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
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

      <Section title={"Przycisk „Czytaj więcej”"}>
        <Grid>
          <Field label="Kolor tła"><Input value={draft.readMoreButton.bgColor} onChange={(e) => set("readMoreButton", { bgColor: e.target.value })} /></Field>
          <Field label="Kolor tekstu"><Input value={draft.readMoreButton.color} onChange={(e) => set("readMoreButton", { color: e.target.value })} /></Field>
          <Field label="Kolor obramowania"><Input value={draft.readMoreButton.borderColor} onChange={(e) => set("readMoreButton", { borderColor: e.target.value })} /></Field>
          <Field label="Zaokrąglenie (px)"><Input value={px(draft.readMoreButton.radius)} onChange={(e) => set("readMoreButton", { radius: `${e.target.value}px` })} /></Field>
          <Field label="Padding X (px)"><Input value={px(draft.readMoreButton.paddingX)} onChange={(e) => set("readMoreButton", { paddingX: `${e.target.value}px` })} /></Field>
          <Field label="Padding Y (px)"><Input value={px(draft.readMoreButton.paddingY)} onChange={(e) => set("readMoreButton", { paddingY: `${e.target.value}px` })} /></Field>
          <Field label="Grubość">
            <Input type="number" value={draft.readMoreButton.fontWeight} onChange={(e) => set("readMoreButton", { fontWeight: Number(e.target.value) })} />
          </Field>
          <ToggleField label="WIELKIE LITERY" checked={draft.readMoreButton.uppercase} onChange={(v) => set("readMoreButton", { uppercase: v })} />
          <ToggleField label="Strzałka →" checked={draft.readMoreButton.arrow} onChange={(v) => set("readMoreButton", { arrow: v })} />
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

      <Section title="Informacje meta (autor, data, kategoria)">
        <Grid>
          <Field label="Rozmiar (px)"><Input value={px(draft.metaInfo.fontSize)} onChange={(e) => set("metaInfo", { fontSize: `${e.target.value}px` })} /></Field>
          <Field label="Kolor"><Input value={draft.metaInfo.color} onChange={(e) => set("metaInfo", { color: e.target.value })} /></Field>
          <Field label="Odstęp między (px)"><Input value={px(draft.metaInfo.gap)} onChange={(e) => set("metaInfo", { gap: `${e.target.value}px` })} /></Field>
          <Field label="Separator">
            <Select value={draft.metaInfo.separator} onValueChange={(v) => set("metaInfo", { separator: v as ThemeDesign["metaInfo"]["separator"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="dot">•</SelectItem>
                <SelectItem value="slash">/</SelectItem>
                <SelectItem value="pipe">|</SelectItem>
                <SelectItem value="none">Brak</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <ToggleField label="WIELKIE LITERY" checked={draft.metaInfo.uppercase} onChange={(v) => set("metaInfo", { uppercase: v })} />
        </Grid>
      </Section>

      <Section title="Przyciski toolbara (undo, redo, język, urządzenie)">
        <Grid>
          <Field label="Tło"><Input value={draft.toolbarButton.bgColor} onChange={(e) => set("toolbarButton", { bgColor: e.target.value })} /></Field>
          <Field label="Kolor ikony/tekstu"><Input value={draft.toolbarButton.color} onChange={(e) => set("toolbarButton", { color: e.target.value })} /></Field>
          <Field label="Hover - tło"><Input value={draft.toolbarButton.hoverBgColor} onChange={(e) => set("toolbarButton", { hoverBgColor: e.target.value })} /></Field>
          <Field label="Hover - kolor"><Input value={draft.toolbarButton.hoverColor} onChange={(e) => set("toolbarButton", { hoverColor: e.target.value })} /></Field>
          <Field label="Aktywny - tło"><Input value={draft.toolbarButton.activeBgColor} onChange={(e) => set("toolbarButton", { activeBgColor: e.target.value })} /></Field>
          <Field label="Aktywny - kolor"><Input value={draft.toolbarButton.activeColor} onChange={(e) => set("toolbarButton", { activeColor: e.target.value })} /></Field>
          <Field label="Zaokrąglenie (px)"><Input value={px(draft.toolbarButton.radius)} onChange={(e) => set("toolbarButton", { radius: `${e.target.value}px` })} /></Field>
          <Field label="Padding X (px)"><Input value={px(draft.toolbarButton.paddingX)} onChange={(e) => set("toolbarButton", { paddingX: `${e.target.value}px` })} /></Field>
          <Field label="Padding Y (px)"><Input value={px(draft.toolbarButton.paddingY)} onChange={(e) => set("toolbarButton", { paddingY: `${e.target.value}px` })} /></Field>
          <Field label="Rozmiar ikony (px)"><Input value={px(draft.toolbarButton.size)} onChange={(e) => set("toolbarButton", { size: `${e.target.value}px` })} /></Field>
        </Grid>
        <Preview>
          <div
            style={{
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
            } as React.CSSProperties}
            className="flex flex-wrap items-center gap-2"
          >
            <button className="cms-tb-btn" data-active="true" title="Aktywny"><Monitor /></button>
            <button className="cms-tb-btn"><Tablet /></button>
            <button className="cms-tb-btn"><Smartphone /></button>
            <button className="cms-tb-btn"><Undo /></button>
            <button className="cms-tb-btn"><Redo /></button>
            <button className="cms-tb-btn" disabled><Redo /></button>
          </div>
        </Preview>
      </Section>

      <Section title="Przełącznik trybu jasny/ciemny">
        <Grid>
          <Field label="Tło toru"><Input value={draft.modeSwitcher.trackBg} onChange={(e) => set("modeSwitcher", { trackBg: e.target.value })} /></Field>
          <Field label="Obramowanie toru"><Input value={draft.modeSwitcher.trackBorder} onChange={(e) => set("modeSwitcher", { trackBorder: e.target.value })} /></Field>
          <Field label="Kolor nieaktywny"><Input value={draft.modeSwitcher.inactiveColor} onChange={(e) => set("modeSwitcher", { inactiveColor: e.target.value })} /></Field>
          <Field label="Aktywny - tło"><Input value={draft.modeSwitcher.activeBg} onChange={(e) => set("modeSwitcher", { activeBg: e.target.value })} /></Field>
          <Field label="Aktywny - kolor"><Input value={draft.modeSwitcher.activeColor} onChange={(e) => set("modeSwitcher", { activeColor: e.target.value })} /></Field>
          <Field label="Zaokrąglenie (px)"><Input value={px(draft.modeSwitcher.radius)} onChange={(e) => set("modeSwitcher", { radius: `${e.target.value}px` })} /></Field>
          <ToggleField label="Pokaż etykiety (Jasny/Ciemny)" checked={draft.modeSwitcher.showLabel} onChange={(v) => set("modeSwitcher", { showLabel: v })} />
        </Grid>
        <Preview>
          <div
            style={{
              ["--td-ms-track-bg" as string]: draft.modeSwitcher.trackBg,
              ["--td-ms-track-border" as string]: draft.modeSwitcher.trackBorder,
              ["--td-ms-inactive" as string]: draft.modeSwitcher.inactiveColor,
              ["--td-ms-active-bg" as string]: draft.modeSwitcher.activeBg,
              ["--td-ms-active-color" as string]: draft.modeSwitcher.activeColor,
              ["--td-ms-radius" as string]: draft.modeSwitcher.radius,
            } as React.CSSProperties}
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

      <Section title="Ikony social media">
        <Grid>
          <Field label="Kolor ikony"><Input value={draft.socialIcons.color} onChange={(e) => set("socialIcons", { color: e.target.value })} /></Field>
          <Field label="Hover - kolor"><Input value={draft.socialIcons.hoverColor} onChange={(e) => set("socialIcons", { hoverColor: e.target.value })} /></Field>
          <Field label="Tło"><Input value={draft.socialIcons.bgColor} onChange={(e) => set("socialIcons", { bgColor: e.target.value })} /></Field>
          <Field label="Hover - tło"><Input value={draft.socialIcons.hoverBgColor} onChange={(e) => set("socialIcons", { hoverBgColor: e.target.value })} /></Field>
          <Field label="Rozmiar (px)"><Input value={px(draft.socialIcons.size)} onChange={(e) => set("socialIcons", { size: `${e.target.value}px` })} /></Field>
          <Field label="Odstęp (px)"><Input value={px(draft.socialIcons.gap)} onChange={(e) => set("socialIcons", { gap: `${e.target.value}px` })} /></Field>
          <Field label="Zaokrąglenie (px)"><Input value={px(draft.socialIcons.radius)} onChange={(e) => set("socialIcons", { radius: `${e.target.value}px` })} /></Field>
          <Field label="Padding X (px)"><Input value={px(draft.socialIcons.paddingX)} onChange={(e) => set("socialIcons", { paddingX: `${e.target.value}px` })} /></Field>
          <Field label="Padding Y (px)"><Input value={px(draft.socialIcons.paddingY)} onChange={(e) => set("socialIcons", { paddingY: `${e.target.value}px` })} /></Field>
        </Grid>
        <Preview>
          <div
            style={{
              ["--td-si-color" as string]: draft.socialIcons.color,
              ["--td-si-hover-color" as string]: draft.socialIcons.hoverColor,
              ["--td-si-bg" as string]: draft.socialIcons.bgColor,
              ["--td-si-hover-bg" as string]: draft.socialIcons.hoverBgColor,
              ["--td-si-size" as string]: draft.socialIcons.size,
              ["--td-si-gap" as string]: draft.socialIcons.gap,
              ["--td-si-radius" as string]: draft.socialIcons.radius,
              ["--td-si-px" as string]: draft.socialIcons.paddingX,
              ["--td-si-py" as string]: draft.socialIcons.paddingY,
            } as React.CSSProperties}
          >
            <div className="cms-social">
              <button className="cms-social__btn" aria-label="Facebook"><Facebook /></button>
              <button className="cms-social__btn" aria-label="Instagram"><Instagram /></button>
              <button className="cms-social__btn" aria-label="YouTube"><Youtube /></button>
              <button className="cms-social__btn" aria-label="LinkedIn"><Linkedin /></button>
              <button className="cms-social__btn" aria-label="Email"><Mail /></button>
            </div>
          </div>
        </Preview>
      </Section>



      <Section title="Slider / karuzela - ustawienia globalne">
        <p className="text-xs text-muted-foreground -mt-2">
          Wartości używane domyślnie przez każdy widget slidera/karuzeli. Można je nadpisać w
          ustawieniach pojedynczego widgetu.
        </p>
        <Grid>
          <ToggleField label="Autoodtwarzanie" checked={cDraft.autoplay} onChange={(v) => setCDraft({ ...cDraft, autoplay: v })} />
          <ToggleField label="Pętla" checked={cDraft.loop} onChange={(v) => setCDraft({ ...cDraft, loop: v })} />
          <ToggleField label="Pauza na hover" checked={cDraft.pauseOnHover} onChange={(v) => setCDraft({ ...cDraft, pauseOnHover: v })} />
          <Field label="Czas slajdu (ms)">
            <Input type="number" min={1000} max={30000} step={500} value={cDraft.intervalMs}
              onChange={(e) => setCDraft({ ...cDraft, intervalMs: Number(e.target.value) })} />
          </Field>
          <Field label="Czas przejścia (ms)">
            <Input type="number" min={100} max={3000} step={50} value={cDraft.speedMs}
              onChange={(e) => setCDraft({ ...cDraft, speedMs: Number(e.target.value) })} />
          </Field>
          <Field label="Typ przejścia">
            <Select value={cDraft.transition} onValueChange={(v) => setCDraft({ ...cDraft, transition: v as CarouselDefaults["transition"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="slide">Slide</SelectItem>
                <SelectItem value="fade">Fade</SelectItem>
                <SelectItem value="zoom">Zoom</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </Grid>
      </Section>

      <div className="flex gap-2 pt-2">
        <Button onClick={saveAll} disabled={saveTd.isPending || saveCd.isPending}>
          <Save className="w-4 h-4 mr-1.5" /> Zapisz wszystko
        </Button>
        <Button
          variant="outline"
          onClick={() => { setDraft(THEME_DESIGN_DEFAULTS); setCDraft(CAROUSEL_DEFAULTS); }}
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

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
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

function px(val: string): string {
  return val.replace(/px$/, "");
}
