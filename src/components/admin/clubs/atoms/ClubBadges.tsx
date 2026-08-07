// Atomy: znaczniki stanu klubu, grupy, roli i członkostwa.
//
// Kolor niesie znaczenie, a nie dekorację: czerwony wyłącznie tam, gdzie coś
// jest odcięte (zablokowany, zamrożona), bursztynowy tam, gdzie coś czeka na
// decyzję człowieka (wersja robocza, oczekuje). Dzięki temu skanowanie tabeli
// wzrokiem wyłapuje pozycje wymagające działania, zanim czytelnik przeczyta
// choć jedną etykietę.
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  ClubGroupStatus,
  ClubMemberRole,
  ClubMemberStatus,
  ClubStatus,
  ClubVisibility,
} from "@/lib/clubs/types";

type Tone = "neutral" | "positive" | "attention" | "danger" | "info";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border/60",
  positive: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
  attention: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  info: "bg-primary/10 text-primary border-primary/30",
};

function ToneBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <Badge variant="outline" className={cn("font-medium whitespace-nowrap", TONE_CLASS[tone])}>
      {children}
    </Badge>
  );
}

const CLUB_STATUS_TONE: Record<ClubStatus, Tone> = {
  draft: "attention",
  active: "positive",
  archived: "neutral",
};

export function ClubStatusBadge({ status }: { status: ClubStatus }) {
  const { t } = useTranslation();
  return <ToneBadge tone={CLUB_STATUS_TONE[status]}>{t(`club.status.${status}`)}</ToneBadge>;
}

const GROUP_STATUS_TONE: Record<ClubGroupStatus, Tone> = {
  draft: "attention",
  scheduled: "info",
  active: "positive",
  frozen: "danger",
  archived: "neutral",
};

export function ClubGroupStatusBadge({ status }: { status: ClubGroupStatus }) {
  const { t } = useTranslation();
  return (
    <ToneBadge tone={GROUP_STATUS_TONE[status]}>{t(`club.groupStatus.${status}`)}</ToneBadge>
  );
}

// Widoczność: im węższa, tym mocniejszy sygnał. `secret` jest informacją
// o ryzyku (treść niewidoczna nawet dla zalogowanych), więc nie jest szara.
const VISIBILITY_TONE: Record<ClubVisibility, Tone> = {
  public: "info",
  members: "neutral",
  private: "attention",
  secret: "danger",
};

export function ClubVisibilityBadge({ visibility }: { visibility: ClubVisibility }) {
  const { t } = useTranslation();
  return (
    <ToneBadge tone={VISIBILITY_TONE[visibility]}>{t(`club.visibility.${visibility}`)}</ToneBadge>
  );
}

const MEMBER_STATUS_TONE: Record<ClubMemberStatus, Tone> = {
  active: "positive",
  pending: "attention",
  invited: "info",
  banned: "danger",
  left: "neutral",
};

export function ClubMemberStatusBadge({ status }: { status: ClubMemberStatus }) {
  const { t } = useTranslation();
  return (
    <ToneBadge tone={MEMBER_STATUS_TONE[status]}>{t(`club.memberStatus.${status}`)}</ToneBadge>
  );
}

const ROLE_TONE: Record<ClubMemberRole, Tone> = {
  lead: "info",
  moderator: "info",
  member: "neutral",
  observer: "neutral",
};

export function ClubRoleBadge({ role }: { role: ClubMemberRole }) {
  const { t } = useTranslation();
  return <ToneBadge tone={ROLE_TONE[role]}>{t(`club.role.${role}`)}</ToneBadge>;
}
