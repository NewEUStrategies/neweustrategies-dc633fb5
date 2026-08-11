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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const options = CLUB_SPECIALIZATIONS.map((item) => ({
    value: item.slug,
    label: t(`club.spec.items.${item.key}.title`),
  }));

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const email = form.email.trim();
    if (firstName === "" || email === "" || spec === "") {
      toast.error(t("club.spec.apply.required"));
      return;
    }
    if (!EMAIL_RE.test(email)) {
      toast.error(t("club.spec.apply.invalidEmail"));
      return;
    }
    if (!consent) {
      toast.error(t("club.spec.apply.consentRequired"));
      return;
    }

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
        <div className="grid gap-4 md:grid-cols-3">
          <FloatingInput
            label={t("club.spec.apply.firstName")}
            required
            autoComplete="given-name"
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
          <FloatingInput
            label={t("club.spec.apply.lastName")}
            autoComplete="family-name"
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
          <FloatingInput
            label={t("club.spec.apply.email")}
            required
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <FloatingInput
            label={t("club.spec.apply.company")}
            autoComplete="organization"
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
          />
          <FloatingInput
            label={t("club.spec.apply.role")}
            autoComplete="organization-title"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          />
          <FloatingInput
            label={t("club.spec.apply.phone")}
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
        </div>

        <FloatingTextarea
          rows={5}
          label={t("club.spec.apply.motivation")}
          value={form.motivation}
          onChange={(e) => setForm({ ...form, motivation: e.target.value })}
        />

        <label className="flex items-start gap-3 text-sm" style={{ color: "var(--cp-muted)" }}>
          <Checkbox
            checked={consent}
            onCheckedChange={(next) => setConsent(next === true)}
            aria-label={t("club.spec.apply.consent")}
          />
          <span>{t("club.spec.apply.consent")}</span>
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
