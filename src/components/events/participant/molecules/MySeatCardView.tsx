// Molekula: karta "Twoje miejsce na sali" - czysta prezentacja kart z
// `event_my_seats` / `event_ticket_seats`.
//
// JEDNA KARTA NA PLAN. Uczestnik moze miec miejsce na kilku planach (np.
// konferencja i gala); kazdy plan to osobna karta z wlasna mini-mapa.
//
// ETYKIETA Z `seatLabelMessage` - to samo zdanie co w panelu organizatora
// i na liscie przy drzwiach. Nazwy kategorii i sesji sa dwujezyczne
// (`pickLocalized`), nazwy planu, sali i sekcji - wlasne, jednojezyczne.
import { Accessibility, Armchair } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SeatMiniMap } from "@/components/events/participant/atoms/SeatMiniMap";
import type { MySeatCard } from "@/lib/events/mySeatsApi";
import { seatLabelMessage } from "@/lib/events/seatLabel";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureEventSeatingI18n } from "@/lib/i18n-event-seating";

ensureEventSeatingI18n();

export function MySeatCardView({ card }: { card: MySeatCard }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const message = seatLabelMessage(card);
  const seatText = t(message.key, message.params);
  const session = pickLocalized(
    { title_pl: card.sessionTitlePl, title_en: card.sessionTitleEn },
    "title",
    lang,
  );
  const category =
    card.category === null
      ? ""
      : pickLocalized(
          { name_pl: card.category.namePl, name_en: card.category.nameEn },
          "name",
          lang,
        );

  return (
    <article className="space-y-3 rounded-[6px] border border-border bg-card p-4">
      <header className="flex items-start gap-2">
        <Armchair className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-base font-semibold text-foreground">{seatText}</h3>
          <p className="text-sm text-muted-foreground">
            {t("eventSeating.card.plan", { name: card.mapName })}
          </p>
        </div>
      </header>
      <ul className="grid gap-1 text-sm text-foreground">
        {card.roomName === null ? null : (
          <li>{t("eventSeating.card.room", { name: card.roomName })}</li>
        )}
        {card.roomFloor === null ? null : (
          <li>{t("eventSeating.card.floor", { floor: card.roomFloor })}</li>
        )}
        {card.roomNote === null ? null : <li className="text-muted-foreground">{card.roomNote}</li>}
        {session === "" ? null : <li>{t("eventSeating.card.session", { title: session })}</li>}
        {card.category === null ? null : (
          <li className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-full border border-border"
              style={{ backgroundColor: card.category.color }}
            />
            {t("eventSeating.card.category", { name: category })}
          </li>
        )}
        {card.isAccessible ? (
          <li className="flex items-center gap-2">
            <Accessibility className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("eventSeating.card.accessible")}
          </li>
        ) : null}
      </ul>
      <SeatMiniMap geometry={card.geometry} label={seatText} />
    </article>
  );
}
