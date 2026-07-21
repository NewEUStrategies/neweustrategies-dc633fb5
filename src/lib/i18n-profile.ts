import i18n from "./i18n";

// Profile / Billing / Checkout i18n bundle - registered as overlay on top of base i18n.
// Using addResourceBundle keeps the huge base i18n.ts untouched and lets us scale modules independently.

const pl = {
  profile: {
    title: "Mój profil",
    nav: {
      overview: "Przegląd",
      edit: "Edycja profilu",
      account: "Konto",
      author: "Profil autora",
      social: "Media społecznościowe",
      interests: "Zainteresowania",
      personality: "Osobowość",
      bookmarks: "Zapisane materiały",
      notifications: "Powiadomienia",
      follows: "Obserwowane",
      network: "Moja sieć",
      membership: "Członkostwo",
      organization: "Organizacja",
      billing: "Dane rozliczeniowe",
      subscription: "Subskrypcja",
      orders: "Historia płatności",
      security: "Bezpieczeństwo",
      privacy: "Prywatność",
    },
    navGroups: {
      identity: "Tożsamość",
      content: "Treści i personalizacja",
      finance: "Płatności i bezpieczeństwo",
    },
    edit: {
      title: "Edycja profilu",
      intro: "Wszystkie dane Twojej tożsamości w jednym miejscu.",
      tabs: {
        basic: "Dane podstawowe",
        expert: "Profil eksperta",
        social: "Social i bio",
      },
    },
    overview: {
      welcome: "Witaj, {{name}}",
      memberLabel: "Członek",
      memberSince: "Z nami od {{date}}",
      planActive: "Aktywny plan",
      planNone: "Brak aktywnej subskrypcji",
      seePlans: "Zobacz plany",
      manageBilling: "Zarządzaj subskrypcją",
    },
    account: {
      displayName: "Nazwa wyświetlana",
      displayNameAlt: "(nick konta)",
      firstName: "Imię",
      lastName: "Nazwisko",
      jobTitle: "Stanowisko",
      currentCompany: "Aktualna firma",
      specialization: "Specjalizacja",

      location: "Miejsce zamieszkania",
      locationPh: "Miasto, kraj",
      phone: "Telefon",
      phonePh: "+48 600 000 000",
      gender: "Płeć",
      genderHint: "Domyślnie wykrywana automatycznie z imienia. Możesz ją nadpisać.",
      genderAuto: "Wykryj automatycznie z imienia",
      genderMale: "Mężczyzna",
      genderFemale: "Kobieta",
      genderNeutral: "Neutralna / inna",
      personalSection: "Dane osobowe",
      contactSection: "Dane kontaktowe",
      mediaSection: "Awatar i tło",
      coverPlaceholder: "Brak tła profilu",
      avatarPlaceholder: "Brak awatara",
      unnamed: "Użytkownik",
      email: "E-mail",
      emailReadonly: "Adres e-mail zmieniany przez ustawienia konta.",
      bio: "Krótki opis",
      avatar: "Awatar (URL)",
      cover: "Tło (URL)",
      uploadAvatar: "Wgraj awatar",
      uploadCover: "Wgraj tło",
      avatarHint: "Zalecane: 512×512 px, kwadrat, max 2 MB (JPG/PNG/WEBP)",
      coverHint: "Zalecane: 1500×500 px, panorama, max 5 MB (JPG/PNG/WEBP)",
      uploading: "Wgrywanie...",
      uploadProgress: "Wgrywanie: {{percent}}%",
      uploadSuccess: "Wgrano pomyślnie",
      uploadFailed: "Wgrywanie nie powiodło się",
      uploadError: "Nie udało się wgrać pliku",
      fileTooLarge: "Plik jest zbyt duży",

      save: "Zapisz zmiany",
      saved: "Zapisano",
      saveError: "Nie udało się zapisać",
      tip: {
        displayName:
          "Tak będziesz widoczny/a publicznie - przy komentarzach, wpisach i w nagłówku powitania. Nie musi to być prawdziwe imię.",
        firstName:
          "Twoje prawdziwe imię. Wykorzystywane do personalizacji powitań i (opcjonalnie) na fakturach.",
        lastName: "Twoje prawdziwe nazwisko. Wykorzystywane w komunikacji oficjalnej i fakturach.",
        jobTitle: "Stanowisko, które wyświetla się przy Twoim profilu autora.",
        currentCompany:
          "Firma, w której obecnie pracujesz - pokazywana publicznie obok stanowiska.",
        location: "Miasto i kraj. Pomaga czytelnikom rozpoznać kontekst Twoich publikacji.",
        phone: "Numer wewnętrzny, widoczny tylko dla zespołu redakcyjnego.",
        email: "Adres logowania. Aby go zmienić, użyj zakładki Bezpieczeństwo.",
        bio: "Krótki biogram (do 500 znaków) widoczny na publicznej stronie autora.",
        avatar: "Zdjęcie profilowe - wyświetlane wszędzie, gdzie widoczny jest Twój nick.",
        cover: "Panorama nad profilem autora i na stronie publicznej.",
        save: "Zapisuje wszystkie zmiany na karcie Konto.",
      },
    },
    inline: {
      viewAsGuest: "Podgląd jak gość",
      editMode: "Tryb edycji",
      adminPanel: "Panel administracyjny",
      contactSection: "Dane kontaktowe",
      activitySection: "Aktywność i obserwowane",
      bioPlaceholder:
        "Opowiedz krótko o sobie - czym się zajmujesz, jakie tematy Cię interesują...",
      addJobTitle: "Dodaj stanowisko",
      addCompany: "Dodaj firmę",
      addLocation: "Dodaj lokalizację",
      addPhone: "Dodaj telefon",
      addLinkedin: "Dodaj LinkedIn",
      addTwitter: "Dodaj X (Twitter)",
      addSpecialization: "Dodaj specjalizację",
      interestsHint: "Wybierz obserwowane tematy, kategorie i tagi.",
      shortcuts: "Skróty",
      notSet: "Nie ustawiono",
      clickToEdit: "Kliknij, aby edytować",
      saving: "Zapisywanie...",
      addAvatar: "Dodaj zdjęcie",
      changeAvatar: "Zmień",
      avatarSize: "400 × 400 px",
    },

    security: {
      changePassword: "Zmień hasło",
      currentPassword: "Obecne hasło",
      newPassword: "Nowe hasło",
      confirmPassword: "Powtórz hasło",
      update: "Zaktualizuj hasło",
      updated: "Hasło zmienione. Pozostałe sesje zostały wylogowane.",
      mismatch: "Hasła nie są identyczne",
      tooShort: "Hasło musi mieć min. 8 znaków",
      wrongCurrent: "Obecne hasło jest nieprawidłowe.",
      signOut: "Wyloguj",
      sessions: "Sesje",
      lastSignIn: "Ostatnie logowanie",
      signOutOthers: "Wyloguj pozostałe sesje",
      signedOutOthers: "Wylogowano pozostałe sesje.",
      exportFailed: "Nie udało się przygotować eksportu. Spróbuj ponownie.",
      email: {
        title: "Adres e-mail",
        subtitle: "Zmiana wymaga potwierdzenia linkiem wysłanym na nowy adres.",
        current: "Obecny adres",
        newEmail: "Nowy adres e-mail",
        submit: "Zmień adres e-mail",
        sent: "Wysłaliśmy link potwierdzający na nowy adres.",
        invalid: "Podaj poprawny adres e-mail.",
        needPassword: "Podaj obecne hasło, aby potwierdzić.",
      },
      danger: {
        title: "Usuń konto",
        subtitle:
          "Trwale usuwa konto i wszystkie powiązane dane (zakładki, obserwacje, wyniki). Operacji nie można cofnąć.",
        button: "Usuń moje konto",
        confirmTitle: "Na pewno usunąć konto?",
        confirmBody:
          "Ta operacja jest nieodwracalna. Aby potwierdzić, wpisz swoje hasło. Wszystkie Twoje dane zostaną trwale usunięte.",
        passwordLabel: "Potwierdź hasłem",
        cancel: "Anuluj",
        confirm: "Usuń konto na stałe",
        deleted: "Konto zostało usunięte.",
        failed: "Nie udało się usunąć konta.",
      },
      tip: {
        currentPassword: "Podaj obecne hasło, aby potwierdzić, że to Ty.",
        newPassword: "Minimum 8 znaków. Używaj kombinacji liter, cyfr i znaków specjalnych.",
        confirmPassword: "Powtórz nowe hasło, żeby uniknąć literówki.",
        update: "Zapisuje nowe hasło i wylogowuje pozostałe sesje.",
        signOut: "Wylogowuje Cię na tym urządzeniu.",
        signOutOthers: "Wylogowuje wszystkie pozostałe sesje na innych urządzeniach.",
      },
      mfa: {
        title: "Uwierzytelnianie dwuskładnikowe (TOTP)",
        subtitle:
          "Dodatkowa warstwa ochrony: przy logowaniu poprosimy o kod z aplikacji uwierzytelniającej.",
        statusEnabled: "Włączone",
        statusDisabled: "Wyłączone",
        enroll: "Skonfiguruj aplikację uwierzytelniającą",
        scanInstruction:
          "Zeskanuj ten kod QR w aplikacji uwierzytelniającej (Google Authenticator, 1Password, Authy…).",
        manualIntro: "Nie możesz zeskanować kodu? Wpisz ten klucz ręcznie:",
        codeLabel: "Kod 6-cyfrowy",
        codePlaceholder: "000000",
        activate: "Aktywuj",
        cancel: "Anuluj",
        activated: "Uwierzytelnianie dwuskładnikowe włączone.",
        invalidCode: "Wpisz 6-cyfrowy kod z aplikacji.",
        enrollError: "Nie udało się rozpocząć konfiguracji. Spróbuj ponownie.",
        verifyError: "Nieprawidłowy kod. Sprawdź go i spróbuj ponownie.",
        enrolledTitle: "Aktywne aplikacje uwierzytelniające",
        defaultFactorName: "Aplikacja uwierzytelniająca",
        addedOn: "Dodano {{date}}",
        loading: "Wczytywanie…",
        none: "Brak skonfigurowanych metod.",
        remove: "Usuń",
        removeTitle: "Usunąć tę metodę?",
        removeBody:
          "Po usunięciu logowanie nie będzie już wymagało kodu z tej aplikacji. Potwierdź hasłem.",
        removePasswordLabel: "Potwierdź hasłem",
        removeConfirm: "Usuń metodę",
        removed: "Metoda została usunięta.",
        removeError: "Nie udało się usunąć metody.",
        wrongPassword: "Obecne hasło jest nieprawidłowe.",
        challenge: {
          title: "Weryfikacja dwuetapowa",
          description: "Wpisz 6-cyfrowy kod z aplikacji uwierzytelniającej, aby kontynuować.",
          codeLabel: "Kod 6-cyfrowy",
          verify: "Zweryfikuj",
          cancel: "Anuluj",
          noFactor: "Do tego konta nie przypisano aplikacji uwierzytelniającej.",
          failed: "Weryfikacja nie powiodła się. Sprawdź kod i spróbuj ponownie.",
        },
      },
    },
    billing: {
      title: "Dane rozliczeniowe",
      subtitle: "Wykorzystywane na fakturach i w procesie zakupu.",
      isCompany: "Jestem firmą",
      fullName: "Imię i nazwisko",
      company: "Nazwa firmy",
      taxId: "NIP",
      email: "E-mail na fakturę",
      phone: "Telefon",
      addressLine1: "Adres - linia 1",
      addressLine2: "Adres - linia 2 (opcjonalnie)",
      city: "Miasto",
      postalCode: "Kod pocztowy",
      region: "Województwo/region",
      country: "Kraj",
      save: "Zapisz dane",
      saved: "Dane zapisane",
      saveError: "Nie udało się zapisać danych. Spróbuj ponownie.",
      taxIdFormat: "Nieprawidłowy format NIP - wpisz 10 cyfr (możesz użyć myślników).",
      taxIdChecksum: "NIP ma błędną cyfrę kontrolną - sprawdź numer.",
      taxIdVatFormat: "Nieprawidłowy format numeru VAT.",
      tip: {
        isCompany: "Włącz, jeśli kupujesz jako firma - pojawi się pole na NIP.",
        fullName: "Pełne imię i nazwisko, jak ma być widoczne na fakturze.",
        company: "Oficjalna nazwa firmy do faktur.",
        taxId: "Numer identyfikacji podatkowej (NIP/VAT). Wymagany dla kupujących firmowych.",
        email: "Adres, na który wyślemy fakturę PDF.",
        phone: "Telefon kontaktowy do pytań związanych z zamówieniem.",
        addressLine1: 'Ulica i numer (np. „Marszałkowska 1").',
        addressLine2: "Mieszkanie, piętro, lokal - opcjonalnie.",
        city: "Miasto, w którym mieści się adres do faktury.",
        postalCode: "Kod pocztowy adresu rozliczeniowego.",
        region: "Województwo, stan lub region - jeśli dotyczy.",
        country: "Dwuliterowy kod kraju ISO (np. PL, DE, US).",
        save: "Zapisuje dane rozliczeniowe na Twoim koncie.",
      },
    },
    subscription: {
      title: "Twoja subskrypcja",
      none: "Nie masz aktywnej subskrypcji.",
      plan: "Plan",
      status: "Status",
      startedAt: "Aktywna od",
      renewsAt: "Odnowienie",
      cancelsAt: "Wygasa",
      cancel: "Anuluj subskrypcję",
      cancelConfirm: "Subskrypcja pozostanie aktywna do końca okresu rozliczeniowego.",
      canceled: "Subskrypcja anulowana",
      cancelFailed:
        "Nie udało się anulować subskrypcji. Spróbuj ponownie lub skontaktuj się z nami.",
      keep: "Zostaw subskrypcję",
      accessUntil: "Subskrypcja anulowana - dostęp pozostaje aktywny do {{date}}.",
      resume: "Wznów subskrypcję",
      resumed: "Subskrypcja wznowiona",
      resumeError: "Nie udało się wznowić subskrypcji.",
      change: "Zmień plan",
    },
    orders: {
      title: "Historia płatności",
      empty: "Brak zamówień.",
      colDate: "Data",
      colItem: "Pozycja",
      colAmount: "Kwota",
      colStatus: "Status",
      colInvoice: "Faktura",
      invoice: "Pobierz",
      kindSubscription: "Subskrypcja",
      kindOneTime: "Zakup jednorazowy",
    },
    status: {
      pending: "Oczekujące",
      processing: "Przetwarzane",
      paid: "Opłacone",
      failed: "Nieudane",
      refunded: "Zwrócone",
      canceled: "Anulowane",
      active: "Aktywna",
      expired: "Wygasła",
    },
  },
  pricing: {
    title: "Cennik",
    subtitle: "Wybierz plan dopasowany do Twoich potrzeb.",
    perMonth: "/ mies.",
    perYear: "/ rok",
    perDay: "/ dzień",
    perWeek: "/ tydz.",
    perOnce: "jednorazowo",
    choose: "Wybierz plan",
    current: "Aktualny plan",
    trial: "{{days}} dni za darmo",
    popular: "Najpopularniejszy",
    empty: "Brak dostępnych planów.",
    intervalMonthly: "Miesięcznie",
    intervalYearly: "Rocznie",
    compareTitle: "Porównanie planów",
    compareFeature: "Funkcja",
    trust: {
      secure: "Bezpieczne płatności Stripe",
      cancel: "Anuluj w każdej chwili",
      instant: "Natychmiastowy dostęp po opłaceniu",
    },
    faqTitle: "Najczęstsze pytania",
    faq: [
      {
        q: "Czy mogę anulować subskrypcję?",
        a: "Tak. Subskrypcję anulujesz w każdej chwili w panelu profilu - zachowujesz dostęp do końca opłaconego okresu.",
      },
      {
        q: "Jakie metody płatności akceptujecie?",
        a: "Płatności obsługuje Stripe - karty Visa, Mastercard oraz popularne metody lokalne.",
      },
      {
        q: "Czy otrzymam fakturę?",
        a: "Tak. Fakturę wystawiamy na podstawie danych rozliczeniowych z Twojego profilu.",
      },
      {
        q: "Czy dostęp jest natychmiastowy?",
        a: "Tak - dostęp odblokowuje się automatycznie zaraz po potwierdzeniu płatności.",
      },
    ],
  },
  checkout: {
    title: "Finalizacja zamówienia",
    saveBillingContinue: "Zapisz i kontynuuj",
    continueReading: "Wróć do artykułu",
    summary: "Podsumowanie",
    item: "Pozycja",
    total: "Razem",
    billingDetails: "Dane do faktury",
    paymentMethod: "Metoda płatności",
    payNow: "Zapłać {{amount}}",
    processing: "Przetwarzanie...",
    secured: "Płatność zabezpieczona przez Stripe",
    terms: 'Klikając "Zapłać" akceptujesz regulamin i politykę prywatności.',
    successTitle: "Dziękujemy za zakup!",
    successBody:
      "Twoje zamówienie zostało przyjęte. Status aktualizujemy po potwierdzeniu płatności.",
    cancelTitle: "Płatność anulowana",
    cancelBody: "Nie pobraliśmy żadnych środków. Możesz spróbować ponownie.",
    backToProfile: "Przejdź do profilu",
    backToPricing: "Wróć do cennika",
    notFound: "Nie znaleziono planu.",
    loginRequired: "Zaloguj się, aby kontynuować zakup.",
    fillBilling: "Uzupełnij dane rozliczeniowe.",
    stripeNotConfigured:
      "Bramka płatności nie jest jeszcze skonfigurowana. Skontaktuj się z administratorem.",
    trialLine: "Pierwsze {{days}} dni za darmo - pierwsza płatność po okresie próbnym.",
    promoHint: "Masz kupon? Kod rabatowy wpiszesz na bezpiecznej stronie płatności Stripe.",
    taxHint: "VAT zostanie naliczony automatycznie według Twojego adresu.",
    taxIdHint: "NIP/VAT ID do faktury podasz na stronie płatności.",
    subtotal: "Wartość",
    applyFailed: "Nie udało się zastosować kuponu.",
    headTitle: "Finalizacja zamówienia · Checkout",
    successHeadTitle: "Dziękujemy za zakup · Payment success",
    cancelHeadTitle: "Płatność anulowana · Payment canceled",
  },
  coupon: {
    title: "Kupon B2B",
    placeholder: "np. NES-B2B-10",
    apply: "Zastosuj",
    savings: "Oszczędzasz",
    discount: "Rabat",
    error: {
      emptyCode: "Wpisz kod kuponu.",
      invalidAmount: "Nieprawidłowa kwota zamówienia.",
      notFound: "Nie znaleziono takiego kodu.",
      inactive: "Ten kupon jest nieaktywny.",
      notYetValid: "Ten kupon nie jest jeszcze ważny.",
      expired: "Ten kupon wygasł.",
      limitReached: "Wykorzystano limit użyć tego kuponu.",
      planNotEligible: "Ten kupon nie obowiązuje na wybrany plan.",
      currencyMismatch: "Waluta kuponu nie pasuje do zamówienia.",
    },
  },
  auth: {
    required: "Wymagane logowanie",
    requiredBody: "Aby zobaczyć tę stronę, musisz się zalogować.",
    signIn: "Zaloguj się",
    signUp: "Załóż konto",
  },
};

const en: typeof pl = {
  profile: {
    title: "My profile",
    nav: {
      overview: "Overview",
      edit: "Edit profile",
      account: "Account",
      author: "Author profile",
      social: "Social media",
      interests: "Interests",
      personality: "Personality",
      bookmarks: "Saved items",
      notifications: "Notifications",
      follows: "Following",
      network: "My network",
      membership: "Membership",
      organization: "Organisation",
      billing: "Billing details",
      subscription: "Subscription",
      orders: "Payment history",
      security: "Security",
      privacy: "Privacy",
    },
    navGroups: {
      identity: "Identity",
      content: "Content & personalization",
      finance: "Payments & security",
    },
    edit: {
      title: "Edit profile",
      intro: "Everything about your identity in one place.",
      tabs: {
        basic: "Basic details",
        expert: "Expert profile",
        social: "Social & bio",
      },
    },
    overview: {
      welcome: "Welcome, {{name}}",
      memberLabel: "Member",
      memberSince: "Member since {{date}}",
      planActive: "Active plan",
      planNone: "No active subscription",
      seePlans: "View plans",
      manageBilling: "Manage subscription",
    },
    account: {
      displayName: "Display name",
      displayNameAlt: "(account nickname)",
      firstName: "First name",
      lastName: "Last name",
      jobTitle: "Job title",
      currentCompany: "Current company",
      specialization: "Specialization",

      location: "Place of residence",
      locationPh: "City, country",
      phone: "Phone",
      phonePh: "+1 555 000 0000",
      gender: "Gender",
      genderHint: "Auto-detected from your first name by default. You can override it.",
      genderAuto: "Auto-detect from first name",
      genderMale: "Male",
      genderFemale: "Female",
      genderNeutral: "Neutral / other",
      personalSection: "Personal details",
      contactSection: "Contact details",
      mediaSection: "Avatar and cover",
      coverPlaceholder: "No cover image",
      avatarPlaceholder: "No avatar",
      unnamed: "User",
      email: "Email",
      emailReadonly: "Email is changed via account settings.",
      bio: "Short bio",
      avatar: "Avatar (URL)",
      cover: "Cover (URL)",
      uploadAvatar: "Upload avatar",
      uploadCover: "Upload cover",
      avatarHint: "Recommended: 512×512 px, square, max 2 MB (JPG/PNG/WEBP)",
      coverHint: "Recommended: 1500×500 px, panorama, max 5 MB (JPG/PNG/WEBP)",
      uploading: "Uploading...",
      uploadProgress: "Uploading: {{percent}}%",
      uploadSuccess: "Uploaded successfully",
      uploadFailed: "Upload failed",
      uploadError: "Could not upload file",
      fileTooLarge: "File is too large",

      save: "Save changes",
      saved: "Saved",
      saveError: "Could not save",
      tip: {
        displayName:
          "How you appear publicly - on comments, posts and in the welcome header. Doesn't have to be your real name.",
        firstName:
          "Your real first name. Used for personalised greetings and (optionally) on invoices.",
        lastName: "Your real last name. Used in official communication and on invoices.",
        jobTitle: "Job title shown on your public author profile.",
        currentCompany: "Where you currently work - shown publicly next to your job title.",
        location: "City and country. Helps readers understand the context of what you publish.",
        phone: "Internal contact number - visible only to the editorial team.",
        email: "Your sign-in address. To change it, use the Security tab.",
        bio: "Short biography (up to 500 characters) shown on your public author page.",
        avatar: "Profile picture - shown anywhere your nickname appears.",
        cover: "Banner image at the top of your author page.",
        save: "Saves all changes on the Account tab.",
      },
    },
    inline: {
      viewAsGuest: "View as guest",
      editMode: "Edit mode",
      adminPanel: "Admin panel",
      contactSection: "Contact details",
      activitySection: "Activity & following",
      bioPlaceholder:
        "Tell readers a bit about yourself - what you do, what topics interest you...",
      addJobTitle: "Add job title",
      addCompany: "Add company",
      addLocation: "Add location",
      addPhone: "Add phone",
      addLinkedin: "Add LinkedIn",
      addTwitter: "Add X (Twitter)",
      addSpecialization: "Add specialization",
      interestsHint: "Pick topics, categories and tags you follow.",
      shortcuts: "Shortcuts",
      notSet: "Not set",
      clickToEdit: "Click to edit",
      saving: "Saving...",
      addAvatar: "Add photo",
      changeAvatar: "Change",
      avatarSize: "400 × 400 px",
    },

    security: {
      changePassword: "Change password",
      currentPassword: "Current password",
      newPassword: "New password",
      confirmPassword: "Confirm password",
      update: "Update password",
      updated: "Password changed. Other sessions were signed out.",
      mismatch: "Passwords do not match",
      tooShort: "Password must be at least 8 characters",
      wrongCurrent: "Your current password is incorrect.",
      signOut: "Sign out",
      sessions: "Sessions",
      lastSignIn: "Last sign-in",
      signOutOthers: "Sign out other sessions",
      signedOutOthers: "Signed out other sessions.",
      exportFailed: "Could not prepare the export. Please try again.",
      email: {
        title: "Email address",
        subtitle: "Changing it requires confirmation via a link sent to the new address.",
        current: "Current address",
        newEmail: "New email address",
        submit: "Change email",
        sent: "We've sent a confirmation link to the new address.",
        invalid: "Enter a valid email address.",
        needPassword: "Enter your current password to confirm.",
      },
      danger: {
        title: "Delete account",
        subtitle:
          "Permanently deletes your account and all related data (bookmarks, follows, results). This cannot be undone.",
        button: "Delete my account",
        confirmTitle: "Delete your account?",
        confirmBody:
          "This action is irreversible. To confirm, enter your password. All your data will be permanently removed.",
        passwordLabel: "Confirm with password",
        cancel: "Cancel",
        confirm: "Delete account permanently",
        deleted: "Your account has been deleted.",
        failed: "Could not delete the account.",
      },
      tip: {
        currentPassword: "Enter your current password to confirm it's you.",
        newPassword: "Minimum 8 characters. Mix letters, digits and symbols for strength.",
        confirmPassword: "Repeat your new password to avoid typos.",
        update: "Saves your new password and signs out other sessions.",
        signOut: "Signs you out on this device.",
        signOutOthers: "Signs out all your other sessions on other devices.",
      },
      mfa: {
        title: "Two-factor authentication (TOTP)",
        subtitle:
          "An extra layer of protection: we'll ask for a code from your authenticator app when you sign in.",
        statusEnabled: "Enabled",
        statusDisabled: "Disabled",
        enroll: "Set up an authenticator app",
        scanInstruction:
          "Scan this QR code with your authenticator app (Google Authenticator, 1Password, Authy…).",
        manualIntro: "Can't scan the code? Enter this key manually:",
        codeLabel: "6-digit code",
        codePlaceholder: "000000",
        activate: "Activate",
        cancel: "Cancel",
        activated: "Two-factor authentication enabled.",
        invalidCode: "Enter the 6-digit code from your app.",
        enrollError: "Could not start setup. Please try again.",
        verifyError: "Invalid code. Check it and try again.",
        enrolledTitle: "Active authenticator apps",
        defaultFactorName: "Authenticator app",
        addedOn: "Added {{date}}",
        loading: "Loading…",
        none: "No methods configured.",
        remove: "Remove",
        removeTitle: "Remove this method?",
        removeBody:
          "After removal, signing in will no longer require a code from this app. Confirm with your password.",
        removePasswordLabel: "Confirm with password",
        removeConfirm: "Remove method",
        removed: "The method has been removed.",
        removeError: "Could not remove the method.",
        wrongPassword: "Your current password is incorrect.",
        challenge: {
          title: "Two-step verification",
          description: "Enter the 6-digit code from your authenticator app to continue.",
          codeLabel: "6-digit code",
          verify: "Verify",
          cancel: "Cancel",
          noFactor: "No authenticator app is configured for this account.",
          failed: "Verification failed. Check the code and try again.",
        },
      },
    },
    billing: {
      title: "Billing details",
      subtitle: "Used on invoices and at checkout.",
      isCompany: "I am a company",
      fullName: "Full name",
      company: "Company name",
      taxId: "Tax ID / VAT",
      email: "Invoice email",
      phone: "Phone",
      addressLine1: "Address line 1",
      addressLine2: "Address line 2 (optional)",
      city: "City",
      postalCode: "Postal code",
      region: "State / region",
      country: "Country",
      save: "Save details",
      saved: "Saved",
      saveError: "Could not save your details. Please try again.",
      taxIdFormat: "Invalid NIP format - enter 10 digits (dashes are fine).",
      taxIdChecksum: "The NIP check digit is wrong - please verify the number.",
      taxIdVatFormat: "Invalid VAT number format.",
      tip: {
        isCompany: "Enable if you're purchasing as a business - a VAT field will appear.",
        fullName: "Full name as it should appear on the invoice.",
        company: "Official company name for invoicing.",
        taxId: "Tax ID / VAT number. Required for business buyers.",
        email: "Where we'll send your PDF invoice.",
        phone: "Contact number for questions about your order.",
        addressLine1: 'Street and number (e.g. "5th Avenue 1").',
        addressLine2: "Apartment, floor, suite - optional.",
        city: "City for the billing address.",
        postalCode: "Postal / ZIP code of the billing address.",
        region: "State or region, if applicable.",
        country: "Two-letter ISO country code (e.g. PL, DE, US).",
        save: "Saves your billing details to your account.",
      },
    },
    subscription: {
      title: "Your subscription",
      none: "You do not have an active subscription.",
      plan: "Plan",
      status: "Status",
      startedAt: "Active since",
      renewsAt: "Renews",
      cancelsAt: "Expires",
      cancel: "Cancel subscription",
      cancelConfirm:
        "Your subscription remains active until the end of the current billing period.",
      canceled: "Subscription canceled",
      cancelFailed: "Could not cancel the subscription. Please try again or contact us.",
      keep: "Keep subscription",
      accessUntil: "Subscription canceled - access stays active until {{date}}.",
      resume: "Resume subscription",
      resumed: "Subscription resumed",
      resumeError: "Could not resume the subscription.",
      change: "Change plan",
    },
    orders: {
      title: "Payment history",
      empty: "No orders yet.",
      colDate: "Date",
      colItem: "Item",
      colAmount: "Amount",
      colStatus: "Status",
      colInvoice: "Invoice",
      invoice: "Download",
      kindSubscription: "Subscription",
      kindOneTime: "One-time purchase",
    },
    status: {
      pending: "Pending",
      processing: "Processing",
      paid: "Paid",
      failed: "Failed",
      refunded: "Refunded",
      canceled: "Canceled",
      active: "Active",
      expired: "Expired",
    },
  },
  pricing: {
    title: "Pricing",
    subtitle: "Choose the plan that fits your needs.",
    perMonth: "/ mo",
    perYear: "/ yr",
    perDay: "/ day",
    perWeek: "/ wk",
    perOnce: "one-time",
    choose: "Choose plan",
    current: "Current plan",
    trial: "{{days}}-day free trial",
    popular: "Most popular",
    empty: "No plans available.",
    intervalMonthly: "Monthly",
    intervalYearly: "Yearly",
    compareTitle: "Compare plans",
    compareFeature: "Feature",
    trust: {
      secure: "Secure payments by Stripe",
      cancel: "Cancel anytime",
      instant: "Instant access after payment",
    },
    faqTitle: "Frequently asked questions",
    faq: [
      {
        q: "Can I cancel my subscription?",
        a: "Yes. Cancel anytime from your profile - you keep access until the end of the paid period.",
      },
      {
        q: "Which payment methods do you accept?",
        a: "Payments are handled by Stripe - Visa, Mastercard and popular local methods.",
      },
      {
        q: "Will I get an invoice?",
        a: "Yes. Invoices are issued from the billing details in your profile.",
      },
      {
        q: "Is access immediate?",
        a: "Yes - access unlocks automatically as soon as the payment is confirmed.",
      },
    ],
  },
  checkout: {
    title: "Checkout",
    saveBillingContinue: "Save and continue",
    continueReading: "Back to the article",
    summary: "Order summary",
    item: "Item",
    total: "Total",
    billingDetails: "Billing details",
    paymentMethod: "Payment method",
    payNow: "Pay {{amount}}",
    processing: "Processing...",
    secured: "Secured by Stripe",
    terms: 'By clicking "Pay" you agree to the terms and privacy policy.',
    successTitle: "Thank you!",
    successBody: "Your order was received. We will update its status once payment is confirmed.",
    cancelTitle: "Payment canceled",
    cancelBody: "We did not charge you. Feel free to try again.",
    backToProfile: "Go to profile",
    backToPricing: "Back to pricing",
    notFound: "Plan not found.",
    loginRequired: "Please sign in to continue.",
    fillBilling: "Fill in your billing details first.",
    stripeNotConfigured: "Payment gateway is not configured yet. Please contact the administrator.",
    trialLine: "First {{days}} days free - the first charge comes after the trial.",
    promoHint: "Have a coupon? Enter your promo code on Stripe's secure payment page.",
    taxHint: "VAT is calculated automatically based on your address.",
    taxIdHint: "You can provide your VAT ID for the invoice on the payment page.",
    subtotal: "Subtotal",
    applyFailed: "Could not apply the coupon.",
    headTitle: "Checkout · Finalizacja zamówienia",
    successHeadTitle: "Payment success · Dziękujemy za zakup",
    cancelHeadTitle: "Payment canceled · Płatność anulowana",
  },
  coupon: {
    title: "B2B coupon",
    placeholder: "e.g. NES-B2B-10",
    apply: "Apply",
    savings: "You save",
    discount: "Discount",
    error: {
      emptyCode: "Enter a coupon code.",
      invalidAmount: "Invalid order amount.",
      notFound: "That code was not found.",
      inactive: "This coupon is inactive.",
      notYetValid: "This coupon is not valid yet.",
      expired: "This coupon has expired.",
      limitReached: "This coupon has reached its usage limit.",
      planNotEligible: "This coupon does not apply to the selected plan.",
      currencyMismatch: "Coupon currency does not match this order.",
    },
  },
  auth: {
    required: "Sign-in required",
    requiredBody: "You need to sign in to view this page.",
    signIn: "Sign in",
    signUp: "Create account",
  },
};

type ProfileExtras = {
  profile: {
    role: {
      badge: string;
      super_admin: string;
      admin: string;
      editor: string;
      author: string;
      user: string;
    };
    social: {
      title: string;
      subtitle: string;
      slug: string;
      slugHint: string;
      slugReset: string;
      slugPreview: string;
      slugInvalid: string;
      slugTooShort: string;
      slugTaken: string;
      slugAvailable: string;
      slugChecking: string;
      slugReserved: string;
      bioPl: string;
      bioEn: string;
      twitter: string;
      linkedin: string;
      website: string;
      facebook: string;
      instagram: string;
      spotify: string;
      email: string;
      save: string;
      saved: string;
      tip: {
        slug: string;
        bioPl: string;
        bioEn: string;
        twitter: string;
        linkedin: string;
        website: string;
        facebook: string;
        instagram: string;
        spotify: string;
        email: string;
        save: string;
      };
    };

    bookmarks: {
      title: string;
      subtitle: string;
      empty: string;
      remove: string;
      open: string;
      tabPosts: string;
      tabPages: string;
      unavailable: string;
    };
    follows: {
      title: string;
      subtitle: string;
      empty: string;
      unfollow: string;
      tabAuthors: string;
      tabCategories: string;
      tabTags: string;
      tabPrograms: string;
      unavailable: string;
    };
  };
};

const extrasPl: ProfileExtras = {
  profile: {
    role: {
      badge: "Rola",
      super_admin: "Super admin",
      admin: "Administrator",
      editor: "Redaktor",
      author: "Autor",
      user: "Czytelnik",
    },
    social: {
      title: "Media społecznościowe i profil publiczny",
      subtitle: "Te dane pojawią się na Twojej publicznej stronie autora.",
      slug: "Nick (unikalny identyfikator)",
      slugHint:
        "Wybierz swój unikalny nick. Adres profilu: /author/{slug}. Małe litery, cyfry, myślniki.",
      slugReset: "Zaproponuj z imienia i nazwiska",
      slugPreview: "Podgląd adresu",
      slugInvalid:
        "Dozwolone tylko małe litery, cyfry i myślnik (-). Bez polskich znaków i spacji.",
      slugTooShort: "Minimum 3 znaki.",
      slugTaken: "Ten nick jest już zajęty.",
      slugAvailable: "Nick jest dostępny.",
      slugChecking: "Sprawdzam dostępność...",
      slugReserved: "Ten nick jest zarezerwowany.",

      bioPl: "Biogram (PL)",
      bioEn: "Biogram (EN)",
      twitter: "X / Twitter (URL)",
      linkedin: "LinkedIn (URL)",
      website: "Strona WWW (URL)",
      facebook: "Facebook (URL)",
      instagram: "Instagram (URL)",
      spotify: "Spotify (URL)",
      email: "E-mail kontaktowy",
      save: "Zapisz",
      saved: "Zapisano",
      tip: {
        slug: "Twój unikalny nick - tworzy adres /author/{nick} i pojawia się przy publikacjach.",
        bioPl: "Krótki biogram po polsku (do 1000 znaków).",
        bioEn: "Krótki biogram po angielsku (do 1000 znaków).",
        twitter: "Pełny link do Twojego profilu X / Twitter (https://x.com/...).",
        linkedin: "Pełny link do Twojego profilu LinkedIn (https://linkedin.com/in/...).",
        website: "Twoja strona WWW - dowolny adres zaczynający się od https://.",
        facebook: "Pełny link do Twojego profilu lub strony na Facebooku.",
        instagram: "Pełny link do Twojego konta na Instagramie.",
        spotify: "Pełny link do profilu artysty lub podcastu na Spotify.",
        email: "Publiczny adres kontaktowy - widoczny na Twojej stronie autora.",
        save: "Zapisuje sekcję mediów społecznościowych i profil publiczny.",
      },
    },
    bookmarks: {
      title: "Zapisane materiały",
      subtitle: "Wpisy i strony, które dodałeś do listy do przeczytania później.",
      empty: "Nie masz jeszcze żadnych zapisanych materiałów.",
      remove: "Usuń",
      open: "Otwórz",
      tabPosts: "Wpisy",
      tabPages: "Strony",
      unavailable: "Materiał niedostępny (usunięty lub wycofany z publikacji)",
    },
    follows: {
      title: "Obserwowane",
      subtitle: "Twoi obserwowani autorzy, kategorie i tagi.",
      empty: "Niczego jeszcze nie obserwujesz.",
      unfollow: "Przestań obserwować",
      unavailable: "Pozycja niedostępna lub ukryta",
      tabAuthors: "Autorzy",
      tabCategories: "Kategorie",
      tabTags: "Tagi",
      tabPrograms: "Programy",
    },
  },
};

const extrasEn: ProfileExtras = {
  profile: {
    role: {
      badge: "Role",
      super_admin: "Super admin",
      admin: "Administrator",
      editor: "Editor",
      author: "Author",
      user: "Reader",
    },
    social: {
      title: "Social media and public profile",
      subtitle: "These details appear on your public author page.",
      slug: "Nickname (unique handle)",
      slugHint:
        "Pick your unique nickname. Profile URL: /author/{slug}. Lowercase letters, digits, dashes.",
      slugReset: "Suggest from first and last name",
      slugPreview: "URL preview",
      slugInvalid:
        "Only lowercase letters, digits and dashes (-) allowed. No spaces or special characters.",
      slugTooShort: "Minimum 3 characters.",
      slugTaken: "This nickname is already taken.",
      slugAvailable: "Nickname is available.",
      slugChecking: "Checking availability...",
      slugReserved: "This nickname is reserved.",

      bioPl: "Biography (PL)",
      bioEn: "Biography (EN)",
      twitter: "X / Twitter (URL)",
      linkedin: "LinkedIn (URL)",
      website: "Website (URL)",
      facebook: "Facebook (URL)",
      instagram: "Instagram (URL)",
      spotify: "Spotify (URL)",
      email: "Contact e-mail",
      save: "Save",
      saved: "Saved",
      tip: {
        slug: "Your unique handle - it builds the /author/{handle} URL and shows next to your posts.",
        bioPl: "Short Polish biography (up to 1000 characters).",
        bioEn: "Short English biography (up to 1000 characters).",
        twitter: "Full URL of your X / Twitter profile (https://x.com/...).",
        linkedin: "Full URL of your LinkedIn profile (https://linkedin.com/in/...).",
        website: "Your website - any address starting with https://.",
        facebook: "Full URL of your Facebook profile or page.",
        instagram: "Full URL of your Instagram account.",
        spotify: "Full URL of your artist or podcast profile on Spotify.",
        email: "Public contact email shown on your author page.",
        save: "Saves the social media & public profile section.",
      },
    },
    bookmarks: {
      title: "Saved items",
      subtitle: "Posts and pages you saved for later.",
      empty: "You have no saved items yet.",
      remove: "Remove",
      open: "Open",
      tabPosts: "Posts",
      tabPages: "Pages",
      unavailable: "Item unavailable (deleted or unpublished)",
    },
    follows: {
      title: "Following",
      subtitle: "Authors, categories and tags you follow.",
      empty: "You are not following anything yet.",
      unfollow: "Unfollow",
      unavailable: "Item unavailable or hidden",
      tabAuthors: "Authors",
      tabCategories: "Categories",
      tabTags: "Tags",
      tabPrograms: "Programs",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
i18n.addResourceBundle("pl", "translation", extrasPl, true, true);
i18n.addResourceBundle("en", "translation", extrasEn, true, true);

export {};

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu.
 * Nazwane wiązanie pozwala splitterowi TanStacka przenieść cały bundle
 * tłumaczeń do chunka trasy - side-effectowy import w pliku trasy lądował
 * w eager-owym grafie wejściowym każdej strony. Rejestracja dzieje się przy
 * ewaluacji modułu (przed renderem komponentu), dokładnie jak wcześniej.
 */
export function ensureI18n(): void {}
