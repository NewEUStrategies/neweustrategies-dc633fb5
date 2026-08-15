// Widget "onboarding-form" - wieloetapowy formularz onboardingowy (brief).
// Kroki: dane osobowe, profil zawodowy, cele, design, budżet, wymagania.
// Wysyłka idzie przez utwardzoną serwerową funkcję submitContactMessage
// (rate limit, walidacja zod, tenant scope, CRM) - żadnej nowej tabeli.
// i18n PL/EN, dark/light przez tokeny, 6px rounding.
import { useMemo, useState, type CSSProperties } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import type { WidgetContent } from "@/lib/builder/types";
import { submitContactMessage } from "@/lib/contact.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, ChevronLeft, ChevronRight, Loader2 } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";
import { getBool, getStr, type Lang } from "./frame";

type StepId = "personal" | "professional" | "goals" | "design" | "budget" | "requirements";

interface OnboardingData {
  name: string;
  email: string;
  company: string;
  profession: string;
  experience: string;
  industry: string;
  primaryGoal: string;
  targetAudience: string;
  contentTypes: string[];
  colorPreference: string;
  stylePreference: string;
  inspirations: string;
  budget: string;
  timeline: string;
  features: string[];
  additionalInfo: string;
}

const EMPTY: OnboardingData = {
  name: "",
  email: "",
  company: "",
  profession: "",
  experience: "",
  industry: "",
  primaryGoal: "",
  targetAudience: "",
  contentTypes: [],
  colorPreference: "",
  stylePreference: "",
  inspirations: "",
  budget: "",
  timeline: "",
  features: [],
  additionalInfo: "",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COPY = {
  pl: {
    steps: {
      personal: "Dane kontaktowe",
      professional: "Profil zawodowy",
      goals: "Cele",
      design: "Design",
      budget: "Budżet",
      requirements: "Wymagania",
    },
    name: "Imię i nazwisko",
    email: "E-mail",
    company: "Organizacja",
    profession: "Stanowisko / rola",
    experience: "Doświadczenie",
    industry: "Branża",
    primaryGoal: "Główny cel",
    targetAudience: "Grupa docelowa",
    contentTypes: "Rodzaje treści",
    colorPreference: "Preferowana kolorystyka",
    stylePreference: "Styl",
    inspirations: "Inspiracje (linki)",
    budget: "Budżet",
    timeline: "Termin realizacji",
    features: "Funkcje",
    additionalInfo: "Dodatkowe informacje",
    back: "Wstecz",
    next: "Dalej",
    submit: "Wyślij zgłoszenie",
    sending: "Wysyłanie...",
    step: (a: number, b: number, title: string) => `Krok ${a} z ${b}: ${title}`,
    consent: "Zgadzam się na kontakt w sprawie mojego zgłoszenia.",
    ok: "Dziękujemy - zgłoszenie zostało wysłane.",
    error: "Nie udało się wysłać zgłoszenia. Spróbuj ponownie.",
    invalidEmail: "Podaj poprawny adres e-mail.",
    doneTitle: "Zgłoszenie przyjęte",
    doneText: "Odezwiemy się na podany adres e-mail.",
    experienceOptions: ["0-2 lata", "3-5 lat", "6-10 lat", "10+ lat"],
    goalOptions: ["Pozyskiwanie klientów", "Budowa marki", "Publikacja treści", "Sprzedaż"],
    contentOptions: ["Artykuły", "Raporty", "Wideo", "Podcast", "Newsletter"],
    styleOptions: ["Minimalistyczny", "Redakcyjny", "Korporacyjny", "Odważny"],
    colorOptions: ["Jasny", "Ciemny", "Stonowany", "Kontrastowy"],
    budgetOptions: ["< 10 000 PLN", "10 000-30 000 PLN", "30 000-80 000 PLN", "80 000+ PLN"],
    timelineOptions: ["ASAP", "1-3 miesiące", "3-6 miesięcy", "Elastyczny"],
    featureOptions: ["Blog", "Newsletter", "Płatności", "Strefa członkowska", "Wielojęzyczność"],
  },
  en: {
    steps: {
      personal: "Personal info",
      professional: "Professional",
      goals: "Goals",
      design: "Design",
      budget: "Budget",
      requirements: "Requirements",
    },
    name: "Full name",
    email: "Email",
    company: "Organisation",
    profession: "Role",
    experience: "Experience",
    industry: "Industry",
    primaryGoal: "Primary goal",
    targetAudience: "Target audience",
    contentTypes: "Content types",
    colorPreference: "Colour preference",
    stylePreference: "Style",
    inspirations: "Inspirations (links)",
    budget: "Budget",
    timeline: "Timeline",
    features: "Features",
    additionalInfo: "Additional info",
    back: "Back",
    next: "Next",
    submit: "Submit",
    sending: "Submitting...",
    step: (a: number, b: number, title: string) => `Step ${a} of ${b}: ${title}`,
    consent: "I agree to be contacted about my request.",
    ok: "Thank you - your request has been sent.",
    error: "Could not submit the form. Please try again.",
    invalidEmail: "Please enter a valid email address.",
    doneTitle: "Request received",
    doneText: "We will get back to you by email.",
    experienceOptions: ["0-2 years", "3-5 years", "6-10 years", "10+ years"],
    goalOptions: ["Lead generation", "Brand building", "Publishing", "Sales"],
    contentOptions: ["Articles", "Reports", "Video", "Podcast", "Newsletter"],
    styleOptions: ["Minimal", "Editorial", "Corporate", "Bold"],
    colorOptions: ["Light", "Dark", "Muted", "High contrast"],
    budgetOptions: ["< 2,500 EUR", "2,500-7,000 EUR", "7,000-20,000 EUR", "20,000+ EUR"],
    timelineOptions: ["ASAP", "1-3 months", "3-6 months", "Flexible"],
    featureOptions: ["Blog", "Newsletter", "Payments", "Member area", "Multilingual"],
  },
} as const;

interface MessageLabels {
  company: string;
  profession: string;
  experience: string;
  industry: string;
  primaryGoal: string;
  targetAudience: string;
  contentTypes: string;
  colorPreference: string;
  stylePreference: string;
  inspirations: string;
  budget: string;
  timeline: string;
  features: string;
  additionalInfo: string;
}

function locStr(c: WidgetContent, base: string, lang: Lang): string {
  return getStr(c, `${base}_${lang}`) || getStr(c, `${base}_pl`) || getStr(c, `${base}_en`);
}

function ChoiceRow({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onPick(opt)}
            aria-pressed={value === opt}
            className={cn(
              "rounded-[6px] border px-3 py-1.5 text-sm transition-colors",
              value === opt
                ? "border-transparent bg-[var(--ob-accent,var(--color-primary))] text-primary-foreground"
                : "border-border bg-background text-foreground hover:bg-muted",
            )}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function MultiRow({
  label,
  options,
  values,
  onToggle,
}: {
  label: string;
  options: readonly string[];
  values: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => (
          <label
            key={opt}
            className="flex min-w-0 cursor-pointer items-center gap-2 rounded-[6px] border border-border px-3 py-2 text-sm"
          >
            <Checkbox
              checked={values.includes(opt)}
              onCheckedChange={() => onToggle(opt)}
              aria-label={opt}
            />
            <span className="truncate">{opt}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

const STEP_IDS: readonly StepId[] = [
  "personal",
  "professional",
  "goals",
  "design",
  "budget",
  "requirements",
];

function buildMessage(data: OnboardingData, t: MessageLabels): string {
  const rows: Array<[string, string]> = [
    [t.company, data.company],
    [t.profession, data.profession],
    [t.experience, data.experience],
    [t.industry, data.industry],
    [t.primaryGoal, data.primaryGoal],
    [t.targetAudience, data.targetAudience],
    [t.contentTypes, data.contentTypes.join(", ")],
    [t.colorPreference, data.colorPreference],
    [t.stylePreference, data.stylePreference],
    [t.inspirations, data.inspirations],
    [t.budget, data.budget],
    [t.timeline, data.timeline],
    [t.features, data.features.join(", ")],
    [t.additionalInfo, data.additionalInfo],
  ];
  return rows
    .filter(([, v]) => v.trim().length > 0)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

export function OnboardingFormView({ c, lang }: { c: WidgetContent; lang: Lang }) {
  const t = COPY[lang] ?? COPY.pl;
  const submit = useServerFn(submitContactMessage);
  const [step, setStep] = useState(0);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [consent, setConsent] = useState(false);
  const [data, setData] = useState<OnboardingData>(EMPTY);

  const heading =
    locStr(c, "heading", lang) || (lang === "en" ? "Project brief" : "Brief projektu");
  const intro = locStr(c, "intro", lang);
  const submitLabel = locStr(c, "submitLabel", lang) || t.submit;
  const accent = getStr(c, "accentColor");
  const showIndicator = getBool(c, "showStepIndicator", true);
  const requireConsent = getBool(c, "requireConsent", true);

  const shellStyle = useMemo<CSSProperties>(
    () => (accent ? ({ "--ob-accent": accent } as CSSProperties) : {}),
    [accent],
  );

  const set = <K extends keyof OnboardingData>(key: K, value: OnboardingData[K]) =>
    setData((prev) => ({ ...prev, [key]: value }));

  const toggle = (key: "contentTypes" | "features", value: string) =>
    setData((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((v) => v !== value)
        : [...prev[key], value],
    }));

  const stepValid = (): boolean => {
    switch (STEP_IDS[step]) {
      case "personal":
        return data.name.trim().length > 0 && EMAIL_RE.test(data.email.trim());
      case "professional":
        return data.profession.trim().length > 0;
      case "goals":
        return data.primaryGoal.trim().length > 0;
      case "budget":
        return data.budget.trim().length > 0;
      case "requirements":
        return !requireConsent || consent;
      default:
        return true;
    }
  };

  const onSubmit = async () => {
    if (!EMAIL_RE.test(data.email.trim())) {
      toast.error(t.invalidEmail);
      return;
    }
    setSending(true);
    try {
      await submit({
        data: {
          name: data.name.trim(),
          email: data.email.trim(),
          company: data.company.trim() || undefined,
          subject: heading,
          message: buildMessage(data, t),
          consent: true,
          lang,
          formName: heading,
          source: "onboarding-form",
        },
      });
      setDone(true);
      toast.success(t.ok);
    } catch {
      toast.error(t.error);
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div
        className="animate-fade-in rounded-[6px] border border-border bg-card p-6 text-center"
        style={shellStyle}
      >
        <Check className="mx-auto h-6 w-6 text-[var(--ob-accent,var(--color-primary))]" />
        <p className="mt-2 text-base font-semibold text-foreground">{t.doneTitle}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t.doneText}</p>
      </div>
    );
  }

  const current = STEP_IDS[step];

  return (
    <div className="w-full" style={shellStyle}>
      <div className="overflow-hidden rounded-[6px] border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h3 className="truncate text-lg font-semibold text-foreground">{heading}</h3>
          {intro ? <p className="mt-1 text-sm text-muted-foreground">{intro}</p> : null}
          <div className="mt-3 flex gap-1.5" role="presentation">
            {STEP_IDS.map((id, i) => (
              <span
                key={id}
                className={cn(
                  "h-1 flex-1 rounded-[6px] transition-colors",
                  i <= step ? "bg-[var(--ob-accent,var(--color-primary))]" : "bg-muted",
                )}
              />
            ))}
          </div>
        </div>

        <div key={current} className="animate-fade-in space-y-4 px-5 py-5">
          {current === "personal" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="ob-name">{t.name}</Label>
                <Input
                  id="ob-name"
                  value={data.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob-email">{t.email}</Label>
                <Input
                  id="ob-email"
                  type="email"
                  value={data.email}
                  onChange={(e) => set("email", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob-company">{t.company}</Label>
                <Input
                  id="ob-company"
                  value={data.company}
                  onChange={(e) => set("company", e.target.value)}
                />
              </div>
            </>
          )}

          {current === "professional" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="ob-profession">{t.profession}</Label>
                <Input
                  id="ob-profession"
                  value={data.profession}
                  onChange={(e) => set("profession", e.target.value)}
                />
              </div>
              <ChoiceRow
                label={t.experience}
                options={t.experienceOptions}
                value={data.experience}
                onPick={(v) => set("experience", v)}
              />
              <div className="space-y-2">
                <Label htmlFor="ob-industry">{t.industry}</Label>
                <Input
                  id="ob-industry"
                  value={data.industry}
                  onChange={(e) => set("industry", e.target.value)}
                />
              </div>
            </>
          )}

          {current === "goals" && (
            <>
              <ChoiceRow
                label={t.primaryGoal}
                options={t.goalOptions}
                value={data.primaryGoal}
                onPick={(v) => set("primaryGoal", v)}
              />
              <div className="space-y-2">
                <Label htmlFor="ob-audience">{t.targetAudience}</Label>
                <Input
                  id="ob-audience"
                  value={data.targetAudience}
                  onChange={(e) => set("targetAudience", e.target.value)}
                />
              </div>
              <MultiRow
                label={t.contentTypes}
                options={t.contentOptions}
                values={data.contentTypes}
                onToggle={(v) => toggle("contentTypes", v)}
              />
            </>
          )}

          {current === "design" && (
            <>
              <ChoiceRow
                label={t.colorPreference}
                options={t.colorOptions}
                value={data.colorPreference}
                onPick={(v) => set("colorPreference", v)}
              />
              <ChoiceRow
                label={t.stylePreference}
                options={t.styleOptions}
                value={data.stylePreference}
                onPick={(v) => set("stylePreference", v)}
              />
              <div className="space-y-2">
                <Label htmlFor="ob-inspirations">{t.inspirations}</Label>
                <Textarea
                  id="ob-inspirations"
                  value={data.inspirations}
                  onChange={(e) => set("inspirations", e.target.value)}
                />
              </div>
            </>
          )}

          {current === "budget" && (
            <>
              <ChoiceRow
                label={t.budget}
                options={t.budgetOptions}
                value={data.budget}
                onPick={(v) => set("budget", v)}
              />
              <ChoiceRow
                label={t.timeline}
                options={t.timelineOptions}
                value={data.timeline}
                onPick={(v) => set("timeline", v)}
              />
            </>
          )}

          {current === "requirements" && (
            <>
              <MultiRow
                label={t.features}
                options={t.featureOptions}
                values={data.features}
                onToggle={(v) => toggle("features", v)}
              />
              <div className="space-y-2">
                <Label htmlFor="ob-additional">{t.additionalInfo}</Label>
                <Textarea
                  id="ob-additional"
                  value={data.additionalInfo}
                  onChange={(e) => set("additionalInfo", e.target.value)}
                />
              </div>
              {requireConsent ? (
                <label className="flex cursor-pointer items-start gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    checked={consent}
                    onCheckedChange={(v) => setConsent(v === true)}
                    aria-label={t.consent}
                  />
                  <span>{t.consent}</span>
                </label>
              ) : null}
            </>
          )}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border px-5 py-4">
          <Button
            type="button"
            variant="outline"
            className="justify-self-start rounded-[6px]"
            disabled={step === 0 || sending}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            <ChevronLeft className="h-4 w-4" /> {t.back}
          </Button>
          <Button
            type="button"
            className="rounded-[6px] bg-[var(--ob-accent,var(--color-primary))]"
            disabled={!stepValid() || sending}
            onClick={() => {
              if (step < STEP_IDS.length - 1) setStep((s) => s + 1);
              else void onSubmit();
            }}
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {t.sending}
              </>
            ) : step === STEP_IDS.length - 1 ? (
              <>
                {submitLabel} <Check className="h-4 w-4" />
              </>
            ) : (
              <>
                {t.next} <ChevronRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>

      {showIndicator ? (
        <p className="mt-3 text-center text-sm text-muted-foreground">
          {t.step(step + 1, STEP_IDS.length, t.steps[current])}
        </p>
      ) : null}
    </div>
  );
}
