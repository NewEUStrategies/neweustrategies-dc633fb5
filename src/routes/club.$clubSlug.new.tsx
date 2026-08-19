// /club/$clubSlug/new - kompozytor tematu.
//
// Osobna trasa, nie dialog: temat ma tytuł, treść do 20 000 znaków, rodzaj
// i opcjonalną kotwicę. Dialog na tyle pól zmusza do scrollowania w oknie
// nad przyciemnionym tłem, co przy dłuższym pisaniu jest męczące.
//
// Wybór rodzaju niesie JEDNOZDANIOWE wyjaśnienie, co dany rodzaj zmienia -
// bo rodzaj zmienia cykl życia wątku, a nie tylko etykietę, i użytkownik nie
// ma skąd tego wiedzieć.
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ClubEnumSelect } from "@/components/clubs/molecules/ClubEnumSelect";
import { ClubIconPicker } from "@/components/clubs/molecules/ClubIconPicker";
import { ClubTopicSelect } from "@/components/clubs/molecules/ClubTopicSelect";
import { normalizeClubTopic } from "@/lib/clubs/policyAreas";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClubBySlug, useClubGroups, useCreateClubThread } from "@/lib/clubs/useClubs";
import { MentionTextarea } from "@/components/mentions/MentionTextarea";
import {
  ClubAnchorPicker,
  type ClubAnchorValue,
} from "@/components/clubs/molecules/ClubAnchorPicker";
import { buildClubHead, toClubHeadSource } from "@/lib/clubs/clubHead";
import { fetchClubBySlug } from "@/lib/clubs/publicClub";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { newIdempotencyKey } from "@/lib/http/idempotency";
import { useThreadDraft } from "@/lib/clubs/useThreadDraft";
import { formatDateTime, uiLang } from "@/lib/i18n/format";
import {
  CLUB_THREAD_KINDS,
  type ClubAttributionMode,
  type ClubThreadKind,
} from "@/lib/clubs/types";
// Reguły kompozytora (progi pól, dziedziczenie atrybucji, widoczność pól,
// payload mutacji) mieszkają w czystym module - patrz jego nagłówek.
import {
  CLUB_THREAD_BODY_MAX,
  CLUB_THREAD_TITLE_MAX,
  NEW_THREAD_ATTRIBUTION_INHERIT,
  attributionHintKey,
  attributionInheritLabel,
  attributionOverrideChoices,
  attributionSelectValue,
  baseAttributionMode,
  buildNewThreadPayload,
  canComposeThread,
  canPostAnonymously,
  defaultLockReplies,
  effectiveAttributionMode,
  isAttributionOverrideAllowed,
  newThreadDenialKey,
  newThreadFieldVisibility,
  newThreadFormReady,
  newThreadOutcome,
  postableThreadGroups,
  readAttributionSelection,
  resolveThreadGroupId,
  resolveThreadKind,
  threadKindChoices,
} from "@/lib/clubs/newThreadForm";
import { ensureClubI18n } from "@/lib/i18n-club";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

export const Route = createFileRoute("/club/$clubSlug/new")({
  // Rodzaj wątku przychodzi z kompozytora na hubie ("Zadaj pytanie",
  // "Zajmij stanowisko"). Bez tego parametru te skróty byłyby ozdobą:
  // prowadziłyby do formularza ustawionego zawsze na "dyskusję", więc
  // użytkownik i tak musiałby przestawić droplistę, którą już raz kliknął.
  //
  // Wartość spoza słownika degraduje do domyślnej - adres jest wejściem
  // użytkownika i nie ma prawa wywrócić kompozytora.
  validateSearch: (
    search: Record<string, unknown>,
  ): { kind?: ClubThreadKind; groupId?: string } => {
    const raw = search["kind"];
    const rawGroup = search["groupId"];
    const out: { kind?: ClubThreadKind; groupId?: string } = {};
    if (typeof raw === "string" && (CLUB_THREAD_KINDS as readonly string[]).includes(raw)) {
      out.kind = raw as ClubThreadKind;
    }
    // Dział przychodzi z kompozytora na hubie; wartość spoza listy działów
    // formularz i tak zignoruje (wybór spada na pierwszy dozwolony dział).
    if (typeof rawGroup === "string" && rawGroup !== "") out.groupId = rawGroup;
    return out;
  },
  loader: async ({ context, params }) => {
    const club = await context.queryClient
      .ensureQueryData({
        queryKey: clubKeys.bySlug(params.clubSlug),
        queryFn: () => fetchClubBySlug(params.clubSlug),
      })
      .catch(() => null);
    return { club: toClubHeadSource(club) };
  },
  // `forceNoindex`: kompozytor jest powierzchnią CZYNNOŚCIOWĄ. Nawet w klubie
  // publicznym pusty formularz w indeksie wyszukiwarki jest szumem, a nie
  // lejkiem - do indeksu należy wątek, nie narzędzie do jego napisania.
  head: ({ loaderData, params }) =>
    buildClubHead({
      fallbackPath: `/club/${params.clubSlug}/new`,
      club: loaderData?.club ?? null,
      forceNoindex: true,
    }),
  component: ClubNewThread,
});

function ClubNewThread() {
  ensureClubI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { clubSlug } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const clubQ = useClubBySlug(clubSlug);
  const club = clubQ.data ?? null;
  const groupsQ = useClubGroups(club?.id);
  const createM = useCreateClubThread(club?.id ?? "");

  const [groupId, setGroupId] = useState(search.groupId ?? "");
  // Rodzaj z adresu jest wartością POCZĄTKOWĄ, nie sterującą: po wejściu
  // droplista należy do użytkownika i przeładowanie propsa nie ma prawa
  // cofnąć jego wyboru.
  const [kind, setKind] = useState<ClubThreadKind>(search.kind ?? "discussion");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [lockReplies, setLockReplies] = useState(false);
  // Obszar tematyczny watku - domyslnie dziedziczony z klubu, ale autor moze
  // go zawezic albo wyczyscic; RPC waliduje wartosc slownikiem.
  const [topic, setTopic] = useState<string | null>(null);
  // Ikona jest ozdobna i domyslnie pusta - brak wyboru rysuje piktogram
  // rodzaju watku, wiec formularz niczego nie wymusza.
  const [icon, setIcon] = useState<string | null>(null);
  const [topicTouched, setTopicTouched] = useState(false);
  // Kotwica jest krawędzią w grafie treści (V1 §1.4), a nie ozdobnym linkiem:
  // dossier pokazuje "3 wątki w klubach dyskutują ten plik", a zdarzenie
  // `policy.updated.v1` może obudzić wątek sprzed miesiąca. Do A18 nie było
  // żadnej ścieżki, która pozwalałaby ją ustawić, więc karta na stronie aktu
  // prawnego z definicji świeciła pustką.
  const [anchor, setAnchor] = useState<ClubAnchorValue | null>(null);
  // Klucz idempotencji per AKCJA, nie per proba: powstaje raz przy wejściu na
  // formularz i przeżywa podwójne kliknięcie oraz retry po timeoucie, więc oba
  // zwracają TEN SAM wątek zamiast zakładać drugi (V1 §6.3). `useState`
  // z inicjalizatorem leniwym, bo `newIdempotencyKey` losuje - wywołane
  // w ciele komponentu dawałoby nowy klucz przy każdym renderze, czyli
  // dokładnie zero idempotencji.
  const [idempotencyKey] = useState(() => newIdempotencyKey("club_create_thread"));

  // Grupa domyślna: pierwsza, w której wolno założyć temat. Bez tego
  // użytkownik z dostępem do jednej grupy i tak musiałby ją wybrać ręcznie.
  const groups = groupsQ.data ?? [];
  const postable = postableThreadGroups(groups);
  useEffect(() => {
    // Dział z adresu obowiązuje TYLKO gdy wolno w nim założyć temat - inaczej
    // formularz startowałby z wyborem, którego zapis i tak by odrzucił.
    const next = resolveThreadGroupId(groupId, postable);
    if (next !== null) setGroupId(next);
  }, [groupId, postable]);

  // Rodzaje, których RPC i tak nie przepuści, nie mają prawa stać na dropliście.
  // `announcement` wymaga moderacji (V1 §1.3), a lista karmiona pełnym
  // słownikiem oferowała go każdemu - żeby po napisaniu tekstu odpowiedzieć
  // "clubs: announcement requires moderator". Ten sam wzorzec, co przy
  // anonimowości: wybór, którego nie da się zrealizować, jest błędem
  // interfejsu, a nie ostrzeżeniem serwera.
  const canModerate = club?.can_moderate === true;

  // Tryb atrybucji DZIEDZICZY dział: NULL w kolumnie znaczy "weź z klubu",
  // a `club_groups_list` zwraca już wartość EFEKTYWNĄ. Czytanie go z klubu
  // sprawiało, że dział prowadzony w regule Chatham House pokazywał ustawienia
  // klubu: przełącznik anonimowości pojawiał się tam, gdzie RPC go odrzuca,
  // i znikał tam, gdzie jest jedynym sposobem na zabranie głosu.
  const baseAttribution = baseAttributionMode(groups, groupId, club?.attribution_mode ?? null);

  // Nadpisanie na poziomie WATKU: `null` = dziedzicz dział. Autor może zasadę
  // wyłącznie ZAOSTRZYĆ (zwykle: zamknąć rozmowę w regule Chatham House),
  // bo poluzowanie byłoby obejściem polityki klubu przez założenie wątku -
  // dokładnie tak samo waliduje to RPC, więc droplista nie oferuje wyborów,
  // które i tak skończyłyby się odmową po napisaniu całego tekstu.
  const [attributionOverride, setAttributionOverride] = useState<ClubAttributionMode | null>(null);
  const attributionChoices = useMemo(
    () => attributionOverrideChoices(canModerate, baseAttribution),
    [canModerate, baseAttribution],
  );

  // Zmiana działu może unieważnić wybór (inna zasada bazowa) - wtedy wracamy
  // do dziedziczenia zamiast wysyłać wartość, której RPC już nie przyjmie.
  useEffect(() => {
    if (!isAttributionOverrideAllowed(attributionOverride, attributionChoices)) {
      setAttributionOverride(null);
    }
  }, [attributionChoices, attributionOverride]);

  const effectiveAttribution = effectiveAttributionMode(attributionOverride, baseAttribution);
  const canGoAnonymous = canPostAnonymously(effectiveAttribution);

  // Zmiana działu może odebrać prawo do anonimowości. Zostawiony włączony
  // przełącznik kończyłby się odmową 'clubs: anonymous posting disabled'
  // dopiero po kliknięciu "Opublikuj" - czyli po napisaniu całego tekstu.
  useEffect(() => {
    if (!canGoAnonymous) setAnonymous(false);
  }, [canGoAnonymous]);

  const kinds = useMemo(() => threadKindChoices(canModerate), [canModerate]);
  useEffect(() => {
    const allowed = resolveThreadKind(kind, canModerate);
    if (allowed !== kind) setKind(allowed);
  }, [canModerate, kind]);

  // Obszar klubu jest tylko DOMYSLNA podpowiedzia: raz dotknieta droplista
  // przestaje sie nadpisywac, zeby refetch klubu nie cofal wyboru autora.
  useEffect(() => {
    if (topicTouched) return;
    const inherited = normalizeClubTopic(club?.policy_area ?? null);
    if (inherited !== null) setTopic(inherited);
  }, [club?.policy_area, topicTouched]);

  // Ogłoszenie domyślnie jest komunikatem, nie dyskusją - ale to nadal DOMYŚLNA
  // wartość, nie przymus: moderator, który chce otworzyć dyskusję pod
  // ogłoszeniem, przestawia przełącznik i tak zostaje.
  const lockTouched = useRef(false);
  useEffect(() => {
    if (!lockTouched.current) setLockReplies(defaultLockReplies(kind));
  }, [kind]);

  // Autozapis szkicu. Klucz per KLUB, więc równolegle rozpoczęte teksty w dwóch
  // klubach się nie nadpisują; zmiana działu w trakcie pisania nic nie gubi.
  const draft = useThreadDraft(club?.id, title, body);

  if (clubQ.isPending) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-8">
        <div className="h-64 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
      </div>
    );
  }

  if (!canComposeThread(club)) {
    return (
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-12">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">{t(newThreadDenialKey(club))}</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/club/$clubSlug" params={{ clubSlug }}>
                {t("club.backToClub")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const formReady = newThreadFormReady({ title, body, groupId });
  const fields = newThreadFieldVisibility({
    kind,
    canModerate,
    effectiveAttribution,
    attributionChoiceCount: attributionChoices.length,
  });
  const inheritLabel = attributionInheritLabel(baseAttribution);

  const submit = () => {
    if (!formReady) return;
    createM.mutate(
      buildNewThreadPayload({
        groupId,
        title,
        body,
        kind,
        anonymous,
        lockReplies,
        canModerate,
        topic,
        icon,
        anchor,
        attributionOverride,
        idempotencyKey,
      }),
      {
        onSuccess: (result) => {
          // Tekst jest już w bazie, więc kopia w przeglądarce przestaje cokolwiek
          // chronić - a zostawiona podpowiadałaby "wróć do niedokończonego"
          // przy następnym wejściu na formularz.
          draft.clear();
          // Wpis w kolejce premoderacji nie prowadzi do wątku, którego
          // jeszcze nie widać - mówimy o tym wprost i wracamy na listę.
          const outcome = newThreadOutcome(result);
          toast.success(t(outcome.toastKey));
          if (outcome.threadSlug === null) {
            void navigate({ to: "/club/$clubSlug", params: { clubSlug } });
            return;
          }
          void navigate({
            to: "/club/$clubSlug/t/$threadSlug",
            params: { clubSlug, threadSlug: outcome.threadSlug },
          });
        },
        onError: () => toast.error(t("adminClubs.saveFailed")),
      },
    );
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3 h-8 px-2">
        <Link to="/club/$clubSlug" params={{ clubSlug }}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          {pickLocalized(club, "name", lang)}
        </Link>
      </Button>

      <h1 className="mb-5 text-2xl font-semibold">{t("club.newThread")}</h1>

      <Card>
        <CardContent className="space-y-5 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="thread-group">{t("club.group")}</Label>
              <Select value={groupId} onValueChange={setGroupId} disabled={createM.isPending}>
                <SelectTrigger id="thread-group">
                  <SelectValue placeholder={t("club.group")} />
                </SelectTrigger>
                <SelectContent>
                  {postable.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {pickLocalized(g, "name", lang)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ClubTopicSelect
              id="thread-topic"
              label={t("club.topic.label")}
              value={topic}
              onChange={(next) => {
                setTopicTouched(true);
                setTopic(next);
              }}
              disabled={createM.isPending}
            />

            <div className="space-y-1.5">
              <Label htmlFor="thread-icon">{t("club.iconPicker.label")}</Label>
              <ClubIconPicker
                id="thread-icon"
                value={icon}
                onChange={setIcon}
                disabled={createM.isPending}
              />
              <p className="text-xs text-muted-foreground">{t("club.iconPicker.hint")}</p>
            </div>

            <ClubEnumSelect
              id="thread-kind"
              label={t("club.kind.label")}
              value={kind}
              options={kinds}
              i18nPrefix="club.kind"
              hintPrefix="club.kindHint"
              onChange={setKind}
              disabled={createM.isPending}
            />
          </div>

          {/* Pasek wznowienia stoi NAD polami, a nie pod nimi: informacja
              "masz niedokończony tekst" jest bezużyteczna po tym, jak ktoś
              zacznie pisać od nowa. */}
          {draft.restored !== null ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
              <span className="flex-1">
                {t("club.composer.draftFound", {
                  when: formatDateTime(draft.restored.savedAt, i18n.language),
                })}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => {
                  if (draft.restored === null) return;
                  setTitle(draft.restored.title);
                  setBody(draft.restored.body);
                  draft.discard();
                }}
              >
                {t("club.composer.draftRestore")}
              </Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={draft.discard}>
                {t("club.composer.draftDiscard")}
              </Button>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="thread-title">{t("club.threadTitle")}</Label>
            <Input
              id="thread-title"
              value={title}
              maxLength={CLUB_THREAD_TITLE_MAX}
              disabled={createM.isPending}
              onChange={(e) => setTitle(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {title.trim().length} / {CLUB_THREAD_TITLE_MAX}
            </p>
          </div>

          <div className="space-y-1.5">
            {/* Wzmianki: ten sam komponent i ten sam parser, co w komentarzach.
                `process_mentions` obsługuje `club_thread` po stronie bazy od
                A12, więc bez podpowiedzi w polu jedyną drogą do wzmianki było
                wpisanie sluga z pamięci. */}
            <MentionTextarea
              id="thread-body"
              label={t("club.threadBody")}
              value={body}
              onChange={setBody}
              lang={lang}
              rows={12}
              maxLength={CLUB_THREAD_BODY_MAX}
            />
            <p className="text-xs text-muted-foreground">
              {body.trim().length} / {CLUB_THREAD_BODY_MAX}
            </p>
          </div>

          <ClubAnchorPicker value={anchor} onChange={setAnchor} disabled={createM.isPending} />

          {/* Reguła autorstwa MUSI być widoczna przed publikacją, a nie dopiero
              na wątku: w dziale prowadzonym w regule Chatham House wypowiedź
              wychodzi pod pseudonimem, a autor - jeśli się tego nie spodziewał -
              pisze inaczej, niż by chciał. Wartość jest efektywna dla WYBRANEGO
              działu, więc zmienia się razem z dropListą wyżej. */}
          {fields.attributionNote ? (
            <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {t(`club.attribution.${effectiveAttribution}`)}
              </span>{" "}
              {t(`club.attributionHint.${effectiveAttribution}`)}
            </p>
          ) : null}

          {/* Anonimowosc UCZESTNIKOW - decyzja o CALEJ rozmowie, nie o wlasnym
              podpisie. Droplista pokazuje wylacznie zaostrzenia dozwolone dla
              tej osoby, bo RPC waliduje to samo i odmowa po napisaniu tekstu
              byla bledem interfejsu, a nie ostrzezeniem serwera. */}
          {fields.attributionOverride ? (
            <div className="space-y-1.5">
              <Label htmlFor="thread-attribution" className="text-sm">
                {t("club.composer.participantAnonymity")}
              </Label>
              <Select
                value={attributionSelectValue(attributionOverride)}
                disabled={createM.isPending}
                onValueChange={(next) => setAttributionOverride(readAttributionSelection(next))}
              >
                <SelectTrigger id="thread-attribution">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW_THREAD_ATTRIBUTION_INHERIT}>
                    {inheritLabel.modeKey === null
                      ? t(inheritLabel.key)
                      : t(inheritLabel.key, { mode: t(inheritLabel.modeKey) })}
                  </SelectItem>
                  {attributionChoices.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {t(`club.attribution.${mode}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t(attributionHintKey(effectiveAttribution))}
              </p>
            </div>
          ) : null}

          {/* Ogłoszenie przypina się z definicji rodzaju (migracja A25), więc
              autor musi o tym wiedzieć PRZED publikacją - przypięty wpis widzą
              wszyscy członkowie klubu na górze listy. */}
          {fields.announcementPinnedNote ? (
            <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {t("club.composer.announcementPinned")}
            </p>
          ) : null}

          {fields.lockReplies ? (
            <div className="space-y-1.5 border-t border-border/60 pt-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="thread-lock"
                  checked={lockReplies}
                  disabled={createM.isPending}
                  onCheckedChange={(next) => {
                    lockTouched.current = true;
                    setLockReplies(next);
                  }}
                />
                <Label htmlFor="thread-lock" className="text-sm">
                  {t("club.composer.lockReplies")}
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">{t("club.composer.lockRepliesHint")}</p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
            {fields.anonymousToggle ? (
              <div className="flex items-center gap-2">
                <Switch
                  id="thread-anon"
                  checked={anonymous}
                  disabled={createM.isPending}
                  onCheckedChange={setAnonymous}
                />
                <Label htmlFor="thread-anon" className="text-sm">
                  {t("club.postAnonymously")}
                </Label>
              </div>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-3">
              {/* Autozapis MUSI być widoczny, inaczej jest funkcją, o której nikt
                  nie wie - a wtedy nie zmienia zachowania osoby, która właśnie
                  boi się zamknąć kartę. */}
              {draft.savedAt !== null ? (
                <span className="text-xs text-muted-foreground" aria-live="polite">
                  {t("club.composer.draftSaved", {
                    when: formatDateTime(draft.savedAt, i18n.language),
                  })}
                </span>
              ) : null}
              <Button onClick={submit} disabled={createM.isPending || !formReady}>
                {t("club.publishThread")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
