// "Dołącz do nas" / "Join us" widget. Combines newsletter signup with
// optional interests tagging so newly subscribed users immediately receive
// personalized recommendations. Every visible label / placeholder / perk is
// overridable via props so the widget can be fully configured from the CMS
// builder (see src/lib/builder/schemas.ts → "join-us"). Additional optional
// contact fields (first name, last name, LinkedIn position, phone, company,
// country) can be turned on per-instance; firstName/lastName are passed to
// the server function natively, the rest ride along in the `meta` map that
// newsletter_subscribers persists verbatim.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronDown, Loader2, UserPlus, X } from "lucide-react";
import { useNewsletterSettings } from "@/hooks/useNewsletterSettings";
import { subscribeToNewsletter } from "@/lib/newsletter.functions";
import { useInterestCatalog, useMyInterests } from "@/hooks/useInterests";
import { useBuilderMode } from "@/lib/builder/modeContext";
import { cn } from "@/lib/utils";
import {
  CustomFieldsRenderer,
  validateCustomFields,
  type CustomFieldDef,
} from "@/lib/builder/formFieldConfig";
import "@/lib/i18n-interests";

export interface JoinUsFormProps {
  variant?: "card" | "split" | "inline" | "split-image";
  showInterests?: boolean;
  /** Sposób wyboru zainteresowań: chips (przyciski) lub droplist (multiselect z listy rozwijanej). */
  interestsDisplay?: "chips" | "droplist";
  className?: string;
  source?: string;

  // --- Media (variant="split-image"): grafika po lewej, formularz po prawej.
  /** URL obrazu w lewej kolumnie. Puste = użyj gradientu fallback. */
  imageUrl?: string;
  /** Alt tekst PL (dostępność / SEO). */
  imageAlt?: string;
  /** Alt tekst EN (dostępność / SEO). */
  imageAltEn?: string;
  /** Fallback gradient (dowolna wartość CSS `background`), gdy brak imageUrl.
   *  Domyślnie: gradient bazujący na tokenach brandu. */
  imageGradient?: string;
  /** Nakładka przyciemniająca 0-100 (% opacity czarnej warstwy). */
  imageOverlay?: number;
  /** Focal point / kadrowanie obrazu (`object-position`), np. "center", "top", "50% 30%". */
  imagePosition?: string;
  /** Proporcje kadru (CSS `aspect-ratio`), np. "16/9", "4/3", "1/1", "3/4", "21/9".
   *  Pozostaw puste ("" lub "auto") żeby zachować wysokość dopasowaną do kolumny obok. */
  imageAspect?: string;
  /** Sposób dopasowania obrazu w kadrze (`object-fit`). Domyślnie "cover". */
  imageFit?: "cover" | "contain";



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

  /** Extra CMS-defined fields ("hybrid" mode). Values are forwarded to CRM
   *  under `aliases.custom.<id>` via the crm_upsert_from_form(_custom) RPC. */
  customFields?: CustomFieldDef[];

  // Font-size overrides (px). undefined = fallback to Tailwind defaults.
  titleSize?: number;
  descriptionSize?: number;
  perkSize?: number;
  labelSize?: number;
  placeholderSize?: number;
  buttonSize?: number;
  consentSize?: number;
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
  interestsDisplay = "chips",
  className,
  source = "join-us",
  imageUrl,
  imageAlt,
  imageAltEn,
  imageGradient,
  imageOverlay = 0,
  imagePosition = "center",
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
  customFields,
  titleSize,
  descriptionSize,
  perkSize,
  labelSize,
  placeholderSize,
  buttonSize,
  consentSize,
}: JoinUsFormProps) {

  const { t, i18n } = useTranslation();
  const lang = (i18n.language?.startsWith("en") ? "en" : "pl") as "pl" | "en";
  const { data: nl } = useNewsletterSettings();
  const catalog = useInterestCatalog(lang);
  const my = useMyInterests();
  const subscribe = useServerFn(subscribeToNewsletter);
  // Non-null only inside the CMS builder canvas (BuilderModeProvider). In the
  // builder the widget must NEVER unmount to null — otherwise disabling the
  // newsletter in settings makes it silently vanish from the canvas.
  const inBuilder = useBuilderMode() !== null;

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
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!dropOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [dropOpen]);
  const cfList = customFields ?? [];
  const setCustom = (id: string, v: string) =>
    setCustomValues((prev) => ({ ...prev, [id]: v }));

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

  const newsletterDisabled = !!nl && !nl.enabled;
  if (newsletterDisabled && !inBuilder) return null;

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
    const missingCustom = validateCustomFields(cfList, customValues);
    if (missingCustom.length) {
      setErrMsg(
        lang === "en"
          ? `Please fill in required fields: ${missingCustom.join(", ")}`
          : `Uzupełnij wymagane pola: ${missingCustom.join(", ")}`,
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

      // Custom fields → forwarded to CRM under aliases.custom.<id>.
      const custom: Record<string, string> = {};
      for (const f of cfList) {
        const v = (customValues[f.id] ?? "").trim();
        if (v) custom[f.id] = v.slice(0, 500);
      }

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
          custom: Object.keys(custom).length ? custom : undefined,
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
    setCustomValues({});
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
    (variant === "inline"
      ? "border-t border-b border-border py-6"
      : variant === "split"
        ? "grid gap-6 rounded-xl border border-border bg-card p-6 sm:p-8 md:grid-cols-2"
        : variant === "split-image"
          ? "grid gap-0 overflow-hidden rounded-xl border border-border bg-card md:grid-cols-2"
          : "rounded-xl border border-border bg-card p-6 sm:p-8") +
    ` join-us-shell join-us-shell--${variant}`;


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
    "h-10 px-3 rounded border border-input bg-background font-sans leading-none w-full";
  const inputStyle = placeholderSize
    ? ({ fontSize: `${placeholderSize}px` } satisfies CSSProperties)
    : ({ fontSize: "14px" } satisfies CSSProperties);
  const droplistButtonStyle = placeholderSize
    ? ({ fontSize: `${placeholderSize}px` } satisfies CSSProperties)
    : undefined;
  const chipStyle = labelSize
    ? ({ fontSize: `${labelSize}px` } satisfies CSSProperties)
    : undefined;
  // Only annotate labels/placeholders with "*" inside the CMS builder canvas —
  // public visitors never see which fields are required until they submit and
  // the server/client validation reports what is missing.
  const withMark = (label: string, req: boolean) => (req && inBuilder ? `${label} *` : label);


  // Build the ordered list of "extra row" fields (email in split mode + optional contact fields).
  // Rendered into a single 2-col grid; when the count is odd, the last item spans both columns
  // so no empty cell remains.
  const extraFields: ReactNode[] = [];
  if (useSplitName) {
    extraFields.push(
      <input
        key="email"
        type="email"
        required={requireEmail}
        aria-required={requireEmail || undefined}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={withMark(phEmail, requireEmail)}
        maxLength={254}
        className={inputCls}
        style={inputStyle}
        data-edit-target="placeholderSize"
        autoComplete="email"
      />,
    );
  }
  if (showPosition) {
    extraFields.push(
      <input
        key="position"
        type="text"
        value={extra.position}
        onChange={(e) => updateExtra("position", e.target.value)}
        placeholder={withMark(phPosition, requirePosition)}
        aria-required={requirePosition || undefined}
        required={requirePosition}
        maxLength={200}
        className={inputCls}
        style={inputStyle}
        data-edit-target="placeholderSize"
        autoComplete="organization-title"
      />,
    );
  }
  if (showLinkedin) {
    extraFields.push(
      <input
        key="linkedin"
        type="url"
        value={extra.linkedin}
        onChange={(e) => updateExtra("linkedin", e.target.value)}
        placeholder={withMark(phLinkedin, requireLinkedin)}
        aria-required={requireLinkedin || undefined}
        required={requireLinkedin}
        maxLength={300}
        className={inputCls}
        style={inputStyle}
        data-edit-target="placeholderSize"
        autoComplete="url"
      />,
    );
  }
  if (showPhone) {
    extraFields.push(
      <input
        key="phone"
        type="tel"
        value={extra.phone}
        onChange={(e) => updateExtra("phone", e.target.value)}
        placeholder={withMark(phPhone, requirePhone)}
        aria-required={requirePhone || undefined}
        required={requirePhone}
        maxLength={40}
        className={inputCls}
        style={inputStyle}
        data-edit-target="placeholderSize"
        autoComplete="tel"
      />,
    );
  }
  if (showCompany) {
    extraFields.push(
      <input
        key="company"
        type="text"
        value={extra.company}
        onChange={(e) => updateExtra("company", e.target.value)}
        placeholder={withMark(phCompany, requireCompany)}
        aria-required={requireCompany || undefined}
        required={requireCompany}
        maxLength={200}
        className={inputCls}
        style={inputStyle}
        data-edit-target="placeholderSize"
        autoComplete="organization"
      />,
    );
  }
  if (showCountry) {
    extraFields.push(
      <input
        key="country"
        type="text"
        value={extra.country}
        onChange={(e) => updateExtra("country", e.target.value)}
        placeholder={withMark(phCountry, requireCountry)}
        aria-required={requireCountry || undefined}
        required={requireCountry}
        maxLength={100}
        className={inputCls}
        style={inputStyle}
        data-edit-target="placeholderSize"
        autoComplete="country-name"
      />,
    );
  }

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
              style={inputStyle}
              data-edit-target="placeholderSize"
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
              style={inputStyle}
              data-edit-target="placeholderSize"
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
            style={inputStyle}
            data-edit-target="placeholderSize"
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
            style={inputStyle}
            data-edit-target="placeholderSize"
            autoComplete="email"
          />
        </div>
      )}

      {extraFields.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {extraFields.map((el, i) => {
            const isLastOdd =
              i === extraFields.length - 1 && extraFields.length % 2 === 1;
            return isLastOdd ? (
              <div key={`wrap-${i}`} className="sm:col-span-2">
                {el}
              </div>
            ) : (
              el
            );
          })}
        </div>
      )}


      {cfList.length > 0 && (
        <CustomFieldsRenderer
          fields={cfList}
          values={customValues}
          onChange={setCustom}
          lang={lang}
          inputClassName={inputCls}
          inputStyle={inputStyle}
          inputEditTarget="placeholderSize"
        />
      )}

      {showInterests && allItems.length > 0 && (
        <div>
          <p
            className="mb-2 font-sans font-semibold uppercase tracking-wider text-muted-foreground"
            style={{ fontSize: labelSize ? `${labelSize}px` : "12px" }}
            data-edit-target="labelSize"
          >
            {iLabel}
            {requireInterests && inBuilder && <span className="ml-1 text-destructive">*</span>}
          </p>


          {interestsDisplay === "droplist" ? (
            <div className="space-y-2">
              {/* Selected pills row */}
              {picked.size > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {allItems
                    .filter((it) => picked.has(it.id))
                    .map((it) => (
                      <span
                        key={`sel:${it.type}:${it.id}`}
                        className="inline-flex items-center gap-1 rounded-full border border-brand bg-brand px-2.5 py-1 text-xs text-brand-foreground"
                      >
                        {it.label}
                        <button
                          type="button"
                          onClick={() => togglePick(it.id)}
                          aria-label={
                            lang === "en" ? `Remove ${it.label}` : `Usuń ${it.label}`
                          }
                          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full hover:opacity-80"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                </div>
              )}

              {/* Dropdown trigger + menu */}
              <div ref={dropRef} className="relative">
                <button
                  type="button"
                  onClick={() => setDropOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={dropOpen}
                  className="flex w-full items-center justify-between rounded border border-input bg-background px-3 py-2 text-sm text-left"
                  style={droplistButtonStyle}
                  data-edit-target="placeholderSize"
                >
                  <span className={picked.size ? "text-foreground" : "text-muted-foreground"}>
                    {picked.size
                      ? lang === "en"
                        ? `${picked.size} selected`
                        : `Wybrano: ${picked.size}`
                      : lang === "en"
                        ? "Select topics…"
                        : "Wybierz tematy…"}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 opacity-60 transition-transform",
                      dropOpen && "rotate-180",
                    )}
                  />
                </button>

                {dropOpen && (
                  <div
                    role="listbox"
                    aria-multiselectable="true"
                    className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded border border-border bg-popover p-1 shadow-lg"
                  >
                    {allItems.map((it) => {
                      const active = picked.has(it.id);
                      return (
                        <button
                          key={`opt:${it.type}:${it.id}`}
                          type="button"
                          role="option"
                          aria-selected={active}
                          onClick={() => togglePick(it.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition hover:bg-accent",
                            active && "text-brand",
                          )}
                        >
                          <span
                            className={cn(
                              "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                              active
                                ? "border-brand bg-brand text-brand-foreground"
                                : "border-input bg-background",
                            )}
                          >
                            {active && <Check className="h-2.5 w-2.5" />}
                          </span>
                          <span className="flex-1">{it.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
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
                    style={chipStyle}
                  >
                    {it.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}


      <button
        type="submit"
        disabled={state === "loading"}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded bg-brand px-4 py-0 font-sans font-semibold leading-none text-brand-foreground transition hover:opacity-90 disabled:opacity-60 sm:w-auto"
        style={{ fontSize: buttonSize ? `${buttonSize}px` : "14px" }}
        data-edit-target="buttonSize"
      >
        {state === "loading" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <UserPlus className="w-4 h-4" />
        )}
        {state === "loading" ? btnLoading : btnLabel}
      </button>

      {state === "err" && errMsg && <p className="text-xs text-destructive">{errMsg}</p>}
      <p
        className="font-sans leading-relaxed text-muted-foreground"
        style={{ fontSize: consentSize ? `${consentSize}px` : "11px" }}
        data-edit-target="consentSize"
      >
        {consent}
      </p>
    </form>
  );



  const titleStyle = titleSize ? { fontSize: `${titleSize}px` } : undefined;
  const descStyle = { fontSize: descriptionSize ? `${descriptionSize}px` : "14px" } as const;
  const perkStyle = { fontSize: perkSize ? `${perkSize}px` : "14px" } as const;

  // Builder-only: keep the widget visible and explain why it is hidden on the
  // public site instead of rendering nothing.
  const disabledNotice =
    newsletterDisabled && inBuilder ? (
      <p
        role="status"
        className="mb-3 rounded border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-600"
      >
        Newsletter jest wyłączony w ustawieniach — ten widget nie wyświetla się na stronie.
      </p>
    ) : null;

  if (variant === "split") {
    return (
      <section className={cn(containerCls, className)} aria-labelledby="joinus-heading">
        {disabledNotice && <div className="md:col-span-2">{disabledNotice}</div>}
        <div>
          <h3
            id="joinus-heading"
            className={cn("font-display mb-2", !titleSize && "text-2xl")}
            style={titleStyle}
            data-edit-target="titleSize"
          >
            {heading}
          </h3>
          <p
            className="font-sans text-muted-foreground mb-4"
            style={descStyle}
            data-edit-target="descriptionSize"
          >
            {description}
          </p>
          <ul
            className="join-us-perks flex flex-col gap-2 font-sans"
            style={perkStyle}
            data-edit-target="perkSize"
          >
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 mt-0.5 text-brand shrink-0" />
              <span>{p1}</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 mt-0.5 text-brand shrink-0" />
              <span>{p2}</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 mt-0.5 text-brand shrink-0" />
              <span>{p3}</span>
            </li>
          </ul>
        </div>
        <div>{form}</div>
      </section>
    );
  }

  if (variant === "split-image") {
    const altText = (lang === "en" ? imageAltEn : imageAlt) || imageAlt || imageAltEn || "";
    const fallbackGradient =
      imageGradient ||
      "linear-gradient(135deg, color-mix(in oklab, var(--color-brand, #2563eb) 90%, transparent) 0%, color-mix(in oklab, var(--color-brand, #2563eb) 40%, #0f172a) 100%)";
    const overlayAlpha = Math.min(100, Math.max(0, imageOverlay)) / 100;
    return (
      <section className={cn(containerCls, className)} aria-labelledby="joinus-heading">
        {disabledNotice && <div className="md:col-span-2 p-4">{disabledNotice}</div>}
        {/* Lewa kolumna: obraz + gradient fallback + overlay + kontent tekstowy */}
        <div
          className="relative min-h-[220px] md:min-h-[380px] overflow-hidden"
          style={!imageUrl ? { background: fallbackGradient } : undefined}
        >
          {imageUrl && (
            <img
              src={imageUrl}
              alt={altText}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition: imagePosition }}
            />
          )}
          {overlayAlpha > 0 && (
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{ backgroundColor: `rgba(0,0,0,${overlayAlpha})` }}
            />
          )}
          <div className="relative flex h-full flex-col justify-end gap-3 p-6 sm:p-8 text-white">
            <h3
              id="joinus-heading"
              className={cn("font-display drop-shadow-md", !titleSize && "text-2xl")}
              style={titleStyle}
              data-edit-target="titleSize"
            >
              {heading}
            </h3>
            {description && (
              <p
                className="font-sans text-white/90 drop-shadow"
                style={descStyle}
                data-edit-target="descriptionSize"
              >
                {description}
              </p>
            )}
            <ul
              className="join-us-perks flex flex-col gap-2 font-sans text-white/95"
              style={perkStyle}
              data-edit-target="perkSize"
            >
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 mt-0.5 text-white shrink-0" />
                <span>{p1}</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 mt-0.5 text-white shrink-0" />
                <span>{p2}</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 mt-0.5 text-white shrink-0" />
                <span>{p3}</span>
              </li>
            </ul>
          </div>
        </div>
        {/* Prawa kolumna: formularz */}
        <div className="p-6 sm:p-8">{form}</div>
      </section>
    );
  }




  return (
    <section className={cn(containerCls, className)} aria-labelledby="joinus-heading">
      {disabledNotice}
      <h3
        id="joinus-heading"
        className={cn("font-display mb-2", !titleSize && "text-2xl")}
        style={titleStyle}
        data-edit-target="titleSize"
      >
        {heading}
      </h3>
      {description && (
        <p
          className="font-sans text-muted-foreground mb-4"
          style={descStyle}
          data-edit-target="descriptionSize"
        >
          {description}
        </p>
      )}
      {form}
    </section>
  );
}

