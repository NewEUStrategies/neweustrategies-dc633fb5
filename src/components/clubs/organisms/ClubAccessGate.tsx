// Bramka dostępu do klubu dyskusyjnego - powierzchnia KONWERSJI, nie komunikat błędu.
//
// Poprzednia wersja pokazywała wyśrodkowane zdanie („Zaloguj się, aby zobaczyć
// ten klub") i jeden przycisk. Osoba, która trafia tu z newslettera albo
// wyszukiwarki, nie dowiadywała się ANI co jest w środku, ANI ile to kosztuje,
// ANI jak wejść - a to jest jedyny moment, w którym jej intencja jest najwyższa.
//
// Bramka rozstrzyga trzy sytuacje jednym układem dwukolumnowym:
//   * anonim              -> wartość klubu + formularz rejestracji inline,
//   * zalogowany za nisko -> wartość klubu + upsell do wymaganego planu,
//   * zalogowany, nie-członek -> prośba o dostęp (plan już wystarcza).
import { Fragment, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Crown,
  Eye,
  EyeOff,
  Library,
  Loader2,
  Lock,
  MailCheck,
  MessagesSquare,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { preAuthGuard } from "@/lib/auth/bruteforce.functions";
import { useAuth } from "@/hooks/useAuth";
import { useUserBadges } from "@/lib/profile/badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldBox } from "@/components/ui/field-box";
import { Checkbox } from "@/components/ui/checkbox";
import {
  buildSignupMetadata,
  useRegistrationFields,
  type RegistrationFieldKey,
} from "@/lib/auth/registrationFields";

import { ClubCover } from "@/components/clubs/atoms/ClubCover";
import {
  CLUB_GATE_BENEFITS,
  clubGateView,
  type ClubGateBenefit,
  type ClubGateView,
} from "@/lib/clubs/gateView";
import type { ClubViewRow } from "@/lib/clubs/types";
import { ensureClubI18n } from "@/lib/i18n-club";
import "@/lib/i18n-club-gate";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { uiLang } from "@/lib/i18n/format";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Ikona przy korzyści. Katalog kluczy żyje w `gateView`, ikony - tutaj. */
const BENEFIT_ICONS: Record<ClubGateBenefit, LucideIcon> = {
  threads: MessagesSquare,
  library: Library,
  calendar: CalendarDays,
  network: Users,
  chatham: ShieldCheck,
  briefs: BookOpen,
};

export function ClubAccessGate({ club }: { club: ClubViewRow }) {
  // Etykiety progów mają JEDNO źródło prawdy: `club.planTier.*` w słowniku
  // modułu. Bramka rejestruje ten słownik sama, bo etykieta planu jest tu
  // treścią sprzedażową, a nie ozdobą - gdyby zabrakło bundla, w nagłówku
  // stanąłby surowy klucz.
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { session, loading } = useAuth();

  const name = pickLocalized(club, "name", lang) || club.name_pl;
  const tagline = pickLocalized(club, "tagline", lang);
  const signedIn = session !== null && !loading;
  const badgesQ = useUserBadges(session?.user.id);
  const isExpert = (badgesQ.data ?? []).includes("expert");

  // CO bramka pokazuje, rozstrzyga czysty deskryptor (`lib/clubs/gateView`) -
  // tutaj zostaje wyłącznie JAK to narysować. Reguły dostępu były w tym repo
  // dowiedzione (capabilityMatrix, hubAccess, pgTAP), ich prezentacja nie.
  const view = clubGateView({ club, signedIn, isExpert });
  const plan = t(view.planLabelKey);

  return (
    <Card className="overflow-hidden rounded-xl border-border/70">
      <ClubCover url={club.cover_image_url} variant="banner" className="rounded-none border-0" />
      <CardContent className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        {/* --- kolumna wartości ------------------------------------------ */}
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
            <Crown className="h-3.5 w-3.5" aria-hidden="true" />
            {t("clubGate.eyebrow", { plan })}
          </span>

          <h1 className="mt-3 text-2xl font-semibold leading-tight sm:text-3xl">{name}</h1>
          {tagline ? <p className="mt-2 text-muted-foreground">{tagline}</p> : null}

          <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <dd className="inline-flex items-center gap-1.5 tabular-nums">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {t("clubGate.statsMembers", { count: club.member_count ?? 0 })}
            </dd>
            <dd className="inline-flex items-center gap-1.5 tabular-nums">
              <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" />
              {t("clubGate.statsThreads", { count: club.thread_count ?? 0 })}
            </dd>
          </dl>

          <p className="mt-4 max-w-2xl text-sm">{t(view.leadKey, { plan })}</p>

          <div className="mt-5 rounded-lg border border-border/70 bg-muted/30 p-4 sm:p-5">
            <p className="text-sm font-semibold">{t("clubGate.benefitsTitle", { plan })}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("clubGate.benefitsLead")}</p>
            <ul className="mt-3.5 grid gap-2.5 sm:grid-cols-2">
              {CLUB_GATE_BENEFITS.map((key) => (
                <Benefit key={key} icon={BENEFIT_ICONS[key]} k={key} />
              ))}
            </ul>
          </div>
        </div>

        {/* --- kolumna akcji --------------------------------------------- */}
        <aside className="min-w-0 rounded-lg border border-primary/25 bg-primary/[0.04] p-4 sm:p-5">
          {signedIn ? (
            <MemberActions club={club} plan={plan} view={view} />
          ) : (
            <GateSignupForm plan={plan} />
          )}
        </aside>
      </CardContent>
    </Card>
  );
}

/** Pojedynczy benefit: tytuł + jedno zdanie „co to znaczy w praktyce". */
function Benefit({ icon: Icon, k }: { icon: LucideIcon; k: string }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-start gap-2.5 rounded-lg bg-background/60 p-2.5 ring-1 ring-border/50">
      <span className="mt-0.5 shrink-0 rounded-md bg-primary/10 p-1.5 text-primary">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-snug">
          {t(`clubGate.benefits.${k}.title`)}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
          {t(`clubGate.benefits.${k}.desc`)}
        </span>
      </span>
    </li>
  );
}

function MemberActions({
  club,
  plan,
  view,
}: {
  club: ClubViewRow;
  plan: string;
  view: ClubGateView;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Lock className="h-4 w-4 text-primary" aria-hidden="true" />
        {t("clubGate.lockedTitle", { plan })}
      </p>

      {view.actions.map((action) => {
        if (action.kind === "upgrade") {
          return (
            <Button key={action.kind} asChild className="w-full rounded-lg">
              <Link to="/pricing">
                {t(action.ctaKey, { plan })}
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          );
        }
        if (action.kind === "plans") {
          return (
            <Button key={action.kind} asChild variant="outline" className="w-full rounded-lg">
              <Link to="/pricing" hash="plans">
                {t(action.ctaKey)}
              </Link>
            </Button>
          );
        }
        if (action.kind === "request") {
          return (
            <Fragment key={action.kind}>
              {view.showExpertNote ? (
                <p className="rounded-md bg-primary/10 px-2.5 py-2 text-[11px] leading-snug text-foreground">
                  <span className="font-semibold">{t("clubGate.expertBadge")}</span> -{" "}
                  {t("clubGate.expertLead")}
                </p>
              ) : null}
              <Button
                asChild
                variant={action.muted ? "ghost" : "default"}
                className="w-full rounded-lg"
              >
                <Link to="/club/$clubSlug/about" params={{ clubSlug: club.slug }}>
                  {t(action.ctaKey)}
                </Link>
              </Button>
            </Fragment>
          );
        }
        return null;
      })}

      {view.showUpgradeOnlyNote ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {t("clubGate.upgradeOnlyNote", { plan })}
        </p>
      ) : null}

      <p className="text-[11px] leading-snug text-muted-foreground">{t("clubGate.secure")}</p>
    </div>
  );
}

function GateSignupForm({ plan }: { plan: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const runPreAuthGuard = useServerFn(preAuthGuard);
  // Te same pola, etykiety i wymagalność co popup rejestracji i /login -
  // jedno źródło prawdy: newsletter_settings.popup_fields (Admin → Popupy).
  const reg = useRegistrationFields(lang);

  const [values, setValues] = useState<Record<RegistrationFieldKey, string>>({
    first_name: "",
    last_name: "",
    job: "",
    company: "",
    linkedin: "",
    email: "",
    phone: "",
    password: "",
    password_confirm: "",
    list: "",
    newsletter_optin: "",
  });
  const [newsletterOptIn, setNewsletterOptIn] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const set = (key: RegistrationFieldKey, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const on = (key: RegistrationFieldKey) => reg.isEnabled(key);
  const req = (key: RegistrationFieldKey) => reg.isRequired(key);
  const labelOf = (key: RegistrationFieldKey, fallback: string) =>
    `${reg.label(key, fallback)}${req(key) ? " *" : ""}`;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const mail = values.email.trim().toLowerCase();
    if (!EMAIL_RE.test(mail)) {
      toast.error(t("clubGate.errors.email"));
      return;
    }
    if (values.password.length < 8) {
      toast.error(t("clubGate.errors.password"));
      return;
    }
    if (on("password_confirm") && values.password_confirm !== values.password) {
      toast.error(t("clubGate.errors.passwordMismatch"));
      return;
    }
    const missing = reg.visible.find(
      (field) =>
        field.required &&
        field.key !== "newsletter_optin" &&
        field.key !== "list" &&
        values[field.key].trim() === "",
    );
    if (missing) {
      toast.error(t("clubGate.errors.required", { field: reg.label(missing.key, missing.key) }));
      return;
    }
    setBusy(true);
    try {
      try {
        await runPreAuthGuard({ data: { kind: "signup", email: mail } });
      } catch (guardError) {
        const message = guardError instanceof Error ? guardError.message : "";
        if (message.includes("rate_limited")) {
          toast.error(t("clubGate.errors.rate"));
          return;
        }
        throw guardError;
      }

      const { error } = await supabase.auth.signUp({
        email: mail,
        password: values.password,
        options: {
          // Po potwierdzeniu wracamy DOKŁADNIE na tę stronę klubu - intencja
          // użytkownika nie może zginąć w podróży przez skrzynkę pocztową.
          emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
          data: buildSignupMetadata(
            {
              firstName: values.first_name,
              lastName: values.last_name,
              job: values.job,
              company: values.company,
              linkedin: values.linkedin,
              phone: values.phone,
              email: mail,
              newsletterOptIn: on("newsletter_optin") ? newsletterOptIn : false,
            },
            { lang, source: "club_gate" },
          ),
        },
      });
      if (error) throw error;
      setSent(true);
    } catch {
      toast.error(t("clubGate.errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="space-y-3 text-center" aria-live="polite">
        <MailCheck className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
        <p className="text-sm font-medium">{t("clubGate.sentTitle")}</p>
        <p className="text-sm text-muted-foreground">
          {t("clubGate.sentBody", { email: values.email.trim().toLowerCase() })}
        </p>
        <Button asChild variant="outline" className="w-full rounded-lg">
          <Link to="/pricing">{t("clubGate.plansCta")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <p className="flex items-center gap-2 text-sm font-medium">
        <Crown className="h-4 w-4 text-primary" aria-hidden="true" />
        {t("clubGate.signupTitle")}
      </p>
      <p className="text-xs text-muted-foreground">{t("clubGate.signupLead", { plan })}</p>

      {on("first_name") || on("last_name") ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {on("first_name") ? (
            <FieldBox
              label={labelOf("first_name", t("clubGate.firstName"))}
              value={values.first_name}
              autoComplete="given-name"
              onChange={(event) => set("first_name", event.target.value)}
            />
          ) : null}
          {on("last_name") ? (
            <FieldBox
              label={labelOf("last_name", t("clubGate.lastName"))}
              value={values.last_name}
              autoComplete="family-name"
              onChange={(event) => set("last_name", event.target.value)}
            />
          ) : null}
        </div>
      ) : null}

      {on("job") ? (
        <FieldBox
          label={labelOf("job", "Stanowisko")}
          value={values.job}
          autoComplete="organization-title"
          onChange={(event) => set("job", event.target.value)}
        />
      ) : null}
      {on("company") ? (
        <FieldBox
          label={labelOf("company", "Firma / organizacja")}
          value={values.company}
          autoComplete="organization"
          onChange={(event) => set("company", event.target.value)}
        />
      ) : null}
      {on("linkedin") ? (
        <FieldBox
          label={labelOf("linkedin", "LinkedIn")}
          value={values.linkedin}
          autoComplete="url"
          onChange={(event) => set("linkedin", event.target.value)}
        />
      ) : null}

      <div className={on("phone") ? "grid gap-3 sm:grid-cols-2" : undefined}>
        <FieldBox
          label={labelOf("email", t("clubGate.email"))}
          type="email"
          required
          value={values.email}
          autoComplete="email"
          onChange={(event) => set("email", event.target.value)}
        />
        {on("phone") ? (
          <FieldBox
            label={labelOf("phone", "Numer telefonu")}
            type="tel"
            value={values.phone}
            autoComplete="tel"
            onChange={(event) => set("phone", event.target.value)}
          />
        ) : null}
      </div>

      <div className={on("password_confirm") ? "grid gap-3 sm:grid-cols-2" : undefined}>
        <FieldBox
          label={labelOf("password", t("clubGate.password"))}
          type={showPw ? "text" : "password"}
          required
          value={values.password}
          autoComplete="new-password"
          onChange={(event) => set("password", event.target.value)}
          trailing={
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              aria-label={t("clubGate.password")}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {showPw ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          }
        />
        {on("password_confirm") ? (
          <FieldBox
            label={labelOf("password_confirm", "Powtórz hasło")}
            type={showPw ? "text" : "password"}
            required
            value={values.password_confirm}
            autoComplete="new-password"
            onChange={(event) => set("password_confirm", event.target.value)}
          />
        ) : null}
      </div>

      {on("newsletter_optin") ? (
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={newsletterOptIn}
            onCheckedChange={(checked) => setNewsletterOptIn(checked === true)}
            className="mt-0.5"
          />
          <span>{reg.label("newsletter_optin", t("clubGate.newsletterOptIn"))}</span>
        </label>
      ) : null}

      <Button type="submit" className="w-full rounded-lg" disabled={busy}>
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
        )}
        {busy ? t("clubGate.signupBusy") : t("clubGate.signupSubmit", { plan })}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        {t("clubGate.haveAccount")}{" "}
        <Link
          to="/login"
          search={{ mode: "signin" }}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("clubGate.signIn")}
        </Link>
      </p>
      <p className="text-[11px] leading-snug text-muted-foreground">{t("clubGate.secure")}</p>
    </form>
  );
}
