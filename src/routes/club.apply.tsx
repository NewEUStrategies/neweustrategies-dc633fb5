// /club/apply - jeden formularz zgłoszeniowy dla wszystkich specjalizacji.
//
// Wzorzec z FT Live "Apply to join": jedna strona, wszystkie pola w siatce,
// specjalizacja wybierana z listy rozwijanej (wstępnie ustawiona parametrem
// `?spec=`, gdy wejście nastąpiło ze strony specjalizacji). Zgłoszenie idzie
// tą samą, zahartowaną ścieżką co formularz kontaktowy (rate limit, zod,
// tenant scope, CRM) - nie budujemy drugiego kanału wiadomości.
import { useState } from "react";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { submitContactMessage } from "@/lib/contact.functions";
import { FloatingInput, FloatingTextarea } from "@/components/ui/floating-input";
import { FormSelect } from "@/components/atoms/FormSelect";
import { Checkbox } from "@/components/ui/checkbox";
import { SubscribeButton } from "@/components/ui/subscribe-button";
import { CLUB_SPECIALIZATIONS, findClubSpecialization } from "@/lib/clubs/specializations";
import {
  clubApplyValid,
  validateClubApply,
  type ClubApplyErrors,
  type ClubApplyField,
} from "@/lib/clubs/applyValidation";
import { ensureClubI18n } from "@/lib/i18n-club";

interface ApplySearch {
  spec?: string;
}

export const Route = createFileRoute("/club/apply")({
  validateSearch: (raw: Record<string, unknown>): ApplySearch =>
    typeof raw.spec === "string" && findClubSpecialization(raw.spec) !== null
      ? { spec: raw.spec }
      : {},
  head: () => {
    const title = "Zaaplikuj do klubu dyskusyjnego | New European Strategies";
    const description =
      "Zgłoś się do zamkniętego klubu dyskusyjnego ekspertów i decydentów. Wybierz specjalizację i wyślij aplikację.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: ClubApplyPage,
});

function ClubApplyPage() {
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = (i18n.language ?? "pl").startsWith("pl") ? "pl" : "en";
  const search = useSearch({ from: "/club/apply" });
  const submit = useServerFn(submitContactMessage);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    company: "",
    role: "",
    motivation: "",
  });
  const [spec, setSpec] = useState<string>(search.spec ?? "");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "ok">("idle");
  // Bledy pokazujemy DOPIERO po pierwszej probie wyslania (`submitted`), a potem
  // przeliczamy na kazda zmiane - inaczej pole krzyczy "za krotkie" przy
  // pierwszej wpisanej literze, co czyta sie jak awaria formularza.
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<ClubApplyErrors>({});

  const values = { ...form, specialization: spec, consent };
  const liveErrors = submitted ? validateClubApply(values) : errors;
  const errorText = (field: ClubApplyField): string | null => {
    const key = liveErrors[field];
    return key === undefined ? null : t(key);
  };
  // Podsumowanie nad formularzem: czytnik ekranu dostaje komplet bledow w jednym
  // miejscu, a osoba widzaca - liste odsyłaczy zamiast polowania na czerwone pola.
  const errorList = (Object.keys(liveErrors) as ClubApplyField[]).map((field) => ({
    field,
    message: t(liveErrors[field] as string),
  }));

  const options = CLUB_SPECIALIZATIONS.map((item) => ({
    value: item.slug,
    label: t(`club.spec.items.${item.key}.title`),
  }));

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    const found = validateClubApply(values);
    setErrors(found);
    if (!clubApplyValid(found)) {
      // Toast informuje, ze cos jest nie tak; SZCZEGOL zostaje przy polu.
      toast.error(t("club.spec.apply.errorsTitle"));
      return;
    }

    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const email = form.email.trim();

    const selected = findClubSpecialization(spec);
    const specLabel = selected === null ? spec : t(`club.spec.items.${selected.key}.title`);

    setStatus("sending");
    try {
      await submit({
        data: {
          name: `${firstName} ${lastName}`.trim(),
          firstName,
          ...(lastName === "" ? {} : { lastName }),
          email,
          ...(form.phone.trim() === "" ? {} : { phone: form.phone.trim() }),
          ...(form.company.trim() === "" ? {} : { company: form.company.trim() }),
          subject: `${t("club.spec.apply.title")}: ${specLabel}`,
          message: [
            `${t("club.spec.apply.specialization")}: ${specLabel}`,
            form.role.trim() === "" ? "" : `${t("club.spec.apply.role")}: ${form.role.trim()}`,
            form.motivation.trim(),
          ]
            .filter((line) => line !== "")
            .join("\n"),
          consent: true,
          lang,
          formId: "club-apply",
          formName: "Club application",
          source: typeof window === "undefined" ? undefined : window.location.pathname,
          pageUrl: typeof window === "undefined" ? undefined : window.location.href,
        },
      });
      setStatus("ok");
      setForm({
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        company: "",
        role: "",
        motivation: "",
      });
      setConsent(false);
      setSubmitted(false);
      setErrors({});
      toast.success(t("club.spec.apply.ok"));
    } catch {
      setStatus("idle");
      toast.error(t("club.spec.apply.error"));
    }
  };

  return (
    <div className="club-prestige mx-auto w-full max-w-[1100px] px-3 py-6 sm:px-5 lg:px-8">
      <header
        className="rounded-md border p-6 md:p-10"
        style={{ background: "var(--cp-surface)", borderColor: "var(--cp-line)" }}
      >
        <Link
          to="/club"
          className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.28em]"
          style={{ color: "var(--cp-muted)" }}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {t("club.backToHub")}
        </Link>
        <h1
          className="mt-6 font-display text-3xl font-black leading-tight tracking-tight md:text-4xl"
          style={{ color: "var(--cp-ink)" }}
        >
          {t("club.spec.apply.title")}
        </h1>
        <p className="mt-3 text-sm" style={{ color: "var(--cp-muted)" }}>
          {t("club.spec.apply.lead")}
        </p>
      </header>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {errorList.length > 0 ? (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm"
          >
            <p className="font-semibold text-destructive">{t("club.spec.apply.errorsTitle")}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-destructive">
              {errorList.map((item) => (
                <li key={item.field}>{item.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <FloatingInput
            label={t("club.spec.apply.firstName")}
            error={errorText("firstName")}
            required
            autoComplete="given-name"
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
          <FloatingInput
            label={t("club.spec.apply.lastName")}
            error={errorText("lastName")}
            autoComplete="family-name"
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
          <FloatingInput
            label={t("club.spec.apply.email")}
            error={errorText("email")}
            required
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <FloatingInput
            label={t("club.spec.apply.company")}
            error={errorText("company")}
            autoComplete="organization"
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
          />
          <FloatingInput
            label={t("club.spec.apply.role")}
            error={errorText("role")}
            autoComplete="organization-title"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          />
          <FloatingInput
            label={t("club.spec.apply.phone")}
            error={errorText("phone")}
            type="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium" style={{ color: "var(--cp-ink)" }}>
            {t("club.spec.apply.specialization")}
          </p>
          <FormSelect
            value={spec}
            onValueChange={setSpec}
            options={options}
            required
            placeholder={t("club.spec.apply.specializationPlaceholder")}
            aria-label={t("club.spec.apply.specialization")}
          />
          {errorText("specialization") !== null ? (
            <p className="mt-1.5 pl-1 text-xs text-destructive" role="alert">
              {errorText("specialization")}
            </p>
          ) : null}
        </div>

        <FloatingTextarea
          rows={5}
          label={t("club.spec.apply.motivation")}
          error={errorText("motivation")}
          value={form.motivation}
          onChange={(e) => setForm({ ...form, motivation: e.target.value })}
        />
        <p className="-mt-2 pl-1 text-xs" style={{ color: "var(--cp-muted)" }}>
          {t("club.spec.apply.motivationHint")}
        </p>

        <label className="flex items-start gap-3 text-sm" style={{ color: "var(--cp-muted)" }}>
          <Checkbox
            checked={consent}
            onCheckedChange={(next) => setConsent(next === true)}
            aria-label={t("club.spec.apply.consent")}
          />
          <span>
            {t("club.spec.apply.consent")}
            {errorText("consent") !== null ? (
              <span className="mt-1 block text-xs text-destructive" role="alert">
                {errorText("consent")}
              </span>
            ) : null}
          </span>
        </label>

        <SubscribeButton
          type="submit"
          loading={status === "sending"}
          loadingLabel={t("club.spec.apply.sending")}
          disabled={status === "sending"}
        >
          {t("club.spec.apply.submit")}
        </SubscribeButton>
        <p role="status" aria-live="polite" className="sr-only">
          {status === "ok" ? t("club.spec.apply.ok") : ""}
        </p>
      </form>
    </div>
  );
}
