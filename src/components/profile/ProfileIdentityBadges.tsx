// MOLEKUŁA: jeden, wspólny układ odznak tożsamości przy nazwisku.
//
// Kolejność jest CELOWA i identyczna na każdej powierzchni (własny profil,
// /author/$slug, hero eksperta, karty katalogu osób, komponenty sieciowe):
//
//   [stopień sieci 1°/2°/3°] -> [Zweryfikowany] -> [odznaki katalogu]
//
// Relacja czyta się razem z nazwiskiem (odpowiada na „czy to ktoś z mojego
// świata?"), potem zaufanie (weryfikacja), a na końcu role/wyróżnienia.
// Stopień może przyjść dwoma drogami:
//   - `userId`  -> organizm NetworkDistance sam dobiera stan z batchowanego
//                  `connection_statuses` (profil, hero eksperta),
//   - `degree`  -> wartość już wczytana z listy (karty /people, sugestie),
// dzięki czemu listy nie robią ani jednego zapytania więcej.
import { DegreeBadge } from "@/components/network/atoms/DegreeBadge";
import { NetworkDistance } from "@/components/network/organisms/NetworkDistance";
import { VerifiedProfileBadge } from "@/components/profile/VerifiedProfileBadge";
import { ProfileBadges } from "@/components/profile/ProfileBadges";
import type { ConnectionDegree } from "@/lib/network/degree";
import type { ProfileBadgeKind } from "@/lib/profile/badgeCatalog";
import { cn } from "@/lib/utils";

export interface ProfileIdentityBadgesProps {
  /** Stopień liczony po stronie komponentu (profil, hero) - wymaga id osoby. */
  userId?: string;
  displayName?: string;
  avatarUrl?: string | null;
  /** Stopień już wczytany z listy - używany zamiast `userId`. */
  degree?: ConnectionDegree;
  verified?: boolean;
  badges?: ProfileBadgeKind[];
  /** `sm` na gęste listy, `md` na nagłówki profilu. */
  size?: "sm" | "md";
  className?: string;
}

export function ProfileIdentityBadges({
  userId,
  displayName,
  avatarUrl,
  degree,
  verified = false,
  badges,
  size = "md",
  className,
}: ProfileIdentityBadgesProps) {
  const hasAny = !!userId || degree !== undefined || verified || (badges?.length ?? 0) > 0;
  if (!hasAny) return null;

  return (
    <span
      className={cn(
        "inline-flex min-w-0 flex-wrap items-center align-middle",
        size === "sm" ? "gap-1" : "gap-1.5",
        className,
      )}
    >
      {degree !== undefined ? (
        <DegreeBadge degree={degree} size={size === "sm" ? "xs" : "sm"} />
      ) : userId ? (
        <NetworkDistance
          userId={userId}
          displayName={displayName ?? ""}
          avatarUrl={avatarUrl}
          path="none"
          density={size === "sm" ? "compact" : "full"}
        />
      ) : null}
      {verified ? <VerifiedProfileBadge size={size} /> : null}
      <ProfileBadges badges={badges} size={size} className="shrink-0" />
    </span>
  );
}

export default ProfileIdentityBadges;
