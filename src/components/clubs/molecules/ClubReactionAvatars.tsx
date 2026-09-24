// Twarze pod wpisem: kto zareagował na wątek lub odpowiedź.
//
// Licznik mówi ILE, awatary mówią KTO - i to drugie decyduje, czy członek
// klubu wchodzi w rozmowę. W trybie poufnym (Chatham House) baza nie oddaje
// tożsamości, więc pokazujemy neutralne znaczniki i sam licznik: interfejs nie
// może sugerować nazwisk, których zasady klubu celowo nie ujawniają.
//
// Nadwyżkę niesie JEDEN element - licznik "+N" na końcu stosu (z pełnym
// "i N innych osób" dla czytnika ekranu i w dymku). Osobny podpis obok stosu
// dublował tę samą liczbę, gdy twarzy było więcej niż miejsc.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AvatarGroup, type AvatarGroupItem } from "@/components/atoms/AvatarGroup";
import type { ClubReactionActor } from "@/lib/clubs/types";

interface ClubReactionAvatarsProps {
  actors: readonly ClubReactionActor[];
  /** Suma reakcji z licznika - może być większa niż liczba twarzy. */
  total?: number;
  maxVisible?: number;
  size?: "xs" | "sm";
  className?: string;
}

export function ClubReactionAvatars({
  actors,
  total,
  maxVisible = 5,
  size = "xs",
  className,
}: ClubReactionAvatarsProps) {
  const { t } = useTranslation();

  const items = useMemo<AvatarGroupItem[]>(
    () =>
      actors.map((actor, index) => {
        const kinds = actor.kinds.map((k) => t(`club.reaction.${k}`)).join(" \u00b7 ");
        const anonymous = actor.userId === null;
        const name = anonymous
          ? t("club.reactionActors.anonymous")
          : actor.isMe
            ? t("club.reactionActors.you")
            : (actor.name ?? t("club.reactionActors.anonymous"));
        return {
          id: actor.userId ?? `anon-${index}`,
          name,
          designation: [actor.headline, kinds].filter(Boolean).join(" \u2013 ") || kinds,
          image: actor.avatarUrl,
          href: actor.slug ? `/author/${encodeURIComponent(actor.slug)}` : null,
          anonymous,
        };
      }),
    [actors, t],
  );

  if (items.length === 0) return null;

  return (
    <div className={className}>
      <AvatarGroup
        items={items}
        size={size}
        maxVisible={maxVisible}
        // Licznik z bazy wygrywa z liczbą twarzy: RPC oddaje najwyżej kilka
        // wierszy na cel, a "+N" ma mówić o wszystkich.
        total={total}
        label={t("club.reactionActors.label")}
        overflowLabel={(count) => t("club.reactionActors.more", { count })}
      />
    </div>
  );
}
