// /club/elements - katalog elementów Klubu dyskusyjnego.
//
// Jedna powierzchnia, na której widać KOMPLET budulca modułu: słowniki
// domenowe (te same, z których biorą się droplisty), znaczniki stanu, żywy
// podgląd ustawień dostępu, macierz uprawnień, reakcje semantyczne i kody
// odmowy. Dzięki temu zmiana w słowniku albo w tonacji znacznika jest widoczna
// natychmiast, bez zakładania testowego klubu i przechodzenia przez panel.
//
// Strona jest CZYSTO POGLĄDOWA: nie odpytuje bazy i nic nie zapisuje. Stan
// zakładki dostępu żyje w useState, więc iloczyn ustawień da się przeklikać
// bez ryzyka dla realnego klubu. `noindex` - to powierzchnia wewnętrzna.
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Check, Minus, Settings2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { ClubReactionBar } from "@/components/clubs/ClubReactionBar";
import {
  CAPABILITY_KEYS,
  CAPABILITY_ROLES,
  capabilityValue,
  type CapabilityValue,
} from "@/lib/clubs/capabilityMatrix";
import {
  CLUB_ACCESS_REASONS,
  CLUB_ATTRIBUTION_MODES,
  CLUB_GROUP_STATUSES,
  CLUB_JOIN_POLICIES,
  CLUB_MEMBER_ROLES,
  CLUB_MEMBER_STATUSES,
  CLUB_MODERATION_MODES,
  CLUB_NOTIFY_LEVELS,
  CLUB_POST_POLICIES,
  CLUB_REACTION_KINDS,
  CLUB_STATUSES,
  CLUB_VISIBILITIES,
  type ClubReactionKind,
  type ClubReactionTally,
} from "@/lib/clubs/types";
import { ensureClubI18n } from "@/lib/i18n-club";
import { ensureClubElementsI18n } from "@/lib/i18n-club-elements";

export const Route = createFileRoute("/club/elements")({
  head: () => ({
    meta: [
      { title: "Klub dyskusyjny - katalog elementów" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ClubElementsPage,
});

/** Sekcja katalogu: nagłówek + krótkie wyjaśnienie, po co ona jest. */
function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

/** Wiersz słownika: nazwa osi + wszystkie jej wartości jako znaczniki. */
function VocabRow({
  label,
  values,
  prefix,
}: {
  label: string;
  values: readonly string[];
  prefix: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2 border-b border-border/60 py-3 last:border-0 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-baseline">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <Badge key={value} variant="outline" className="font-normal">
            <span className="text-muted-foreground">{value}</span>
            <span aria-hidden className="mx-1.5 text-border">
              ·
            </span>
            {t(`${prefix}.${value}`)}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function MatrixCell({ value }: { value: CapabilityValue }) {
  const { t } = useTranslation();
  if (value === "yes") {
    return (
      <span className="inline-flex" title={t("clubElements.matrix.legendYes")}>
        <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <span className="sr-only">{t("clubElements.matrix.legendYes")}</span>
      </span>
    );
  }
  if (value === "cond") {
    return (
      <span className="inline-flex" title={t("clubElements.matrix.legendCond")}>
        <Settings2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="sr-only">{t("clubElements.matrix.legendCond")}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex" title={t("clubElements.matrix.legendNo")}>
      <Minus className="h-4 w-4 text-muted-foreground/60" />
      <span className="sr-only">{t("clubElements.matrix.legendNo")}</span>
    </span>
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

function ClubElementsPage() {
  ensureClubI18n();
  ensureClubElementsI18n();
  const { t } = useTranslation();

  const [draft, setDraft] = useState<ClubAccessDraft>(INITIAL_DRAFT);
  const [tallies, setTallies] = useState<ClubReactionTally[]>(INITIAL_TALLIES);

  const toggleReaction = (kind: ClubReactionKind, active: boolean) => {
    setTallies((prev) =>
      prev.map((tally) =>
        tally.kind === kind
          ? { ...tally, mine: !active, total: Math.max(0, tally.total + (active ? -1 : 1)) }
          : tally,
      ),
    );
  };

  return (
    <div className="container mx-auto max-w-6xl space-y-10 px-4 py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("clubElements.title")}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("clubElements.subtitle")}</p>
        <p className="text-xs text-muted-foreground/80">{t("clubElements.note")}</p>
      </header>

      <Section title={t("clubElements.section.vocab")} hint={t("clubElements.section.vocabHint")}>
        <Card>
          <CardContent className="p-5">
            <VocabRow
              label={t("clubElements.vocab.visibility")}
              values={CLUB_VISIBILITIES}
              prefix="club.visibility"
            />
            <VocabRow
              label={t("clubElements.vocab.joinPolicy")}
              values={CLUB_JOIN_POLICIES}
              prefix="club.joinPolicy"
            />
            <VocabRow
              label={t("clubElements.vocab.attribution")}
              values={CLUB_ATTRIBUTION_MODES}
              prefix="club.attribution"
            />
            <VocabRow
              label={t("clubElements.vocab.whoCanPost")}
              values={CLUB_POST_POLICIES}
              prefix="club.whoCanPost"
            />
            <VocabRow
              label={t("clubElements.vocab.moderation")}
              values={CLUB_MODERATION_MODES}
              prefix="club.moderation"
            />
            <VocabRow
              label={t("clubElements.vocab.notifyLevel")}
              values={CLUB_NOTIFY_LEVELS}
              prefix="club.notify"
            />
            <VocabRow
              label={t("clubElements.vocab.reaction")}
              values={CLUB_REACTION_KINDS}
              prefix="club.reaction"
            />
          </CardContent>
        </Card>
      </Section>

      <Section title={t("clubElements.section.badges")} hint={t("clubElements.section.badgesHint")}>
        <Card>
          <CardContent className="space-y-4 p-5">
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

      <Section title={t("clubElements.section.access")} hint={t("clubElements.section.accessHint")}>
        <ClubAccessTab draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
      </Section>

      <Section title={t("clubElements.section.matrix")} hint={t("clubElements.section.matrixHint")}>
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">
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
                {CAPABILITY_KEYS.map((key) => (
                  <TableRow key={key}>
                    <TableCell className="text-sm font-medium">{key}</TableCell>
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

      <Section
        title={t("clubElements.section.reactions")}
        hint={t("clubElements.section.reactionsHint")}
      >
        <Card>
          <CardContent className="space-y-5 p-5">
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

      <Section
        title={t("clubElements.section.reasons")}
        hint={t("clubElements.section.reasonsHint")}
      >
        <Card>
          <CardContent className="grid gap-3 p-5 sm:grid-cols-2">
            {CLUB_ACCESS_REASONS.map((reason) => (
              <div key={reason} className="rounded-md border border-border/60 p-3">
                <p className="font-mono text-xs text-muted-foreground">{reason}</p>
                <p className="mt-1 text-sm">{t(`club.reason.${reason}`)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </Section>

      <Section title={t("clubElements.section.routes")} hint={t("clubElements.section.routesHint")}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">/club</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 p-5 pt-0">
            <Button asChild size="sm" variant="outline">
              <Link to="/club">{t("clubElements.routes.index")}</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/community/clubs">{t("clubElements.routes.admin")}</Link>
            </Button>
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
