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
//
// KOMPOZYCJA, NIE LOGIKA. Reguły tego formularza (stan adresu, warunek
// wysyłki, kształt payloadu, skutki odmowy) mieszkają w
// `lib/clubs/adminClubCreateForm`, a powtarzalne wiersze pól - w molekułach
// `ClubDialogTextRow` i `ClubDialogSlugRow`. Tutaj zostaje SKLEJENIE: stan
// formularza, wpięcie zapytania o dostępność i to, co leci do mutacji.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { uiLang } from "@/lib/i18n/format";
import { CLUB_PLAN_TIERS, DEFAULT_CLUB_PLAN_TIER, type ClubPlanTier } from "@/lib/clubs/planTiers";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { ClubDialogSlugRow } from "../molecules/ClubDialogSlugRow";
import { ClubDialogTextRow } from "../molecules/ClubDialogTextRow";
import { useClubSlugAvailable, useUpsertClub } from "@/lib/clubs/useClubs";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";
import {
  canSubmitClubCreate,
  clubCreateEffectiveSlug,
  clubCreateFailure,
  clubCreatePayload,
  clubCreateSlugState,
  nextClubSlugConflict,
} from "@/lib/clubs/adminClubCreateForm";
import {
  CLUB_ATTRIBUTION_MODES,
  CLUB_JOIN_POLICIES,
  CLUB_VISIBILITIES,
  clubSlugFromName,
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

  const effectiveSlug = clubCreateEffectiveSlug({ slugTouched, slug, namePl });
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
    setSlugConflict((current) => nextClubSlugConflict(current, effectiveSlug));
  }, [effectiveSlug]);

  const slugState = useMemo(
    () =>
      clubCreateSlugState({
        effectiveSlug,
        debouncedSlug,
        isFetching: availableQ.isFetching,
        available: availableQ.data,
        serverConflict: slugConflict,
      }),
    [effectiveSlug, debouncedSlug, availableQ.isFetching, availableQ.data, slugConflict],
  );

  const canSubmit = canSubmitClubCreate({
    namePl,
    slugState,
    isPending: createM.isPending,
  });

  // JEDNA BRAMKA, NIE DWIE. Warunek wysyłki żyje w `canSubmitClubCreate`
  // i wyłącza przycisk; drugi warunek wewnątrz `submit` byłby drugim miejscem,
  // w którym trzeba pamiętać o tej samej regule - i pierwszym, o którym się
  // zapomni. Stany blokujące (nazwa za krótka, adres inny niż wolny, zapis
  // w locie) mają dowód w `ClubCreateDialog.test.tsx`: klik nie wysyła nic.
  const submit = () => {
    createM.mutate(
      clubCreatePayload(
        {
          slug: effectiveSlug,
          namePl,
          nameEn,
          tagline,
          visibility,
          joinPolicy,
          attribution,
          layout,
          planTier,
          cover,
          topic,
        },
        { writesPolish },
      ),
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
          // Dialog zostaje otwarty w KAŻDYM przypadku - wpisana treść jest
          // wartościowsza niż czysty ekran. Przy zajętym adresie dokładamy
          // trwały komunikat przy polu, bo to jedyna odmowa, którą piszący
          // naprawia jednym polem.
          const failure = clubCreateFailure(error);
          if (failure.blocksSlug) setSlugConflict(effectiveSlug);
          toast.error(t(failure.key));
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
            <ClubDialogTextRow
              id="club-create-name-pl"
              labelKey="adminClubs.fields.namePl"
              value={namePl}
              maxLength={120}
              autoFocus
              placeholderKey="adminClubs.create.namePlaceholder"
              onValueChange={setNamePl}
            />
            <ClubDialogTextRow
              id="club-create-name-en"
              labelKey="adminClubs.fields.nameEn"
              value={nameEn}
              maxLength={120}
              // Zastępcza treść odbija nazwę POLSKĄ, bo puste pole angielskie
              // zapisze się właśnie nią - i to trzeba widzieć przed zapisem.
              placeholderText={namePl.trim() !== "" ? namePl : ""}
              hintKey="adminClubs.create.nameEnHint"
              onValueChange={setNameEn}
            />
          </div>

          {/* Adres z żywą informacją zwrotną. */}
          <ClubDialogSlugRow
            id="club-create-slug"
            labelKey="adminClubs.fields.slug"
            prefix="/club/"
            value={effectiveSlug}
            state={slugState}
            maxLength={80}
            onValueChange={(next) => {
              setSlugTouched(true);
              setSlug(clubSlugFromName(next));
            }}
          />

          <ClubDialogTextRow
            id="club-create-tagline"
            labelKey="adminClubs.fields.taglinePl"
            value={tagline}
            rows={2}
            maxLength={280}
            placeholderKey="adminClubs.create.taglinePlaceholder"
            onValueChange={setTagline}
          />

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
