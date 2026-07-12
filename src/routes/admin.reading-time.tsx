// Panel czasu czytania (/admin/reading-time).
//
// Steruje WSZYSTKIMI parametrami algorytmu z lib/readingTime.ts poprzez
// site_settings["reading_time"]: strona publiczna, JSON-LD, blok reading-time
// i podgląd w edytorze liczą tym samym rdzeniem, więc zapis tutaj natychmiast
// rzutuje na wpisy (inwalidujemy zbiorczy cache site_settings).
//
// Podział uprawnień:
//   - admin: włącznik, wpm PL/EN, minimum, zaokrąglanie,
//   - super admin: dodatkowo parametry zaawansowane (krzywa obrazów, mnożnik
//     kodu) - sekcja ukryta dla zwykłego admina.
// Podgląd na żywo liczy PL i EN SYMULTANICZNIE na bieżących (niezapisanych)
// wartościach, żeby było widać skutek zmiany zanim trafi do czytelników.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSiteSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import {
  computeBilingualReadingStats,
  DEFAULT_READING_TIME_SETTINGS,
  READING_TIME_SETTINGS_KEY,
  readingTimeSettingsSchema,
  type ReadingTimeSettings,
} from "@/lib/readingTime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Clock, RotateCcw, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/admin/reading-time")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Czas czytania - admin" }],
  }),
  component: ReadingTimeAdmin,
});

const SAMPLE_PL =
  "Wklej tu fragment artykułu, aby zobaczyć wyliczenie. Ten przykładowy akapit " +
  "pokazuje, jak zmiana prędkości czytania lub zaokrąglania wpływa na wynik dla " +
  "polskiej wersji tekstu.";
const SAMPLE_EN =
  "Paste an article fragment here to preview the calculation. This sample " +
  "paragraph shows how changing the reading speed or rounding affects the " +
  "result for the English version.";

function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  hint?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ReadingTimeAdmin() {
  const { t } = useTranslation();
  const { isSuperAdmin } = useAuth();
  const qc = useQueryClient();

  const saved = useSiteSetting(
    READING_TIME_SETTINGS_KEY,
    DEFAULT_READING_TIME_SETTINGS,
    readingTimeSettingsSchema,
  );
  const [draft, setDraft] = useState<ReadingTimeSettings>(saved);
  const [busy, setBusy] = useState(false);
  const [samplePl, setSamplePl] = useState(SAMPLE_PL);
  const [sampleEn, setSampleEn] = useState(SAMPLE_EN);
  const [sampleImages, setSampleImages] = useState(0);

  const set = <K extends keyof ReadingTimeSettings>(k: K, v: ReadingTimeSettings[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  // Walidacja draftu na żywo - zapisujemy tylko wartości przechodzące schemat.
  const parsed = readingTimeSettingsSchema.safeParse(draft);

  // Symultaniczny podgląd PL/EN na BIEŻĄCYCH wartościach draftu.
  const preview = useMemo(() => {
    const settings = parsed.success ? parsed.data : DEFAULT_READING_TIME_SETTINGS;
    return computeBilingualReadingStats(
      {
        pl: { extraText: samplePl, images: sampleImages },
        en: { extraText: sampleEn, images: sampleImages },
      },
      settings,
    );
  }, [parsed, samplePl, sampleEn, sampleImages]);

  const save = async () => {
    if (!parsed.success) {
      toast.error(
        t("admin.readingTime.invalid", {
          defaultValue: "Popraw wartości poza zakresem przed zapisem.",
        }),
      );
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("site_settings")
      .upsert(
        { key: READING_TIME_SETTINGS_KEY, value: parsed.data as never },
        { onConflict: "key" },
      );
    setBusy(false);
    if (error) {
      toast.error(t("admin.saveError", { defaultValue: "Nie udało się zapisać." }));
      return;
    }
    // Publiczny widok czyta ten sam zbiorczy cache - inwalidacja sprawia, że
    // zmiana rzutuje na wpisy bez przeładowania.
    await qc.invalidateQueries({ queryKey: siteSettingsQueryOptions.queryKey });
    toast.success(t("admin.saved", { defaultValue: "Zapisano" }));
  };

  const resetDefaults = () => setDraft(DEFAULT_READING_TIME_SETTINGS);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl">
            <Clock className="h-5 w-5" aria-hidden />
            {t("admin.readingTime.title", { defaultValue: "Czas czytania" })}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("admin.readingTime.subtitle", {
              defaultValue:
                "Algorytm liczy PL i EN niezależnie z pełnej treści wpisu. Zmiany rzutują natychmiast na stronę publiczną, JSON-LD i bloki.",
            })}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={resetDefaults}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          {t("admin.readingTime.reset", { defaultValue: "Domyślne" })}
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("admin.readingTime.basic", { defaultValue: "Parametry podstawowe" })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-3">
            <Switch
              id="rt-enabled"
              checked={draft.enabled}
              onCheckedChange={(v) => set("enabled", !!v)}
            />
            <Label htmlFor="rt-enabled">
              {t("admin.readingTime.enabled", {
                defaultValue: "Pokazuj czas czytania na stronie publicznej",
              })}
            </Label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              id="rt-wpm-pl"
              label={t("admin.readingTime.wpmPl", { defaultValue: "Prędkość PL (słowa/min)" })}
              value={draft.wpm_pl}
              onChange={(v) => set("wpm_pl", v)}
              min={60}
              max={1200}
              hint={t("admin.readingTime.wpmPlHint", {
                defaultValue: "Typowo 200-240 dla polskiej prozy.",
              })}
            />
            <NumberField
              id="rt-wpm-en"
              label={t("admin.readingTime.wpmEn", { defaultValue: "Prędkość EN (słowa/min)" })}
              value={draft.wpm_en}
              onChange={(v) => set("wpm_en", v)}
              min={60}
              max={1200}
              hint={t("admin.readingTime.wpmEnHint", {
                defaultValue: "Typowo 220-260 dla angielskiej prozy.",
              })}
            />
            <NumberField
              id="rt-min"
              label={t("admin.readingTime.min", { defaultValue: "Minimum (min)" })}
              value={draft.min_minutes}
              onChange={(v) => set("min_minutes", v)}
              min={0}
              max={10}
            />
            <div className="grid gap-1.5">
              <Label htmlFor="rt-rounding">
                {t("admin.readingTime.rounding", { defaultValue: "Zaokrąglanie" })}
              </Label>
              <Select
                value={draft.rounding}
                onValueChange={(v) => set("rounding", v as ReadingTimeSettings["rounding"])}
              >
                <SelectTrigger id="rt-rounding">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="round">
                    {t("admin.readingTime.roundingRound", {
                      defaultValue: "Matematyczne (1.5 → 2)",
                    })}
                  </SelectItem>
                  <SelectItem value="ceil">
                    {t("admin.readingTime.roundingCeil", { defaultValue: "W górę (1.1 → 2)" })}
                  </SelectItem>
                  <SelectItem value="floor">
                    {t("admin.readingTime.roundingFloor", { defaultValue: "W dół (1.9 → 1)" })}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {isSuperAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-brand-ink" aria-hidden />
              {t("admin.readingTime.advanced", {
                defaultValue: "Parametry zaawansowane (super admin)",
              })}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <NumberField
              id="rt-img-head"
              label={t("admin.readingTime.imgHead", {
                defaultValue: "Sekundy na obraz (pierwsze N)",
              })}
              value={draft.image_seconds_head}
              onChange={(v) => set("image_seconds_head", v)}
              min={0}
              max={60}
            />
            <NumberField
              id="rt-img-tail"
              label={t("admin.readingTime.imgTail", {
                defaultValue: "Sekundy na każdy kolejny obraz",
              })}
              value={draft.image_seconds_tail}
              onChange={(v) => set("image_seconds_tail", v)}
              min={0}
              max={60}
            />
            <NumberField
              id="rt-img-count"
              label={t("admin.readingTime.imgCount", {
                defaultValue: "Ile obrazów liczy się po stawce pełnej (N)",
              })}
              value={draft.image_head_count}
              onChange={(v) => set("image_head_count", v)}
              min={0}
              max={50}
            />
            <NumberField
              id="rt-code"
              label={t("admin.readingTime.codeFactor", {
                defaultValue: "Mnożnik prędkości dla bloków kodu",
              })}
              value={draft.code_wpm_factor}
              onChange={(v) => set("code_wpm_factor", v)}
              min={0.1}
              max={1}
              step={0.05}
              hint={t("admin.readingTime.codeFactorHint", {
                defaultValue: "0.5 = kod czytany 2x wolniej niż proza.",
              })}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("admin.readingTime.preview", {
              defaultValue: "Podgląd na żywo - PL i EN symultanicznie",
            })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="rt-sample-pl">
                {t("admin.readingTime.samplePl", { defaultValue: "Próbka treści PL" })}
              </Label>
              <Textarea
                id="rt-sample-pl"
                rows={5}
                value={samplePl}
                onChange={(e) => setSamplePl(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rt-sample-en">
                {t("admin.readingTime.sampleEn", { defaultValue: "Próbka treści EN" })}
              </Label>
              <Textarea
                id="rt-sample-en"
                rows={5}
                value={sampleEn}
                onChange={(e) => setSampleEn(e.target.value)}
              />
            </div>
          </div>
          <div className="grid max-w-xs gap-1.5">
            <Label htmlFor="rt-sample-images">
              {t("admin.readingTime.sampleImages", { defaultValue: "Liczba obrazów w treści" })}
            </Label>
            <Input
              id="rt-sample-images"
              type="number"
              min={0}
              max={100}
              value={sampleImages}
              onChange={(e) => setSampleImages(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <div
            className="flex flex-wrap gap-6 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm"
            role="status"
            aria-live="polite"
          >
            <span>
              <strong>PL:</strong>{" "}
              {t("admin.readingTime.previewValue", {
                defaultValue: "{{min}} min ({{words}} słów)",
                min: preview.pl.minutes,
                words: preview.pl.words,
              })}
            </span>
            <span>
              <strong>EN:</strong>{" "}
              {t("admin.readingTime.previewValue", {
                defaultValue: "{{min}} min ({{words}} słów)",
                min: preview.en.minutes,
                words: preview.en.words,
              })}
            </span>
            {!draft.enabled && (
              <span className="text-muted-foreground">
                {t("admin.readingTime.disabledNote", {
                  defaultValue: "Czas czytania jest wyłączony na stronie publicznej.",
                })}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button onClick={save} disabled={busy || !parsed.success}>
          {busy
            ? t("admin.saving", { defaultValue: "Zapisywanie..." })
            : t("admin.save", { defaultValue: "Zapisz" })}
        </Button>
      </div>
    </div>
  );
}
