// Supplementary i18n bundle for the donations CMS widget (PL/EN).
// Side-effect import wherever the widget mounts:
//   import "@/lib/i18n-donations-widget";
import i18n from "./i18n";

export const donationsWidgetPl = {
  donationsWidget: {
    total: "Suma wsparcia",
    thisMonth: "W tym miesiącu",
    donors: "Darczyńców",
    goal: "Cel",
    of: "z",
    progress: "postęp",
    empty: "Bądź pierwszym darczyńcą",
    recent: "Ostatnie wpłaty",
    anon: "Anonimowy darczyńca",
    cta: "Wesprzyj",
    loading: "Wczytywanie...",
  },
};

export const donationsWidgetEn = {
  donationsWidget: {
    total: "Total raised",
    thisMonth: "This month",
    donors: "Donors",
    goal: "Goal",
    of: "of",
    progress: "progress",
    empty: "Be the first to donate",
    recent: "Recent gifts",
    anon: "Anonymous donor",
    cta: "Support",
    loading: "Loading...",
  },
};

i18n.addResourceBundle("pl", "translation", donationsWidgetPl, true, true);
i18n.addResourceBundle("en", "translation", donationsWidgetEn, true, true);
