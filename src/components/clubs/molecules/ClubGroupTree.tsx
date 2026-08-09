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
import {
  CLUB_GROUP_CHIP,
  CLUB_GROUP_CHIP_ACTIVE,
  CLUB_GROUP_TINT,
  ClubGroupIcon,
  clubGroupAccentVars,
} from "@/components/clubs/atoms/ClubGroupAccent";
import { ClubRegimeMark } from "@/components/clubs/atoms/ClubRegimeMark";
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
  "group/row relative flex w-full min-h-9 items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-1.5 text-left text-sm transition-[background-color,color,box-shadow] duration-150";

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
  return (
    <div
      className="relative flex items-center"
      style={{ ...clubGroupAccentVars(group.accent_color), paddingLeft: depth * 14 }}
    >
      {/* Prowadnica poziomu: cienka pionowa kreska zamiast samego wcięcia.
          Przy dwóch poziomach wcięcie 14 px czyta się jako przypadek; kreska
          mówi wprost, że podgrupa NALEŻY do gałęzi wyżej. */}
      {depth > 0 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0.5 w-px bg-border/70"
          style={{ left: depth * 14 - 7 }}
        />
      ) : null}

      {/* Rozwijanie jest OSOBNYM przyciskiem od wyboru działu: kliknięcie w
          nazwę ma filtrować strumień, a nie zwijać gałąź. Miejsce na strzałkę
          rezerwujemy też dla liści, żeby nazwy stały w jednej kolumnie. */}
      {children.length > 0 ? (
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
      ) : (
        <span aria-hidden="true" className="h-6 w-5 shrink-0" />
      )}

      <button
        type="button"
        aria-pressed={active}
        title={name}
        onClick={onSelect}
        className={cn(
          ROW,
          "min-w-0 flex-1",
          active
            ? cn(
                CLUB_GROUP_TINT,
                "font-medium text-foreground shadow-[inset_2px_0_0_0_color-mix(in_oklab,var(--club-accent)_70%,transparent)]",
              )
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
      >
        {/* Ikona w kwadracie w kolorze działu - ten sam znacznik stoi w
            strumieniu i w panelu źródeł, więc te miejsca łączy się wzrokiem. */}
        <span
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors",
            active ? CLUB_GROUP_CHIP_ACTIVE : cn(CLUB_GROUP_CHIP, "opacity-90"),
          )}
          aria-hidden="true"
        >
          <ClubGroupIcon icon={group.icon} depth={depth} className="h-3.5 w-3.5" />
        </span>

        {/* Nazwa ZAWIJA się do dwóch linii zamiast się urywać - "Zdolności i
            przemysł obronny" po obcięciu przestaje być pozycją nawigacji. */}
        <span className="line-clamp-2 min-w-0 flex-1 text-left leading-snug">{name}</span>

        {locked ? (
          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}

        {/* Licznik zostaje CICHY, a przy zerze - prawie niewidoczny: pusty
            dział nie ma prawa przyciągać wzroku mocniej niż dział z ruchem. */}
        <span
          className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums transition-colors",
            totalThreads > 0
              ? "bg-muted text-muted-foreground group-hover/row:bg-muted/80"
              : "text-muted-foreground/45",
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
    <ul className="flex flex-col gap-0.5">
      <li>
        {/* "Wszystkie działy" dostaje ten sam kształt co dział - ikonę w
            kwadracie i licznik - bo jest pozycją tej samej listy, a nie
            nagłówkiem nad nią. */}
        <button
          type="button"
          aria-pressed={activeGroupId === null}
          onClick={() => onGroupChange(null)}
          className={cn(
            ROW,
            "pl-1.5",
            activeGroupId === null
              ? "bg-primary/10 font-medium text-primary shadow-[inset_2px_0_0_0_var(--primary)]"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          <span
            className={cn(
              "grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors",
              activeGroupId === null
                ? "border-primary/45 bg-primary/15"
                : "border-border/60 bg-muted/50",
            )}
            aria-hidden="true"
          >
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 truncate text-left">{t("club.allGroups")}</span>
          <span
            className={cn(
              "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums",
              totalThreads > 0
                ? "bg-muted text-muted-foreground"
                : "text-muted-foreground/45",
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
