// Organizm: PANEL PRELEGENTA wydarzenia (`/events/<slug>/speaker`).
//
// CZTERY PYTANIA PRELEGENTA, JEDEN EKRAN: „co z moim zgłoszeniem", „jak mnie
// przedstawicie", „kiedy i gdzie występuję", „gdzie wrzucić prezentację".
// Każda zakładka czyta WŁASNE dane wołającego (`auth.uid()`), więc panel nie ma
// bramki na trasie - gość dostaje zaproszenie do logowania.
//
// PROFIL I MATERIAŁY POJAWIAJĄ SIĘ PO PRZYJĘCIU. Nakładka sceniczna i materiały
// wiszą na profilu prelegenta w rejestrze wydarzenia, a ten powstaje przy
// przyjęciu pierwszego wystąpienia (albo ręcznym dodaniu przez organizatora).
// Wcześniej zakładka mówi to wprost zamiast pokazywać formularz, którego zapis
// baza by odbiła (`not_speaker`).
//
// DANE TYLKO W PRZEGLĄDARCE. Trasa jest w powłoce wydarzenia (pasek zakładek),
// ale panel pyta o dane dopiero po montażu - SSR i pierwszy render rysują ten
// sam szkielet.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SpeakerMaterialDialog } from "@/components/events/cfp/molecules/SpeakerMaterialDialog";
import { SpeakerProfileForm } from "@/components/events/cfp/molecules/SpeakerProfileForm";
import { SpeakerSubmissionsList } from "@/components/events/cfp/molecules/SpeakerSubmissionsList";
import { useAuth } from "@/hooks/useAuth";
import { confirmDialog } from "@/lib/appDialogs";
import {
  CFP_SPEAKER_ROLE_LABEL_KEYS,
  localizedPair,
  SPEAKER_MATERIAL_KIND_LABEL_KEYS,
  SPEAKER_MATERIAL_VISIBILITY_LABEL_KEYS,
} from "@/lib/events/cfpEnums";
import type { SpeakerMaterialInput } from "@/lib/events/cfpPublicApi";
import type { SpeakerPanel, SpeakerPanelMaterial } from "@/lib/events/cfpSurface";
import { publicCfpErrorMessage } from "@/lib/events/publicCfpErrors";
import { formatEventDateTime } from "@/lib/events/timezone";
import {
  useCfpPublic,
  useDeleteSpeakerMaterial,
  useMyCfpSubmissions,
  useSaveSpeakerMaterial,
  useSpeakerPanel,
} from "@/lib/events/useCfpMe";
import { uiLang } from "@/lib/i18n/format";
import { ensureEventCfpI18n } from "@/lib/i18n-event-cfp";
import { useNowMs } from "@/lib/time/useNowMs";

export function SpeakerPanelPage({ slug }: { slug: string }) {
  ensureEventCfpI18n();
  const { t } = useTranslation();
  const { session } = useAuth();
  const mounted = useNowMs() !== null;
  const signedIn = mounted && session !== null;
  const panelQ = useSpeakerPanel(slug, signedIn);
  const mineQ = useMyCfpSubmissions(slug, signedIn);
  const cfpQ = useCfpPublic(slug, signedIn);

  if (!mounted) return <PanelSkeleton />;
  if (session === null) {
    return (
      <section className="space-y-3 rounded-[6px] border border-border bg-muted/30 p-6">
        <h1 className="text-lg font-bold">{t("eventCfp.speaker.signInTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("eventCfp.speaker.signInBody")}</p>
        <Button asChild size="sm">
          <Link to="/login">{t("eventCfp.common.signIn")}</Link>
        </Button>
      </section>
    );
  }
  if (panelQ.isLoading || mineQ.isLoading) return <PanelSkeleton />;
  const panel = panelQ.data ?? null;
  const mine = mineQ.data ?? null;
  if (panelQ.error || mineQ.error || panel === null || mine === null) {
    return (
      <p className="text-sm text-muted-foreground" role="alert">
        {t("eventCfp.common.loadFailed")}
      </p>
    );
  }

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-bold">{t("eventCfp.speaker.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("eventCfp.speaker.lead")}</p>
        {panel.isReviewer ? (
          <p className="text-sm">
            <Link to="/events/$slug/review" params={{ slug }} className="underline underline-offset-2">
              {t("eventCfp.speaker.reviewerLink")}
            </Link>
          </p>
        ) : null}
      </header>
      <Tabs defaultValue="submissions" className="space-y-4">
        <TabsList className="flex w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="submissions">{t("eventCfp.speaker.tabs.submissions")}</TabsTrigger>
          <TabsTrigger value="profile">{t("eventCfp.speaker.tabs.profile")}</TabsTrigger>
          <TabsTrigger value="sessions">{t("eventCfp.speaker.tabs.sessions")}</TabsTrigger>
          <TabsTrigger value="materials">{t("eventCfp.speaker.tabs.materials")}</TabsTrigger>
        </TabsList>
        <TabsContent value="submissions">
          <SpeakerSubmissionsList slug={slug} data={mine} canSubmit={cfpQ.data?.phase === "open"} />
        </TabsContent>
        <TabsContent value="profile">
          {panel.profile === null ? (
            <p className="text-sm text-muted-foreground">{t("eventCfp.speaker.profile.noProfile")}</p>
          ) : (
            <SpeakerProfileForm slug={slug} profile={panel.profile} />
          )}
        </TabsContent>
        <TabsContent value="sessions">
          <SpeakerSessions panel={panel} />
        </TabsContent>
        <TabsContent value="materials">
          {panel.profile === null ? (
            <p className="text-sm text-muted-foreground">{t("eventCfp.speaker.profile.noProfile")}</p>
          ) : (
            <SpeakerMaterials slug={slug} panel={panel} />
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-6 w-1/3 rounded-[6px]" />
      <Skeleton className="h-32 w-full rounded-[6px]" />
    </div>
  );
}

function SpeakerSessions({ panel }: { panel: SpeakerPanel }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  if (panel.sessions.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("eventCfp.speaker.sessions.empty")}</p>;
  }
  return (
    <ul className="space-y-3">
      {panel.sessions.map((session) => {
        const track = localizedPair(lang, session.trackNamePl ?? "", session.trackNameEn ?? "");
        return (
          <li key={session.sessionId} className="space-y-1 rounded-[6px] border border-border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{localizedPair(lang, session.titlePl, session.titleEn)}</h3>
              <Badge variant="outline">{t(CFP_SPEAKER_ROLE_LABEL_KEYS[session.role])}</Badge>
            </div>
            <p className="text-sm">
              {session.startsAt === null
                ? t("eventCfp.speaker.sessions.noTime")
                : formatEventDateTime(session.startsAt, panel.timezone, lang)}
            </p>
            {session.roomName === null ? null : (
              <p className="text-xs text-muted-foreground">
                {t("eventCfp.speaker.sessions.room", { room: session.roomName })}
              </p>
            )}
            {track === "" ? null : (
              <p className="text-xs text-muted-foreground">{t("eventCfp.speaker.sessions.track", { track })}</p>
            )}
            {session.status === "draft" ? (
              <p className="text-xs text-muted-foreground">{t("eventCfp.speaker.sessions.draft")}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function SpeakerMaterials({ slug, panel }: { slug: string; panel: SpeakerPanel }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const save = useSaveSpeakerMaterial(slug);
  const remove = useDeleteSpeakerMaterial(slug);
  const [editing, setEditing] = useState<SpeakerPanelMaterial | null>(null);
  const [open, setOpen] = useState(false);

  const openDialog = (material: SpeakerPanelMaterial | null) => {
    setEditing(material);
    setOpen(true);
  };

  const submit = (input: SpeakerMaterialInput) =>
    save.mutate(input, {
      onSuccess: () => {
        setOpen(false);
        toast.success(t("eventCfp.speaker.materials.saved"));
      },
      onError: (error) => toast.error(publicCfpErrorMessage(error)),
    });

  const runDelete = async (material: SpeakerPanelMaterial) => {
    const confirmed = await confirmDialog({
      title: t("eventCfp.speaker.materials.deleteTitle"),
      description: t("eventCfp.speaker.materials.deleteDescription"),
      confirmLabel: t("eventCfp.common.delete"),
      cancelLabel: t("eventCfp.common.cancel"),
      destructive: true,
    });
    if (!confirmed) return;
    remove.mutate(material.id, {
      onSuccess: () => toast.success(t("eventCfp.speaker.materials.deleted")),
      onError: (error) => toast.error(publicCfpErrorMessage(error)),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-sm text-muted-foreground">{t("eventCfp.speaker.materials.lead")}</p>
        <Button type="button" size="sm" onClick={() => openDialog(null)}>
          {t("eventCfp.speaker.materials.add")}
        </Button>
      </div>
      {panel.materials.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("eventCfp.speaker.materials.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {panel.materials.map((material) => (
            <li
              key={material.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-border p-3"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium">{localizedPair(lang, material.titlePl, material.titleEn)}</p>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{t(SPEAKER_MATERIAL_KIND_LABEL_KEYS[material.kind])}</span>
                  <span>{t(SPEAKER_MATERIAL_VISIBILITY_LABEL_KEYS[material.visibility])}</span>
                  <Badge variant={material.isPublished ? "default" : "outline"}>
                    {t(material.isPublished ? "eventCfp.speaker.materials.published" : "eventCfp.speaker.materials.pending")}
                  </Badge>
                </div>
              </div>
              <div className="flex gap-1">
                <Button asChild type="button" size="sm" variant="ghost">
                  <a href={material.url} target="_blank" rel="noopener noreferrer nofollow">
                    {t("eventCfp.speaker.materials.open")}
                  </a>
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => openDialog(material)}>
                  {t("eventCfp.common.edit")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => void runDelete(material)}
                >
                  {t("eventCfp.common.delete")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <SpeakerMaterialDialog
        open={open}
        onOpenChange={setOpen}
        slug={slug}
        material={editing}
        sessions={panel.sessions}
        isSaving={save.isPending}
        onSubmit={submit}
      />
    </div>
  );
}
