// Organizm: formularz aplikacyjny jako 3-krokowy kreator. Wysyłka idzie przez
// tę samą, utwardzoną funkcję serwerową co formularz kontaktowy
// (`submitContactMessage`): rate-limit, scope tenantowy, walidacja zod, zapis
// w Contact Center + CRM. Dane rekrutacyjne (dział, rola, poziom, start,
// LinkedIn) jadą w polu `custom`, więc backend nie wymaga zmian.
//
// Kreator: Enter / "Dalej" waliduje bieżący krok i przechodzi dalej, powrót
// możliwy do kroków odwiedzonych, fokus po zmianie kroku ląduje na legendzie
// (czytnik ekranu słyszy "Krok X z Y: tytuł"). Po wysyłce formularz zastępuje
// panel potwierdzenia - nie znikający toast.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertCircle, ArrowLeft, ArrowRight, Send } from "lucide-react";

import { submitContactMessage } from "@/lib/contact.functions";
import { Button } from "@/components/ui/button";
import { FloatingInput, FloatingTextarea } from "@/components/ui/floating-input";
import { FormSelect, type FormSelectOption } from "@/components/atoms/FormSelect";
import { SubscribeButton } from "@/components/ui/subscribe-button";
import {
  CAREER_DEPARTMENTS,
  CAREER_SENIORITIES,
  type CareerDepartmentId,
} from "@/lib/careers/roles";
import { filterOffersByDepartment, findOffer } from "@/lib/careers/catalog";
import { useCareerOffers } from "@/lib/careers/useCareerContent";
import {
  CAREER_START_OPTIONS,
  CAREER_FIELD_STEP,
  MESSAGE_MAX,
  MESSAGE_MIN,
  hasErrors,
  validateApplication,
  validateStep,
  type CareerFieldErrors,
  type CareerFieldName,
} from "@/lib/careers/applicationSchema";
import { CAREER_FORM_STEPS, CareerFormStepper } from "../molecules/CareerFormStepper";
import { CareerFormSuccess } from "../molecules/CareerFormSuccess";

const START_OPTIONS = CAREER_START_OPTIONS;
const LAST_STEP = CAREER_FORM_STEPS.length - 1;

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  linkedin: string;
  department: CareerDepartmentId | "";
  role: string;
  seniority: string;
  start: string;
  message: string;
}

const EMPTY: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  linkedin: "",
  department: "",
  role: "",
  seniority: "",
  start: "",
  message: "",
};

export function CareersApplyForm({
  id,
  lang,
  selectedRoleId,
  onRoleChange,
  applySignal = 0,
}: {
  id: string;
  lang: "pl" | "en";
  selectedRoleId: string | null;
  onRoleChange: (roleId: string | null) => void;
  /**
   * Licznik intencji aplikowania z trasy (CTA hero / domknięcia / karty ról).
   * Rośnie przy każdym kliknięciu, więc przywraca formularz po panelu
   * potwierdzenia także wtedy, gdy `selectedRoleId` się nie zmienia
   * (zgłoszenie spontaniczne po zgłoszeniu spontanicznym).
   */
  applySignal?: number;
}) {
  const { t } = useTranslation();
  const { offers } = useCareerOffers();

  const submit = useServerFn(submitContactMessage);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<CareerFieldErrors>({});
  const [maxVisited, setMaxVisited] = useState(0);
  const legendRef = useRef<HTMLLegendElement>(null);
  const skipFocusRef = useRef(true);
  const formId = useId();
  const consentId = `${formId}-consent`;

  // Preselekcja z kart ról - wybór roli ustawia też jej dział i poziom.
  useEffect(() => {
    const role = findOffer(offers, selectedRoleId);
    if (!role) return;
    setForm((prev) => ({
      ...prev,
      role: role.id,
      department: role.department,
      seniority: prev.seniority || role.seniority,
    }));
  }, [selectedRoleId]);

  // Każda intencja aplikowania (CTA / karta roli) przywraca formularz po
  // panelu potwierdzenia - niezależnie od tego, czy zmieniła się rola.
  useEffect(() => {
    if (applySignal > 0) setSubmitted(false);
  }, [applySignal]);

  // Fokus na legendzie aktywnego kroku - dopiero od pierwszej ZMIANY kroku,
  // żeby nie kraść fokusa przy wejściu na stronę.
  useEffect(() => {
    if (skipFocusRef.current) {
      skipFocusRef.current = false;
      return;
    }
    legendRef.current?.focus();
  }, [step]);

  const goToStep = useCallback((next: number) => {
    setStep(next);
    setMaxVisited((prev) => Math.max(prev, next));
  }, []);

  // Klucze i18n z schematu tłumaczymy dopiero tutaj - schemat pozostaje
  // niezależny od języka i testowalny bez i18n.
  const msg = useCallback(
    (key: string | undefined) =>
      key ? t(key, { min: MESSAGE_MIN, max: MESSAGE_MAX, defaultValue: key }) : undefined,
    [t],
  );

  const payload = useMemo(
    () => ({ ...form, consent }),
    [form, consent],
  );

  const clearError = useCallback((field: CareerFieldName) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }, []);

  const setField = useCallback(
    <K extends keyof FormState>(field: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      clearError(field as CareerFieldName);
    },
    [clearError],
  );

  const blurField = useCallback(
    (field: CareerFieldName) => {
      const stepErrors = validateStep(CAREER_FIELD_STEP[field], payload);
      setErrors((prev) => ({ ...prev, [field]: stepErrors[field] }));
    },
    [payload],
  );

  // Fokus i przewinięcie do pierwszego błędnego pola - bez tego na mobile
  // komunikat potrafi zostać poza ekranem.
  const focusFirstError = useCallback((current: CareerFieldErrors) => {
    if (typeof document === "undefined") return;
    const field = (Object.keys(current) as CareerFieldName[]).find((key) => current[key]);
    if (!field) return;
    window.requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>(`[data-field="${field}"]`);
      node?.scrollIntoView({ block: "center", behavior: "smooth" });
      node?.focus?.();
    });
  }, []);

  const errorCount = Object.values(errors).filter(Boolean).length;

  const departmentOptions = useMemo<FormSelectOption[]>(
    () => CAREER_DEPARTMENTS.map((d) => ({ value: d, label: t(`careers.departments.${d}`) })),
    [t],
  );

  const roleOptions = useMemo<FormSelectOption[]>(() => {
    const pool = filterOffersByDepartment(offers, form.department || "all");
    return [
      { value: "open", label: t("careers.form.roleOpen") },
      ...pool.map((role) => ({ value: role.id, label: role.title })),
    ];
  }, [form.department, offers, t]);

  const seniorityOptions = useMemo<FormSelectOption[]>(
    () => CAREER_SENIORITIES.map((s) => ({ value: s, label: t(`careers.seniority.${s}`) })),
    [t],
  );

  const startOptions = useMemo<FormSelectOption[]>(
    () => START_OPTIONS.map((s) => ({ value: s, label: t(`careers.form.startOptions.${s}`) })),
    [t],
  );

  /** Waliduje wskazany krok, ustawia błędy pól i zwraca wynik. */
  const checkStep = useCallback(
    (index: number) => {
      const stepErrors = validateStep(index as 0 | 1 | 2, payload);
      setErrors((prev) => {
        const next: CareerFieldErrors = { ...prev };
        for (const field of Object.keys(CAREER_FIELD_STEP) as CareerFieldName[]) {
          if (CAREER_FIELD_STEP[field] === index) next[field] = stepErrors[field];
        }
        return next;
      });
      if (hasErrors(stepErrors)) {
        toast.error(
          t("careers.form.errors.summary", {
            count: Object.values(stepErrors).filter(Boolean).length,
            defaultValue: "careers.form.errors.summary",
          }),
        );
        focusFirstError(stepErrors);
        return false;
      }
      return true;
    },
    [focusFirstError, payload, t],
  );

  const send = async () => {
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const email = form.email.trim();
    const message = form.message.trim();
    const roleLabel =
      form.role && form.role !== "open"
        ? (findOffer(offers, form.role)?.title ?? form.role)
        : t("careers.form.roleOpen");

    setSending(true);
    try {
      await submit({
        data: {
          name: `${firstName} ${lastName}`,
          firstName,
          lastName,
          email,
          phone: form.phone.trim(),
          subject: `${t("careers.eyebrow")}: ${roleLabel}`,
          message,
          consent: true,
          lang,
          formName: "careers-application",
          formId: "careers",
          source: typeof window !== "undefined" ? window.location.pathname : "/zatrudniamy",
          pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
          custom: {
            department: form.department || "",
            role: form.role || "open",
            role_label: roleLabel,
            seniority: form.seniority || "",
            start: form.start || "",
            linkedin: form.linkedin.trim(),
          },
          consents: [
            {
              key: "recruitment",
              text: t("careers.form.consent"),
              lang,
            },
          ],
        },
      });
      setSubmittedEmail(email);
      setForm(EMPTY);
      setConsent(false);
      setErrors({});
      onRoleChange(null);
      setStep(0);
      setMaxVisited(0);
      skipFocusRef.current = true;
      setSubmitted(true);
    } catch {
      toast.error(t("careers.form.error"));
    } finally {
      setSending(false);
    }
  };

  // Powrót stepperem jest wolny, ale ruch W PRZÓD przechodzi walidację kroku
  // "O Tobie" - po cofnięciu można wyczyścić wymagane pola i bez tej bramki
  // skok do odwiedzonej "Wiadomości" ominąłby walidację.
  const handleStepSelect = (index: number) => {
    if (index > step) {
      for (let i = step; i < index; i += 1) {
        if (!checkStep(i)) {
          setStep(i);
          return;
        }
      }
    }
    setStep(index);
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (step < LAST_STEP) {
      if (checkStep(step)) goToStep(step + 1);
      return;
    }
    // Finalna walidacja całości: po cofnięciu można było wyczyścić pola
    // wcześniejszych kroków, a CRM nie może dostać zgłoszenia z brakami.
    const result = validateApplication(payload);
    if (!result.ok) {
      setErrors(result.errors);
      toast.error(
        t("careers.form.errors.summary", {
          count: Object.values(result.errors).filter(Boolean).length,
          defaultValue: "careers.form.errors.summary",
        }),
      );
      setStep(result.firstStep);
      focusFirstError(result.errors);
      return;
    }
    await send();
  };

  const selectedRole = findOffer(offers, selectedRoleId);
  const stepKey = CAREER_FORM_STEPS[step];

  return (
    <section
      id={id}
      aria-labelledby="careers-form"
      className="mt-14 scroll-mt-28 rounded-[6px] border border-border/70 bg-card/50 p-5 sm:p-8"
    >
      <h2
        id="careers-form"
        className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
      >
        {t("careers.form.title")}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
        {t("careers.form.subtitle")}
      </p>
      {!submitted && selectedRole ? (
        <p className="mt-3 inline-flex items-center gap-2 rounded-[6px] border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-foreground">
          {t("careers.roles.selected")}: {selectedRole.title}
        </p>
      ) : null}

      {submitted ? (
        <CareerFormSuccess email={submittedEmail} onReset={() => setSubmitted(false)} />
      ) : (
        <form onSubmit={onSubmit} className="mt-6" noValidate>
          <CareerFormStepper
            current={step}
            maxVisited={maxVisited}
            onStepSelect={handleStepSelect}
          />

          <fieldset key={stepKey} className="crs-step mt-6 min-w-0 border-0 p-0">
            <legend
              ref={legendRef}
              tabIndex={-1}
              className="mb-4 p-0 text-base font-semibold text-foreground outline-none"
            >
              <span className="sr-only">
                {t("careers.form.stepLabel", {
                  current: step + 1,
                  total: CAREER_FORM_STEPS.length,
                })}
                {": "}
              </span>
              {t(`careers.form.steps.${stepKey}.title`)}
            </legend>

            {step === 0 ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <FloatingInput
                    label={t("careers.form.firstName")}
                    autoComplete="given-name"
                    required
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  />
                  <FloatingInput
                    label={t("careers.form.lastName")}
                    autoComplete="family-name"
                    required
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  />
                  <FloatingInput
                    label={t("careers.form.email")}
                    type="email"
                    autoComplete="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                  <FloatingInput
                    label={t("careers.form.phone")}
                    type="tel"
                    autoComplete="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
                <FloatingInput
                  label={t("careers.form.linkedin")}
                  inputMode="url"
                  value={form.linkedin}
                  onChange={(e) => setForm({ ...form, linkedin: e.target.value })}
                />
              </div>
            ) : null}

            {step === 1 ? (
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("careers.form.fitOptional")}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormSelect
                    aria-label={t("careers.form.department")}
                    placeholder={t("careers.form.department")}
                    value={form.department}
                    options={departmentOptions}
                    onValueChange={(value) => {
                      const department = value as CareerDepartmentId;
                      setForm((prev) => ({
                        ...prev,
                        department,
                        role: findOffer(offers, prev.role)?.department === department ? prev.role : "",
                      }));
                    }}
                  />
                  <FormSelect
                    aria-label={t("careers.form.role")}
                    placeholder={t("careers.form.role")}
                    value={form.role}
                    options={roleOptions}
                    onValueChange={(value) => {
                      setForm((prev) => ({ ...prev, role: value }));
                      onRoleChange(value === "open" ? null : value);
                    }}
                  />
                  <FormSelect
                    aria-label={t("careers.form.seniority")}
                    placeholder={t("careers.form.seniority")}
                    value={form.seniority}
                    options={seniorityOptions}
                    onValueChange={(value) => setForm({ ...form, seniority: value })}
                  />
                  <FormSelect
                    aria-label={t("careers.form.start")}
                    placeholder={t("careers.form.start")}
                    value={form.start}
                    options={startOptions}
                    onValueChange={(value) => setForm({ ...form, start: value })}
                  />
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-3">
                <FloatingTextarea
                  label={t("careers.form.message")}
                  placeholder={t("careers.form.messagePlaceholder")}
                  rows={6}
                  required
                  maxLength={4000}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                />
                <label
                  htmlFor={consentId}
                  className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-muted-foreground"
                >
                  <input
                    id={consentId}
                    type="checkbox"
                    className="lov-check mt-0.5"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span>{t("careers.form.consent")}</span>
                </label>
              </div>
            ) : null}
          </fieldset>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {step > 0 ? (
              <Button
                type="button"
                variant="ghost"
                className="gap-2"
                onClick={() => setStep(step - 1)}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {t("careers.form.back")}
              </Button>
            ) : null}
            {step < LAST_STEP ? (
              <Button type="submit" className="gap-2">
                {t("careers.form.next")}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            ) : (
              <SubscribeButton
                className="gap-2"
                loading={sending}
                loadingLabel={t("careers.form.sending")}
              >
                <Send className="h-4 w-4" aria-hidden />
                {t("careers.form.submit")}
              </SubscribeButton>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
