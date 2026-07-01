import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminShell } from "@/components/admin/AdminShell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { RotateCcw, MessageCircle, Plus, Trash2, AlertCircle, Info } from "lucide-react";
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

type ValidationIssue = { lang: Lang; bucket: TimeBucket; reason: "empty" | "missing-name" };

function validateDict(dict: GreetingsDictionary): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const l of ["pl", "en"] as const) {
    for (const b of BUCKETS) {
      const items = (dict[l][b] ?? []).map((s) => s.trim()).filter(Boolean);
      if (items.length === 0) {
        issues.push({ lang: l, bucket: b, reason: "empty" });
        continue;
      }
      if (!items.some((s) => s.includes("{name}"))) {
        issues.push({ lang: l, bucket: b, reason: "missing-name" });
      }
    }
  }
  return issues;
}

function GreetingsAdmin() {
  const { t, i18n } = useTranslation();
  const uiLang: Lang = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const isPL = uiLang === "pl";
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

  const issues = useMemo(() => validateDict(dict), [dict]);
  const canSave = issues.filter((i) => i.reason === "empty").length === 0;

  const save = async () => {
    const emptyIssues = issues.filter((i) => i.reason === "empty");
    if (emptyIssues.length > 0) {
      toast.error(
        isPL
          ? `Nie można zapisać: brakuje powitań w ${emptyIssues.length} sekcjach (wymagane zarówno PL i EN).`
          : `Cannot save: ${emptyIssues.length} sections have no greetings (both PL and EN required).`,
      );
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("site_settings")
      .upsert({ key: "greetings", value: dict as never }, { onConflict: "key" });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success(t("admin.saved", { defaultValue: isPL ? "Zapisano" : "Saved" }));
  };

  const resetBucket = (b: TimeBucket) => {
    setDict((d) => ({
      ...d,
      [lang]: { ...d[lang], [b]: [...DEFAULT_GREETINGS[lang][b]] },
    }));
  };

  const resetAll = () => setDict(cloneDefaults());

  const updateItem = (b: TimeBucket, i: number, value: string) => {
    setDict((d) => {
      const arr = [...d[lang][b]];
      arr[i] = value;
      return { ...d, [lang]: { ...d[lang], [b]: arr } };
    });
  };
  const removeItem = (b: TimeBucket, i: number) => {
    setDict((d) => {
      const arr = d[lang][b].filter((_, idx) => idx !== i);
      return { ...d, [lang]: { ...d[lang], [b]: arr } };
    });
  };
  const addItem = (b: TimeBucket) => {
    setDict((d) => ({
      ...d,
      [lang]: {
        ...d[lang],
        [b]: [...d[lang][b], lang === "pl" ? "Witaj, {name}" : "Welcome, {name}"],
      },
    }));
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
          firstName: isPL ? "Anna" : "Alex",
          entry: null,
          seed: `preview-${b}`,
          now: testDate,
          overrides: dict,
        }),
      };
    });
  }, [dict, lang, isPL]);

  if (!loaded) {
    return <p className="p-6 text-sm text-muted-foreground">{t("admin.loading", { defaultValue: "Loading…" })}</p>;
  }

  const title = isPL ? "Powitania" : "Greetings";
  const subtitle = isPL
    ? "Konfiguruj wiadomości powitalne pojawiające się w panelu i widgetach."
    : "Configure greeting messages shown in the app and widgets.";

  // Count issues per lang for tab badges
  const emptyPerLang = { pl: 0, en: 0 } as Record<Lang, number>;
  for (const i of issues) if (i.reason === "empty") emptyPerLang[i.lang]++;

  return (
    <div className="space-y-6 max-w-5xl">

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-primary" />{title}
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl mt-1">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={resetAll} className="gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" />
              {isPL ? "Przywróć domyślne" : "Reset to defaults"}
            </Button>
            <Button size="sm" onClick={save} disabled={busy || !canSave}>
              {busy ? (isPL ? "Zapisywanie…" : "Saving…") : (isPL ? "Zapisz" : "Save")}
            </Button>
          </div>
        </div>

        {/* Pattern / wzór */}
        <div className="rounded-md border border-border p-4 bg-muted/30 space-y-2 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <Info className="w-4 h-4 text-primary" />
            {isPL ? "Wzór powitania" : "Greeting pattern"}
          </div>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>
              {isPL ? "Użyj placeholdera" : "Use the placeholder"}{" "}
              <code className="text-foreground bg-background/60 px-1 rounded">{"{name}"}</code>{" "}
              {isPL
                ? "— zostanie zamieniony na imię użytkownika."
                : "— it will be replaced with the user's first name."}
            </li>
            <li>
              {isPL
                ? "W języku polskim imię zawsze pojawia się w wołaczu (np. Anna → Anno, Piotr → Piotrze). System dobiera formę automatycznie na podstawie słownika i płci."
                : "In Polish, names are always in vocative form (Anna → Anno, Piotr → Piotrze). The system infers the form automatically."}
            </li>
            <li>
              {isPL
                ? "Każda pora dnia musi mieć co najmniej jedno powitanie w obu językach (PL i EN) — inaczej zapis jest zablokowany."
                : "Every time bucket must have at least one greeting in both PL and EN — otherwise saving is blocked."}
            </li>
            <li>
              {isPL ? "Przykład:" : "Example:"}{" "}
              <code className="text-foreground bg-background/60 px-1 rounded">
                {isPL ? "Dzień dobry, {name}!" : "Good morning, {name}!"}
              </code>
            </li>
          </ul>
        </div>

        {!canSave && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive p-3 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              {isPL
                ? "Zapis zablokowany: uzupełnij brakujące powitania. Każda pora dnia wymaga min. 1 wpisu w PL i EN."
                : "Save blocked: fill in the missing greetings. Each time bucket needs at least 1 entry in PL and EN."}
            </div>
          </div>
        )}

        <Tabs value={lang} onValueChange={(v) => setLang(v as Lang)}>
          <TabsList>
            <TabsTrigger value="pl" className="gap-1.5">
              Polski (PL)
              {emptyPerLang.pl > 0 && (
                <span className="ml-1 rounded-full bg-destructive/15 text-destructive text-[10px] px-1.5 py-0.5">
                  {emptyPerLang.pl}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="en" className="gap-1.5">
              English (EN)
              {emptyPerLang.en > 0 && (
                <span className="ml-1 rounded-full bg-destructive/15 text-destructive text-[10px] px-1.5 py-0.5">
                  {emptyPerLang.en}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {(["pl", "en"] as const).map((l) => (
            <TabsContent key={l} value={l} className="space-y-4 mt-6">
              {BUCKETS.map((b) => {
                const items = dict[l][b];
                const bucketEmpty = items.length === 0;
                return (
                  <div
                    key={b}
                    className={`rounded-md border p-4 bg-card ${bucketEmpty ? "border-destructive/50" : "border-border"}`}
                  >
                    <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                      <Label className="text-sm font-medium">
                        {BUCKET_LABEL[l][b]}
                        <span className="ml-2 text-xs text-muted-foreground">({BUCKET_HOURS[b]})</span>
                        {bucketEmpty && (
                          <span className="ml-2 text-[11px] text-destructive font-normal">
                            {l === "pl" ? "wymagane" : "required"}
                          </span>
                        )}
                      </Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => resetBucket(b)}
                        className="h-7 gap-1.5 text-xs"
                      >
                        <RotateCcw className="w-3 h-3" />
                        {l === "pl" ? "Domyślne" : "Default"}
                      </Button>
                    </div>

                    {l === l && lang === l && (
                      <div className="space-y-2">
                        {items.map((val, i) => {
                          const hasName = val.includes("{name}");
                          return (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-[11px] text-muted-foreground w-5 text-right shrink-0">
                                {i + 1}.
                              </span>
                              <Input
                                value={val}
                                onChange={(e) => updateItem(b, i, e.target.value)}
                                placeholder={l === "pl" ? "np. Dzień dobry, {name}!" : "e.g. Good morning, {name}!"}
                                className={`h-8 text-sm ${!hasName ? "border-amber-500/60" : ""}`}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                                onClick={() => removeItem(b, i)}
                                aria-label={l === "pl" ? "Usuń" : "Remove"}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          );
                        })}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => addItem(b)}
                          className="h-8 gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          {l === "pl" ? "Dodaj powitanie" : "Add greeting"}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </TabsContent>
          ))}
        </Tabs>

        <div className="rounded-md border border-border p-4 bg-muted/30">
          <h2 className="text-sm font-semibold mb-3">
            {isPL ? "Podgląd (przykładowe imię)" : "Preview (sample name)"}
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
