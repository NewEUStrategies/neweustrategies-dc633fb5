// Organizm: FORMULARZ ZGŁOSZENIA WYSTĄPIENIA (`/events/<slug>/cfp-submit`).
//
// ZGŁOSZENIE NALEŻY DO KONTA. Bez logowania strona zaprasza do niego i nic
// więcej - baza i tak odmówiłaby zapisu (`auth_required`), a konto jest jedyną
// drogą powrotu do szkicu, decyzji i odpowiedzi na nią.
//
// `?id=` OTWIERA ISTNIEJĄCE ZGŁOSZENIE, ale tylko własne i tylko w stanie
// edytowalnym (szkic albo prośba o zmiany). Odczyt idzie przez „moje
// zgłoszenia" (`event_my_cfp_submissions`), więc cudzy identyfikator w adresie
// kończy się zdaniem „nie znaleziono", a nie formularzem.
//
// ZAPIS I WYSŁANIE SĄ ROZDZIELONE. „Zapisz szkic" przyjmuje stan niekompletny;
// „Wyślij" najpierw zapisuje bieżący stan, potem go wysyła, a na końcu
// zamawia mail z potwierdzeniem (bez blokowania - brak maila nie cofa
// zgłoszenia).
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { CfpCoSpeakersEditor } from "@/components/events/cfp/molecules/CfpCoSpeakersEditor";
import { CfpSelectField, CfpTextField } from "@/components/events/cfp/molecules/CfpFormFields";
import { RegistrationAnswerField } from "@/components/events/registration/RegistrationAnswerField";
import { useAuth } from "@/hooks/useAuth";
import {
  CFP_TALK_LANGUAGE_LABEL_KEYS,
  CFP_TALK_LANGUAGES,
  localizedPair,
  type CfpTalkLanguage,
} from "@/lib/events/cfpEnums";
import { confirmCfpSubmissionEmail } from "@/lib/events/cfpNotify.functions";
import { countsTowardsCfpLimit, isCfpEditable } from "@/lib/events/cfpRows";
import {
  cfpSubmissionDraftFromItem,
  cfpSubmissionSaveInput,
  emptyCfpSubmissionDraft,
  validateCfpDraftSave,
  validateCfpDraftSubmit,
  toRegistrationFormField,
  type CfpSubmissionDraft,
  type CfpSubmissionDraftField,
  type CfpSubmissionIssue,
} from "@/lib/events/cfpSubmissionDraft";
import type { CfpMySubmission, CfpMySubmissions, CfpPublic } from "@/lib/events/cfpSurface";
import { publicCfpErrorMessage } from "@/lib/events/publicCfpErrors";
import {
  useCfpPublic,
  useMyCfpSubmissions,
  useSaveCfpSubmission,
  useSubmitCfpSubmission,
} from "@/lib/events/useCfpMe";
import { uiLang } from "@/lib/i18n/format";
import { ensureEventCfpI18n } from "@/lib/i18n-event-cfp";
import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";

export function CfpSubmitPage({ slug, submissionId }: { slug: string; submissionId: string | null }) {
  ensureEventCfpI18n();
  ensureEventRegistrationI18n();
  const { t } = useTranslation();
  const { session, loading } = useAuth();
  const signedIn = session !== null;
  const cfpQ = useCfpPublic(slug);
  const mineQ = useMyCfpSubmissions(slug, signedIn);

  if (loading) return <FormSkeleton />;
  if (!signedIn) {
    return (
      <section className="space-y-3 rounded-[6px] border border-border bg-muted/30 p-6">
        <h1 className="text-lg font-bold">{t("eventCfp.submit.signInTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("eventCfp.submit.signInBody")}</p>
        <Button asChild size="sm">
          <Link to="/login">{t("eventCfp.common.signIn")}</Link>
        </Button>
      </section>
    );
  }
  if (cfpQ.isLoading || mineQ.isLoading) return <FormSkeleton />;
  if (cfpQ.error || mineQ.error) {
    return (
      <p className="text-sm text-muted-foreground" role="alert">
        {t("eventCfp.common.loadFailed")}
      </p>
    );
  }
  const cfp = cfpQ.data ?? null;
  const mine = mineQ.data ?? null;
  if (cfp === null || mine === null || cfp.phase === "none") {
    return <Notice slug={slug} text={t("eventCfp.submit.notFound")} />;
  }

  const item = submissionId === null ? null : (mine.items.find((entry) => entry.id === submissionId) ?? null);
  // Świeżo zapisany szkic: adres ma już `?id=`, a lista „moich" jeszcze się
  // odświeża - to nie jest „nie znaleziono".
  if (submissionId !== null && item === null && mineQ.isFetching) return <FormSkeleton />;
  if (submissionId !== null && item === null) {
    return <Notice slug={slug} text={t("eventCfp.submit.draftNotFound")} />;
  }
  if (item !== null && !isCfpEditable(item.status)) {
    return <Notice slug={slug} text={t("eventCfp.submit.notEditable")} />;
  }
  // Szkic (i nowe zgłoszenie) wymaga otwartego naboru; prośba o zmiany - nie.
  if ((item === null || item.status === "draft") && cfp.phase !== "open") {
    return <Notice slug={slug} text={t("eventCfp.submit.closed")} />;
  }

  return (
    <CfpSubmitEditor
      key={submissionId ?? "new"}
      slug={slug}
      cfp={cfp}
      mine={mine}
      item={item}
      accountEmail={session.user.email ?? mine.person?.email ?? ""}
    />
  );
}

function FormSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-6 w-1/2 rounded-[6px]" />
      <Skeleton className="h-40 w-full rounded-[6px]" />
    </div>
  );
}

function Notice({ slug, text }: { slug: string; text: string }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">{text}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link to="/events/$slug/cfp" params={{ slug }}>
            {t("eventCfp.submit.backToCall")}
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to="/events/$slug/speaker" params={{ slug }}>
            {t("eventCfp.submit.toPanel")}
          </Link>
        </Button>
      </div>
    </section>
  );
}

function CfpSubmitEditor({
  slug,
  cfp,
  mine,
  item,
  accountEmail,
}: {
  slug: string;
  cfp: CfpPublic;
  mine: CfpMySubmissions;
  item: CfpMySubmission | null;
  accountEmail: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const navigate = useNavigate();
  const save = useSaveCfpSubmission(slug);
  const submit = useSubmitCfpSubmission(slug);
  const confirmEmail = useServerFn(confirmCfpSubmissionEmail);
  const [draft, setDraft] = useState<CfpSubmissionDraft>(() =>
    item === null ? emptyCfpSubmissionDraft(mine.person, lang) : cfpSubmissionDraftFromItem(item, mine.person),
  );
  const [issues, setIssues] = useState<CfpSubmissionIssue[]>([]);
  const busy = save.isPending || submit.isPending;

  const set = <K extends keyof CfpSubmissionDraft>(key: K, value: CfpSubmissionDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const errorFor = (field: CfpSubmissionDraftField): string | null => {
    const found = issues.find((issue) => issue.field === field);
    return found === undefined ? null : t(found.messageKey);
  };
  const sent = mine.items.filter((entry) => countsTowardsCfpLimit(entry.status)).length;

  /**
   * Zapis bieżącego stanu; zwraca identyfikator (nowy szkic dostaje go z bazy).
   * `pinUrl` dopisuje `?id=` do adresu, żeby odświeżenie strony wróciło do tego
   * szkicu - przy wysyłce zbędne, bo zaraz przechodzimy do panelu prelegenta.
   */
  const persist = async (pinUrl: boolean): Promise<string | null> => {
    try {
      const result = await save.mutateAsync(cfpSubmissionSaveInput(draft, { slug, cfp, notifyLang: lang }));
      if (draft.id === null) {
        setDraft((previous) => ({ ...previous, id: result.id }));
      }
      if (draft.id === null && pinUrl) {
        void navigate({
          to: "/events/$slug/cfp-submit",
          params: { slug },
          search: { id: result.id },
          replace: true,
        });
      }
      return result.id;
    } catch (error) {
      toast.error(publicCfpErrorMessage(error));
      return null;
    }
  };

  const saveDraft = async () => {
    const found = validateCfpDraftSave(draft);
    setIssues(found);
    if (found.length > 0) return;
    const id = await persist(true);
    if (id !== null) toast.success(t("eventCfp.submit.saved"));
  };

  const send = async () => {
    const found = validateCfpDraftSubmit(draft, cfp);
    setIssues(found);
    if (found.length > 0) return;
    const id = await persist(false);
    if (id === null) return;
    try {
      await submit.mutateAsync(id);
    } catch (error) {
      toast.error(publicCfpErrorMessage(error));
      return;
    }
    // Potwierdzenie mailem jest „przy okazji" - odmowa nie cofa wysłania.
    void confirmEmail({ data: { submissionId: id } }).catch(() => undefined);
    toast.success(t("eventCfp.submit.submitted"));
    void navigate({ to: "/events/$slug/speaker", params: { slug } });
  };

  const formatOptions = cfp.formats.map((format) => format.key);
  const trackOptions = cfp.tracks.map((track) => track.id);

  return (
    <form
      className="space-y-8"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">
          {t(item === null ? "eventCfp.submit.title" : "eventCfp.submit.editTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("eventCfp.submit.lead")}</p>
        <p className="text-xs text-muted-foreground">
          {t("eventCfp.submit.limitInfo", { count: sent, max: mine.maxPerSubmitter })}
        </p>
      </header>

      {item !== null && item.status === "changes_requested" ? (
        <section className="space-y-1 rounded-[6px] border border-border bg-muted/30 p-4">
          <h2 className="text-sm font-semibold">{t("eventCfp.submit.changesRequested")}</h2>
          {item.feedbackToSpeaker === "" ? null : (
            <p className="whitespace-pre-line text-sm">{item.feedbackToSpeaker}</p>
          )}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("eventCfp.submit.sections.you")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <CfpTextField
            label={t("eventCfp.submit.fields.firstName")}
            value={draft.firstName}
            maxLength={100}
            required
            error={errorFor("firstName")}
            onChange={(value) => set("firstName", value)}
          />
          <CfpTextField
            label={t("eventCfp.submit.fields.lastName")}
            value={draft.lastName}
            maxLength={100}
            required
            error={errorFor("lastName")}
            onChange={(value) => set("lastName", value)}
          />
          <CfpTextField
            label={t("eventCfp.submit.fields.email")}
            value={accountEmail}
            type="email"
            readOnly
            hint={t("eventCfp.submit.fields.emailHint")}
          />
          <CfpTextField
            label={t("eventCfp.submit.fields.jobTitle")}
            value={draft.jobTitle}
            maxLength={200}
            onChange={(value) => set("jobTitle", value)}
          />
          <CfpTextField
            label={t("eventCfp.submit.fields.company")}
            value={draft.companyText}
            maxLength={200}
            onChange={(value) => set("companyText", value)}
          />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={draft.consentMarketing}
            onCheckedChange={(checked) => set("consentMarketing", checked === true)}
          />
          <span>{t("eventCfp.submit.fields.marketingConsent")}</span>
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("eventCfp.submit.sections.talk")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <CfpTextField
            label={t("eventCfp.submit.fields.titlePl")}
            value={draft.titlePl}
            maxLength={200}
            hint={t("eventCfp.submit.fields.titleHint")}
            error={errorFor("title")}
            onChange={(value) => set("titlePl", value)}
          />
          <CfpTextField
            label={t("eventCfp.submit.fields.titleEn")}
            value={draft.titleEn}
            maxLength={200}
            onChange={(value) => set("titleEn", value)}
          />
          <CfpTextField
            label={t("eventCfp.submit.fields.abstractPl")}
            value={draft.abstractPl}
            rows={6}
            maxLength={4000}
            hint={t("eventCfp.submit.fields.abstractHint")}
            error={errorFor("abstract")}
            onChange={(value) => set("abstractPl", value)}
          />
          <CfpTextField
            label={t("eventCfp.submit.fields.abstractEn")}
            value={draft.abstractEn}
            rows={6}
            maxLength={4000}
            onChange={(value) => set("abstractEn", value)}
          />
          <CfpSelectField<CfpTalkLanguage>
            label={t("eventCfp.submit.fields.talkLanguage")}
            value={draft.talkLanguage}
            options={CFP_TALK_LANGUAGES}
            labelFor={(option) => t(CFP_TALK_LANGUAGE_LABEL_KEYS[option])}
            onChange={(value) => set("talkLanguage", value)}
          />
          {formatOptions.length === 0 ? null : (
            <CfpSelectField<string>
              label={t("eventCfp.submit.fields.format")}
              value={draft.formatKey}
              options={formatOptions}
              placeholder={t("eventCfp.submit.fields.formatPlaceholder")}
              required
              error={errorFor("format")}
              labelFor={(key) => {
                const format = cfp.formats.find((entry) => entry.key === key);
                return format === undefined
                  ? key
                  : `${localizedPair(lang, format.labelPl, format.labelEn)} (${t("eventCfp.page.formatDuration", { count: format.durationMin })})`;
              }}
              onChange={(value) => set("formatKey", value)}
            />
          )}
          {trackOptions.length === 0 ? null : (
            <CfpSelectField<string>
              label={t("eventCfp.submit.fields.track")}
              value={draft.trackId}
              options={trackOptions}
              placeholder={t("eventCfp.submit.fields.trackPlaceholder")}
              required
              error={errorFor("track")}
              labelFor={(id) => {
                const track = cfp.tracks.find((entry) => entry.id === id);
                return track === undefined ? id : localizedPair(lang, track.namePl, track.nameEn);
              }}
              onChange={(value) => set("trackId", value)}
            />
          )}
          <CfpTextField
            label={t("eventCfp.submit.fields.topics")}
            value={draft.topics}
            maxLength={700}
            hint={t("eventCfp.submit.fields.topicsHint")}
            onChange={(value) => set("topics", value)}
          />
        </div>
      </section>

      {cfp.allowCoSpeakers ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("eventCfp.submit.sections.coSpeakers")}</h2>
          <CfpCoSpeakersEditor
            speakers={draft.coSpeakers}
            onChange={(coSpeakers) => set("coSpeakers", coSpeakers)}
            error={errorFor("coSpeakers")}
          />
        </section>
      ) : null}

      {cfp.fields.length === 0 ? null : (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t("eventCfp.submit.sections.questions")}</h2>
          {cfp.fields.map((field) => (
            <RegistrationAnswerField
              key={field.key}
              field={toRegistrationFormField(field)}
              value={draft.answers[field.key]}
              lang={lang}
              error={errorFor(`answer:${field.key}`)}
              onChange={(value) =>
                setDraft((previous) => ({
                  ...previous,
                  answers: { ...previous.answers, [field.key]: value },
                }))
              }
            />
          ))}
        </section>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void saveDraft()}>
          {t(save.isPending && !submit.isPending ? "eventCfp.common.saving" : "eventCfp.submit.saveDraft")}
        </Button>
        <Button type="submit" disabled={busy}>
          {t(submit.isPending ? "eventCfp.submit.sending" : "eventCfp.submit.send")}
        </Button>
        <Button asChild type="button" variant="ghost">
          <Link to="/events/$slug/cfp" params={{ slug }}>
            {t("eventCfp.submit.backToCall")}
          </Link>
        </Button>
      </div>
    </form>
  );
}
