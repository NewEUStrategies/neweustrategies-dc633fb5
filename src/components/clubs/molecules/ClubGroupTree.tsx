// Molekuła: drzewo działów klubu (grupy + podgrupy).
//
// Wariant "Modern collapsible hierarchy": główne działy to rozwijane
// sekcje z ikoną i dużą etykietą, poddziały są cicho wcięte pod spodem.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildClubGroupTree, clubGroupPath, type ClubGroupNode } from "@/lib/clubs/groupTree";
import { ClubGroupIcon, clubGroupAccentVars } from "@/components/clubs/atoms/ClubGroupAccent";
import type { ClubGroupRow } from "@/lib/clubs/types";

export function clubGroupName(group: ClubGroupRow, isPl: boolean): string {
  return isPl ? group.name_pl : group.name_en || group.name_pl;
}

export function clubGroupDescription(group: ClubGroupRow, isPl: boolean): string {
  const value = isPl ? group.description_pl : group.description_en;
  return value === null ? "" : value.trim();
}

const COUNTER =
  "shrink-0 rounded-[5px] px-1.5 py-0.5 text-[10px] font-bold tabular-nums transition-opacity";

function ThreadCounter({ count, active }: { count: number; active: boolean }) {
  return (
    <span
      className={cn(
        COUNTER,
        active
          ? "bg-[color-mix(in_oklab,var(--club-accent)_85%,var(--foreground))] text-background"
          : "bg-[color-mix(in_oklab,var(--club-accent)_10%,transparent)] text-[color-mix(in_oklab,var(--club-accent)_60%,var(--foreground))] opacity-0 group-hover/row:opacity-100",
      )}
    >
      {count}
    </span>
  );
}

function ParentRow({
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
  const { group, children, totalThreads } = node;
  const locked = !group.can_read;
  const name = clubGroupName(group, isPl);
  const hasChildren = children.length > 0;

  return (
    <div
      className="group/row flex items-center gap-1"
      style={clubGroupAccentVars(group.accent_color)}
    >
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={name}
          className="grid h-6 w-5 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <ChevronRight
            className={cn("h-3.5 w-3.5 transition-transform duration-200", expanded && "rotate-90")}
            aria-hidden="true"
          />
        </button>
      ) : (
        <span aria-hidden="true" className="h-6 w-5 shrink-0" />
      )}

      <button
        type="button"
        aria-pressed={active}
        title={name}
        onClick={onSelect}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wider transition-colors",
          active
            ? "bg-muted/50 text-foreground"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
      >
        <ClubGroupIcon
          icon={group.icon}
          className="h-4 w-4 shrink-0 text-muted-foreground group-hover/row:text-foreground"
        />
        <span className="line-clamp-2 min-w-0 flex-1 leading-snug">{name}</span>
        {locked ? (
          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
        <ThreadCounter count={totalThreads} active={active} />
      </button>
    </div>
  );
}

function SubRow({
  node,
  active,
  onSelect,
  isPl,
}: {
  node: ClubGroupNode;
  active: boolean;
  onSelect: () => void;
  isPl: boolean;
}) {
  const { group, totalThreads } = node;
  const locked = !group.can_read;
  const name = clubGroupName(group, isPl);
  const indent = 14 + node.depth * 28;

  return (
    <div className="group/row" style={{ ...clubGroupAccentVars(group.accent_color), marginLeft: indent }}>
      <button
        type="button"
        aria-pressed={active}
        title={name}
        onClick={onSelect}
        className={cn(
          "flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-sm transition-colors",
          active
            ? "bg-muted/50 font-medium text-foreground"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
      >
        <span className="line-clamp-2 min-w-0 flex-1 leading-snug">{name}</span>
        {locked ? (
          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
        <ThreadCounter count={totalThreads} active={active} />
      </button>
    </div>
  );
}

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
  return node.depth === 0 ? (
    <ParentRow
      node={node}
      active={active}
      expanded={expanded}
      onToggle={onToggle}
      onSelect={onSelect}
      isPl={isPl}
    />
  ) : (
    <SubRow node={node} active={active} onSelect={onSelect} isPl={isPl} />
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
    <div className="flex flex-col gap-4">
      <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {t("club.groups")}
      </h2>
      <ul className="flex flex-col gap-1">
        <li>
          <button
            type="button"
            aria-pressed={activeGroupId === null}
            onClick={() => onGroupChange(null)}
            className={cn(
              "group/row flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wider transition-colors",
              activeGroupId === null
                ? "bg-muted/50 text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <span aria-hidden="true" className="h-6 w-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t("club.allGroups")}</span>
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
    </div>
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
          "group/chip shrink-0 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
          activeGroupId === null
            ? "border-foreground/20 bg-muted/50 text-foreground"
            : "border-border/60 bg-transparent text-muted-foreground hover:bg-muted/50",
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
                ? "border-[color-mix(in_oklab,var(--club-accent)_40%,var(--border))] bg-[color-mix(in_oklab,var(--club-accent)_8%,var(--muted))] text-[color-mix(in_oklab,var(--club-accent)_40%,var(--foreground))]"
                : "border-border/60 bg-transparent text-muted-foreground hover:bg-[color-mix(in_oklab,var(--club-accent)_5%,var(--muted))] hover:text-[color-mix(in_oklab,var(--club-accent)_60%,var(--foreground))]",
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
