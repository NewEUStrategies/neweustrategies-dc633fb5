// Organizm: zakładanie klubu.
//
// Wcześniej "Nowy klub" tworzył od razu wersję roboczą ze slugiem z znacznika
// czasu (`klub-m3x9p2`) i przerzucał do edytora. Dwa problemy, oba realne:
//
//   1. Przy KAŻDEJ odmowie RPC panel pokazywał jedno zdanie "Nie udało się
//      zapisać". Zajęty adres, nierozwiązany tenant i brak uprawnień to trzy
//      różne problemy z trzema różnymi następnymi krokami - administrator
//      dostawał ten sam ślepy zaułek i nie miał czego naprawić.
//   2. Adres z znacznika czasu zostawał w URL-u na zawsze, bo nikt nie wraca
//      do zakładki "Ogólne", żeby go poprawić. Klub publiczny dostawał więc
//      adres wyglądający jak identyfikator sesji.
//
// Teraz formularz pyta o to, co naprawdę trzeba wiedzieć na starcie, adres
// układa się z nazwy na oczach piszącego, a dostępność sprawdza się PRZED
// zapisem. Reszta ustawień zostaje w edytorze - to jest zakładanie, nie
// konfigurowanie wszystkiego naraz.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { uiLang } from "@/lib/i18n/format";
import {
  CLUB_PLAN_TIERS,
  DEFAULT_CLUB_PLAN_TIER,
  rankFromPlanTier,
  type ClubPlanTier,
} from "@/lib/clubs/planTiers";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CoverImagePicker } from "@/components/admin/CoverImagePicker";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { ClubEnumSelect } from "@/components/clubs/molecules/ClubEnumSelect";
import { ClubTopicSelect } from "@/components/clubs/molecules/ClubTopicSelect";
import { ClubLayoutPicker } from "../molecules/ClubLayoutPicker";
import { useClubSlugAvailable, useUpsertClub } from "@/lib/clubs/useClubs";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";
import {
  CLUB_ATTRIBUTION_MODES,
  CLUB_JOIN_POLICIES,
  CLUB_VISIBILITIES,
  clubSlugFromName,
  toClubSaveError,
  type ClubAttributionMode,
  type ClubJoinPolicy,
  type ClubLayout,
  type ClubVisibility,
} from "@/lib/clubs/types";

export function ClubCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (clubId: string) => void;
}) {
  ensureAdminClubsI18n();
  const { t, i18n } = useTranslation();
  // Nazwa mowi, co ta flaga naprawde robi: wybiera KOLUMNE zapisu tagline'u,
  // a nie etykiete interfejsu.
  const writesPolish = uiLang(i18n.language) === "pl";
  const createM = useUpsertClub();

  const [namePl, setNamePl] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [slug, setSlug] = useState("");
  // Dopóki administrator nie tknie pola adresu, adres podąża za nazwą. Po
  // pierwszej ręcznej edycji przestaje - inaczej poprawka adresu znikałaby
  // przy następnej literze w nazwie.
  const [slugTouched, setSlugTouched] = useState(false);
  const [tagline, setTagline] = useState("");
  const [visibility, setVisibility] = useState<ClubVisibility>("members");
  const [joinPolicy, setJoinPolicy] = useState<ClubJoinPolicy>("request");
  const [attribution, setAttribution] = useState<ClubAttributionMode>("attributed");
  const [layout, setLayout] = useState<ClubLayout>("list");
  // Próg planu jest domyślnie "pro": kluby powstają jako przestrzeń dla
  // płacących członków, a obniżenie progu jest świadomą decyzją.
  const [planTier, setPlanTier] = useState<ClubPlanTier>(DEFAULT_CLUB_PLAN_TIER);
  const [cover, setCover] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  // Kolizja zgłoszona przez RPC przy ZAPISIE. Sprawdzanie na żywo łapie
  // większość przypadków, ale nie wyścig: ktoś inny mógł zająć ten adres
  // między sprawdzeniem a kliknięciem. Wtedy toast znika po chwili, a
  // formularz musi zostać z widocznym powodem przy właściwym polu.
  const [slugConflict, setSlugConflict] = useState<string | null>(null);

  const effectiveSlug = slugTouched ? slug : clubSlugFromName(namePl);
  const debouncedSlug = useDebouncedValue(effectiveSlug, 350);
  const availableQ = useClubSlugAvailable(debouncedSlug);

  useEffect(() => {
    if (!open) return;
    setNamePl("");
    setNameEn("");
    setSlug("");
    setSlugTouched(false);
    setTagline("");
    setVisibility("members");
    setJoinPolicy("request");
    setAttribution("attributed");
    setLayout("list");
    setPlanTier(DEFAULT_CLUB_PLAN_TIER);
    setCover("");
    setSlugConflict(null);
  }, [open]);

  // Zajęty adres z serwera unieważnia się sam, gdy tylko adres się zmieni.
  useEffect(() => {
    setSlugConflict((current) => (current !== null && current !== effectiveSlug ? null : current));
  }, [effectiveSlug]);

  const slugState = useMemo(() => {
    if (effectiveSlug.length === 0) return "empty" as const;
    if (effectiveSlug.length < 3) return "short" as const;
    if (slugConflict === effectiveSlug) return "taken" as const;
    if (debouncedSlug !== effectiveSlug || availableQ.isFetching) return "checking" as const;
    if (availableQ.data === false) return "taken" as const;
    if (availableQ.data === true) return "free" as const;
    return "checking" as const;
  }, [effectiveSlug, debouncedSlug, availableQ.isFetching, availableQ.data, slugConflict]);

  const canSubmit = namePl.trim().length >= 3 && slugState === "free" && !createM.isPending;

  const submit = () => {
    if (!canSubmit) return;
    createM.mutate(
      {
        slug: effectiveSlug,
        name_pl: namePl.trim(),
        name_en: nameEn.trim() !== "" ? nameEn.trim() : namePl.trim(),
        // Jedno pole tagline'u trafia do kolumny jezyka, w ktorym redaktor
        // pracuje; druga zostaje pusta CELOWO. Czytelnicy sciagaja te wartosc
        // przez `pickLocalized`, ktory przy pustej kolumnie siega po drugi
        // jezyk - wiec zapisanie tu tego samego tekstu w obu kolumnach
        // udawaloby tlumaczenie, ktorego nie ma.
        tagline_pl: writesPolish ? tagline.trim() || null : null,
        tagline_en: writesPolish ? null : tagline.trim() || null,
        visibility,
        join_policy: joinPolicy,
        attribution_mode: attribution,
        layout,
        min_tier_rank: rankFromPlanTier(planTier),
        cover_image_url: cover.trim() || null,
        policy_area: topic,
        status: "draft",
      },
      {
        onSuccess: (clubId) => {
          toast.success(t("adminClubs.create.done"));
          onOpenChange(false);
          onCreated(clubId);
        },
        // Konkretny powód zamiast "Nie udało się zapisać". Kod slug_taken
        // dodatkowo NIE zamyka dialogu - formularz zostaje z wpisaną treścią,
        // żeby dało się poprawić sam adres.
        onError: (error) => {
          const code = toClubSaveError(error);
          // Dialog zostaje otwarty w KAŻDYM przypadku - wpisana treść jest
          // wartościowsza niż czysty ekran. Przy zajętym adresie dokładamy
          // trwały komunikat przy polu, bo to jedyna odmowa, którą piszący
          // naprawia jednym polem.
          if (code === "slug_taken") setSlugConflict(effectiveSlug);
          toast.error(t(`adminClubs.create.error.${code}`));
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-left">{t("adminClubs.create.title")}</DialogTitle>
          <DialogDescription className="text-left">{t("adminClubs.create.hint")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="club-create-name-pl">{t("adminClubs.fields.namePl")}</Label>
              <Input
                id="club-create-name-pl"
                value={namePl}
                maxLength={120}
                autoFocus
                onChange={(e) => setNamePl(e.target.value)}
                placeholder={t("adminClubs.create.namePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="club-create-name-en">{t("adminClubs.fields.nameEn")}</Label>
              <Input
                id="club-create-name-en"
                value={nameEn}
                maxLength={120}
                onChange={(e) => setNameEn(e.target.value)}
                placeholder={namePl.trim() !== "" ? namePl : ""}
              />
              <p className="text-xs text-muted-foreground">{t("adminClubs.create.nameEnHint")}</p>
            </div>
          </div>

          {/* Adres z żywą informacją zwrotną. */}
          <div className="space-y-1.5">
            <Label htmlFor="club-create-slug">{t("adminClubs.fields.slug")}</Label>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-sm text-muted-foreground">/club/</span>
              <Input
                id="club-create-slug"
                value={effectiveSlug}
                maxLength={80}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(clubSlugFromName(e.target.value));
                }}
                aria-describedby="club-create-slug-state"
              />
              <SlugState state={slugState} />
            </div>
            <p
              id="club-create-slug-state"
              role={slugState === "taken" ? "alert" : undefined}
              className={
                slugState === "taken"
                  ? "text-xs font-medium text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {slugState === "taken"
                ? t("adminClubs.create.slugTaken")
                : slugState === "free"
                  ? t("adminClubs.create.slugFree")
                  : t("adminClubs.fields.slugHint")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="club-create-tagline">{t("adminClubs.fields.taglinePl")}</Label>
            <Textarea
              id="club-create-tagline"
              rows={2}
              maxLength={280}
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder={t("adminClubs.create.taglinePlaceholder")}
            />
          </div>

          {/* --- układ --- */}
          <div className="space-y-2">
            <div>
              <Label>{t("adminClubs.layout.label")}</Label>
              <p className="text-xs text-muted-foreground">{t("adminClubs.layout.hint")}</p>
            </div>
            <ClubLayoutPicker value={layout} onChange={setLayout} disabled={createM.isPending} />
          </div>

          <ClubTopicSelect
            id="club-create-topic"
            label={t("adminClubs.fields.policyArea")}
            hint={t("club.topic.hint")}
            value={topic}
            onChange={setTopic}
            disabled={createM.isPending}
          />

          {/* --- okładka --- */}
          <CoverImagePicker
            label={t("adminClubs.fields.cover")}
            value={cover}
            onChange={setCover}
            folder="clubs"
          />

          {/* --- dostęp: trzy decyzje, które trudno zmienić później --- */}
          <div className="grid gap-4 rounded-lg border border-border/60 p-3 sm:grid-cols-3">
            <ClubEnumSelect
              id="club-create-visibility"
              label={t("adminClubs.fields.visibility")}
              value={visibility}
              options={CLUB_VISIBILITIES}
              i18nPrefix="club.visibility"
              hintPrefix="club.visibilityHint"
              onChange={setVisibility}
              disabled={createM.isPending}
            />
            <ClubEnumSelect
              id="club-create-join"
              label={t("adminClubs.fields.joinPolicy")}
              value={joinPolicy}
              options={CLUB_JOIN_POLICIES}
              i18nPrefix="club.joinPolicy"
              onChange={setJoinPolicy}
              disabled={createM.isPending}
            />
            <ClubEnumSelect
              id="club-create-attribution"
              label={t("adminClubs.fields.attributionMode")}
              value={attribution}
              options={CLUB_ATTRIBUTION_MODES}
              i18nPrefix="club.attribution"
              hintPrefix="club.attributionHint"
              onChange={setAttribution}
              disabled={createM.isPending}
            />
            <ClubEnumSelect
              id="club-create-min-tier"
              label={t("adminClubs.fields.minTier")}
              value={planTier}
              options={CLUB_PLAN_TIERS}
              i18nPrefix="club.planTier"
              hintPrefix="club.planTierHint"
              onChange={setPlanTier}
              disabled={createM.isPending}
            />
          </div>

          <p className="text-xs text-muted-foreground">{t("adminClubs.create.draftNote")}</p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {createM.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("adminClubs.create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SlugState({ state }: { state: "empty" | "short" | "checking" | "free" | "taken" }) {
  const { t } = useTranslation();
  if (state === "checking") {
    return (
      <Loader2
        className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
        aria-label={t("adminClubs.create.slugChecking")}
      />
    );
  }
  if (state === "free") {
    return (
      <Check
        className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
        aria-label={t("adminClubs.create.slugFree")}
      />
    );
  }
  if (state === "taken") {
    return (
      <X
        className="h-4 w-4 shrink-0 text-destructive"
        aria-label={t("adminClubs.create.slugTaken")}
      />
    );
  }
  return <span className="h-4 w-4 shrink-0" aria-hidden="true" />;
}
