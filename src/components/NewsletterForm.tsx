// Formularz zapisu do newslettera (publiczny). Zapis idzie przez serwerową
// funkcję subscribeToNewsletter (double opt-in + wysyłka maila potwierdzającego
// po stronie serwera); token potwierdzenia nigdy nie powstaje w przeglądarce.
//
// Opcjonalny `widgetConfig` pozwala nadpisywać etykiety / placeholdery per-pole,
// wymuszać pokazanie dodatkowych pól (imię/nazwisko/firma) oraz renderować
// custom fields zdefiniowane w builderze - całość leci do CRM przez server.
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import * as React from "react";
import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import "@/lib/i18n-public";
import { useBuilderMode } from "@/lib/content-model/editorCanvas";
import { useNewsletterSettings, type NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { subscribeToNewsletter } from "@/lib/newsletter.functions";
import {
  subscribeErrorMessage,
  subscribeErrorTitle,
  subscribeSuccessCopy,
  type SubscribeStatus,
} from "@/lib/newsletter/subscribeFeedback";
import { sanitizeHtml } from "@/lib/sanitize";
import { NewsletterDocRenderer } from "@/components/newsletter/NewsletterDocRenderer";
import { NewsletterSubscribedPanel } from "@/components/newsletter/NewsletterSubscribedPanel";
import { useMyNewsletterStatus } from "@/hooks/useMyNewsletterStatus";
import { SubscribeButton } from "@/components/ui/subscribe-button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormSelect } from "@/components/atoms/FormSelect";
import { floatingPlaceholder } from "@/components/ui/floating-input";
import { TopicsDroplist, useInterestGroups } from "@/components/interests/TopicsDroplist";
import { useNewsletterFieldLabels } from "@/lib/newsletter/newsletterFieldLabels";
import {
  collectCustomValues,
  parseCustomFields,
  pickLabel,
  pickPlaceholder,
  readI18nOverride,
  validateCustom,
  type CustomField,
} from "@/lib/content-model/formFields";

function BuilderInlineWrapper({
  settings,
  lang,
  source,
  variant,
}: {
  settings: NewsletterSettings;
  lang: "pl" | "en";
  source: string;
  variant: "card" | "inline";
}) {
  if (!settings.inline_doc) return null;
  const containerCls =
    variant === "card"
      ? "border border-border rounded-lg p-6 lg:p-8 bg-transparent"
      : "border-t border-b border-border py-8";
  return (
    <section className={containerCls + " nl-shell nl-shell--" + variant} aria-label="Newsletter">
      <NewsletterDocRenderer
        doc={settings.inline_doc}
        settings={settings}
        lang={lang}
        source={source}
      />
    </section>
  );
}

interface Props {
  lang?: "pl" | "en";
  source?: string;
  variant?: "card" | "inline";
  /** Full widget content JSON from the builder (optional). */
  widgetConfig?: Record<string, unknown>;
}

function boolCfg(c: Record<string, unknown> | undefined, k: string, fb = false): boolean {
  const v = c?.[k];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "1" || v === "true";
  if (typeof v === "number") return v !== 0;
  return fb;
}

export function NewsletterForm({
  lang = "pl",
  source = "post-bottom",
  variant = "card",
  widgetConfig,
}: Props) {
  const { t } = useTranslation();
  const { data: s } = useNewsletterSettings();
  // Inside the CMS builder canvas the widget must stay visible even when the
  // newsletter is disabled - otherwise it silently vanishes mid-edit.
  const inBuilder = useBuilderMode() !== null;
  const cfg = widgetConfig ?? {};

  // ALL hooks must run before any conditional return: settings load async, so
  // the inline_doc branch below can flip between renders - an early return
  // above these hooks made React throw "Rendered fewer hooks than expected"
  // and the whole widget vanished into the error boundary.
  const [email, setEmail] = useState("");
  const [name, setName] = useState(""); // legacy single "name" (fallback)
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [position, setPosition] = useState("");
  const [phone, setPhone] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [okStatus, setOkStatus] = useState<SubscribeStatus>("pending");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const subscribe = useServerFn(subscribeToNewsletter);

  const customFields = useMemo<CustomField[]>(
    () => parseCustomFields(cfg.customFields),
    [cfg.customFields],
  );

  // Wspólne dla wszystkich widgetów newslettera: etykiety pól + droplista tematów.
  const fieldLabels = useNewsletterFieldLabels(lang);
  const { allItems, groups } = useInterestGroups(lang, null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Zalogowany, już zapisany: zamiast prosić po raz drugi o dane kontaktowe
  // pokazujemy stan subskrypcji (lewa kolumna) i sam wybór tematów (prawa).
  const { data: myStatus } = useMyNewsletterStatus();
  if (myStatus?.subscribed === true && !inBuilder) {
    const shellCls =
      variant === "card"
        ? "border border-border rounded-lg p-6 lg:p-8 bg-transparent"
        : "border-t border-b border-border py-8";
    return (
      <section className={shellCls} aria-label="Newsletter">
        <NewsletterSubscribedPanel status={myStatus} lang={lang} />
      </section>
    );
  }

  // Nowy builder: jesli tenant ma inline_doc i tryb pozwala na inline, uzywamy
  // NewsletterDocRenderer (Elementor-style). Legacy fallback nizej.
  if (s && s.enabled && s.inline_doc && s.mode !== "off" && s.mode !== "popup") {
    return <BuilderInlineWrapper settings={s} lang={lang} source={source} variant={variant} />;
  }

  // Per-widget visibility toggles for the extra fields.
  // Instancje spoza buildera (stopka wpisu, sidebar, archiwum, popup) nie mają
  // własnej konfiguracji - dostają wtedy ten sam, pełny zestaw pól co widget
  // "Dołącz do nas" na stronie głównej (imię, nazwisko, stanowisko, firma,
  // telefon). Widgety z buildera nadal decydują same.
  const hasCfg = Object.keys(cfg).length > 0;
  const showFirstName = boolCfg(cfg, "showFirstName", !hasCfg);
  const showLastName = boolCfg(cfg, "showLastName", !hasCfg);
  const showCompany = boolCfg(cfg, "showCompany", !hasCfg);
  const showPosition = boolCfg(cfg, "showPosition", !hasCfg);
  const showPhone = boolCfg(cfg, "showPhone", !hasCfg);
  const requireFirstName = boolCfg(cfg, "requireFirstName", false);
  const requireLastName = boolCfg(cfg, "requireLastName", false);
  const requireCompany = boolCfg(cfg, "requireCompany", false);
  const requirePosition = boolCfg(cfg, "requirePosition", false);
  const requirePhone = boolCfg(cfg, "requirePhone", false);
  const requireEmail = boolCfg(cfg, "requireEmail", true);

  if (!s || !s.enabled) {
    if (!inBuilder) return null;

    return (
      <div
        role="status"
        className="rounded border border-dashed border-amber-500/60 bg-amber-500/10 px-3 py-2 text-[11px] font-medium text-amber-600"
      >
        {!s
          ? "Newsletter: wczytywanie ustawień…"
          : "Newsletter jest wyłączony w ustawieniach - ten widget nie wyświetla się na stronie."}
      </div>
    );
  }

  // Labels / placeholders (widget override > sensible defaults).
  const L = {
    firstName: fieldLabels.label("firstName", readI18nOverride(cfg, "firstNameLabel", lang, "")),
    lastName: fieldLabels.label("lastName", readI18nOverride(cfg, "lastNameLabel", lang, "")),
    email: fieldLabels.label("email", readI18nOverride(cfg, "emailLabel", lang, "")),
    company: fieldLabels.label("company", readI18nOverride(cfg, "companyLabel", lang, "")),
    position: fieldLabels.label("position", readI18nOverride(cfg, "positionLabel", lang, "")),
    phone: fieldLabels.label("phone", readI18nOverride(cfg, "phoneLabel", lang, "")),
  };

  const showInterests = boolCfg(cfg, "showInterests", true) && allItems.length > 0;
  const P = {
    firstName: readI18nOverride(
      cfg,
      "firstNamePlaceholder",
      lang,
      t("newsletterForm.firstNamePlaceholder"),
    ),
    lastName: readI18nOverride(
      cfg,
      "lastNamePlaceholder",
      lang,
      t("newsletterForm.lastNamePlaceholder"),
    ),
    email: readI18nOverride(cfg, "emailPlaceholder", lang, t("newsletterForm.emailPlaceholder")),
    company: readI18nOverride(
      cfg,
      "companyPlaceholder",
      lang,
      t("newsletterForm.companyPlaceholder"),
    ),
    name: t("newsletterForm.namePlaceholder"),
  };
  const requiredText = t("newsletterForm.requiredField");
  const invalidEmailText = t("newsletterForm.invalidEmail");

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setState("loading");
    setErrMsg(null);
    setErrors({});

    const fd = new FormData(e.currentTarget);
    const trimmedEmail = email.trim().toLowerCase();
    const custom = collectCustomValues(customFields, fd);

    const errs: Record<string, string> = {};
    if (requireEmail && !trimmedEmail) errs.email = requiredText;
    else if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail))
      errs.email = invalidEmailText;
    if (showFirstName && requireFirstName && !firstName.trim()) errs.firstName = requiredText;
    if (showLastName && requireLastName && !lastName.trim()) errs.lastName = requiredText;
    if (showCompany && requireCompany && !company.trim()) errs.company = requiredText;
    if (showPosition && requirePosition && !position.trim()) errs.position = requiredText;
    if (showPhone && requirePhone && !phone.trim()) errs.phone = requiredText;

    Object.assign(errs, validateCustom(customFields, custom, requiredText));

    if (Object.keys(errs).length) {
      setErrors(errs);
      setState("err");
      return;
    }

    try {
      const consentText =
        pickLocalized(s, "policy_html", lang) || t("newsletterForm.consentDefault");

      const displayName =
        [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") || name.trim() || undefined;

      const meta: Record<string, string> = {};
      if (company.trim()) meta.company = company.trim();
      if (position.trim()) meta.position = position.trim().slice(0, 500);
      if (phone.trim()) meta.phone = phone.trim().slice(0, 500);

      const pickedItemIds = Array.from(picked);
      if (pickedItemIds.length > 0) {
        const pickedItems = allItems.filter((it) => pickedItemIds.includes(it.id));
        const areas = pickedItems.filter((it) => it.type === "category").map((it) => it.label);
        const topics = pickedItems.filter((it) => it.type === "tag").map((it) => it.label);
        custom.interests = pickedItems
          .map((it) => it.label)
          .join(", ")
          .slice(0, 500);
        if (areas.length) custom.interests_areas = areas.join(", ").slice(0, 500);
        if (topics.length) custom.interests_topics = topics.join(", ").slice(0, 500);
      }

      const res = await subscribe({
        data: {
          email: trimmedEmail,
          name: displayName,
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          language: lang,
          source,
          formName: pickLocalized(s, "heading", lang) || undefined,
          consents: [{ key: "newsletter", text: consentText, given: true, lang }],
          meta: Object.keys(meta).length ? meta : undefined,
          custom: Object.keys(custom).length ? custom : undefined,
        },
      });

      if (!res.ok) {
        setErrMsg(subscribeErrorMessage(res.error, lang));
        setState("err");
        return;
      }
      setOkStatus(res.status);
      setState("ok");
      setEmail("");
      setName("");
      setFirstName("");
      setLastName("");
      setCompany("");
      setPicked(new Set());
    } catch (err) {
      setErrMsg(subscribeErrorMessage(err instanceof Error ? err.message : String(err), lang));
      setState("err");
    }
  };

  const heading = pickLocalized(s, "heading", lang);
  const description = pickLocalized(s, "description", lang);
  const policy = pickLocalized(s, "policy_html", lang);
  const success = pickLocalized(s, "success_message", lang);

  const containerCls =
    (variant === "card"
      ? "border border-border rounded-lg p-6 lg:p-8 bg-transparent"
      : "border-t border-b border-border py-8") + ` nl-shell nl-shell--${variant}`;

  const inputCls = "px-3 py-2 rounded border border-input bg-background text-sm w-full";
  const hasExtras =
    showFirstName ||
    showLastName ||
    showCompany ||
    showPosition ||
    showPhone ||
    customFields.length > 0 ||
    showInterests;

  return (
    <section className={containerCls} aria-labelledby="newsletter-heading">
      <h3 id="newsletter-heading" className="font-display text-2xl mb-2">
        {heading}
      </h3>
      {description && <p className="text-sm text-muted-foreground mb-4">{description}</p>}
      {state === "ok" ? (
        (() => {
          // Jasny stan sukcesu: ikona + nagłówek + co dalej (DOI / już zapisany).
          const copy = subscribeSuccessCopy(okStatus, lang, success);
          return (
            <div
              role="status"
              aria-live="polite"
              className="flex items-start gap-3 rounded-[6px] border border-brand/40 bg-brand/10 p-4"
            >
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{copy.title}</p>
                {copy.hint && <p className="mt-1 text-xs text-muted-foreground">{copy.hint}</p>}
                <button
                  type="button"
                  onClick={() => {
                    setState("idle");
                    setErrMsg(null);
                  }}
                  className="mt-2 text-xs font-medium text-brand underline-offset-2 hover:underline"
                >
                  {t("newsletterForm.addAnother")}
                </button>
              </div>
            </div>
          );
        })()
      ) : (
        <form
          onSubmit={onSubmit}
          className={hasExtras ? "space-y-2" : "grid sm:grid-cols-[1fr_1fr_auto] gap-2"}
        >
          {hasExtras ? (
            <>
              <div className="grid sm:grid-cols-2 gap-2">
                {showFirstName && (
                  <FieldWrap
                    label={L.firstName}
                    required={requireFirstName}
                    showMark={inBuilder}
                    error={errors.firstName}
                  >
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder={P.firstName}
                      className={inputCls}
                      maxLength={100}
                      required={requireFirstName}
                      aria-required={requireFirstName || undefined}
                    />
                  </FieldWrap>
                )}
                {showLastName && (
                  <FieldWrap
                    label={L.lastName}
                    required={requireLastName}
                    showMark={inBuilder}
                    error={errors.lastName}
                  >
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder={P.lastName}
                      className={inputCls}
                      maxLength={100}
                      required={requireLastName}
                      aria-required={requireLastName || undefined}
                    />
                  </FieldWrap>
                )}
                {showCompany && (
                  <FieldWrap
                    label={L.company}
                    required={requireCompany}
                    showMark={inBuilder}
                    error={errors.company}
                  >
                    <input
                      type="text"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder={P.company}
                      className={inputCls}
                      maxLength={200}
                      required={requireCompany}
                      aria-required={requireCompany || undefined}
                    />
                  </FieldWrap>
                )}
                {showPosition && (
                  <FieldWrap
                    label={L.position}
                    required={requirePosition}
                    showMark={inBuilder}
                    error={errors.position}
                  >
                    <input
                      type="text"
                      value={position}
                      onChange={(e) => setPosition(e.target.value)}
                      className={inputCls}
                      maxLength={200}
                      required={requirePosition}
                      aria-required={requirePosition || undefined}
                    />
                  </FieldWrap>
                )}
                {showPhone && (
                  <FieldWrap
                    label={L.phone}
                    required={requirePhone}
                    showMark={inBuilder}
                    error={errors.phone}
                  >
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className={inputCls}
                      maxLength={40}
                      required={requirePhone}
                      aria-required={requirePhone || undefined}
                    />
                  </FieldWrap>
                )}

                <FieldWrap
                  label={L.email}
                  required={requireEmail}
                  showMark={inBuilder}
                  error={errors.email}
                >
                  <input
                    type="email"
                    required={requireEmail}
                    aria-required={requireEmail || undefined}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={P.email}
                    className={inputCls}
                    maxLength={254}
                  />
                </FieldWrap>
                {customFields.map((f) => (
                  <CustomFieldRender
                    key={f.id}
                    field={f}
                    lang={lang}
                    err={errors[f.id]}
                    inputCls={inputCls}
                    showMark={inBuilder}
                  />
                ))}
              </div>

              {showInterests && (
                <TopicsDroplist
                  lang={lang}
                  allItems={allItems}
                  groups={groups}
                  picked={picked}
                  onToggle={togglePick}
                  onClear={() => setPicked(new Set())}
                />
              )}

              <SubscribeButton
                type="submit"
                loading={state === "loading"}
                loadingLabel="…"
                className="w-full sm:w-auto"
              >
                {t("newsletterForm.subscribe")}
              </SubscribeButton>
            </>
          ) : (
            <>
              <FieldWrap label={P.name}>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                />
              </FieldWrap>
              <FieldWrap label={L.email} required error={errors.email}>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={P.email}
                  maxLength={254}
                />
              </FieldWrap>
              <SubscribeButton
                loading={state === "loading"}
                aria-label={t("newsletterForm.subscribe")}
                className="!min-h-0 !py-0 !px-6 self-stretch"
              >
                {t("newsletterForm.subscribe")}
              </SubscribeButton>
            </>
          )}
        </form>
      )}
      {state === "err" && errMsg && (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-3 flex items-start gap-3 rounded-[6px] border border-destructive/40 bg-destructive/10 p-3"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-destructive">{subscribeErrorTitle(lang)}</p>
            <p className="mt-0.5 text-xs text-foreground/80">{errMsg}</p>
          </div>
        </div>
      )}
      {policy && (
        <p
          className="nl-consent nl-fineprint mt-3 text-muted-foreground"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(policy) }}
        />
      )}
    </section>
  );
}

function FieldWrap({
  label,
  showMark: _showMark,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  /** Legacy builder option retained for schema compatibility. */
  showMark?: boolean;
  error?: string;
  children: React.ReactElement<{ className?: string; placeholder?: string }>;
}) {
  // Floating-label wrapper: wstrzykuje klasę `.input` do dziecka, dzięki czemu
  // label unosi się na obramowanie po focus / gdy pole ma wartość.
  // Placeholder z ustawień widgetu przechodzi dalej bez zmian - CSS ukrywa go,
  // dopóki pole nie ma focusu (`:not(:focus)::placeholder`), więc etykieta i
  // podpowiedź nigdy nie nachodzą na siebie. Pole bez własnego placeholdera
  // dostaje spacer, bo `:placeholder-shown` wymaga niepustego atrybutu.
  // Semantyczne tokeny (border/ring/destructive/background) => light+dark OK.
  const injectedClass = ["input", children.props.className].filter(Boolean).join(" ");
  const cloned = React.cloneElement(children, {
    className: injectedClass,
    placeholder: floatingPlaceholder(children.props.placeholder),
  });
  return (
    <div className="input-group" data-invalid={error ? "true" : undefined}>
      {cloned}
      <label className="user-label">{label}</label>
      {error && <span className="mt-1.5 block pl-1 text-[11px] text-destructive">{error}</span>}
    </div>
  );
}

function CustomFieldRender({
  field,
  lang,
  err,
  inputCls,
  showMark,
}: {
  field: CustomField;
  lang: "pl" | "en";
  err?: string;
  inputCls: string;
  showMark?: boolean;
}) {
  const { t } = useTranslation();
  const label = pickLabel(field, lang);
  const placeholder = pickPlaceholder(field, lang);
  const name = `custom_${field.id}`;

  if (field.type === "checkbox") {
    return <ConsentCheckboxField name={name} label={label} required={field.required} err={err} />;
  }
  if (field.type === "select") {
    // Droplista korzysta z atomu FormSelect (Radix) - popup, focus ring, radius
    // 6px i light/dark pochodzą z naszych tokenów, a nie z systemowego <select>.
    return (
      <SelectField
        name={name}
        label={label}
        placeholder={placeholder || t("newsletterForm.selectPlaceholder")}
        required={field.required}
        err={err}
        options={(field.options ?? []).map((o) => ({
          value: o.value,
          label: (lang === "pl" ? o.labelPl : o.labelEn) ?? o.value,
        }))}
      />
    );
  }

  if (field.type === "textarea") {
    return (
      <FieldWrap label={label} required={field.required} showMark={showMark} error={err}>
        <textarea
          name={name}
          rows={4}
          required={field.required}
          aria-required={field.required || undefined}
          className={`${inputCls} resize-y`}
          placeholder={placeholder}
          maxLength={field.maxLength ?? 4000}
        />
      </FieldWrap>
    );
  }
  return (
    <FieldWrap label={label} required={field.required} showMark={showMark} error={err}>
      <input
        name={name}
        type={field.type}
        required={field.required}
        aria-required={field.required || undefined}
        className={inputCls}
        placeholder={placeholder}
        maxLength={field.maxLength ?? 500}
      />
    </FieldWrap>
  );
}

/**
 * Zgoda (checkbox) w widgecie newslettera.
 * Używa globalnego, animowanego atomu <Checkbox /> (ten sam co w JoinUsForm,
 * popupach i formularzach kontaktowych) zamiast natywnego inputa - dzięki temu
 * animacja zaznaczenia jest identyczna w całym serwisie. Tekst zgody jest
 * wyjustowany w pionie do środka wysokości checkboxa (`items-center`).
 * Ukryty input przenosi wartość do FormData (`collectCustomValues`).
 */
function ConsentCheckboxField({
  name,
  label,
  required,
  err,
}: {
  name: string;
  label: string;
  required?: boolean;
  err?: string;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="sm:col-span-2">
      <label className="widget-align-row nl-fineprint flex cursor-pointer items-center gap-2">
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => setChecked(v === true)}
          aria-required={required || undefined}
          className="h-[16px] w-[16px] shrink-0"
        />
        <span
          className="min-w-0"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(label) }}
          onClick={(e) => {
            // Klik w link (np. „warunki korzystania") nie może przełączać zgody.
            if ((e.target as HTMLElement).closest("a")) e.stopPropagation();
          }}
        />
      </label>
      {checked && <input type="hidden" name={name} value="1" />}
      {err && <span className="mt-1 block text-[11px] text-destructive">{err}</span>}
    </div>
  );
}

/** Droplista zgodna z layoutem serwisu (Radix + floating label). */
function SelectField({
  name,
  label,
  placeholder,
  required,
  err,
  options,
}: {
  name: string;
  label: string;
  placeholder: string;
  required?: boolean;
  err?: string;
  options: readonly { value: string; label: string }[];
}) {
  const [value, setValue] = useState("");
  return (
    <div className="input-group" data-invalid={err ? "true" : undefined}>
      <FormSelect
        className="input"
        name={name}
        value={value}
        onValueChange={setValue}
        options={options}
        placeholder={placeholder}
        required={required}
        aria-label={label}
      />
      <label className="user-label">{label}</label>
      {err && <span className="mt-1.5 block pl-1 text-[11px] text-destructive">{err}</span>}
    </div>
  );
}
