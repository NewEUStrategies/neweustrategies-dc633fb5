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
