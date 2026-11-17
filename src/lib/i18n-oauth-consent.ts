// Słownik strony zgody OAuth (PL/EN). Import jako efekt uboczny w
// `components/oauth/OAuthConsentPanel.tsx` i trasie zgody.
import i18n from "./i18n";

export const oauthConsentPl = {
  oauthConsent: {
    metaTitle: "Połącz aplikację",
    metaDescription: "Zgoda na połączenie zewnętrznej aplikacji z kontem New European Strategies.",
    title: "Połącz {{client}} z New European Strategies",
    unknownClient: "aplikację",
    intro: "{{client}} będzie mogła korzystać z narzędzi New European Strategies w Twoim imieniu.",
    signedInAs: "Zalogowano jako",
    returnsTo: "Po decyzji wrócisz do",
    accessHeading: "Do czego uzyska dostęp",
    capabilities: {
      read: "Czytanie opublikowanych artykułów i wyszukiwanie w nich",
      members: "Pełna treść artykułów dla członków, jeśli Twoje konto ma do nich dostęp",
    },
    scopesHeading: "Udostępniane dane konta",
    scopes: {
      openid: "Identyfikator konta",
      email: "Adres e-mail",
      profile: "Podstawowe dane profilu",
      phone: "Numer telefonu",
      other: "Dodatkowe uprawnienie: {{scope}}",
    },
    boundary:
      "Połączenie nie omija uprawnień konta ani zasad dostępu platformy. Możesz je wycofać w każdej chwili.",
    approve: "Zezwól",
    deny: "Anuluj połączenie",
    working: "Przetwarzanie...",
    errors: {
      missing: "Link autoryzacji jest niepełny. Wróć do aplikacji i rozpocznij łączenie ponownie.",
      expired:
        "To żądanie autoryzacji wygasło lub zostało już użyte. Wróć do aplikacji i spróbuj ponownie.",
      failed: "Nie udało się zapisać decyzji. Spróbuj ponownie.",
      noRedirect:
        "Serwer autoryzacji nie zwrócił adresu powrotu. Wróć do aplikacji i spróbuj ponownie.",
      title: "Nie można dokończyć łączenia",
      backHome: "Wróć na stronę główną",
    },
  },
} as const;

export const oauthConsentEn = {
  oauthConsent: {
    metaTitle: "Connect an app",
    metaDescription: "Consent to connect an external app to your New European Strategies account.",
    title: "Connect {{client}} to New European Strategies",
    unknownClient: "an app",
    intro: "{{client}} will be able to use New European Strategies tools on your behalf.",
    signedInAs: "Signed in as",
    returnsTo: "After you decide, you will return to",
    accessHeading: "What it can access",
    capabilities: {
      read: "Read and search published articles",
      members: "Full members-only articles when your account has access to them",
    },
    scopesHeading: "Account data shared",
    scopes: {
      openid: "Account identifier",
      email: "Email address",
      profile: "Basic profile details",
      phone: "Phone number",
      other: "Additional permission: {{scope}}",
    },
    boundary:
      "This connection does not bypass your account permissions or the platform's access rules. You can revoke it at any time.",
    approve: "Allow",
    deny: "Cancel connection",
    working: "Processing...",
    errors: {
      missing:
        "This authorization link is incomplete. Return to the app and start connecting again.",
      expired:
        "This authorization request has expired or was already used. Return to the app and try again.",
      failed: "Your decision could not be saved. Please try again.",
      noRedirect:
        "The authorization server returned no return address. Return to the app and try again.",
      title: "The connection could not be completed",
      backHome: "Back to the homepage",
    },
  },
} as const;

i18n.addResourceBundle("pl", "translation", oauthConsentPl, true, true);
i18n.addResourceBundle("en", "translation", oauthConsentEn, true, true);
