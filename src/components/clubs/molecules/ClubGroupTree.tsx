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
import {
  buildClubGroupTree,
  clubGroupPath,
  type ClubGroupNode,
} from "@/lib/clubs/groupTree";
import {
  CLUB_GROUP_DOT,
  CLUB_GROUP_TINT,
  ClubGroupIcon,
  clubGroupAccentVars,
} from "@/components/clubs/atoms/ClubGroupAccent";
import { ClubRegimeMark } from "@/components/clubs/atoms/ClubRegimeMark";
import type { ClubGroupRow } from "@/lib/clubs/types";

export function clubGroupName(group: ClubGroupRow, isPl: boolean): string {
  return isPl ? group.name_pl : (group.name_en || group.name_pl);
}

export function clubGroupDescription(group: ClubGroupRow, isPl: boolean): string {
  const value = isPl ? group.description_pl : group.description_en;
  return value === null ? "" : value.trim();
}

const ROW =
  "group flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-sm leading-none transition-colors";

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
  return (
    <div className="flex items-center" style={clubGroupAccentVars(group.accent_color)}>
      {children.length > 0 ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={clubGroupName(group, isPl)}
          className="shrink-0 rounded-lg p-1 text-muted-foreground hover:text-foreground"
          style={{ marginLeft: depth * 10 }}
        >
          <ChevronRight
            className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")}
            aria-hidden="true"
          />
        </button>
      ) : (
        <span
          aria-hidden="true"
          className="shrink-0"
          style={{ marginLeft: depth * 10 + (depth > 0 ? 22 : 22) }}
        />
      )}
      <button
        type="button"
        aria-pressed={active}
        onClick={onSelect}
        className={cn(
          ROW,
          "min-w-0 flex-1 pl-1.5",
          active
            ? cn("border", CLUB_GROUP_TINT, "font-medium text-foreground")
            : "border border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
      >
        <span className={cn("h-4 w-1 shrink-0 rounded-full", CLUB_GROUP_DOT)} aria-hidden="true" />
        <ClubGroupIcon
          icon={group.icon}
          depth={depth}
          className={cn("h-3.5 w-3.5", active ? "" : "opacity-70")}
        />
        <span className="min-w-0 flex-1 truncate">{clubGroupName(group, isPl)}</span>
        {/* Reżim stoi PRZED kłódką braku dostępu, bo dotyczy działu, a kłódka
            dotyczy wołającego - to są dwa różne komunikaty i nie wolno ich
            zlepić w jedną ikonę. */}
        <ClubRegimeMark group={group} />
        {locked ? (
          <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
        <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
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

  return (
    <ul className="flex flex-col gap-0.5">
      <li>
        <button
          type="button"
          aria-pressed={activeGroupId === null}
          onClick={() => onGroupChange(null)}
          className={cn(
            ROW,
            "pl-2",
            activeGroupId === null
              ? "bg-primary/10 font-medium text-primary"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          <span className="truncate">{t("club.allGroups")}</span>
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
      className={cn("-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none]", className)}
    >
      <button
        type="button"
        aria-pressed={activeGroupId === null}
        onClick={() => onGroupChange(null)}
        className={cn(
          "shrink-0 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium",
          activeGroupId === null
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border/60 bg-card text-muted-foreground",
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
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium",
              active
                ? cn(CLUB_GROUP_TINT, "text-foreground")
                : "border-border/60 bg-card text-muted-foreground",
            )}
          >
            <ClubGroupIcon icon={group.icon} className="h-3.5 w-3.5" />
            {clubGroupName(group, isPl)}
            <ClubRegimeMark group={group} />
            <span className="tabular-nums opacity-70">{group.thread_count}</span>
          </button>
        );
      })}
    </nav>
  );
}
