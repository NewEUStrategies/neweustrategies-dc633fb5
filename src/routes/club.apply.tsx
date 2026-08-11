// /club/apply - jeden formularz zgloszeniowy dla wszystkich specjalizacji.
//
// Dwie bramki, obie obowiazkowe (rowniez dla osob, ktore juz maja PRO+):
//   1. konto (zgloszenie wiaze sie z uzytkownikiem, nie z adresem e-mail),
//   2. aktywne czlonkostwo od warstwy PRO wzwyz (ranga >= 20).
// Posiadanie subskrypcji NIE zastepuje formularza - komisja rozpatruje profil
// zawodowy, a nie fakt platnosci. Twarda bramka jest w RPC `club_apply_submit`;
// tutaj tylko czytelne UI, zeby uzytkownik nie trafial na blad po wypelnieniu.
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, Lock, ShieldCheck } from "lucide-react";
import { FloatingInput, FloatingTextarea } from "@/components/ui/floating-input";
import { FormSelect } from "@/components/atoms/FormSelect";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { SubscribeButton } from "@/components/ui/subscribe-button";
import { MARKETING_CONSENT_KEY } from "@/components/interests/JoinUsForm";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentTier } from "@/lib/billing/tiers";
import { setMyConsent } from "@/lib/consents.functions";
import { getConsentDefinition } from "@/lib/notifications/consentCatalog";
import { formatDate } from "@/lib/i18n/format";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead } from "@/lib/seo/meta";
import { findClubSpecialization } from "@/lib/clubs/specializations";
import { useClubSpecializations, useClubsBySpecialization } from "@/lib/clubs/useClubSpecializations";
import {
  clubApplyErrorCode,
  fetchMyClubApplications,
  submitClubApplication,
  type ClubMyApplicationRow,
} from "@/lib/clubs/applyApi";
import { getClubApplyPrefill } from "@/lib/clubs/applyPrefill.functions";
import {
  clubApplyValid,
  validateClubApply,
  CLUB_APPLY_AVAILABILITY,
  CLUB_APPLY_INDUSTRY,
  CLUB_APPLY_SENIORITY,
  EMPTY_CLUB_APPLY,
  type ClubApplyErrors,
  type ClubApplyField,
  type ClubApplyValues,
} from "@/lib/clubs/applyValidation";
import { clubEn, clubPl, ensureClubI18n } from "@/lib/i18n-club";

interface ApplySearch {
  spec?: string;
}

/** Od tej rangi zaczyna sie "PRO+" (PRO oraz kazda wyzsza warstwa). */
const PRO_MIN_RANK = 20;

/** Pola, ktore umiemy wziac z profilu - nazwy identyczne w obu strukturach. */
const PREFILL_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "company",
  "jobPosition",
  "country",
  "linkedinUrl",
] as const;

/** Klucz cache historii wlasnych zgloszen - uniewazniany po wyslaniu. */
const MY_APPLICATIONS_KEY = ["club-applications", "mine"] as const;

/**
 * Meta trasy. Jezyk bierzemy z ADRESU zadania, a nie z singletona i18next:
 * `head()` biegnie na serwerze wspoldzielony miedzy rownolegle zadania, wiec
 * jego `language` potrafi nalezec do innego uzytkownika - dokladnie ten sam
 * mechanizm co strony specjalizacji (`lib/clubs/specializationHead.ts`).
 * Tresc czyta drzewa slownika wprost, zeby PL i EN mialy jedno zrodlo prawdy
 * z reszta strony, a `buildContentHead` dodaje canonical, hreflang i og:locale.
 */
function buildApplyHead(): ReturnType<typeof buildContentHead> {
  const url = getRequestUrl() || "/club/apply";
  const lang = activeLang(url);
  const copy = (lang === "en" ? clubEn : clubPl).club.spec.apply.meta;
  return buildContentHead({
    url,
    lang,
    type: "website",
    title: copy.title,
    description: copy.description,
    robots: "index, follow",
  });
}

export const Route = createFileRoute("/club/apply")({
  validateSearch: (raw: Record<string, unknown>): ApplySearch =>
    typeof raw.spec === "string" ? { spec: raw.spec } : {},
  head: () => buildApplyHead(),
  component: ClubApplyPage,
});

function GateCard(props: {
  icon: "lock" | "shield";
  title: string;
  lead: string;
  action: React.ReactNode;
}) {
  const Icon = props.icon === "lock" ? Lock : ShieldCheck;
  return (
    <div
      className="mt-6 rounded-md border p-6 md:p-8"
      style={{ background: "var(--cp-surface)", borderColor: "var(--cp-line)" }}
    >
      <div className="flex items-start gap-4">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "var(--cp-accent)" }} aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold" style={{ color: "var(--cp-ink)" }}>
            {props.title}
          </h2>
          <p className="mt-2 text-sm" style={{ color: "var(--cp-muted)" }}>
            {props.lead}
          </p>
          <div className="mt-4">{props.action}</div>
        </div>
      </div>
    </div>
  );
}

function ClubApplyPage() {
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = (i18n.language ?? "pl").startsWith("pl") ? "pl" : "en";
  const search = useSearch({ from: "/club/apply" });
  const { user } = useAuth();
  const tierQuery = useCurrentTier();
  const specsQuery = useClubSpecializations();

  const [form, setForm] = useState<ClubApplyValues>({
    ...EMPTY_CLUB_APPLY,
    specialization: search.spec ?? "",
  });
  const [status, setStatus] = useState<"idle" | "sending" | "ok">("idle");
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<ClubApplyErrors>({});

  const clubsQuery = useClubsBySpecialization(form.specialization, 60, form.specialization !== "");

  const queryClient = useQueryClient();
  const loadPrefill = useServerFn(getClubApplyPrefill);
  const saveConsent = useServerFn(setMyConsent);

  // Prefill z profilu (3.1). Osiem z czternastu pol obowiazkowych platforma juz
  // zna, a formularz za dwiema bramkami zajmuje kilkanascie minut - kazde z nich
  // przepisywane recznie to strata bez zadnej korzysci dla komisji.
  const prefillQuery = useQuery({
    queryKey: ["club-apply-prefill"],
    queryFn: () => loadPrefill(),
    enabled: user !== null,
    staleTime: 5 * 60 * 1000,
  });

  // Historia wlasnych zgloszen (2.2). Bez niej kandydat po wyslaniu nie widzi
  // niczego wiecej i po tygodniu ciszy sklada zgloszenie drugi raz.
  const mineQuery = useQuery({
    queryKey: MY_APPLICATIONS_KEY,
    queryFn: fetchMyClubApplications,
    enabled: user !== null,
    staleTime: 30_000,
  });

  const [prefilled, setPrefilled] = useState(false);
  // Ref, a nie sam warunek "pole puste": efekt ma wypelnic formularz JEDEN raz
  // po dojsciu danych. Bez tego swiadome wyczyszczenie pola przez uzytkownika
  // bylo cofane przy kazdym kolejnym renderze.
  const prefillApplied = useRef(false);
  useEffect(() => {
    const data = prefillQuery.data;
    if (data === undefined || prefillApplied.current) return;
    prefillApplied.current = true;
    const fillable = PREFILL_FIELDS.filter((key) => form[key] === "" && data[key] !== "");
    if (fillable.length === 0) return;
    setForm((prev) => {
      const next: ClubApplyValues = { ...prev };
      // Pustke sprawdzamy jeszcze raz w updaterze: miedzy renderem a zapisem
      // uzytkownik moze zaczac pisac, a jego tekst wygrywa z profilem.
      for (const key of fillable) if (next[key] === "") next[key] = data[key];
      return next;
    });
    setPrefilled(true);
  }, [prefillQuery.data, form]);

  const set = <K extends keyof ClubApplyValues>(key: K, value: ClubApplyValues[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const liveErrors = submitted ? validateClubApply(form) : errors;
  const errorText = (field: ClubApplyField): string | null => {
    const key = liveErrors[field];
    return key === undefined ? null : t(key);
  };
  const errorList = (Object.keys(liveErrors) as ClubApplyField[]).map((field) => ({
    field,
    message: t(liveErrors[field] as string),
  }));

  const specOptions = useMemo(() => {
    const rows = specsQuery.data ?? [];
    if (rows.length > 0) {
      return rows.map((row) => ({
        value: row.slug,
        label: lang === "en" ? row.label_en || row.label_pl : row.label_pl || row.label_en,
      }));
    }
    const fallback = findClubSpecialization(form.specialization);
    return fallback === null
      ? []
      : [{ value: fallback.slug, label: t(`club.spec.items.${fallback.key}.title`) }];
  }, [specsQuery.data, lang, form.specialization, t]);

  const rank = tierQuery.data?.rank ?? 0;
  const isPro = rank >= PRO_MIN_RANK;

  // 5.1: klub o progu wyzszym niz ranga uzytkownika nie ma prawa byc do wyboru.
  // Zgloszenie do niego przechodzi globalna bramke PRO+ i moze zostac przyjete,
  // a potem `club_capabilities` odrzuca czlonka z `tier_too_low` - czyli komisja
  // wpuszcza kogos do klubu, do ktorego nigdy nie wejdzie.
  const clubsInReach = useMemo(() => {
    const rows = clubsQuery.data?.rows ?? [];
    const visible = rows.filter((row) => row.min_tier_rank <= rank);
    return { visible, hidden: rows.length - visible.length };
  }, [clubsQuery.data, rank]);

  const clubOptions = useMemo(
    () => [
      { value: "", label: t("club.spec.apply.clubAny") },
      ...clubsInReach.visible.map((row) => ({
        value: row.id,
        label: lang === "en" ? row.name_en || row.name_pl : row.name_pl || row.name_en,
      })),
    ],
    [clubsInReach, lang, t],
  );

  const optionList = (prefix: string, keys: readonly string[]) =>
    keys.map((key) => ({ value: key, label: t(`club.spec.apply.${prefix}.${key}`) }));

  /** Etykieta specjalizacji z katalogu; fallback na slug, gdy katalog milczy. */
  const specLabel = (slug: string): string => {
    const row = (specsQuery.data ?? []).find((item) => item.slug === slug);
    if (row !== undefined) {
      return lang === "en" ? row.label_en || row.label_pl : row.label_pl || row.label_en;
    }
    const spec = findClubSpecialization(slug);
    return spec === null ? slug : t(`club.spec.items.${spec.key}.title`);
  };

  /** Nazwa klubu ze zgloszenia; brak wskazania to swiadomy wybor kandydata. */
  const mineClubLabel = (row: ClubMyApplicationRow): string => {
    if (row.club_id === null) return t("club.spec.apply.mine.clubAny");
    const name =
      lang === "en"
        ? row.club_name_en || row.club_name_pl
        : row.club_name_pl || row.club_name_en;
    return name === null || name === "" ? t("club.spec.apply.mine.clubAny") : name;
  };

  const mineRows = mineQuery.data ?? [];

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    const found = validateClubApply(form);
    setErrors(found);
    if (!clubApplyValid(found)) {
      toast.error(t("club.spec.apply.errorsTitle"));
      return;
    }
    setStatus("sending");
    try {
      await submitClubApplication(form, lang);

      // 3.3: zgoda marketingowa musi wyladowac w rejestrze `user_consents` -
      // to jedno zrodlo prawdy widoczne w profilu i jedyne miejsce, w ktorym
      // uzytkownik moze ja wycofac. Zapis jest NIEKRYTYCZNY: zgloszenie jest
      // juz w bazie, wiec bledu rejestru nie wolno pokazac jako porazki wysylki.
      if (form.marketingConsent) {
        try {
          await saveConsent({
            data: {
              key: MARKETING_CONSENT_KEY,
              given: true,
              version: getConsentDefinition(MARKETING_CONSENT_KEY)?.version ?? "1.0",
              lang,
              source: "club_apply",
            },
          });
        } catch (consentErr) {
          console.error("[club-apply] consent registry write failed", consentErr);
        }
      }

      setStatus("ok");
      setForm({ ...EMPTY_CLUB_APPLY, specialization: form.specialization });
      setSubmitted(false);
      setErrors({});
      setPrefilled(false);
      // Historia musi pokazac swieze zgloszenie od razu - inaczej kandydat widzi
      // toast, a sekcja "Twoje zgloszenia" nadal go nie zna.
      void queryClient.invalidateQueries({ queryKey: MY_APPLICATIONS_KEY });
      toast.success(t("club.spec.apply.ok"));
    } catch (err) {
      setStatus("idle");
      const code = clubApplyErrorCode(err instanceof Error ? err.message : "");
      toast.error(t(`club.spec.apply.submitErrors.${code}`));
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
        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--cp-accent)" }}>
          {t("club.spec.apply.requirement")}
        </p>
      </header>

      {/* 2.2: wlasne zgloszenia NAD formularzem - status decyzji jest pierwsza
          rzecza, ktorej kandydat tu szuka, i jedynym powodem, zeby nie wysylac
          zgloszenia drugi raz. Sekcja stoi przed bramkami, bo historia jest
          wazna takze wtedy, gdy warstwa czlonkostwa wygasla. */}
      {user !== null && mineRows.length > 0 ? (
        <section
          className="mt-6 rounded-md border p-6 md:p-8"
          style={{ background: "var(--cp-surface)", borderColor: "var(--cp-line)" }}
          aria-labelledby="club-apply-mine"
        >
          <h2
            id="club-apply-mine"
            className="font-display text-lg font-bold"
            style={{ color: "var(--cp-ink)" }}
          >
            {t("club.spec.apply.mine.title")}
          </h2>
          <ul className="mt-4 space-y-3">
            {mineRows.map((row) => (
              <li
                key={row.id}
                className="rounded-md border p-4"
                style={{ borderColor: "var(--cp-line)", background: "var(--cp-panel)" }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold" style={{ color: "var(--cp-ink)" }}>
                    {mineClubLabel(row)}
                  </p>
                  <span
                    className="text-[10px] font-semibold uppercase tracking-[0.18em]"
                    style={{ color: "var(--cp-accent)" }}
                  >
                    {t(`club.spec.apply.mine.status.${row.status}`)}
                  </span>
                </div>
                <p className="mt-1 text-xs" style={{ color: "var(--cp-muted)" }}>
                  {specLabel(row.specialization_slug)}
                </p>
                <p className="mt-2 text-xs" style={{ color: "var(--cp-muted)" }}>
                  {t("club.spec.apply.mine.submittedAt")}: {formatDate(row.created_at, lang)}
                  {row.reviewed_at === null
                    ? ""
                    : ` - ${t("club.spec.apply.mine.reviewedAt")}: ` +
                      formatDate(row.reviewed_at, lang)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {user === null ? (
        <GateCard
          icon="lock"
          title={t("club.spec.apply.gate.signInTitle")}
          lead={t("club.spec.apply.gate.signInLead")}
          action={
            <Button asChild>
              <Link to="/login">{t("club.spec.apply.gate.signIn")}</Link>
            </Button>
          }
        />
      ) : !isPro ? (
        <GateCard
          icon="lock"
          title={t("club.spec.apply.gate.proTitle")}
          lead={t("club.spec.apply.gate.proLead", {
            tier: lang === "en" ? (tierQuery.data?.name_en ?? "") : (tierQuery.data?.name_pl ?? ""),
          })}
          action={
            <Button asChild>
              <Link to="/pricing">{t("club.spec.apply.gate.proCta")}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <GateCard
            icon="shield"
            title={t("club.spec.apply.gate.okTitle")}
            lead={t("club.spec.apply.gate.okLead", {
              tier: lang === "en" ? (tierQuery.data?.name_en ?? "") : (tierQuery.data?.name_pl ?? ""),
            })}
            action={null}
          />

          {/* 3.1: informacja, ze czesc pol pochodzi z profilu. Bez niej dane
              wygladaja jak wziete z powietrza, a kandydat nie wie, ze moze je
              nadpisac - do zgloszenia idzie to, co jest w formularzu. */}
          {prefilled ? (
            <p role="status" className="mt-4 text-xs" style={{ color: "var(--cp-muted)" }}>
              {t("club.spec.apply.prefillNote")}
            </p>
          ) : null}

          <form onSubmit={onSubmit} className="mt-6 space-y-6" noValidate>
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

            <section className="space-y-4">
              <h2
                className="text-[11px] font-semibold uppercase tracking-[0.24em]"
                style={{ color: "var(--cp-muted)" }}
              >
                {t("club.spec.apply.sectionPersonal")}
              </h2>
              <div className="grid gap-4 md:grid-cols-3">
                <FloatingInput
                  label={t("club.spec.apply.firstName")}
                  error={errorText("firstName")}
                  required
                  autoComplete="given-name"
                  value={form.firstName}
                  onChange={(e) => set("firstName", e.target.value)}
                />
                <FloatingInput
                  label={t("club.spec.apply.lastName")}
                  error={errorText("lastName")}
                  required
                  autoComplete="family-name"
                  value={form.lastName}
                  onChange={(e) => set("lastName", e.target.value)}
                />
                <FloatingInput
                  label={t("club.spec.apply.email")}
                  error={errorText("email")}
                  required
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                />
                <FloatingInput
                  label={t("club.spec.apply.phone")}
                  error={errorText("phone")}
                  required
                  type="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                />
                <FloatingInput
                  label={t("club.spec.apply.country")}
                  error={errorText("country")}
                  required
                  autoComplete="country-name"
                  value={form.country}
                  onChange={(e) => set("country", e.target.value)}
                />
                <FloatingInput
                  label={`${t("club.spec.apply.city")} (${t("club.spec.apply.optional")})`}
                  error={errorText("city")}
                  autoComplete="address-level2"
                  value={form.city}
                  onChange={(e) => set("city", e.target.value)}
                />
              </div>
            </section>

            <section className="space-y-4">
              <h2
                className="text-[11px] font-semibold uppercase tracking-[0.24em]"
                style={{ color: "var(--cp-muted)" }}
              >
                {t("club.spec.apply.sectionProfessional")}
              </h2>
              <div className="grid gap-4 md:grid-cols-3">
                <FloatingInput
                  label={t("club.spec.apply.company")}
                  error={errorText("company")}
                  required
                  autoComplete="organization"
                  value={form.company}
                  onChange={(e) => set("company", e.target.value)}
                />
                <FloatingInput
                  label={t("club.spec.apply.jobPosition")}
                  error={errorText("jobPosition")}
                  required
                  autoComplete="organization-title"
                  value={form.jobPosition}
                  onChange={(e) => set("jobPosition", e.target.value)}
                />
                <FloatingInput
                  label={`${t("club.spec.apply.years")} (${t("club.spec.apply.optional")})`}
                  error={errorText("yearsExperience")}
                  inputMode="numeric"
                  value={form.yearsExperience}
                  onChange={(e) => set("yearsExperience", e.target.value)}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-2 text-sm font-medium" style={{ color: "var(--cp-ink)" }}>
                    {t("club.spec.apply.seniority")}
                  </p>
                  <FormSelect
                    value={form.seniority}
                    onValueChange={(v) => set("seniority", v)}
                    options={optionList("seniorityOptions", CLUB_APPLY_SENIORITY)}
                    required
                    placeholder={t("club.spec.apply.selectPlaceholder")}
                    aria-label={t("club.spec.apply.seniority")}
                  />
                  {errorText("seniority") !== null ? (
                    <p className="mt-1.5 pl-1 text-xs text-destructive" role="alert">
                      {errorText("seniority")}
                    </p>
                  ) : null}
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium" style={{ color: "var(--cp-ink)" }}>
                    {t("club.spec.apply.industry")}
                  </p>
                  <FormSelect
                    value={form.industry}
                    onValueChange={(v) => set("industry", v)}
                    options={optionList("industryOptions", CLUB_APPLY_INDUSTRY)}
                    required
                    placeholder={t("club.spec.apply.selectPlaceholder")}
                    aria-label={t("club.spec.apply.industry")}
                  />
                  {errorText("industry") !== null ? (
                    <p className="mt-1.5 pl-1 text-xs text-destructive" role="alert">
                      {errorText("industry")}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <FloatingInput
                  label={`${t("club.spec.apply.linkedin")} (${t("club.spec.apply.optional")})`}
                  error={errorText("linkedinUrl")}
                  inputMode="url"
                  placeholder="https://www.linkedin.com/in/..."
                  value={form.linkedinUrl}
                  onChange={(e) => set("linkedinUrl", e.target.value)}
                />
                <FloatingInput
                  label={`${t("club.spec.apply.languages")} (${t("club.spec.apply.optional")})`}
                  error={errorText("languages")}
                  value={form.languages}
                  onChange={(e) => set("languages", e.target.value)}
                />
              </div>
              <FloatingTextarea
                rows={3}
                label={t("club.spec.apply.expertise")}
                error={errorText("expertise")}
                value={form.expertise}
                onChange={(e) => set("expertise", e.target.value)}
              />
            </section>

            <section className="space-y-4">
              <h2
                className="text-[11px] font-semibold uppercase tracking-[0.24em]"
                style={{ color: "var(--cp-muted)" }}
              >
                {t("club.spec.apply.sectionClub")}
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-2 text-sm font-medium" style={{ color: "var(--cp-ink)" }}>
                    {t("club.spec.apply.specialization")}
                  </p>
                  <FormSelect
                    value={form.specialization}
                    onValueChange={(v) => {
                      set("specialization", v);
                      set("clubId", "");
                    }}
                    options={specOptions}
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
                <div>
                  <p className="mb-2 text-sm font-medium" style={{ color: "var(--cp-ink)" }}>
                    {t("club.spec.apply.club")} ({t("club.spec.apply.optional")})
                  </p>
                  <FormSelect
                    value={form.clubId}
                    onValueChange={(v) => set("clubId", v)}
                    options={clubOptions}
                    disabled={form.specialization === ""}
                    placeholder={t("club.spec.apply.clubPlaceholder")}
                    aria-label={t("club.spec.apply.club")}
                  />
                  {clubsInReach.hidden > 0 ? (
                    <p className="mt-1.5 pl-1 text-xs" style={{ color: "var(--cp-muted)" }}>
                      {t("club.spec.apply.gate.tierFilteredNote")}
                    </p>
                  ) : null}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium" style={{ color: "var(--cp-ink)" }}>
                  {t("club.spec.apply.availability")}
                </p>
                <FormSelect
                  value={form.availability}
                  onValueChange={(v) => set("availability", v)}
                  options={optionList("availabilityOptions", CLUB_APPLY_AVAILABILITY)}
                  required
                  placeholder={t("club.spec.apply.selectPlaceholder")}
                  aria-label={t("club.spec.apply.availability")}
                />
                {errorText("availability") !== null ? (
                  <p className="mt-1.5 pl-1 text-xs text-destructive" role="alert">
                    {errorText("availability")}
                  </p>
                ) : null}
              </div>
              <FloatingTextarea
                rows={5}
                label={t("club.spec.apply.motivation")}
                error={errorText("motivation")}
                value={form.motivation}
                onChange={(e) => set("motivation", e.target.value)}
              />
              <p className="-mt-2 pl-1 text-xs" style={{ color: "var(--cp-muted)" }}>
                {t("club.spec.apply.motivationHint")}
              </p>
              <FloatingTextarea
                rows={3}
                label={t("club.spec.apply.goals")}
                error={errorText("goals")}
                value={form.goals}
                onChange={(e) => set("goals", e.target.value)}
              />
              <FloatingTextarea
                rows={3}
                label={`${t("club.spec.apply.contribution")} (${t("club.spec.apply.optional")})`}
                error={errorText("contribution")}
                value={form.contribution}
                onChange={(e) => set("contribution", e.target.value)}
              />
              <FloatingInput
                label={`${t("club.spec.apply.referral")} (${t("club.spec.apply.optional")})`}
                error={errorText("referralSource")}
                value={form.referralSource}
                onChange={(e) => set("referralSource", e.target.value)}
              />
            </section>

            <section className="space-y-3">
              <label className="flex items-start gap-3 text-sm" style={{ color: "var(--cp-muted)" }}>
                <Checkbox
                  checked={form.consent}
                  onCheckedChange={(next) => set("consent", next === true)}
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
              <label className="flex items-start gap-3 text-sm" style={{ color: "var(--cp-muted)" }}>
                <Checkbox
                  checked={form.marketingConsent}
                  onCheckedChange={(next) => set("marketingConsent", next === true)}
                  aria-label={t("club.spec.apply.marketingConsent")}
                />
                <span>{t("club.spec.apply.marketingConsent")}</span>
              </label>
            </section>

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
        </>
      )}
    </div>
  );
}
