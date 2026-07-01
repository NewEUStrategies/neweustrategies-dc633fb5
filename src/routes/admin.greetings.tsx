import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminShell } from "@/components/admin/AdminShell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { RotateCcw, Sparkles } from "lucide-react";
import {
  DEFAULT_GREETINGS,
  pickGreeting,
  type GreetingsDictionary,
  type Lang,
  type TimeBucket,
} from "@/lib/greetings/greetings";

export const Route = createFileRoute("/admin/greetings")({ component: GreetingsAdmin });

const BUCKETS: TimeBucket[] = [
  "night", "earlyMorning", "morning", "noon", "afternoon", "evening", "lateEvening",
];

const BUCKET_HOURS: Record<TimeBucket, string> = {
  night: "00:00 - 04:59",
  earlyMorning: "05:00 - 07:59",
  morning: "08:00 - 10:59",
  noon: "11:00 - 13:59",
  afternoon: "14:00 - 16:59",
  evening: "17:00 - 20:59",
  lateEvening: "21:00 - 23:59",
};

function cloneDefaults(): GreetingsDictionary {
  return JSON.parse(JSON.stringify(DEFAULT_GREETINGS)) as GreetingsDictionary;
}

function GreetingsAdmin() {
  const { t, i18n } = useTranslation();
  const uiLang: Lang = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const [dict, setDict] = useState<GreetingsDictionary>(cloneDefaults());
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [lang, setLang] = useState<Lang>(uiLang);

  useEffect(() => {
    supabase.from("site_settings").select("value").eq("key", "greetings").maybeSingle()
      .then(({ data }) => {
        if (data?.value) {
          const base = cloneDefaults();
          const raw = data.value as Partial<GreetingsDictionary>;
          for (const l of ["pl", "en"] as const) {
            const langObj = raw[l];
            if (!langObj) continue;
            for (const b of BUCKETS) {
              const arr = langObj[b];
              if (Array.isArray(arr)) base[l][b] = arr.filter((x) => typeof x === "string");
            }
          }
          setDict(base);
        }
        setLoaded(true);
      });
  }, []);

  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from("site_settings")
      .upsert({ key: "greetings", value: dict as never }, { onConflict: "key" });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success(t("admin.saved", { defaultValue: uiLang === "pl" ? "Zapisano" : "Saved" }));
  };

  const resetBucket = (b: TimeBucket) => {
    setDict((d) => ({
      ...d,
      [lang]: { ...d[lang], [b]: [...DEFAULT_GREETINGS[lang][b]] },
    }));
  };

  const resetAll = () => setDict(cloneDefaults());

  const updateBucket = (b: TimeBucket, text: string) => {
    const arr = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    setDict((d) => ({ ...d, [lang]: { ...d[lang], [b]: arr } }));
  };

  const preview = useMemo(() => {
    const now = new Date();
    return BUCKETS.map((b) => {
      const testDate = new Date(now);
      const hour = { night: 2, earlyMorning: 6, morning: 9, noon: 12, afternoon: 15, evening: 19, lateEvening: 22 }[b];
      testDate.setHours(hour, 0, 0, 0);
      return {
        bucket: b,
        sample: pickGreeting({
          lang,
          firstName: uiLang === "pl" ? "Anna" : "Alex",
          entry: null,
          seed: `preview-${b}`,
          now: testDate,
          overrides: dict,
        }),
      };
    });
  }, [dict, lang, uiLang]);

  if (!loaded) {
    return <AdminShell><p className="p-6 text-sm text-muted-foreground">{t("admin.loading", { defaultValue: "Loading…" })}</p></AdminShell>;
  }

  const title = uiLang === "pl" ? "Powitania" : "Greetings";
  const subtitle = uiLang === "pl"
    ? "Konfiguruj wiadomości powitalne pojawiające się w panelu i widgetach. Zmienna {name} zostaje zamieniona na imię użytkownika (w PL w wołaczu)."
    : "Configure greeting messages shown in the app and widgets. The {name} placeholder is replaced with the user's first name (vocative in Polish).";

  return (
    <AdminShell>
      <div className="p-4 md:p-6 space-y-6 max-w-5xl">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" />{title}</h1>
            <p className="text-sm text-muted-foreground max-w-2xl mt-1">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={resetAll} className="gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" />
              {uiLang === "pl" ? "Przywróć domyślne" : "Reset to defaults"}
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy
                ? (uiLang === "pl" ? "Zapisywanie…" : "Saving…")
                : (uiLang === "pl" ? "Zapisz" : "Save")}
            </Button>
          </div>
        </div>

        <Tabs value={lang} onValueChange={(v) => setLang(v as Lang)}>
          <TabsList>
            <TabsTrigger value="pl">Polski (PL)</TabsTrigger>
            <TabsTrigger value="en">English (EN)</TabsTrigger>
          </TabsList>

          {(["pl", "en"] as const).map((l) => (
            <TabsContent key={l} value={l} className="space-y-4 mt-6">
              {BUCKETS.map((b) => (
                <div key={b} className="rounded-md border border-border p-4 bg-card">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-medium">
                      {BUCKET_LABEL[l][b]}
                      <span className="ml-2 text-xs text-muted-foreground">({BUCKET_HOURS[b]})</span>
                    </Label>
                    <Button variant="ghost" size="sm" onClick={() => resetBucket(b)} className="h-7 gap-1.5 text-xs">
                      <RotateCcw className="w-3 h-3" />
                      {l === "pl" ? "Domyślne" : "Default"}
                    </Button>
                  </div>
                  <Textarea
                    className="font-mono text-[13px] min-h-[140px]"
                    value={dict[l][b].join("\n")}
                    onChange={(e) => updateBucket(b, e.target.value)}
                    placeholder={l === "pl" ? "Jedno powitanie w linii, użyj {name}" : "One greeting per line, use {name}"}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {l === "pl" ? "Jedno powitanie w linii. Placeholder" : "One greeting per line. Placeholder"} <code className="text-foreground">{"{name}"}</code>{" "}
                    {l === "pl" ? "→ imię użytkownika." : "→ user's first name."}
                  </p>
                </div>
              ))}
            </TabsContent>
          ))}
        </Tabs>

        <div className="rounded-md border border-border p-4 bg-muted/30">
          <h2 className="text-sm font-semibold mb-3">
            {uiLang === "pl" ? "Podgląd (przykładowe imię)" : "Preview (sample name)"}
          </h2>
          <ul className="space-y-1.5 text-sm">
            {preview.map((p) => (
              <li key={p.bucket} className="flex items-baseline gap-3">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground w-28 shrink-0">
                  {BUCKET_LABEL[lang][p.bucket]}
                </span>
                <span className="text-foreground">{p.sample}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AdminShell>
  );
}

const BUCKET_LABEL: Record<Lang, Record<TimeBucket, string>> = {
  pl: {
    night: "Noc",
    earlyMorning: "Wczesny poranek",
    morning: "Poranek",
    noon: "Południe",
    afternoon: "Popołudnie",
    evening: "Wieczór",
    lateEvening: "Późny wieczór",
  },
  en: {
    night: "Night",
    earlyMorning: "Early morning",
    morning: "Morning",
    noon: "Noon",
    afternoon: "Afternoon",
    evening: "Evening",
    lateEvening: "Late evening",
  },
};
