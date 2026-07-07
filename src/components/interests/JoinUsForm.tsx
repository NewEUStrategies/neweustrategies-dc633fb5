// "Dołącz do nas" / "Join us" widget. Combines newsletter signup with
// optional interests tagging so newly subscribed users immediately receive
// personalized recommendations. Every visible label / placeholder / perk is
// overridable via props so the widget can be fully configured from the CMS
// builder (see src/lib/builder/schemas.ts → "join-us"). Additional optional
// contact fields (first name, last name, LinkedIn position, phone, company,
// country) can be turned on per-instance; firstName/lastName are passed to
// the server function natively, the rest ride along in the `meta` map that
// newsletter_subscribers persists verbatim.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, UserPlus } from "lucide-react";
import { useNewsletterSettings } from "@/hooks/useNewsletterSettings";
import { subscribeToNewsletter } from "@/lib/newsletter.functions";
import { useInterestCatalog, useMyInterests } from "@/hooks/useInterests";
import { cn } from "@/lib/utils";
import {
  CustomFieldsRenderer,
  validateCustomFields,
  type CustomFieldDef,
} from "@/lib/builder/formFieldConfig";
import "@/lib/i18n-interests";

export interface JoinUsFormProps {
  variant?: "card" | "split" | "inline";
  showInterests?: boolean;
  className?: string;
  source?: string;

  // Headings / copy
  title?: string;
  subtitle?: string;
  perk1?: string;
  perk2?: string;
  perk3?: string;
  interestsLabel?: string;
  submitLabel?: string;
  submittingLabel?: string;
  consentText?: string;
  successText?: string;

  // Core inputs (always visible)
  namePlaceholder?: string;
  emailPlaceholder?: string;

  // Optional extra fields
  showFirstName?: boolean;
  showLastName?: boolean;
  showPosition?: boolean;
  showLinkedin?: boolean;
  showPhone?: boolean;
  showCompany?: boolean;
  showCountry?: boolean;

  // Per-field "wymagane" toggles - kontrolowane w builderze, egzekwowane
  // dodatkowo po stronie serwera przez enforce_form_field_policy().
  requireFirstName?: boolean;
  requireLastName?: boolean;
  requireEmail?: boolean;
  requirePosition?: boolean;
  requireLinkedin?: boolean;
  requirePhone?: boolean;
  requireCompany?: boolean;
  requireCountry?: boolean;
  requireInterests?: boolean;

  // Optional curated allow-list of interests to show as chips (category or
  // tag slugs). When empty/undefined - all catalog items are shown.
  interestSlugs?: string[];

  firstNamePlaceholder?: string;
  lastNamePlaceholder?: string;
  positionPlaceholder?: string;
  linkedinPlaceholder?: string;
  phonePlaceholder?: string;
  companyPlaceholder?: string;
  countryPlaceholder?: string;
}


type ExtraKey =
  | "firstName"
  | "lastName"
  | "position"
  | "linkedin"
  | "phone"
  | "company"
  | "country";

export function JoinUsForm({
  variant = "card",
  showInterests = true,
  className,
  source = "join-us",
  title,
  subtitle,
  perk1,
  perk2,
  perk3,
  interestsLabel,
  submitLabel,
  submittingLabel,
  consentText,
  successText,
  namePlaceholder,
  emailPlaceholder,
  showFirstName = false,
  showLastName = false,
  showPosition = false,
  showLinkedin = false,
  showPhone = false,
  showCompany = false,
  showCountry = false,
  requireFirstName = false,
  requireLastName = false,
  requireEmail = true,
  requirePosition = false,
  requireLinkedin = false,
  requirePhone = false,
  requireCompany = false,
  requireCountry = false,
  requireInterests = false,
  interestSlugs,
  firstNamePlaceholder,
  lastNamePlaceholder,
  positionPlaceholder,
  linkedinPlaceholder,
  phonePlaceholder,
  companyPlaceholder,
  countryPlaceholder,
}: JoinUsFormProps) {

  const { t, i18n } = useTranslation();
  const lang = (i18n.language?.startsWith("en") ? "en" : "pl") as "pl" | "en";
  const { data: nl } = useNewsletterSettings();
  const catalog = useInterestCatalog(lang);
  const my = useMyInterests();
  const subscribe = useServerFn(subscribeToNewsletter);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [extra, setExtra] = useState<Record<ExtraKey, string>>({
    firstName: "",
    lastName: "",
    position: "",
    linkedin: "",
    phone: "",
    company: "",
    country: "",
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const useSplitName = showFirstName || showLastName;

  useEffect(() => {
    if (!my.data) return;
    setPicked(new Set([...my.data.categoryIds, ...my.data.tagIds]));
  }, [my.data]);

  const allItems = useMemo(() => {
    const cats = catalog.data?.categories ?? [];
    const tags = catalog.data?.tags ?? [];
    const all = [...cats, ...tags];
    const allow = (interestSlugs ?? [])
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!allow.length) return all;
    const set = new Set(allow);
    return all.filter((it) => set.has(it.slug.toLowerCase()));
  }, [catalog.data, interestSlugs]);


  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (nl && !nl.enabled) return null;

  const updateExtra = (k: ExtraKey, v: string) =>
    setExtra((prev) => ({ ...prev, [k]: v }));

  // Client-side "wymagane" enforcement — mirror of the server-side policy.
  const requiredMap: Record<string, boolean> = {
    firstName: showFirstName && requireFirstName,
    lastName: showLastName && requireLastName,
    email: requireEmail,
    position: showPosition && requirePosition,
    linkedin: showLinkedin && requireLinkedin,
    phone: showPhone && requirePhone,
    company: showCompany && requireCompany,
    country: showCountry && requireCountry,
  };
  const requiredFields = Object.entries(requiredMap)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("loading");
    setErrMsg(null);

    const trimmed = email.trim().toLowerCase();
    if (requireEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setErrMsg(t("joinUs.errorEmail"));
      setState("err");
      return;
    }

    const firstName = showFirstName ? extra.firstName.trim() : "";
    const lastName = showLastName ? extra.lastName.trim() : "";

    // Client-side "required" verification (server re-checks).
    const values: Record<string, string> = {
      firstName,
      lastName,
      email: trimmed,
      position: extra.position.trim(),
      linkedin: extra.linkedin.trim(),
      phone: extra.phone.trim(),
      company: extra.company.trim(),
      country: extra.country.trim(),
    };
    const missing = requiredFields.filter((k) => !values[k]);
    if (missing.length) {
      setErrMsg(
        lang === "en"
          ? `Please fill in required fields: ${missing.join(", ")}`
          : `Uzupełnij wymagane pola: ${missing.join(", ")}`,
      );
      setState("err");
      return;
    }
    if (showInterests && requireInterests && allItems.length > 0 && picked.size === 0) {
      setErrMsg(
        lang === "en"
          ? "Please pick at least one topic."
          : "Wybierz co najmniej jeden temat.",
      );
      setState("err");
      return;
    }


    try {
      const nlText =
        lang === "en"
          ? "I subscribe to the newsletter and accept receiving marketing messages."
          : "Zapisuję się do newslettera i akceptuję otrzymywanie wiadomości marketingowych.";

      // Extras with no first-class column go into meta (persisted verbatim
      // in newsletter_subscribers.meta by the server fn).
      const meta: Record<string, string> = {};
      if (showPosition && values.position) meta.position = values.position.slice(0, 500);
      if (showLinkedin && values.linkedin) meta.linkedin = values.linkedin.slice(0, 500);
      if (showPhone && values.phone) meta.phone = values.phone.slice(0, 500);
      if (showCompany && values.company) meta.company = values.company.slice(0, 500);
      if (showCountry && values.country) meta.country = values.country.slice(0, 500);

      const combinedName = useSplitName
        ? [firstName, lastName].filter(Boolean).join(" ")
        : name.trim();

      const res = await subscribe({
        data: {
          email: trimmed,
          name: combinedName || undefined,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          language: lang,
          source,
          consents: [{ key: "newsletter", text: nlText, given: true, lang }],
          meta: Object.keys(meta).length ? meta : undefined,
          requiredFields,
          formType: "join_us",
        },
      });

      if (!res.ok) {
        setErrMsg(
          res.error === "not_configured" || res.error === "disabled"
            ? t("joinUs.errorGeneric")
            : res.error,
        );
        setState("err");
        return;
      }
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : t("joinUs.errorGeneric"));
      setState("err");
      return;
    }


    if (showInterests && allItems.length) {
      const catIds = new Set(catalog.data?.categories.map((c) => c.id) ?? []);
      const tagIds = new Set(catalog.data?.tags.map((c) => c.id) ?? []);
      const nextCats: string[] = [];
      const nextTags: string[] = [];
      picked.forEach((id) => {
        if (catIds.has(id)) nextCats.push(id);
        else if (tagIds.has(id)) nextTags.push(id);
      });
      try {
        await my.save({ categoryIds: nextCats, tagIds: nextTags });
      } catch {
        /* non-fatal */
      }
    }

    setState("ok");
    setEmail("");
    setName("");
    setExtra({
      firstName: "",
      lastName: "",
      position: "",
      linkedin: "",
      phone: "",
      company: "",
      country: "",
    });
  };

  // Resolved copy (props override → newsletter settings → i18n default)
  const heading = title || (lang === "en" ? nl?.heading_en : nl?.heading_pl) || t("joinUs.title");
  const description =
    subtitle || (lang === "en" ? nl?.description_en : nl?.description_pl) || t("joinUs.subtitle");
  const p1 = perk1 || t("joinUs.perk1");
  const p2 = perk2 || t("joinUs.perk2");
  const p3 = perk3 || t("joinUs.perk3");
  const iLabel = interestsLabel || t("joinUs.interestsLabel");
  const btnLabel = submitLabel || t("joinUs.submit");
  const btnLoading = submittingLabel || t("joinUs.submitting");
  const consent = consentText || t("joinUs.consent");
  const okText = successText || t("joinUs.success");
  const phName = namePlaceholder || t("joinUs.name");
  const phEmail = emailPlaceholder || t("joinUs.email");
  const phFirst =
    firstNamePlaceholder || (lang === "en" ? "First name" : "Imię");
  const phLast = lastNamePlaceholder || (lang === "en" ? "Last name" : "Nazwisko");
  const phPosition =
    positionPlaceholder || (lang === "en" ? "Position (LinkedIn)" : "Stanowisko (LinkedIn)");
  const phLinkedin =
    linkedinPlaceholder || (lang === "en" ? "LinkedIn profile URL" : "Adres profilu LinkedIn");
  const phPhone = phonePlaceholder || (lang === "en" ? "Phone" : "Telefon");
  const phCompany = companyPlaceholder || (lang === "en" ? "Company" : "Firma");
  const phCountry = countryPlaceholder || (lang === "en" ? "Country" : "Kraj");

  const containerCls =
    variant === "inline"
      ? "border-t border-b border-border py-6"
      : variant === "split"
        ? "grid gap-6 rounded-xl border border-border bg-card p-6 sm:p-8 md:grid-cols-2"
        : "rounded-xl border border-border bg-card p-6 sm:p-8";

  if (state === "ok") {
    return (
      <section className={cn(containerCls, className)} aria-live="polite">
        <div className="flex items-center gap-3 text-foreground">
          <Check className="w-5 h-5 text-emerald-500" />
          <p className="text-sm font-medium">{okText}</p>
        </div>
      </section>
    );
  }

  const inputCls =
    "px-3 py-2 rounded border border-input bg-background text-sm w-full";
  const withMark = (label: string, req: boolean) => (req ? `${label} *` : label);

  const form = (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {useSplitName ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {showFirstName && (
            <input
              type="text"
              value={extra.firstName}
              onChange={(e) => updateExtra("firstName", e.target.value)}
              placeholder={withMark(phFirst, requireFirstName)}
              aria-required={requireFirstName || undefined}
              required={requireFirstName}
              maxLength={100}
              className={inputCls}
              autoComplete="given-name"
            />
          )}
          {showLastName && (
            <input
              type="text"
              value={extra.lastName}
              onChange={(e) => updateExtra("lastName", e.target.value)}
              placeholder={withMark(phLast, requireLastName)}
              aria-required={requireLastName || undefined}
              required={requireLastName}
              maxLength={100}
              className={inputCls}
              autoComplete="family-name"
            />
          )}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={phName}
            maxLength={120}
            className={inputCls}
            autoComplete="name"
          />
          <input
            type="email"
            required={requireEmail}
            aria-required={requireEmail || undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={withMark(phEmail, requireEmail)}
            maxLength={254}
            className={inputCls}
            autoComplete="email"
          />
        </div>
      )}

      {useSplitName && (
        <input
          type="email"
          required={requireEmail}
          aria-required={requireEmail || undefined}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={withMark(phEmail, requireEmail)}
          maxLength={254}
          className={inputCls}
          autoComplete="email"
        />
      )}

      {(showPosition || showLinkedin || showPhone || showCompany || showCountry) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {showPosition && (
            <input
              type="text"
              value={extra.position}
              onChange={(e) => updateExtra("position", e.target.value)}
              placeholder={withMark(phPosition, requirePosition)}
              aria-required={requirePosition || undefined}
              required={requirePosition}
              maxLength={200}
              className={inputCls}
              autoComplete="organization-title"
            />
          )}
          {showLinkedin && (
            <input
              type="url"
              value={extra.linkedin}
              onChange={(e) => updateExtra("linkedin", e.target.value)}
              placeholder={withMark(phLinkedin, requireLinkedin)}
              aria-required={requireLinkedin || undefined}
              required={requireLinkedin}
              maxLength={300}
              className={inputCls}
              autoComplete="url"
            />
          )}
          {showPhone && (
            <input
              type="tel"
              value={extra.phone}
              onChange={(e) => updateExtra("phone", e.target.value)}
              placeholder={withMark(phPhone, requirePhone)}
              aria-required={requirePhone || undefined}
              required={requirePhone}
              maxLength={40}
              className={inputCls}
              autoComplete="tel"
            />
          )}
          {showCompany && (
            <input
              type="text"
              value={extra.company}
              onChange={(e) => updateExtra("company", e.target.value)}
              placeholder={withMark(phCompany, requireCompany)}
              aria-required={requireCompany || undefined}
              required={requireCompany}
              maxLength={200}
              className={inputCls}
              autoComplete="organization"
            />
          )}
          {showCountry && (
            <input
              type="text"
              value={extra.country}
              onChange={(e) => updateExtra("country", e.target.value)}
              placeholder={withMark(phCountry, requireCountry)}
              aria-required={requireCountry || undefined}
              required={requireCountry}
              maxLength={100}
              className={inputCls}
              autoComplete="country-name"
            />
          )}
        </div>
      )}



      {showInterests && allItems.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {iLabel}
            {requireInterests && <span className="ml-1 text-destructive">*</span>}
          </p>

          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-auto pr-1">
            {allItems.map((it) => {
              const active = picked.has(it.id);
              return (
                <button
                  key={`${it.type}:${it.id}`}
                  type="button"
                  onClick={() => togglePick(it.id)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition",
                    active
                      ? "border-brand bg-brand text-brand-foreground"
                      : "border-border bg-background hover:border-brand/60",
                  )}
                >
                  {it.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={state === "loading"}
        className="inline-flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground transition hover:opacity-90 disabled:opacity-60 sm:w-auto"
      >
        {state === "loading" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <UserPlus className="w-4 h-4" />
        )}
        {state === "loading" ? btnLoading : btnLabel}
      </button>

      {state === "err" && errMsg && <p className="text-xs text-destructive">{errMsg}</p>}
      <p className="text-[11px] leading-relaxed text-muted-foreground">{consent}</p>
    </form>
  );

  if (variant === "split") {
    return (
      <section className={cn(containerCls, className)} aria-labelledby="joinus-heading">
        <div>
          <h3 id="joinus-heading" className="font-display text-2xl mb-2">
            {heading}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">{description}</p>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 mt-0.5 text-brand" />
              {p1}
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 mt-0.5 text-brand" />
              {p2}
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 mt-0.5 text-brand" />
              {p3}
            </li>
          </ul>
        </div>
        <div>{form}</div>
      </section>
    );
  }

  return (
    <section className={cn(containerCls, className)} aria-labelledby="joinus-heading">
      <h3 id="joinus-heading" className="font-display text-2xl mb-2">
        {heading}
      </h3>
      {description && <p className="text-sm text-muted-foreground mb-4">{description}</p>}
      {form}
    </section>
  );
}
