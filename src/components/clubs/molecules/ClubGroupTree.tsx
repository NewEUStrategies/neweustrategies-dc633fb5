// Molekuła: drzewo działów klubu (grupy + podgrupy).
//
// Dział był dotąd linijką tekstu w szynie, przez co cztery byty klubu -
// dział, temat, dokument i wątek - wyglądały tak samo. Tutaj dział dostaje
// własny kolor (delikatny), własną ikonę, licznik wątków i - jeśli konwencja
// slugów ją niesie - hierarchię z podgrupami zwijanymi na miejscu.
//
// Zwijanie jest lokalne i domyślnie OTWARTE dla gałęzi zawierającej wybrany
// dział: użytkownik, który kliknął podgrupę, nie może stracić jej z oczu przy
// następnym renderze.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildClubGroupTree, clubGroupPath, type ClubGroupNode } from "@/lib/clubs/groupTree";
import { CLUB_GROUP_TEXT, ClubGroupIcon, clubGroupAccentVars } from "@/components/clubs/atoms/ClubGroupAccent";
import type { ClubGroupRow } from "@/lib/clubs/types";

export function clubGroupName(group: ClubGroupRow, isPl: boolean): string {
  return isPl ? group.name_pl : group.name_en || group.name_pl;
}

export function clubGroupDescription(group: ClubGroupRow, isPl: boolean): string {
  const value = isPl ? group.description_pl : group.description_en;
  return value === null ? "" : value.trim();
}

// Wspólny kształt wiersza. Wysokość jest MINIMALNA, nie stała - nazwa działu
// bywa dwuwierszowa i wiersz ma się do niej dopasować, a nie ją przyciąć.
const ROW =
  "group/row relative flex w-full items-center justify-between gap-2 rounded-lg border border-transparent px-3 py-2 text-left text-sm transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const COUNTER =
  "shrink-0 rounded-[5px] px-1.5 py-0.5 text-[10px] font-bold tabular-nums transition-opacity";

function GroupRow({
  node,
  active,
  expanded,
  onToggle,
  onSelect,
  isPl,
}: {
  node: ClubGroupNode;
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
  isPl: boolean;
}) {
  const { group, depth, children, totalThreads } = node;
  const locked = !group.can_read;
  const name = clubGroupName(group, isPl);
  const hasChildren = children.length > 0;
  const isSub = depth > 0;

  return (
    <div
      className="relative flex items-center"
      style={{ ...clubGroupAccentVars(group.accent_color), paddingLeft: depth * 14 }}
    >
      {/* Rozwijanie jest OSOBNYM przyciskiem od wyboru działu: kliknięcie w
          nazwę ma filtrować strumień, a nie zwijać gałąź. Miejsce na strzałkę
          rezerwujemy dla liści pierwszego poziomu, żeby nazwy stały w jednej
          kolumnie; podgrupy są zagnieżdżone i nie potrzebują tego wyrównania. */}
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={name}
          className="grid h-6 w-5 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <ChevronRight
            className={cn("h-3.5 w-3.5 transition-transform duration-200", expanded && "rotate-90")}
            aria-hidden="true"
          />
        </button>
      ) : !isSub ? (
        <span aria-hidden="true" className="h-6 w-5 shrink-0" />
      ) : null}

      <button
        type="button"
        aria-pressed={active}
        title={name}
        onClick={onSelect}
        className={cn(
          ROW,
          "min-w-0 flex-1",
          isSub && !hasChildren && "ml-2 border-l border-border/60 pl-3",
          active
            ? cn(
                "bg-[color-mix(in_oklab,var(--club-accent)_8%,var(--muted))] border-[color-mix(in_oklab,var(--club-accent)_20%,transparent)] shadow-[0_0_15px_-5px_var(--club-glow)] font-medium",
                CLUB_GROUP_TEXT,
              )
            : cn(
                "text-muted-foreground hover:bg-[color-mix(in_oklab,var(--club-accent)_5%,var(--muted))] hover:border-[color-mix(in_oklab,var(--club-accent)_10%,var(--border))] hover:text-[color-mix(in_oklab,var(--club-accent)_60%,var(--foreground))]",
                isSub && "text-muted-foreground/80",
              ),
        )}
      >
        {/* Ikona tylko na poziomie głównym - podgrupy czytają się jako
            ciche rozszerzenie gałęzi, bez własnego znaczka. */}
        {!isSub && (
          <ClubGroupIcon icon={group.icon} depth={depth} className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}

        {/* Nazwa ZAWIJA się do dwóch linii zamiast się urywać - "Zdolności i
            przemysł obronny" po obcięciu przestaje być pozycją nawigacji. */}
        <span className={cn("line-clamp-2 min-w-0 flex-1 text-left leading-snug", isSub && "text-xs")}>{name}</span>

        {locked ? (
          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}

        {/* Licznik zostaje CICHY, a przy zerze - prawie niewidoczny: pusty
            dział nie ma prawa przyciągać wzroku mocniej niż dział z ruchem. */}
        <span
          className={cn(
            COUNTER,
            active
              ? "bg-[color-mix(in_oklab,var(--club-accent)_85%,var(--foreground))] text-background"
              : "bg-[color-mix(in_oklab,var(--club-accent)_10%,transparent)] text-[color-mix(in_oklab,var(--club-accent)_60%,var(--foreground))] opacity-0 group-hover/row:opacity-100",
          )}
        >
          {totalThreads}
        </span>
      </button>
    </div>
  );
}

export function ClubGroupTree({
  groups,
  activeGroupId,
  onGroupChange,
  isPl,
}: {
  groups: readonly ClubGroupRow[];
  activeGroupId: string | null;
  onGroupChange: (groupId: string | null) => void;
  isPl: boolean;
}) {
  const { t } = useTranslation();
  const tree = useMemo(() => buildClubGroupTree(groups), [groups]);
  const openPath = useMemo(
    () => clubGroupPath(tree, activeGroupId).map((node) => node.group.id),
    [tree, activeGroupId],
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set<string>());

  const isExpanded = (id: string): boolean => openPath.includes(id) || !collapsed.has(id);
  const toggle = (id: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNodes = (nodes: readonly ClubGroupNode[]): React.ReactNode =>
    nodes.map((node) => (
      <li key={node.group.id} className="space-y-0.5">
        <GroupRow
          node={node}
          active={activeGroupId === node.group.id}
          expanded={isExpanded(node.group.id)}
          onToggle={() => toggle(node.group.id)}
          onSelect={() => onGroupChange(activeGroupId === node.group.id ? null : node.group.id)}
          isPl={isPl}
        />
        {node.children.length > 0 && isExpanded(node.group.id) ? (
          <ul className="space-y-0.5">{renderNodes(node.children)}</ul>
        ) : null}
      </li>
    ));

  const totalThreads = tree.reduce((sum, node) => sum + node.totalThreads, 0);

  return (
    <ul className="flex flex-col gap-1">
      <li>
        <button
          type="button"
          aria-pressed={activeGroupId === null}
          onClick={() => onGroupChange(null)}
          className={cn(
            ROW,
            activeGroupId === null
              ? "bg-muted/50 border-border/50 text-foreground font-medium"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          <span aria-hidden="true" className="h-6 w-5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">{t("club.allGroups")}</span>
          <span
            className={cn(
              COUNTER,
              activeGroupId === null
                ? "bg-muted text-foreground"
                : "bg-muted/50 text-muted-foreground opacity-0 group-hover/row:opacity-100",
            )}
          >
            {totalThreads}
          </span>
        </button>
      </li>
      {renderNodes(tree)}
    </ul>
  );
}

/** Wariant poziomy - na telefonie i tablecie, gdzie szyny nie ma wcale. */
export function ClubGroupBar({
  groups,
  activeGroupId,
  onGroupChange,
  isPl,
  className,
}: {
  groups: readonly ClubGroupRow[];
  activeGroupId: string | null;
  onGroupChange: (groupId: string | null) => void;
  isPl: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  if (groups.length === 0) return null;
  return (
    <nav
      aria-label={t("club.groups")}
      className={cn(
        "-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none]",
        className,
      )}
    >
      <button
        type="button"
        aria-pressed={activeGroupId === null}
        onClick={() => onGroupChange(null)}
        className={cn(
          "group shrink-0 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
          activeGroupId === null
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border/60 bg-card text-muted-foreground hover:bg-muted",
        )}
      >
        {t("club.allGroups")}
      </button>
      {groups.map((group) => {
        const active = activeGroupId === group.id;
        return (
          <button
            key={group.id}
            type="button"
            aria-pressed={active}
            onClick={() => onGroupChange(active ? null : group.id)}
            style={clubGroupAccentVars(group.accent_color)}
            className={cn(
              "group/chip inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
              active
                ? "border-[color-mix(in_oklab,var(--club-accent)_40%,transparent)] bg-[color-mix(in_oklab,var(--club-accent)_10%,var(--muted))] text-[color-mix(in_oklab,var(--club-accent)_40%,var(--foreground))]"
                : "border-border/60 bg-card text-muted-foreground hover:bg-[color-mix(in_oklab,var(--club-accent)_5%,var(--muted))] hover:text-[color-mix(in_oklab,var(--club-accent)_60%,var(--foreground))]",
            )}
          >
            <ClubGroupIcon icon={group.icon} className="h-3.5 w-3.5" />
            {clubGroupName(group, isPl)}
            <span
              className={cn(
                "tabular-nums transition-opacity",
                active ? "opacity-100" : "opacity-0 group-hover/chip:opacity-100",
              )}
            >
              {group.thread_count}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
