// Twarze pod wpisem: kto zareagował na wątek lub odpowiedź.
//
// Licznik mówi ILE, awatary mówią KTO - i to drugie decyduje, czy członek
// klubu wchodzi w rozmowę. W trybie poufnym (Chatham House) baza nie oddaje
// tożsamości, więc pokazujemy neutralne znaczniki i sam licznik: interfejs nie
// może sugerować nazwisk, których zasady klubu celowo nie ujawniają.
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
          href: actor.slug ? `/people/${actor.slug}` : null,
          anonymous,
        };
      }),
    [actors, t],
  );

  if (items.length === 0) return null;

  const people = actors.length;
  const shown = Math.min(items.length, maxVisible);
  const hidden = Math.max(0, (total ?? people) - shown);

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <AvatarGroup
          items={items}
          size={size}
          maxVisible={maxVisible}
          label={t("club.reactionActors.label")}
          overflowLabel={(count) => t("club.reactionActors.more", { count })}
        />
        {hidden > 0 ? (
          <span className="text-[11px] leading-none text-muted-foreground">
            {t("club.reactionActors.more", { count: hidden })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
