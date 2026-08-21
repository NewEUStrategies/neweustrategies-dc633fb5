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
//
// CO ZOSTAŁO W TYM PLIKU PO WYPROWADZENIU REGUŁ. Układ i tylko układ: cztery
// zakładki, karty, tabela macierzy, ikony. Które słowniki stoją pod którą
// etykietą, jak liczy się licznik sekcji, co znika pod filtrem i jak działa
// dopasowanie bez akcentów - to `lib/clubs/adminElementsCatalog.ts`. Jeden
// znacznik wartości, jeden wiersz osi, karta słownika, karta kodu i komórka
// macierzy - molekuły `ClubInboxCatalog*`.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookMarked,
  Check,
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
import { ClubInboxCatalogCodeCard } from "@/components/admin/clubs/molecules/ClubInboxCatalogCodeCard";
import { ClubInboxCatalogMatrixCell } from "@/components/admin/clubs/molecules/ClubInboxCatalogMatrixCell";
import { ClubInboxCatalogVocabCard } from "@/components/admin/clubs/molecules/ClubInboxCatalogVocabCard";
import { ClubInboxCatalogVocabRow } from "@/components/admin/clubs/molecules/ClubInboxCatalogVocabRow";
import {
  ClubAccessTab,
  type ClubAccessDraft,
} from "@/components/admin/clubs/organisms/ClubAccessTab";
import { ClubReactionBar } from "@/components/clubs/molecules/ClubReactionBar";
import { CAPABILITY_ROLES, capabilityValue } from "@/lib/clubs/capabilityMatrix";
import { ClubElementsGallery } from "@/components/clubs/organisms/ClubElementsGallery";
import {
  CATALOG_CODE_SOURCES,
  CATALOG_GROUPS,
  CATALOG_INITIAL_DRAFT,
  CATALOG_INITIAL_TALLIES,
  CATALOG_SECTION_SIZE,
  CATALOG_VOCAB_CARDS,
  catalogBadgesVisible,
  catalogCodeRows,
  catalogGroupSections,
  catalogGroupSize,
  catalogNothingFound,
  catalogQuery,
  catalogSectionHidden,
  filterCapabilityKeys,
  toggleReactionTally,
  type CatalogGroupId,
  type CatalogSectionId,
} from "@/lib/clubs/adminElementsCatalog";
import {
  CLUB_GROUP_STATUSES,
  CLUB_MEMBER_ROLES,
  CLUB_MEMBER_STATUSES,
  CLUB_STATUSES,
  CLUB_VISIBILITIES,
  type ClubReactionKind,
  type ClubReactionTally,
} from "@/lib/clubs/types";
import { ensureClubI18n } from "@/lib/i18n-club";
import { ensureAdminClubsI18n } from "@/lib/i18n-clubs-admin";
import { ensureClubElementsI18n } from "@/lib/i18n-club-elements";

/** Ikony zakładek - jedyna rzecz, jaką organizm dokłada do listy grup. */
const GROUP_ICON: Record<CatalogGroupId, typeof BookMarked> = {
  vocab: BookMarked,
  components: Shapes,
  rules: KeyRound,
  codes: TriangleAlert,
};

/** Sekcje słownikowe w kolejności renderowania w zakładce „słowniki”. */
const VOCAB_SECTIONS = ["vocab", "threadVocab", "opsVocab"] as const;

type SectionProps = {
  id: CatalogSectionId;
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

export function ClubElementsCatalog() {
  ensureAdminClubsI18n();
  ensureClubI18n();
  ensureClubElementsI18n();
  const { t } = useTranslation();

  const [rawQuery, setRawQuery] = useState("");
  const [group, setGroup] = useState<CatalogGroupId>("vocab");
  const [draft, setDraft] = useState<ClubAccessDraft>(CATALOG_INITIAL_DRAFT);
  const [tallies, setTallies] = useState<ClubReactionTally[]>([...CATALOG_INITIAL_TALLIES]);
  const query = useMemo(() => catalogQuery(rawQuery), [rawQuery]);
  const activeSections = catalogGroupSections(group);

  const toggleReaction = (kind: ClubReactionKind, active: boolean) => {
    setTallies((prev) => toggleReactionTally(prev, kind, active));
  };

  /** `t` zawężone do jednego argumentu - moduł reguł nie zna i18next. */
  const translate = (key: string): string => t(key);

  const reasons = catalogCodeRows(CATALOG_CODE_SOURCES.reasons, translate, query);
  const inviteErrors = catalogCodeRows(CATALOG_CODE_SOURCES.invite, translate, query);
  const saveErrors = catalogCodeRows(CATALOG_CODE_SOURCES.save, translate, query);
  const capabilityKeys = filterCapabilityKeys(query);

  const badgesVisible = catalogBadgesVisible(t("clubElements.section.badges"), query);
  const nothingFound = catalogNothingFound(query, [
    reasons.length,
    inviteErrors.length,
    saveErrors.length,
    capabilityKeys.length,
  ]);

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
      <Tabs
        value={group}
        onValueChange={(value) => setGroup(value as CatalogGroupId)}
        className="gap-6"
      >
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-muted/40 p-1">
          {CATALOG_GROUPS.map((entry) => {
            const Icon = GROUP_ICON[entry.id];
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
                  {catalogGroupSize(entry.id)}
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
              <span className="text-xs tabular-nums opacity-70">{CATALOG_SECTION_SIZE[id]}</span>
            </a>
          ))}
        </nav>

        <TabsContent value="vocab" className="min-w-0 space-y-10">
          {VOCAB_SECTIONS.map((id) => (
            <Section
              key={id}
              id={id}
              title={t(`clubElements.section.${id}`)}
              hint={t(`clubElements.section.${id}Hint`)}
            >
              {/* Reakcje dzielą się na DWIE rozłączne grupy i to jest reguła bazy,
                  nie konwencja interfejsu: trigger podmienia jedno stanowisko na
                  drugie, a oceny jakości sumują się niezależnie. Dlatego osie
                  jadą KARTAMI, a nie jedną listą. */}
              {CATALOG_VOCAB_CARDS[id].map((axes) => (
                <ClubInboxCatalogVocabCard key={axes[0].labelKey}>
                  {axes.map((axis) => (
                    <ClubInboxCatalogVocabRow
                      key={axis.labelKey}
                      label={t(axis.labelKey)}
                      values={axis.values}
                      prefix={axis.prefix}
                      query={query}
                    />
                  ))}
                </ClubInboxCatalogVocabCard>
              ))}
            </Section>
          ))}
        </TabsContent>

        <TabsContent value="components" className="min-w-0 space-y-10">
          {catalogSectionHidden("badges", query, badgesVisible) ? null : (
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
                            <ClubInboxCatalogMatrixCell value={capabilityValue(key, role)} />
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
          {catalogSectionHidden("reasons", query, reasons.length > 0) ? null : (
            <Section
              id="reasons"
              title={t("clubElements.section.reasons")}
              hint={t("clubElements.section.reasonsHint")}
            >
              <Card>
                <CardContent className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
                  {reasons.map((row) => (
                    <ClubInboxCatalogCodeCard
                      key={row.code}
                      code={row.code}
                      sentence={row.sentence}
                    />
                  ))}
                </CardContent>
              </Card>
            </Section>
          )}

          {catalogSectionHidden(
            "errors",
            query,
            inviteErrors.length + saveErrors.length > 0,
          ) ? null : (
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
                        <ClubInboxCatalogCodeCard
                          key={row.code}
                          code={row.code}
                          sentence={row.sentence}
                        />
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
                        <ClubInboxCatalogCodeCard
                          key={row.code}
                          code={row.code}
                          sentence={row.sentence}
                        />
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
