// "Dołącz do nas" / "Join us" widget. Combines newsletter signup with
// optional interests tagging so newly subscribed users immediately receive
// personalized recommendations. Every visible label / placeholder / perk is
// overridable via props so the widget can be fully configured from the CMS
// builder (see src/lib/builder/schemas.ts → "join-us"). Additional optional
// contact fields (first name, last name, LinkedIn position, phone, company,
// country) can be turned on per-instance; firstName/lastName are passed to
// the server function natively, the rest ride along in the `meta` map that
// newsletter_subscribers persists verbatim.
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { Check, UserPlus } from "lucide-react";
import { SubscribeButton } from "@/components/ui/subscribe-button";

import { useNewsletterSettings } from "@/hooks/useNewsletterSettings";
import { subscribeToNewsletter } from "@/lib/newsletter.functions";
import { getJoinUsPrefill, linkJoinUsAndBackfill } from "@/lib/joinUsSync.functions";
import { setMyConsent } from "@/lib/consents.functions";
import { getConsentDefinition } from "@/lib/notifications/consentCatalog";
import { useMyInterests } from "@/hooks/useInterests";
import { TopicsDroplist, useInterestGroups } from "@/components/interests/TopicsDroplist";
import { useNewsletterFieldLabels } from "@/lib/newsletter/newsletterFieldLabels";
import { useBuilderMode } from "@/lib/content-model/editorCanvas";
import { cn } from "@/lib/utils";
import {
  CustomFieldsRenderer,
  validateCustomFields,
  type CustomFieldDef,
} from "@/lib/builder/formFieldConfig";
import { CountryCombobox } from "@/components/interests/CountryCombobox";
import { FloatingInput } from "@/components/ui/floating-input";
import { Checkbox } from "@/components/ui/checkbox";
import { buildJoinUsSizeCss } from "@/lib/interests/joinUsSizeCss";

import { ensureI18n as ensureInterestsI18n } from "@/lib/i18n-interests";

ensureInterestsI18n();

/** Klucz zgody marketingowej w katalogu RODO - jedno źródło prawdy. */
export const MARKETING_CONSENT_KEY = "marketing_email";
export const MARKETING_CONSENT_VERSION =
  getConsentDefinition(MARKETING_CONSENT_KEY)?.version ?? "1.0";

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

  // --- Tło kontenera formularza. Puste = global colors (var(--card)).
  //     Można ustawić "transparent" żeby formularz "siedział" na tle strony.
  bgLight?: string;
  bgDark?: string;
  /** Kolor ikony ✓ (Lucide `Check`) przy bulletpointach perks. Puste = domyślnie brand / white (dla wariantu split-image). */
  perkIconColor?: string;

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
  /** Sztywny bok ikon (px). undefined = ikony skalują się z własnym tekstem. */
  iconSize?: number;
}

/**
 * Bok ikony wyrażony w `em`, czyli względem tekstu, przy którym ikona stoi
 * (✓ przy korzyściach → perkSize, ikona przycisku → buttonSize, chevron
 * droplisty → placeholderSize). Dzięki temu zmiana rozmiaru czcionki w
 * tooltipie / panelu buildera rusza też ikony - wcześniej były przybite
 * klasami `w-4 h-4` i nie reagowały na nic. 1.15em ≈ 16px przy domyślnych
 * 14px tekstu, więc domyślny wygląd pozostaje bez zmian.
 */
const ICON_EM = 1.15;

type ExtraKey =
  "firstName" | "lastName" | "position" | "linkedin" | "phone" | "company" | "country";

export function JoinUsForm({
  variant = "card",
  showInterests = true,
  interestsDisplay = "droplist",
  className,
  source = "join-us",
  imageUrl,
  imageAlt,
  imageAltEn,
  imageGradient,
  imageOverlay = 0,
  imagePosition = "center",
  imageAspect,
  imageFit = "cover",
  bgLight,
  bgDark,
  perkIconColor,

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
  iconSize,
}: JoinUsFormProps) {
  const jusId = useId();
  const hasCustomBg = Boolean(bgLight || bgDark);

  const { t, i18n } = useTranslation();
  const lang = (i18n.language?.startsWith("en") ? "en" : "pl") as "pl" | "en";
  const { data: nl } = useNewsletterSettings();
  const interestGroups = useInterestGroups(lang, interestSlugs);
  const fieldLabels = useNewsletterFieldLabels(lang);
  const catalog = interestGroups.catalog;
  const my = useMyInterests();
  const subscribe = useServerFn(subscribeToNewsletter);
  const fetchPrefill = useServerFn(getJoinUsPrefill);
  const linkAndBackfill = useServerFn(linkJoinUsAndBackfill);
  const saveConsent = useServerFn(setMyConsent);
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
  const cfList = customFields ?? [];
  const setCustom = (id: string, v: string) => setCustomValues((prev) => ({ ...prev, [id]: v }));

  // Zgoda marketingowa (RODO) - checkbox wymagany do wysyłki. Stan trzymamy
  // lokalnie, a po udanym zapisie propagujemy do rejestru `user_consents`
  // (jedno źródło prawdy widoczne w profilu użytkownika).
  const [consentAccepted, setConsentAccepted] = useState(false);

  const useSplitName = showFirstName || showLastName;

  useEffect(() => {
    if (!my.data) return;
    setPicked(new Set([...my.data.categoryIds, ...my.data.tagIds]));
  }, [my.data]);

  // Świadomie NIE prefillujemy pól z profilu zalogowanego użytkownika -
  // formularz newslettera ma pokazywać placeholdery i18n (Imię, Nazwisko,
  // Twój e-mail, LinkedIn, telefon, firma, kraj), a nie zmuszać usera do
  // czyszczenia autouzupełnionych danych. Wartości i tak zostaną doczytane
  // po stronie serwera przy subskrypcji dla zalogowanego usera.
  void fetchPrefill;

  const { allItems } = interestGroups;

  const clearPicked = () => setPicked(new Set());
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

  const updateExtra = (k: ExtraKey, v: string) => setExtra((prev) => ({ ...prev, [k]: v }));

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
        lang === "en" ? "Please pick at least one topic." : "Wybierz co najmniej jeden temat.",
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
    if (!consentAccepted) {
      setErrMsg(t("joinUs.consentRequired"));
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

      // Interests picked in the widget go to CRM as grouped custom fields.
      // - `interests` = flat list of wszystkich labeli (fallback do dawnych
      //   automatyzacji)
      // - `interests_areas` = wszystkie kategorie
      // - `interests_topics` = wszystkie tagi
      // - `interests_<slug_obszaru>` = wybory pogrupowane po obszarze
      //   (Region, Specjalizacja, ...), żeby CRM widział strukturę tak samo
      //   jak formularz.
      if (showInterests && picked.size > 0) {
        const pickedItems = allItems.filter((it) => picked.has(it.id));
        const areas = pickedItems.filter((it) => it.type === "category").map((it) => it.label);
        const topics = pickedItems.filter((it) => it.type === "tag").map((it) => it.label);
        const all = pickedItems.map((it) => it.label);
        if (areas.length) custom.interests_areas = areas.join(", ").slice(0, 500);
        if (topics.length) custom.interests_topics = topics.join(", ").slice(0, 500);
        if (all.length) custom.interests = all.join(", ").slice(0, 500);

        // Per-obszar rozbicie: klucz = interests_<slug_rodzica_z_lat_a-Z0-9_>.
        const byParent = new Map<string, { title: string; labels: string[] }>();
        for (const it of pickedItems) {
          if (it.type !== "category") continue;
          const pSlug = it.parentSlug ?? null;
          const pLabel = it.parentLabel ?? null;
          if (!pSlug || !pLabel) continue;
          const bucket = byParent.get(pSlug) ?? { title: pLabel, labels: [] };
          bucket.labels.push(it.label);
          byParent.set(pSlug, bucket);
        }
        for (const [slug, bucket] of byParent.entries()) {
          const safeKey = `interests_${slug.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}`.slice(
            0,
            60,
          );
          custom[safeKey] = bucket.labels.join(", ").slice(0, 500);
        }
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

    // Zalogowany user: powiąż subskrypcję z auth.uid() i uzupełnij PUSTE pola profilu
    // (RPC join_us_link_and_backfill po stronie SQL używa COALESCE - nie nadpisuje
    // istniejących wartości). Niekrytyczne dla samego zapisu do newslettera.
    if (my.userId) {
      try {
        await linkAndBackfill({
          data: {
            email: trimmed,
            firstName,
            lastName,
            country: extra.country.trim(),
            linkedin: extra.linkedin.trim(),
            phone: extra.phone.trim(),
            company: extra.company.trim(),
            position: extra.position.trim(),
          },
        });
      } catch {
        /* non-fatal */
      }

      // Jedno źródło prawdy dla zgód: rejestr `user_consents` (widoczny w
      // profilu, z audit-logiem IP/UA/wersja). Niekrytyczne dla subskrypcji.
      try {
        await saveConsent({
          data: {
            key: MARKETING_CONSENT_KEY,
            given: true,
            version: MARKETING_CONSENT_VERSION,
            lang,
            source: "join_us_form",
          },
        });
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
    setConsentAccepted(false);
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
  // Etykiety pól = globalna konfiguracja (Admin → Popupy) z możliwością
  // nadpisania per-widget. Ten sam zestaw obowiązuje w każdym widgecie newslettera.
  const phName = namePlaceholder || t("joinUs.name");
  const phEmail = fieldLabels.label("email", emailPlaceholder);
  const phFirst = fieldLabels.label("firstName", firstNamePlaceholder);
  const phLast = fieldLabels.label("lastName", lastNamePlaceholder);
  const phPosition = fieldLabels.label("position", positionPlaceholder);
  const phLinkedin = fieldLabels.label("linkedin", linkedinPlaceholder);
  const phPhone = fieldLabels.label("phone", phonePlaceholder);
  const phCompany = fieldLabels.label("company", companyPlaceholder);
  const phCountry = fieldLabels.label("country", countryPlaceholder);

  // Kontener: domyślnie `bg-card` (global colors); gdy operator ustawi
  // `bgLight`/`bgDark` (w tym "transparent") - drop `bg-card` i użyj CSS
  // vars ze scoped <style> poniżej.
  // Kontener: domyślnie tło przezroczyste (formularz "siedzi" na tle strony /
  // sekcji). Operator może w każdej chwili nadpisać `bgLight` / `bgDark`
  // (np. `var(--card)` żeby wrócić do global colors, dowolny hex, gradient).
  const bgClass = hasCustomBg ? "" : "bg-transparent";
  const containerCls =
    (variant === "inline"
      ? "border-t border-b border-border py-6"
      : variant === "split"
        ? `grid gap-6 rounded-xl border border-border ${bgClass} p-6 sm:p-8 md:grid-cols-2`
        : variant === "split-image"
          ? `grid gap-0 overflow-hidden rounded-xl border border-border ${bgClass} md:grid-cols-2`
          : `rounded-xl border border-border ${bgClass} p-6 sm:p-8`) +
    ` join-us-shell join-us-shell--${variant}`;

  // Scoped <style>: tło + rozmiary czcionek. Rozmiary muszą lecieć przez CSS
  // (a nie tylko inline), żeby wygrać z globalnymi regułami platformy i dawać
  // ten sam efekt w podglądzie buildera oraz na stronie publicznej.
  const sizeCss = buildJoinUsSizeCss(jusId, {
    titleSize,
    descriptionSize,
    perkSize,
    labelSize,
    placeholderSize,
    buttonSize,
    consentSize,
    iconSize,
  });
  const bgCss = hasCustomBg
    ? `[data-jus-id="${jusId}"]{background:${bgLight || "var(--card)"} !important;}` +
      `.dark [data-jus-id="${jusId}"]{background:${bgDark || bgLight || "var(--card)"} !important;}`
    : "";
  const bgStyleTag = bgCss || sizeCss ? <style>{bgCss + sizeCss}</style> : null;

  // Nagłówek musi mieć id UNIKALNE w dokumencie - dwa widgety "Dołącz do nas"
  // na jednej stronie (np. w sidebarze i w stopce) dawały wcześniej dwa
  // elementy o id="joinus-heading", więc aria-labelledby wskazywało na cudzy
  // nagłówek.
  const headingId = `${jusId}-heading`;

  // Ikony: bok w `em` (skaluje się z tekstem obok) + `data-jus-icon`, po którym
  // celuje sztywny override `iconSize` z buildera.
  //
  // KONTRAKT: `data-jus-icon` i `data-edit-target="iconSize"` chodzą PARAMI.
  // Ikona sterowana polem „Ikony" musi być też klikalnym celem tego pola na
  // canvasie - inaczej operator klika ikonę, a otwiera mu się edytor rodzica
  // (rozmiar przycisku / pola) i zmiana „nie działa". Wyjątkiem jest ✕ w
  // pigułce wybranego tematu: to mikro-chrome tagu, które ma trzymać się
  // rozmiaru samej pigułki, nie rozmiaru ikon treści - dlatego nie ma żadnego
  // z tych dwóch atrybutów i skaluje się wyłącznie przez `em`.
  const iconStyle: CSSProperties = { width: `${ICON_EM}em`, height: `${ICON_EM}em` };
  const iconTargetProps = { "data-jus-icon": true, "data-edit-target": "iconSize" } as const;

  /** Jeden bulletpoint korzyści - wspólny atom wariantów split / split-image.
   *  `data-keep-color` chroni własny kolor ikony przed globalnym override'em
   *  kolorów ikon widgetu, gdy operator ustawił `perkIconColor`. */
  const perkItem = (text: string, tone: "brand" | "on-image") => (
    <li className="flex items-start gap-2">
      <Check
        className={cn("mt-[0.15em] shrink-0", tone === "on-image" ? "text-white" : "text-brand")}
        style={{ ...iconStyle, ...(perkIconColor ? { color: perkIconColor } : null) }}
        {...iconTargetProps}
        data-keep-color={perkIconColor ? "" : undefined}
        aria-hidden
      />
      <span>{text}</span>
    </li>
  );

  if (state === "ok") {
    return (
      <section data-jus-id={jusId} className={cn(containerCls, className)} aria-live="polite">
        {bgStyleTag}
        <div className="flex items-center gap-3 text-foreground">
          <Check
            className="text-emerald-500 shrink-0"
            style={iconStyle}
            {...iconTargetProps}
            aria-hidden
          />
          <p className="text-sm font-medium">{okText}</p>
        </div>
      </section>
    );
  }

  const inputCls =
    "h-10 px-3 rounded border border-border bg-background font-sans leading-none w-full";
  const inputStyle = placeholderSize
    ? ({ fontSize: `${placeholderSize}px` } satisfies CSSProperties)
    : ({ fontSize: "14px" } satisfies CSSProperties);
  // Bez lokalnych `droplistButtonStyle` / `chipStyle`: `TopicsDroplist` dostaje
  // `labelSize` i `placeholderSize` w propsach i liczy te same style u siebie
  // (patrz `chipStyle` i `triggerStyle` w tym komponencie). Tutejsze kopie były
  // martwym duplikatem po przeniesieniu odpowiedzialności do dziecka.
  // Gwiazdka przy polach wymaganych - dokładnie jak w popupie rejestracji i w
  // formularzu newslettera (FieldBox dokleja " *"), żeby wszystkie formularze
  // platformy czytały się tak samo.
  const withMark = (label: string, req: boolean) => (req ? `${label} *` : label);

  // Build the ordered list of "extra row" fields (email in split mode + optional contact fields).
  // Rendered into a single 2-col grid; when the count is odd, the last item spans both columns
  // so no empty cell remains.
  const extraFields: ReactNode[] = [];
  if (useSplitName) {
    extraFields.push(
      <FloatingInput
        key="email"
        type="email"
        required={requireEmail}
        aria-required={requireEmail || undefined}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        label={withMark(phEmail, requireEmail)}
        maxLength={254}
        style={inputStyle}
        data-edit-target="placeholderSize"
        labelEditTarget="labelSize"
        autoComplete="email"
      />,
    );
  }
  if (showPosition) {
    extraFields.push(
      <FloatingInput
        key="position"
        type="text"
        value={extra.position}
        onChange={(e) => updateExtra("position", e.target.value)}
        label={withMark(phPosition, requirePosition)}
        aria-required={requirePosition || undefined}
        required={requirePosition}
        maxLength={200}
        style={inputStyle}
        data-edit-target="placeholderSize"
        labelEditTarget="labelSize"
        autoComplete="organization-title"
      />,
    );
  }
  if (showLinkedin) {
    extraFields.push(
      <FloatingInput
        key="linkedin"
        type="url"
        value={extra.linkedin}
        onChange={(e) => updateExtra("linkedin", e.target.value)}
        label={withMark(phLinkedin, requireLinkedin)}
        aria-required={requireLinkedin || undefined}
        required={requireLinkedin}
        maxLength={300}
        style={inputStyle}
        data-edit-target="placeholderSize"
        labelEditTarget="labelSize"
        autoComplete="url"
      />,
    );
  }
  if (showPhone) {
    extraFields.push(
      <FloatingInput
        key="phone"
        type="tel"
        value={extra.phone}
        onChange={(e) => updateExtra("phone", e.target.value)}
        label={withMark(phPhone, requirePhone)}
        aria-required={requirePhone || undefined}
        required={requirePhone}
        maxLength={40}
        style={inputStyle}
        data-edit-target="placeholderSize"
        labelEditTarget="labelSize"
        autoComplete="tel"
      />,
    );
  }
  if (showCompany) {
    extraFields.push(
      <FloatingInput
        key="company"
        type="text"
        value={extra.company}
        onChange={(e) => updateExtra("company", e.target.value)}
        label={withMark(phCompany, requireCompany)}
        aria-required={requireCompany || undefined}
        required={requireCompany}
        maxLength={200}
        style={inputStyle}
        data-edit-target="placeholderSize"
        labelEditTarget="labelSize"
        autoComplete="organization"
      />,
    );
  }
  if (showCountry) {
    extraFields.push(
      <CountryCombobox
        key="country"
        value={extra.country}
        onChange={(v) => updateExtra("country", v)}
        lang={lang}
        label={withMark(phCountry, requireCountry)}
        required={requireCountry}
        maxLength={100}
        style={inputStyle}
        labelEditTarget="labelSize"
      />,
    );
  }

  const form = (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {useSplitName ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {showFirstName && (
            <FloatingInput
              type="text"
              value={extra.firstName}
              onChange={(e) => updateExtra("firstName", e.target.value)}
              label={withMark(phFirst, requireFirstName)}
              aria-required={requireFirstName || undefined}
              required={requireFirstName}
              maxLength={100}
              style={inputStyle}
              data-edit-target="placeholderSize"
              labelEditTarget="labelSize"
              autoComplete="given-name"
            />
          )}
          {showLastName && (
            <FloatingInput
              type="text"
              value={extra.lastName}
              onChange={(e) => updateExtra("lastName", e.target.value)}
              label={withMark(phLast, requireLastName)}
              aria-required={requireLastName || undefined}
              required={requireLastName}
              maxLength={100}
              style={inputStyle}
              data-edit-target="placeholderSize"
              labelEditTarget="labelSize"
              autoComplete="family-name"
            />
          )}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <FloatingInput
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            label={phName}
            maxLength={120}
            style={inputStyle}
            data-edit-target="placeholderSize"
            labelEditTarget="labelSize"
            autoComplete="name"
          />
          <FloatingInput
            type="email"
            required={requireEmail}
            aria-required={requireEmail || undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            label={withMark(phEmail, requireEmail)}
            maxLength={254}
            style={inputStyle}
            data-edit-target="placeholderSize"
            labelEditTarget="labelSize"
            autoComplete="email"
          />
        </div>
      )}

      {extraFields.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {extraFields.map((el, i) => {
            const isLastOdd = i === extraFields.length - 1 && extraFields.length % 2 === 1;
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
        <TopicsDroplist
          lang={lang}
          heading={iLabel}
          allItems={allItems}
          groups={interestGroups.groups}
          picked={picked}
          onToggle={togglePick}
          onClear={clearPicked}
          display={interestsDisplay}
          labelSize={labelSize}
          placeholderSize={placeholderSize}
          editTargets
          iconStyle={iconStyle}
          iconTargetProps={iconTargetProps}
        />
      )}

      {/* Zgoda i przycisk w jednym rzędzie - checkbox + tekst wyśrodkowane
          w pionie względem wysokości przycisku (na mobile układ kolumnowy). */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <label
          className="flex cursor-pointer items-center gap-2 font-sans leading-relaxed text-muted-foreground"
          style={{ fontSize: consentSize ? `${consentSize}px` : "11px" }}
          data-edit-target="consentSize"
        >
          <Checkbox
            checked={consentAccepted}
            onCheckedChange={(v) => setConsentAccepted(v === true)}
            aria-required="true"
            className="h-[16px] w-[16px] shrink-0"
          />
          <span>
            {consent}
            <span className="ml-1 text-destructive">*</span>
          </span>
        </label>

        <SubscribeButton
          loading={state === "loading"}
          loadingLabel={btnLoading}
          className="w-full sm:w-auto sm:shrink-0"
          style={{ fontSize: buttonSize ? `${buttonSize}px` : undefined }}
          data-edit-target="buttonSize"
        >
          <UserPlus className="shrink-0" style={iconStyle} {...iconTargetProps} aria-hidden />
          {btnLabel}
        </SubscribeButton>
      </div>

      {state === "err" && errMsg && <p className="text-xs text-destructive">{errMsg}</p>}
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
      <section
        data-jus-id={jusId}
        className={cn(containerCls, className)}
        aria-labelledby={headingId}
      >
        {bgStyleTag}
        {disabledNotice && <div className="md:col-span-2">{disabledNotice}</div>}
        <div>
          <h3
            id={headingId}
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
            {perkItem(p1, "brand")}
            {perkItem(p2, "brand")}
            {perkItem(p3, "brand")}
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
      "linear-gradient(135deg, color-mix(in oklab, var(--color-brand, #2563eb) 90%, transparent) 0%, color-mix(in oklab, var(--color-brand, #2563eb) 40%, #141414) 100%)";
    const overlayAlpha = Math.min(100, Math.max(0, imageOverlay)) / 100;
    return (
      <section
        data-jus-id={jusId}
        className={cn(containerCls, className)}
        aria-labelledby={headingId}
      >
        {bgStyleTag}
        {disabledNotice && <div className="md:col-span-2 p-4">{disabledNotice}</div>}
        {/* Lewa kolumna: obraz + gradient fallback + overlay + kontent tekstowy.
            aspectRatio + object-fit + object-position pozwalają operatorowi
            CMS dopasować kadr do dowolnej kreacji (np. 16/9 dla banerów,
            1/1 dla portretów) bez zmian w kodzie. */}
        <div
          className={cn(
            "relative overflow-hidden",
            // Bez zdefiniowanego aspect-ratio zachowujemy dotychczasowe minima,
            // żeby obraz zawsze wypełniał kolumnę obok formularza.
            !imageAspect || imageAspect === "auto" ? "min-h-[220px] md:min-h-[380px]" : undefined,
          )}
          style={{
            ...(imageAspect && imageAspect !== "auto"
              ? { aspectRatio: imageAspect.replace("/", " / ") }
              : null),
            ...(!imageUrl ? { background: fallbackGradient } : null),
          }}
        >
          {imageUrl && (
            <img
              src={imageUrl}
              alt={altText}
              loading="lazy"
              decoding="async"
              className={cn(
                "absolute inset-0 h-full w-full",
                imageFit === "contain" ? "object-contain" : "object-cover",
              )}
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
              id={headingId}
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
              {perkItem(p1, "on-image")}
              {perkItem(p2, "on-image")}
              {perkItem(p3, "on-image")}
            </ul>
          </div>
        </div>
        {/* Prawa kolumna: formularz */}
        <div className="p-6 sm:p-8">{form}</div>
      </section>
    );
  }

  return (
    <section
      data-jus-id={jusId}
      className={cn(containerCls, className)}
      aria-labelledby={headingId}
    >
      {bgStyleTag}
      {disabledNotice}
      <h3
        id={headingId}
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
