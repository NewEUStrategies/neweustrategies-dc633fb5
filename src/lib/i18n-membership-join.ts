// Słownik strony /membership-join ("Dołącz do nas") - PL/EN.
// Rejestracja dzieje się przy ewaluacji modułu, a `ensureI18n()` pozwala
// splitterowi trasy trzymać cały bundle w chunku tej strony (patrz i18n-pricing).
import i18n from "@/lib/i18n";

const joinPl = {
  membershipJoin: {
    eyebrow: "Członkostwo",
    title: "Dołącz do New European Strategies",
    lead: "Niezależny think tank, w którym analiza spotyka decyzję. Dołączasz do środowiska ludzi, którzy realnie kształtują europejskie bezpieczeństwo, gospodarkę i politykę.",
    ctaPrimary: "Załóż konto",
    ctaSecondary: "Zobacz plany i ceny",
    ctaMember: "Przejdź do swojego profilu",
    trust: "Bez karty płatniczej - konto bezpłatne zakładasz w minutę.",
    stats: {
      analyses: { value: "300+", label: "analiz i policy papers" },
      experts: { value: "80+", label: "ekspertów i praktyków" },
      clubs: { value: "12", label: "klubów dyskusyjnych" },
      events: { value: "40/rok", label: "spotkań i debat" },
    },
    pillars: {
      title: "Co dostajesz jako członek",
      subtitle:
        "Cztery filary członkostwa - wiedza, ludzie, wpływ i narzędzia. Każdy z nich działa od pierwszego dnia.",
      items: {
        knowledge: {
          title: "Wiedza, której nie znajdziesz w newsach",
          body: "Analizy, policy papers i briefy przygotowane przez praktyków - z jasną tezą, danymi i rekomendacją.",
        },
        network: {
          title: "Sieć, która otwiera drzwi",
          body: "Profil eksperta, wiadomości bezpośrednie i rekomendacje kontaktów w obszarze, w którym pracujesz.",
        },
        clubs: {
          title: "Kluby dyskusyjne i debaty",
          body: "Zamknięte dyskusje w formule Chatham House, spotkania offline oraz wątki tematyczne między spotkaniami.",
        },
        impact: {
          title: "Realny wpływ na agendę",
          body: "Konsultacje stanowisk, udział w pracach programowych i monitoring legislacji UE, którą śledzisz.",
        },
      },
    },
    steps: {
      title: "Jak dołączyć",
      subtitle: "Trzy kroki - od bezpłatnego konta do pełnego dostępu.",
      items: {
        account: {
          title: "Załóż konto",
          body: "Rejestracja zajmuje minutę. Od razu czytasz analizy otwarte i zapisujesz się na wydarzenia.",
        },
        profile: {
          title: "Uzupełnij profil",
          body: "Doświadczenie, obszary eksperckie i język pracy - to na tej podstawie dobieramy kontakty i zaproszenia.",
        },
        plan: {
          title: "Wybierz plan",
          body: "Rozszerz dostęp o kluby, materiały premium i spotkania zamknięte. Plan zmienisz albo anulujesz w profilu.",
        },
      },
    },
    tiers: {
      title: "Poziomy członkostwa",
      subtitle:
        "Zacznij bezpłatnie, rozszerzaj wtedy, gdy potrzebujesz. Pełne porównanie znajdziesz w cenniku.",
      allPlans: "Zobacz pełny cennik",
      empty: "Poziomy członkostwa pojawią się tu, gdy tylko zostaną opublikowane.",
    },
    audience: {
      title: "Dla kogo jest to członkostwo",
      items: {
        policy: {
          title: "Administracja i instytucje",
          body: "Dla osób, które przygotowują stanowiska i potrzebują skróconego dystansu między danymi a decyzją.",
        },
        business: {
          title: "Biznes i doradztwo",
          body: "Dla zespołów, które muszą rozumieć ryzyko regulacyjne i geopolityczne, zanim zamieni się w koszt.",
        },
        academia: {
          title: "Nauka i organizacje pozarządowe",
          body: "Dla badaczy i praktyków, którzy chcą, by ich praca trafiała do osób decyzyjnych.",
        },
      },
    },
    closing: {
      title: "Twoje miejsce w tej rozmowie jest wolne",
      body: "Dołącz dziś, a od pierwszego tygodnia dostaniesz materiały, zaproszenia i kontakty dopasowane do Twojego obszaru.",
      cta: "Załóż bezpłatne konto",
      secondary: "Napisz do nas",
    },
    seo: {
      title: "Dołącz do nas - członkostwo New European Strategies",
      description:
        "Zostań członkiem New European Strategies: analizy, kluby dyskusyjne, sieć ekspertów i realny wpływ na europejską agendę.",
    },
  },
};

const joinEn = {
  membershipJoin: {
    eyebrow: "Membership",
    title: "Join New European Strategies",
    lead: "An independent think tank where analysis meets decision. You join a community of people who genuinely shape European security, economy and policy.",
    ctaPrimary: "Create your account",
    ctaSecondary: "See plans and pricing",
    ctaMember: "Go to your profile",
    trust: "No payment card required - a free account takes a minute.",
    stats: {
      analyses: { value: "300+", label: "analyses and policy papers" },
      experts: { value: "80+", label: "experts and practitioners" },
      clubs: { value: "12", label: "discussion clubs" },
      events: { value: "40/year", label: "meetings and debates" },
    },
    pillars: {
      title: "What membership gives you",
      subtitle:
        "Four pillars - knowledge, people, impact and tools. Each of them works from day one.",
      items: {
        knowledge: {
          title: "Knowledge you will not find in the news",
          body: "Analyses, policy papers and briefs written by practitioners - a clear thesis, the data behind it and a recommendation.",
        },
        network: {
          title: "A network that opens doors",
          body: "An expert profile, direct messages and curated introductions in the field you actually work in.",
        },
        clubs: {
          title: "Discussion clubs and debates",
          body: "Closed Chatham House sessions, offline meetings and thematic threads that keep running between them.",
        },
        impact: {
          title: "Real influence on the agenda",
          body: "Consultations on positions, programme work and monitoring of the EU legislation you follow.",
        },
      },
    },
    steps: {
      title: "How to join",
      subtitle: "Three steps - from a free account to full access.",
      items: {
        account: {
          title: "Create an account",
          body: "Registration takes a minute. You immediately read open analyses and register for events.",
        },
        profile: {
          title: "Complete your profile",
          body: "Experience, areas of expertise and working language - we match introductions and invitations against them.",
        },
        plan: {
          title: "Choose a plan",
          body: "Extend access to clubs, premium material and closed sessions. Change or cancel it any time in your profile.",
        },
      },
    },
    tiers: {
      title: "Membership levels",
      subtitle:
        "Start free, extend when you need to. The full comparison lives in the pricing page.",
      allPlans: "See full pricing",
      empty: "Membership levels will appear here as soon as they are published.",
    },
    audience: {
      title: "Who this membership is for",
      items: {
        policy: {
          title: "Public administration and institutions",
          body: "For people drafting positions who need the shortest possible distance between data and decision.",
        },
        business: {
          title: "Business and advisory",
          body: "For teams that must understand regulatory and geopolitical risk before it turns into cost.",
        },
        academia: {
          title: "Academia and NGOs",
          body: "For researchers and practitioners who want their work to reach decision makers.",
        },
      },
    },
    closing: {
      title: "Your seat in this conversation is open",
      body: "Join today and from the first week you receive material, invitations and contacts matched to your field.",
      cta: "Create a free account",
      secondary: "Write to us",
    },
    seo: {
      title: "Join us - New European Strategies membership",
      description:
        "Become a New European Strategies member: analyses, discussion clubs, an expert network and real influence on the European agenda.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", joinPl, true, true);
i18n.addResourceBundle("en", "translation", joinEn, true, true);

/** No-op utrzymujący rejestrację słownika w chunku trasy. */
export function ensureI18n(): void {}

/** Kształt słownika - wykorzystywany przez test parzystości PL/EN. */
export const membershipJoinResources = { pl: joinPl, en: joinEn };
