// i18n huba „Przychód i lejek" - nakładka ZDROWIA KANAŁU E-MAIL (S1).
//
// Etykieta i krótka definicja KAŻDEGO pola `RevenueEmailHealthDto`
// (src/lib/revenue/email/dto.ts) - definicja jest tym, co karta pokazuje
// w podpowiedzi, więc musi mówić dokładnie to samo co agregat SQL
// (`admin_revenue_email_health`): kohorta wysyłek z okna, unikalni per
// kampania, wypis w 7 dni od wysyłki, „brak danych" zamiast zera.
//
// Prefiks `adminRevenue` jest pod TWARDĄ bramką parytetu
// (`src/__tests__/i18nParity.gate.test.ts`): każdy brak albo napis
// identyczny w PL i EN zapala CI. Gałąź `adminRevenue.email` scala się
// głęboko z rdzeniem huba (`i18n-admin-revenue.ts`), niczego mu nie nadpisując.
//
// UWAGA NA ARKUSZ CSS. Pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO - słowo będące klasą Tailwinda (np. nazwa klasy odbicia
// „blokada" po angielsku, „ukryty", „tabela", „rośnij") dokłada regułę do CSS
// każdej strony czytelnika. Napisy niżej są dobrane tak, żeby żadne nie było
// nazwą klasy narzędziowej.
//
// IMPORT WYŁĄCZNIE Z KOMPONENTÓW (karta huba woła `ensureI18n()`).
import i18n from "@/lib/i18n";

const pl = {
  adminRevenue: {
    email: {
      title: "Zdrowie kanału e-mail",
      subtitle: "Wysyłki kampanii z wybranego okresu, stan listy i potwierdzenia zapisu.",
      noData: "Brak danych",
      noDataHint:
        "Tej liczby nie da się policzyć dla wybranego okresu - to nie jest zero (np. brak wysyłek albo brak sygnału od dostawcy poczty).",
      state: {
        forbidden: "Zdrowie kanału e-mail widzą administratorzy i redaktorzy.",
        unavailable: "Dane kanału e-mail pojawią się po zakończeniu wdrożenia.",
      },
      campaigns: {
        heading: "Kampanie",
        sent: {
          label: "Wysłane",
          hint: "Wiadomości kampanii przekazane do wysyłki w wybranym okresie.",
        },
        delivered: {
          label: "Doręczone",
          hint: "Wysyłki potwierdzone przez dostawcę poczty jako doręczone (także te, które skończyły się skargą).",
        },
        uniqueOpens: {
          label: "Unikalne otwarcia",
          hint: "Osoby, które otworzyły kampanię - w każdej kampanii liczone raz, potem sumowane po kampaniach.",
        },
        uniqueClicks: {
          label: "Unikalne kliknięcia",
          hint: "Osoby, które kliknęły link w kampanii - w każdej kampanii liczone raz, potem sumowane.",
        },
        hardBounces: {
          label: "Odbicia trwałe",
          hint: "Adresy odrzucone na stałe (nieistniejąca skrzynka albo odmowa serwera). Trafiają na listę wykluczeń.",
        },
        softBounces: {
          label: "Odbicia przejściowe",
          hint: "Chwilowe odrzucenia, np. pełna skrzynka. Kolejna wysyłka może już dotrzeć.",
        },
        complaints: {
          label: "Skargi na spam",
          hint: "Odbiorcy, którzy oznaczyli wiadomość jako spam. Powyżej 0,3% dostawcy obniżają reputację domeny.",
        },
        unsubscribes: {
          label: "Wypisy po kampanii",
          hint: "Odbiorcy wysyłek z okresu, którzy wypisali się w ciągu 7 dni od otrzymania wiadomości.",
        },
      },
      list: {
        heading: "Lista",
        start: {
          label: "Na liście na początku",
          hint: "Subskrybenci zapisani i niewypisani w chwili rozpoczęcia okresu.",
        },
        end: {
          label: "Na liście na końcu",
          hint: "Subskrybenci zapisani i niewypisani w chwili zakończenia okresu.",
        },
        new: {
          label: "Nowi subskrybenci",
          hint: "Zapisy potwierdzone w tym okresie (bez potwierdzenia - data zapisu).",
        },
        unsubscribed: {
          label: "Wypisani",
          hint: "Wszystkie wypisy z listy w tym okresie, niezależnie od kampanii.",
        },
        netGrowth: {
          label: "Przyrost netto",
          hint: "Różnica między stanem na końcu i na początku okresu (nowi minus wypisani).",
        },
      },
      doi: {
        heading: "Potwierdzenie zapisu",
        started: {
          label: "Rozpoczęte potwierdzenia",
          hint: "Nowe adresy z tego okresu, które dostały wiadomość z prośbą o potwierdzenie zapisu (double opt-in).",
        },
        confirmed7d: {
          label: "Potwierdzone w 7 dni",
          hint: "Ile z rozpoczętych potwierdzeń zakończyło się kliknięciem linku w ciągu 7 dni od zapisu.",
        },
      },
    },
  },
};

const en: typeof pl = {
  adminRevenue: {
    email: {
      title: "Email channel health",
      subtitle: "Campaign sends from the selected period, list status and signup confirmations.",
      noData: "No data",
      noDataHint:
        "This number cannot be computed for the selected period - it is not zero (e.g. no sends or no signal from the mail provider).",
      state: {
        forbidden: "Email channel health is available to administrators and editors.",
        unavailable: "Email channel data will appear once the deployment finishes.",
      },
      campaigns: {
        heading: "Campaigns",
        sent: {
          label: "Sent",
          hint: "Campaign messages handed over for sending in the selected period.",
        },
        delivered: {
          label: "Delivered",
          hint: "Sends the mail provider confirmed as delivered (including those that ended in a complaint).",
        },
        uniqueOpens: {
          label: "Unique opens",
          hint: "People who opened a campaign - counted once per campaign, then summed across campaigns.",
        },
        uniqueClicks: {
          label: "Unique clicks",
          hint: "People who clicked a link in a campaign - counted once per campaign, then summed.",
        },
        hardBounces: {
          label: "Permanent bounces",
          hint: "Addresses rejected for good (mailbox does not exist or the server refused). They go on the suppression list.",
        },
        softBounces: {
          label: "Temporary bounces",
          hint: "Short-lived rejections, e.g. a full mailbox. A later send may still arrive.",
        },
        complaints: {
          label: "Spam complaints",
          hint: "Recipients who marked the message as spam. Above 0.3% providers lower the domain reputation.",
        },
        unsubscribes: {
          label: "Unsubscribes after a campaign",
          hint: "Recipients of sends from the period who unsubscribed within 7 days of receiving the message.",
        },
      },
      list: {
        heading: "List",
        start: {
          label: "On the list at the beginning",
          hint: "Subscribers signed up and not unsubscribed when the period began.",
        },
        end: {
          label: "On the list at the close",
          hint: "Subscribers signed up and not unsubscribed when the period closed.",
        },
        new: {
          label: "New subscribers",
          hint: "Signups confirmed in this period (without confirmation - the signup date).",
        },
        unsubscribed: {
          label: "Unsubscribed",
          hint: "All list unsubscribes in this period, regardless of campaigns.",
        },
        netGrowth: {
          label: "Net change",
          hint: "Difference between the list size at the close and at the beginning of the period (new minus unsubscribed).",
        },
      },
      doi: {
        heading: "Signup confirmation",
        started: {
          label: "Confirmations started",
          hint: "New addresses from this period that received a message asking to confirm the signup (double opt-in).",
        },
        confirmed7d: {
          label: "Confirmed within 7 days",
          hint: "How many of the started confirmations ended with a click on the link within 7 days of signing up.",
        },
      },
    },
  },
};

// Rejestracja jawna (komponent woła `ensureI18n()`) ORAZ przy imporcie:
// bramki parytetu i dryfu kluczy ładują nakładki globem i liczą na efekt
// importu, a flaga chroni przed powtórnym głębokim scalaniem przy renderze.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
