// Katalog elementów Klubu dyskusyjnego - powierzchnia ADMINISTRACYJNA.
//
// Wcześniej ta zawartość żyła jako publiczna trasa /club/elements: pełna
// szerokość strony publicznej, dziesięć sekcji jedna pod drugą, żadnego
// sposobu na znalezienie konkretnej wartości poza Ctrl+F. To jest materiał
// operacyjny (słowniki bazy, macierz uprawnień, kody odmów), więc mieszka
// teraz w panelu i dostaje narzędzia panelu:
//
//   - JEDNO pole szukania, które filtruje RÓWNOCZEŚNIE surowe wartości
//     (`chatham`) i ich tłumaczenia ("Reguła Chatham House"). Operator pamięta
//     albo jedno, albo drugie - nigdy nie wiadomo które, więc szukamy po obu.
//   - Spis sekcji z licznikami, przyklejony na dużych ekranach. Licznik jest
//     policzalny (ile wartości ma sekcja), więc od razu widać, gdzie szukanie
//     coś znalazło, a gdzie nie.
//   - Kliknięcie znacznika kopiuje SUROWĄ wartość. To jest realny odruch:
//     wartości ze słownika wpisuje się potem do SQL-a i do zgłoszeń.
//
// Strona pozostaje CZYSTO POGLĄDOWA - nie odpytuje bazy i nic nie zapisuje.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  BookMarked,
  Check,
  Copy,
  KeyRound,
  Minus,
  SearchX,
  Settings2,
  Shapes,
  TriangleAlert,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ClubGroupStatusBadge,
  ClubMemberStatusBadge,
  ClubRoleBadge,
  ClubStatusBadge,
  ClubVisibilityBadge,
} from "@/components/admin/clubs/atoms/ClubBadges";
import {
  ClubAccessTab,
  type ClubAccessDraft,
} from "@/components/admin/clubs/organisms/ClubAccessTab";
import { ClubReactionBar } from "@/components/clubs/molecules/ClubReactionBar";
import {
  CAPABILITY_KEYS,
  CAPABILITY_ROLES,
  capabilityValue,
  type CapabilityValue,
} from "@/lib/clubs/capabilityMatrix";
import { ClubElementsGallery } from "@/components/clubs/organisms/ClubElementsGallery";
import {
  CLUB_ACCESS_REASONS,
  CLUB_ACTIVITY_SORTS,
  CLUB_ATTRIBUTION_MODES,
  CLUB_GROUP_STATUSES,
  CLUB_INVITATION_STATUSES,
  CLUB_INVITE_CHANNELS,
  CLUB_INVITE_ERRORS,
  CLUB_JOIN_POLICIES,
  CLUB_LAYOUTS,
  CLUB_LOG_ACTIONS,
  CLUB_LOG_TARGETS,
  CLUB_MEMBER_ROLES,
  CLUB_MEMBER_STATUSES,
  CLUB_MODERATION_ACTIONS,
  CLUB_MODERATION_MODES,
  CLUB_NOTIFY_LEVELS,
  CLUB_POST_POLICIES,
  CLUB_QUALITY_REACTIONS,
  CLUB_REACTION_KINDS,
  CLUB_REPLY_SORTS,
  CLUB_SAVE_ERRORS,
  CLUB_STANCES,
  CLUB_STANCE_REACTIONS,
  CLUB_STATUSES,
  CLUB_SUBSCRIPTION_STATES,
  CLUB_THREAD_KINDS,
  CLUB_THREAD_SORTS,
  CLUB_THREAD_STATUSES,
  CLUB_VISIBILITIES,
  type ClubReactionKind,
  type ClubReactionTally,
} from "@/lib/clubs/types";
import { ensureClubI18n } from "@/lib/i18n-club";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";
import { ensureClubElementsI18n } from "@/lib/i18n-club-elements";

/** Bez akcentów i wielkości liter - "widocznosc" ma znaleźć "Widoczność". */
function normalize(value: string): string {
  return value
    .toLocaleLowerCase("pl")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0142/g, "l");
}

type SectionId =
  | "vocab"
  | "threadVocab"
  | "opsVocab"
  | "badges"
  | "access"
  | "gallery"
  | "matrix"
  | "reactions"
  | "reasons"
  | "errors";

/** Ile wartości ma sekcja - do licznika w spisie treści. */
const SECTION_SIZE: Record<SectionId, number> = {
  vocab:
    CLUB_VISIBILITIES.length +
    CLUB_JOIN_POLICIES.length +
    CLUB_ATTRIBUTION_MODES.length +
    CLUB_POST_POLICIES.length +
    CLUB_MODERATION_MODES.length +
    CLUB_NOTIFY_LEVELS.length +
    CLUB_REACTION_KINDS.length +
    CLUB_LAYOUTS.length,
  threadVocab:
    CLUB_THREAD_KINDS.length +
    CLUB_THREAD_STATUSES.length +
    CLUB_THREAD_SORTS.length +
    CLUB_REPLY_SORTS.length +
    CLUB_ACTIVITY_SORTS.length +
    CLUB_STANCES.length +
    CLUB_SUBSCRIPTION_STATES.length +
    CLUB_QUALITY_REACTIONS.length +
    CLUB_STANCE_REACTIONS.length,
  opsVocab:
    CLUB_INVITE_CHANNELS.length +
    CLUB_INVITATION_STATUSES.length +
    CLUB_MODERATION_ACTIONS.length +
    CLUB_LOG_ACTIONS.length +
    CLUB_LOG_TARGETS.length,
  badges:
    CLUB_STATUSES.length +
    CLUB_GROUP_STATUSES.length +
    CLUB_VISIBILITIES.length +
    CLUB_MEMBER_ROLES.length +
    CLUB_MEMBER_STATUSES.length,
  access: 6,
  gallery: 5,
  matrix: CAPABILITY_KEYS.length,
  reactions: CLUB_REACTION_KINDS.length,
  reasons: CLUB_ACCESS_REASONS.length,
  errors: CLUB_INVITE_ERRORS.length + CLUB_SAVE_ERRORS.length,
};

type GroupId = "vocab" | "components" | "rules" | "codes";

/** Cztery powierzchnie katalogu - słowniki, komponenty, reguły, kody odmów. */
const GROUPS: readonly {
  id: GroupId;
  icon: typeof BookMarked;
  sections: readonly SectionId[];
}[] = [
  { id: "vocab", icon: BookMarked, sections: ["vocab", "threadVocab", "opsVocab"] },
  { id: "components", icon: Shapes, sections: ["badges", "gallery", "reactions"] },
  { id: "rules", icon: KeyRound, sections: ["access", "matrix"] },
  { id: "codes", icon: TriangleAlert, sections: ["reasons", "errors"] },
];

/** Sekcje bez własnego słownika wartości - szukanie ich nie filtruje. */
const UNFILTERABLE: ReadonlySet<SectionId> = new Set<SectionId>(["access", "gallery", "matrix"]);

type SectionProps = {
  id: SectionId;
  title: string;
  hint: string;
  children: React.ReactNode;
};

function Section({ id, title, hint, children }: SectionProps) {
  return (
    <section id={`club-elements-${id}`} className="scroll-mt-24 space-y-3">
      <div className="space-y-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

/** Znacznik wartości słownika - kliknięcie kopiuje surową wartość. */
function VocabValue({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const copy = () => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => toast.success(t("clubElements.ui.copied", { value })))
      .catch(() => toast.error(t("clubElements.ui.copyFailed")));
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={t("clubElements.ui.copyHint")}
      className="group inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 py-1 text-sm transition-colors hover:border-primary/50 hover:bg-accent"
    >
      <code className="font-mono text-xs text-muted-foreground">{value}</code>
      <span aria-hidden className="text-border">
        ·
      </span>
      <span>{label}</span>
      <Copy
        aria-hidden
        className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}

/**
 * Wiersz słownika. Sam decyduje, czy się pokazać: filtr dostaje etykietę osi,
 * surowe wartości i ich tłumaczenia, więc wpisanie "chatham" zostawia tylko
 * tryb atrybucji, a wpisanie "moderacja" - wszystkie osie o moderacji.
 */
function VocabRow({
  label,
  values,
  prefix,
  query,
}: {
  label: string;
  values: readonly string[];
  prefix: string;
  query: string;
}) {
  const { t } = useTranslation();
  const rows = values.map((value) => ({ value, label: t(`${prefix}.${value}`) }));
  const visible = query
    ? normalize(label).includes(query)
      ? rows
      : rows.filter(
          (row) => normalize(row.value).includes(query) || normalize(row.label).includes(query),
        )
    : rows;

  if (visible.length === 0) return null;

  return (
    <div className="grid gap-2 border-b border-border/60 py-3 last:border-0 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-baseline">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((row) => (
          <VocabValue key={row.value} value={row.value} label={row.label} />
        ))}
      </div>
    </div>
  );
}

/** Karta ze słownikiem - znika w całości, gdy filtr nie zostawił wierszy. */
function VocabCard({ children }: { children: React.ReactNode }) {
  const rendered = Array.isArray(children) ? children.filter(Boolean) : children;
  if (Array.isArray(rendered) && rendered.every((child) => child === null)) return null;
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">{children}</CardContent>
    </Card>
  );
}

function MatrixCell({ value }: { value: CapabilityValue }) {
  const { t } = useTranslation();
  if (value === "yes") {
    return (
      <span className="inline-flex" title={t("clubElements.matrix.legendYes")}>
        <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
        <span className="sr-only">{t("clubElements.matrix.legendYes")}</span>
      </span>
    );
  }
  if (value === "cond") {
    return (
      <span className="inline-flex" title={t("clubElements.matrix.legendCond")}>
        <Settings2 className="size-4 text-amber-600 dark:text-amber-400" />
        <span className="sr-only">{t("clubElements.matrix.legendCond")}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex" title={t("clubElements.matrix.legendNo")}>
      <Minus className="size-4 text-muted-foreground/60" />
      <span className="sr-only">{t("clubElements.matrix.legendNo")}</span>
    </span>
  );
}

/** Karta kodu (powód odmowy / błąd) - też podlega filtrowi. */
function CodeCard({ code, sentence }: { code: string; sentence: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card/50 p-3">
      <p className="font-mono text-xs text-muted-foreground">{code}</p>
      <p className="mt-1 text-sm">{sentence}</p>
    </div>
  );
}

const INITIAL_DRAFT: ClubAccessDraft = {
  visibility: "members",
  joinPolicy: "invite",
  minTierRank: 0,
  attributionMode: "chatham",
  whoCanPost: "moderators",
  moderationMode: "trusted",
};

/** Startowy zestaw liczników reakcji - wygląda jak żywy wątek, nie jak zero. */
const INITIAL_TALLIES: ClubReactionTally[] = [
  { kind: "insightful", total: 7, mine: true },
  { kind: "evidence", total: 3, mine: false },
  { kind: "question", total: 1, mine: false },
  { kind: "thanks", total: 0, mine: false },
  { kind: "agree", total: 5, mine: false },
  { kind: "disagree", total: 2, mine: false },
];

export function ClubElementsCatalog() {
  ensureAdminClubsI18n();
  ensureClubI18n();
  ensureClubElementsI18n();
  const { t } = useTranslation();

  const [rawQuery, setRawQuery] = useState("");
  const [group, setGroup] = useState<GroupId>("vocab");
  const [draft, setDraft] = useState<ClubAccessDraft>(INITIAL_DRAFT);
  const [tallies, setTallies] = useState<ClubReactionTally[]>(INITIAL_TALLIES);
  const query = useMemo(() => normalize(rawQuery.trim()), [rawQuery]);
  const filtering = query.length > 0;
  const activeSections: readonly SectionId[] =
    GROUPS.find((entry) => entry.id === group)?.sections ?? [];

  const toggleReaction = (kind: ClubReactionKind, active: boolean) => {
    setTallies((prev) =>
      prev.map((tally) =>
        tally.kind === kind
          ? { ...tally, mine: !active, total: Math.max(0, tally.total + (active ? -1 : 1)) }
          : tally,
      ),
    );
  };

  const matchesCode = (code: string, sentence: string) =>
    !filtering || normalize(code).includes(query) || normalize(sentence).includes(query);

  const reasons = CLUB_ACCESS_REASONS.map((reason) => ({
    code: reason,
    sentence: t(`club.reason.${reason}`),
  })).filter((row) => matchesCode(row.code, row.sentence));
  const inviteErrors = CLUB_INVITE_ERRORS.map((code) => ({
    code,
    sentence: t(`adminClubs.invitations.error.${code}`),
  })).filter((row) => matchesCode(row.code, row.sentence));
  const saveErrors = CLUB_SAVE_ERRORS.map((code) => ({
    code,
    sentence: t(`adminClubs.create.error.${code}`),
  })).filter((row) => matchesCode(row.code, row.sentence));
  const capabilityKeys = CAPABILITY_KEYS.filter(
    (key) => !filtering || normalize(key).includes(query),
  );

  // Sekcja jest "pusta pod filtrem" tylko wtedy, gdy MA co filtrować.
  // Podgląd dostępu, galeria i macierz zostają widoczne zawsze - to narzędzia,
  // nie zbiory wartości, a znikające narzędzie wygląda jak awaria.
  const emptyUnderFilter = (id: SectionId, hasContent: boolean) =>
    filtering && !UNFILTERABLE.has(id) && !hasContent;

  const badgesVisible =
    !filtering || normalize(t("clubElements.section.badges")).includes(query) || false;

  const nothingFound =
    filtering &&
    reasons.length === 0 &&
    inviteErrors.length === 0 &&
    saveErrors.length === 0 &&
    capabilityKeys.length === 0;

  return (
    <div className="space-y-6">
      {/* Pasek narzędzi - przyklejony, bo katalog jest długi i szukanie musi
          zostać w zasięgu ręki także na dole macierzy uprawnień. */}
      <div className="sticky top-0 z-20 -mx-1 rounded-lg border border-border/60 bg-background/95 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Input
              value={rawQuery}
              onChange={(event) => setRawQuery(event.target.value)}
              placeholder={t("clubElements.ui.searchPlaceholder")}
              aria-label={t("clubElements.ui.searchLabel")}
              className="h-9 pr-9"
            />
            {rawQuery ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t("clubElements.ui.clear")}
                onClick={() => setRawQuery("")}
                className="absolute top-0.5 right-0.5 size-8"
              >
                <X className="size-4" />
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              {t("clubElements.matrix.legendYes")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Settings2 className="size-3.5 text-amber-600 dark:text-amber-400" />
              {t("clubElements.matrix.legendCond")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Minus className="size-3.5" />
              {t("clubElements.matrix.legendNo")}
            </span>
          </div>
        </div>
      </div>

      {nothingFound ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <SearchX className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">{t("clubElements.ui.noResults")}</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {t("clubElements.ui.noResultsHint")}
            </p>
            <Button size="sm" variant="outline" onClick={() => setRawQuery("")}>
              {t("clubElements.ui.clear")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Zakładki zamiast dziesięciu sekcji jedna pod drugą: operator wchodzi
          tu po JEDNĄ rzecz (wartość słownika albo kod odmowy), więc katalog
          dzieli się na cztery powierzchnie zamiast jednego kilometrowego
          przewijania. Spis sekcji w danej zakładce zostaje jako skróty. */}
      <Tabs value={group} onValueChange={(value) => setGroup(value as GroupId)} className="gap-6">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-muted/40 p-1">
          {GROUPS.map((entry) => {
            const Icon = entry.icon;
            return (
              <TabsTrigger
                key={entry.id}
                value={entry.id}
                className="gap-2 px-3 py-1.5 data-[state=active]:shadow-sm"
              >
                <Icon aria-hidden className="size-4" />
                <span>{t(`clubElements.group.${entry.id}`)}</span>
                <Badge
                  variant="secondary"
                  className="ml-0.5 h-5 min-w-5 justify-center px-1.5 text-[11px] tabular-nums"
                >
                  {entry.sections.reduce((sum, id) => sum + SECTION_SIZE[id], 0)}
                </Badge>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* Skróty do sekcji AKTYWNEJ zakładki - poziomy pas, bo zakładka ma
            teraz najwyżej trzy sekcje i pionowa kolumna byłaby marnotrawstwem. */}
        <nav
          aria-label={t("clubElements.ui.sections")}
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
        >
          {activeSections.map((id) => (
            <a
              key={id}
              href={`#club-elements-${id}`}
              className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border/60 bg-card px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-foreground"
            >
              <span className="whitespace-nowrap">{t(`clubElements.section.${id}`)}</span>
              <span className="text-xs tabular-nums opacity-70">{SECTION_SIZE[id]}</span>
            </a>
          ))}
        </nav>

        <TabsContent value="vocab" className="min-w-0 space-y-10">
          <Section
            id="vocab"
            title={t("clubElements.section.vocab")}
            hint={t("clubElements.section.vocabHint")}
          >
            <VocabCard>
              <VocabRow
                label={t("clubElements.vocab.visibility")}
                values={CLUB_VISIBILITIES}
                prefix="club.visibility"
                query={query}
              />
              <VocabRow
                label={t("clubElements.vocab.joinPolicy")}
                values={CLUB_JOIN_POLICIES}
                prefix="club.joinPolicy"
                query={query}
              />
              <VocabRow
                label={t("clubElements.vocab.attribution")}
                values={CLUB_ATTRIBUTION_MODES}
                prefix="club.attribution"
                query={query}
              />
              <VocabRow
                label={t("clubElements.vocab.whoCanPost")}
                values={CLUB_POST_POLICIES}
                prefix="club.whoCanPost"
                query={query}
              />
              <VocabRow
                label={t("clubElements.vocab.moderation")}
                values={CLUB_MODERATION_MODES}
                prefix="club.moderation"
                query={query}
              />
              <VocabRow
                label={t("clubElements.vocab.notifyLevel")}
                values={CLUB_NOTIFY_LEVELS}
                prefix="club.notify"
                query={query}
              />
              <VocabRow
                label={t("clubElements.vocab.reaction")}
                values={CLUB_REACTION_KINDS}
                prefix="club.reaction"
                query={query}
              />
              <VocabRow
                label={t("clubElements.vocab.layout")}
                values={CLUB_LAYOUTS}
                prefix="adminClubs.layout"
                query={query}
              />
            </VocabCard>
          </Section>

          <Section
            id="threadVocab"
            title={t("clubElements.section.threadVocab")}
            hint={t("clubElements.section.threadVocabHint")}
          >
            <VocabCard>
              <VocabRow
                label={t("clubElements.vocab.threadKind")}
                values={CLUB_THREAD_KINDS}
                prefix="club.kind"
                query={query}
              />
              <VocabRow
                label={t("clubElements.vocab.threadStatus")}
                values={CLUB_THREAD_STATUSES}
                prefix="club.threadStatus"
                query={query}
              />
              <VocabRow
                label={t("clubElements.vocab.threadSort")}
                values={CLUB_THREAD_SORTS}
                prefix="club.sort"
                query={query}
              />
              <VocabRow
                label={t("clubElements.vocab.replySort")}
                values={CLUB_REPLY_SORTS}
                prefix="club.replySort"
                query={query}
              />
              <VocabRow
                label={t("clubElements.vocab.activitySort")}
                values={CLUB_ACTIVITY_SORTS}
                prefix="club.sort"
                query={query}
              />
              <VocabRow
                label={t("clubElements.vocab.stance")}
                values={CLUB_STANCES}
                prefix="club.stance"
                query={query}
              />
              <VocabRow
                label={t("clubElements.vocab.subscription")}
                values={CLUB_SUBSCRIPTION_STATES}
                prefix="club.subscription"
                query={query}
              />
            </VocabCard>

            {/* Reakcje dzielą się na DWIE rozłączne grupy i to jest reguła bazy,
                nie konwencja interfejsu: trigger podmienia jedno stanowisko na
                drugie, a oceny jakości sumują się niezależnie. */}
            <VocabCard>
              <VocabRow
                label={t("clubElements.vocab.qualityReaction")}
                values={CLUB_QUALITY_REACTIONS}
                prefix="club.reaction"
                query={query}
              />
              <VocabRow
                label={t("clubElements.vocab.stanceReaction")}
                values={CLUB_STANCE_REACTIONS}
                prefix="club.reaction"
                query={query}
              />
            </VocabCard>
          </Section>

          <Section
            id="opsVocab"
            title={t("clubElements.section.opsVocab")}
            hint={t("clubElements.section.opsVocabHint")}
          >
            <VocabCard>
              <VocabRow
                label={t("clubElements.vocab.inviteChannel")}
                values={CLUB_INVITE_CHANNELS}
                prefix="adminClubs.invitations.channelName"
                query={query}
              />
              <VocabRow
                label={t("clubElements.vocab.invitationStatus")}
                values={CLUB_INVITATION_STATUSES}
                prefix="adminClubs.invitations.statusName"
                query={query}
              />
              <VocabRow
                label={t("clubElements.vocab.moderationAction")}
                values={CLUB_MODERATION_ACTIONS}
                prefix="adminClubs.moderation.action"
                query={query}
              />
              <VocabRow
                label={t("clubElements.vocab.logAction")}
                values={CLUB_LOG_ACTIONS}
                prefix="adminClubs.moderation.action"
                query={query}
              />
              <VocabRow
                label={t("clubElements.vocab.logTarget")}
                values={CLUB_LOG_TARGETS}
                prefix="adminClubs.moderation.target"
                query={query}
              />
            </VocabCard>
          </Section>
        </TabsContent>

        <TabsContent value="components" className="min-w-0 space-y-10">
          {emptyUnderFilter("badges", badgesVisible) ? null : (
            <Section
              id="badges"
              title={t("clubElements.section.badges")}
              hint={t("clubElements.section.badgesHint")}
            >
              <Card>
                <CardContent className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">{t("clubElements.vocab.status")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {CLUB_STATUSES.map((status) => (
                        <ClubStatusBadge key={status} status={status} />
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">{t("clubElements.vocab.groupStatus")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {CLUB_GROUP_STATUSES.map((status) => (
                        <ClubGroupStatusBadge key={status} status={status} />
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">{t("clubElements.vocab.visibility")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {CLUB_VISIBILITIES.map((visibility) => (
                        <ClubVisibilityBadge key={visibility} visibility={visibility} />
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">{t("clubElements.vocab.role")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {CLUB_MEMBER_ROLES.map((role) => (
                        <ClubRoleBadge key={role} role={role} />
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">{t("clubElements.vocab.memberStatus")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {CLUB_MEMBER_STATUSES.map((status) => (
                        <ClubMemberStatusBadge key={status} status={status} />
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Section>
          )}

          <Section
            id="gallery"
            title={t("clubElements.section.gallery")}
            hint={t("clubElements.section.galleryHint")}
          >
            <ClubElementsGallery />
          </Section>

          <Section
            id="reactions"
            title={t("clubElements.section.reactions")}
            hint={t("clubElements.section.reactionsHint")}
          >
            <Card>
              <CardContent className="space-y-5 p-4 sm:p-5">
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t("clubElements.reactions.full")}</p>
                  <ClubReactionBar tallies={tallies} variant="full" onToggle={toggleReaction} />
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t("clubElements.reactions.compact")}</p>
                  <ClubReactionBar tallies={tallies} variant="compact" onToggle={toggleReaction} />
                </div>
              </CardContent>
            </Card>
          </Section>
        </TabsContent>

        <TabsContent value="rules" className="min-w-0 space-y-10">
          <Section
            id="access"
            title={t("clubElements.section.access")}
            hint={t("clubElements.section.accessHint")}
          >
            <ClubAccessTab
              draft={draft}
              onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            />
          </Section>

          <Section
            id="matrix"
            title={t("clubElements.section.matrix")}
            hint={t("clubElements.section.matrixHint")}
          >
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {/* Pierwsza kolumna przyklejona: przy siedmiu rolach tabela
                          przewija się w poziomie, a bez nazwy zdolności komórka
                          nie znaczy nic. */}
                      <TableHead className="sticky left-0 z-10 min-w-[220px] bg-card">
                        {t("clubElements.matrix.capability")}
                      </TableHead>
                      {CAPABILITY_ROLES.map((role) => (
                        <TableHead key={role} className="text-center text-xs whitespace-nowrap">
                          {role}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {capabilityKeys.map((key) => (
                      <TableRow key={key}>
                        <TableCell className="sticky left-0 z-10 bg-card font-mono text-xs">
                          {key}
                        </TableCell>
                        {CAPABILITY_ROLES.map((role) => (
                          <TableCell key={role} className="text-center">
                            <MatrixCell value={capabilityValue(key, role)} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </Section>
        </TabsContent>

        <TabsContent value="codes" className="min-w-0 space-y-10">
          {emptyUnderFilter("reasons", reasons.length > 0) ? null : (
            <Section
              id="reasons"
              title={t("clubElements.section.reasons")}
              hint={t("clubElements.section.reasonsHint")}
            >
              <Card>
                <CardContent className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
                  {reasons.map((row) => (
                    <CodeCard key={row.code} code={row.code} sentence={row.sentence} />
                  ))}
                </CardContent>
              </Card>
            </Section>
          )}

          {emptyUnderFilter("errors", inviteErrors.length + saveErrors.length > 0) ? null : (
            <Section
              id="errors"
              title={t("clubElements.section.errors")}
              hint={t("clubElements.section.errorsHint")}
            >
              <div className="grid gap-3 lg:grid-cols-2">
                {inviteErrors.length > 0 ? (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">{t("clubElements.errors.invite")}</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-2 p-4 pt-0 sm:p-5 sm:pt-0">
                      {inviteErrors.map((row) => (
                        <CodeCard key={row.code} code={row.code} sentence={row.sentence} />
                      ))}
                    </CardContent>
                  </Card>
                ) : null}
                {saveErrors.length > 0 ? (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">{t("clubElements.errors.save")}</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-2 p-4 pt-0 sm:p-5 sm:pt-0">
                      {saveErrors.map((row) => (
                        <CodeCard key={row.code} code={row.code} sentence={row.sentence} />
                      ))}
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            </Section>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
