// Molekuła: drzewo działów klubu (grupy + podgrupy).
//
// Wariant "Ghost Ember Sidebar": główne działy to rozwijane karty z ikoną
// w półprzezroczystym kwadracie, poddziały są cicho wcięte z lewą linią.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, LayoutGrid, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildClubGroupTree, clubGroupPath, type ClubGroupNode } from "@/lib/clubs/groupTree";
import { ClubGroupIcon, clubGroupAccentVars } from "@/components/clubs/atoms/ClubGroupAccent";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized, type LocaleCode } from "@/lib/i18n/pickLocalized";
import type { ClubGroupRow } from "@/lib/clubs/types";

/**
 * Nazwa działu w języku interfejsu. `pickLocalized` sięga po drugi język, gdy
 * wybrany jest pusty - stąd brak dawnego `|| group.name_pl` na końcu: ten
 * fallback był i tak nieosiągalny, bo pusty wynik znaczy, że OBIE kolumny
 * są puste.
 */
export function clubGroupName(group: ClubGroupRow, lang: LocaleCode): string {
  return pickLocalized(group, "name", lang);
}

export function clubGroupDescription(group: ClubGroupRow, lang: LocaleCode): string {
  return pickLocalized(group, "description", lang).trim();
}

const ACCENT_TEXT = "text-[color-mix(in_oklab,var(--club-accent)_75%,var(--foreground))]";
const ACCENT_BG = "bg-[color-mix(in_oklab,var(--club-accent)_10%,var(--muted))]";
const ACCENT_BG_HOVER = "group-hover:bg-[color-mix(in_oklab,var(--club-accent)_12%,var(--muted))]";
const ACCENT_TEXT_HOVER =
  "group-hover:text-[color-mix(in_oklab,var(--club-accent)_75%,var(--foreground))]";

function ThreadCounter({ count, active }: { count: number; active: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums transition-opacity",
        active
          ? "bg-[color-mix(in_oklab,var(--club-accent)_85%,var(--foreground))] text-background"
          : "bg-muted text-muted-foreground opacity-0 group-hover/row:opacity-100",
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
}: {
  node: ClubGroupNode;
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const { i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { group, children, totalThreads } = node;
  const locked = !group.can_read;
  const name = clubGroupName(group, lang);
  const hasChildren = children.length > 0;

  return (
    <div className="group/row" style={clubGroupAccentVars(group.accent_color)}>
      <button
        type="button"
        aria-pressed={active}
        aria-expanded={hasChildren ? expanded : undefined}
        title={name}
        onClick={hasChildren ? onToggle : onSelect}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
          active ? "bg-muted/50" : "hover:bg-muted/50",
        )}
      >
        <div
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors",
            active ? ACCENT_BG : "bg-muted/50",
            !active && ACCENT_BG_HOVER,
          )}
        >
          <ClubGroupIcon
            icon={group.icon}
            className={cn(
              "h-4 w-4 shrink-0 transition-colors",
              active ? ACCENT_TEXT : "text-muted-foreground",
              !active && ACCENT_TEXT_HOVER,
            )}
          />
        </div>

        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm font-semibold",
            active ? "text-foreground" : "text-foreground/80",
          )}
        >
          {name}
        </span>

        {locked ? (
          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}

        {hasChildren ? (
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-300",
              expanded && "rotate-90",
            )}
            aria-hidden="true"
          />
        ) : (
          <span className="shrink-0">
            <ThreadCounter count={totalThreads} active={active} />
          </span>
        )}
      </button>
    </div>
  );
}

function SubRow({
  node,
  active,
  onSelect,
}: {
  node: ClubGroupNode;
  active: boolean;
  onSelect: () => void;
}) {
  const { i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { group, totalThreads } = node;
  const locked = !group.can_read;
  const name = clubGroupName(group, lang);

  return (
    <div className="group/row" style={clubGroupAccentVars(group.accent_color)}>
      <button
        type="button"
        aria-pressed={active}
        title={name}
        onClick={onSelect}
        className={cn(
          "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors",
          active ? cn("bg-muted/50", ACCENT_TEXT) : cn("text-muted-foreground", ACCENT_TEXT_HOVER),
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
}: {
  node: ClubGroupNode;
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  return node.depth === 0 ? (
    <ParentRow
      node={node}
      active={active}
      expanded={expanded}
      onToggle={onToggle}
      onSelect={onSelect}
    />
  ) : (
    <SubRow node={node} active={active} onSelect={onSelect} />
  );
}

export function ClubGroupTree({
  groups,
  activeGroupId,
  onGroupChange,
}: {
  groups: readonly ClubGroupRow[];
  activeGroupId: string | null;
  onGroupChange: (groupId: string | null) => void;
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

  const totalThreads = tree.reduce((sum, node) => sum + node.totalThreads, 0);

  const renderNodes = (nodes: readonly ClubGroupNode[]): React.ReactNode =>
    nodes.map((node) => {
      const expanded = isExpanded(node.group.id);
      return (
        <li key={node.group.id}>
          <GroupRow
            node={node}
            active={activeGroupId === node.group.id}
            expanded={expanded}
            onToggle={() => toggle(node.group.id)}
            onSelect={() => onGroupChange(activeGroupId === node.group.id ? null : node.group.id)}
          />
          {node.children.length > 0 && expanded ? (
            <ul className="ml-8 mt-0.5 flex list-none flex-col gap-0.5 border-l border-border/60 pl-3">
              {renderNodes(node.children)}
            </ul>
          ) : null}
        </li>
      );
    });

  return (
    <div className="flex flex-col gap-4">
      <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {t("club.groups")}
      </h2>
      <ul className="flex flex-col gap-1 list-none">
        <li>
          <button
            type="button"
            aria-pressed={activeGroupId === null}
            onClick={() => onGroupChange(null)}
            className={cn(
              "group/row flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
              activeGroupId === null ? "bg-muted/50" : "hover:bg-muted/50",
            )}
          >
            <div
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted/50 transition-colors",
                activeGroupId === null ? "bg-muted" : "group-hover/row:bg-muted",
              )}
            >
              <LayoutGrid
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  activeGroupId === null
                    ? "text-foreground"
                    : "text-muted-foreground group-hover/row:text-foreground",
                )}
                aria-hidden="true"
              />
            </div>
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm font-semibold",
                activeGroupId === null ? "text-foreground" : "text-foreground/80",
              )}
            >
              {t("club.allGroups")}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums",
                activeGroupId === null
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground opacity-0 group-hover/row:opacity-100 transition-opacity",
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
  className,
}: {
  groups: readonly ClubGroupRow[];
  activeGroupId: string | null;
  onGroupChange: (groupId: string | null) => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  if (groups.length === 0) return null;
  return (
    <nav
      aria-label={t("club.groups")}
      className={cn("-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]", className)}
    >
      <button
        type="button"
        aria-pressed={activeGroupId === null}
        onClick={() => onGroupChange(null)}
        className={cn(
          "group/chip inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          activeGroupId === null
            ? "border-foreground/20 bg-muted/50 text-foreground"
            : "border-border/60 bg-transparent text-muted-foreground hover:bg-muted/50",
        )}
      >
        <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
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
              "group/chip inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "border-[color-mix(in_oklab,var(--club-accent)_40%,var(--border))] bg-[color-mix(in_oklab,var(--club-accent)_8%,var(--muted))] text-[color-mix(in_oklab,var(--club-accent)_40%,var(--foreground))]"
                : "border-border/60 bg-transparent text-muted-foreground hover:bg-[color-mix(in_oklab,var(--club-accent)_5%,var(--muted))] hover:text-[color-mix(in_oklab,var(--club-accent)_60%,var(--foreground))]",
            )}
          >
            <ClubGroupIcon icon={group.icon} className="h-3.5 w-3.5" />
            {clubGroupName(group, lang)}
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
