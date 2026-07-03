import i18n from "./i18n";

// Second extras overlay for the LinkedIn-style profile suite.
// Adds: tabs, sidebar sections (personal data, personality, hobbies),
// experience / education / skills / awards / CV, personality test, public profile.

type ProfileExtras2 = {
  profile: {
    tabs: { about: string; experience: string; badges: string; activity: string; settings: string };
    actions: {
      edit: string;
      viewAsGuest: string;
      add: string;
      remove: string;
      save: string;
      cancel: string;
      saving: string;
      saved: string;
      saveError: string;
      uploading: string;
      empty: string;
      loading: string;
    };
    sidebar: {
      personal: string;
      personality: string;
      interests: string;
      hobbies: string;
      birthDate: string;
      gender: string;
      location: string;
      label: string;
      joined: string;
      phone: string;
      noData: string;
      retakeTest: string;
      takeTest: string;
      testNote: string;
    };
    sections: {
      bio: string;
      bioEmpty: string;
      projects: string;
      projectsEmpty: string;
      contact: string;
      cv: string;
      cvHistory: string;
      cvCurrent: string;
      cvUpload: string;
      cvPreview: string;
      cvDownload: string;
      cvDelete: string;
      cvEmpty: string;
      cvSize: string;
      cvUploaded: string;
      experience: string;
      experienceEmpty: string;
      education: string;
      educationEmpty: string;
      skills: string;
      skillsEmpty: string;
      awards: string;
      awardsEmpty: string;
      recognitions: string;
      recognitionsEmpty: string;
      mentions: string;
      mentionsEmpty: string;
      hobbies: string;
    };
    forms: {
      roleTitle: string;
      company: string;
      description: string;
      startDate: string;
      endDate: string;
      current: string;
      school: string;
      degree: string;
      field: string;
      label: string;
      level: string;
      category: string;
      title: string;
      issuer: string;
      awardedAt: string;
      kind: string;
      kindAward: string;
      kindRecognition: string;
      kindMention: string;
      icon: string;
      url: string;
      addExperience: string;
      addEducation: string;
      addSkill: string;
      addAward: string;
      addHobby: string;
      addInterest: string;
      datePresent: string;
    };
    personality: {
      title: string;
      intro: string;
      axes: {
        openness: string;
        conscientiousness: string;
        extraversion: string;
        agreeableness: string;
        neuroticism: string;
      };
      lowHigh: {
        openness: [string, string];
        conscientiousness: [string, string];
        extraversion: [string, string];
        agreeableness: [string, string];
        neuroticism: [string, string];
      };
      scale: { 1: string; 2: string; 3: string; 4: string; 5: string };
      progress: string;
      submit: string;
      submitting: string;
      saved: string;
      yourScore: string;
      retake: string;
      back: string;
      requireAll: string;
      lastTaken: string;
    };
    publicProfile: {
      title: string;
      notFound: string;
      notFoundBody: string;
      backHome: string;
      contactCta: string;
    };
  };
};

const extras2Pl: ProfileExtras2 = {
  profile: {
    tabs: {
      about: "O mnie",
      experience: "Doświadczenie",
      badges: "Odznaki",
      activity: "Aktywność",
      settings: "Ustawienia",
    },
    actions: {
      edit: "Edytuj profil",
      viewAsGuest: "Zobacz jako gość",
      add: "Dodaj",
      remove: "Usuń",
      save: "Zapisz",
      cancel: "Anuluj",
      saving: "Zapisywanie...",
      saved: "Zapisano",
      saveError: "Nie udało się zapisać",
      uploading: "Wgrywanie...",
      empty: "Brak danych",
      loading: "Ładowanie...",
    },
    sidebar: {
      personal: "Dane osobowe",
      personality: "Osobowość",
      interests: "Zainteresowania",
      hobbies: "Hobby",
      birthDate: "Data urodzenia",
      gender: "Płeć",
      location: "Lokalizacja",
      label: "Label",
      joined: "Dołączył(a)",
      phone: "Telefon",
      noData: "Brak danych",
      retakeTest: "Powtórz test",
      takeTest: "Wypełnij test",
      testNote: "Test Big Five (30 pytań, ok. 5 minut).",
    },
    sections: {
      bio: "O mnie",
      bioEmpty: "Napisz krótko o sobie - czym się zajmujesz i co Cię interesuje.",
      projects: "Projekty",
      projectsEmpty: "Brak projektów - dodaj swoje zaangażowania.",
      contact: "Kontakt",
      cv: "CV / Plik",
      cvHistory: "Historia wgrywanych plików",
      cvCurrent: "AKTUALNE",
      cvUpload: "Wgraj CV",
      cvPreview: "Podgląd",
      cvDownload: "Pobierz",
      cvDelete: "Usuń",
      cvEmpty: "Nie wgrano jeszcze żadnego pliku.",
      cvSize: "Rozmiar: {{size}}",
      cvUploaded: "Wgrano: {{date}}",
      experience: "Doświadczenie",
      experienceEmpty: "Brak doświadczenia - dodaj swoje stanowiska.",
      education: "Wykształcenie",
      educationEmpty: "Brak wykształcenia - dodaj swoje uczelnie.",
      skills: "Umiejętności",
      skillsEmpty: "Brak umiejętności - dodaj swoje kompetencje.",
      awards: "Odznaki i nagrody",
      awardsEmpty: "Brak przyznanych odznak.",
      recognitions: "Nagrody Recognition",
      recognitionsEmpty: "Brak nagród Recognition.",
      mentions: "Otrzymane wyróżnienia",
      mentionsEmpty: "Brak otrzymanych wyróżnień.",
      hobbies: "Hobby",
    },
    forms: {
      roleTitle: "Stanowisko",
      company: "Firma",
      description: "Opis",
      startDate: "Data rozpoczęcia",
      endDate: "Data zakończenia",
      current: "Obecne",
      school: "Uczelnia / szkoła",
      degree: "Stopień",
      field: "Kierunek",
      label: "Nazwa",
      level: "Poziom",
      category: "Kategoria",
      title: "Tytuł",
      issuer: "Wystawca",
      awardedAt: "Data przyznania",
      kind: "Rodzaj",
      kindAward: "Nagroda",
      kindRecognition: "Recognition",
      kindMention: "Wyróżnienie",
      icon: "Ikona",
      url: "URL",
      addExperience: "Dodaj stanowisko",
      addEducation: "Dodaj wykształcenie",
      addSkill: "Dodaj umiejętność",
      addAward: "Dodaj odznakę",
      addHobby: "Dodaj hobby",
      addInterest: "Dodaj zainteresowanie",
      datePresent: "obecnie",
    },
    personality: {
      title: "Test osobowości (Big Five)",
      intro:
        "30 pytań, ok. 5 minut. Odpowiedz na każde, używając skali od 1 (zdecydowanie nie) do 5 (zdecydowanie tak).",
      axes: {
        openness: "Otwartość",
        conscientiousness: "Sumienność",
        extraversion: "Ekstrawertyczność",
        agreeableness: "Ugodowość",
        neuroticism: "Stabilność emocjonalna",
      },
      lowHigh: {
        openness: ["Konwencjonalny", "Otwarty"],
        conscientiousness: ["Spontaniczny", "Sumienny"],
        extraversion: ["Introwertyczny", "Ekstrawertyczny"],
        agreeableness: ["Niezależny", "Ugodowy"],
        neuroticism: ["Stabilny", "Reaktywny"],
      },
      scale: {
        1: "Zdecydowanie nie",
        2: "Raczej nie",
        3: "Nie wiem",
        4: "Raczej tak",
        5: "Zdecydowanie tak",
      },
      progress: "Postęp: {{done}}/{{total}}",
      submit: "Zobacz wynik",
      submitting: "Liczenie wyniku...",
      saved: "Wynik zapisany",
      yourScore: "Twój wynik",
      retake: "Powtórz test",
      back: "Wróć do profilu",
      requireAll: "Odpowiedz na wszystkie pytania, aby zobaczyć wynik.",
      lastTaken: "Ostatnio wykonany: {{date}}",
    },
    publicProfile: {
      title: "Profil publiczny",
      notFound: "Nie znaleziono profilu",
      notFoundBody: "Ten profil nie istnieje lub nie został opublikowany.",
      backHome: "Wróć na stronę główną",
      contactCta: "Skontaktuj się",
    },
  },
};

const extras2En: ProfileExtras2 = {
  profile: {
    tabs: {
      about: "About",
      experience: "Experience",
      badges: "Badges",
      activity: "Activity",
      settings: "Settings",
    },
    actions: {
      edit: "Edit profile",
      viewAsGuest: "View as guest",
      add: "Add",
      remove: "Remove",
      save: "Save",
      cancel: "Cancel",
      saving: "Saving...",
      saved: "Saved",
      saveError: "Could not save",
      uploading: "Uploading...",
      empty: "Empty",
      loading: "Loading...",
    },
    sidebar: {
      personal: "Personal data",
      personality: "Personality",
      interests: "Interests",
      hobbies: "Hobby",
      birthDate: "Date of birth",
      gender: "Gender",
      location: "Location",
      label: "Label",
      joined: "Joined",
      phone: "Phone",
      noData: "No data",
      retakeTest: "Retake test",
      takeTest: "Take the test",
      testNote: "Big Five test (30 questions, ~5 minutes).",
    },
    sections: {
      bio: "About me",
      bioEmpty: "Tell readers about yourself - what you do and what interests you.",
      projects: "Projects",
      projectsEmpty: "No projects - add your engagements.",
      contact: "Contact",
      cv: "CV / File",
      cvHistory: "Upload history",
      cvCurrent: "CURRENT",
      cvUpload: "Upload CV",
      cvPreview: "Preview",
      cvDownload: "Download",
      cvDelete: "Delete",
      cvEmpty: "No file uploaded yet.",
      cvSize: "Size: {{size}}",
      cvUploaded: "Uploaded: {{date}}",
      experience: "Experience",
      experienceEmpty: "No experience - add your roles.",
      education: "Education",
      educationEmpty: "No education - add your schools.",
      skills: "Skills",
      skillsEmpty: "No skills - add your competencies.",
      awards: "Badges and awards",
      awardsEmpty: "No badges yet.",
      recognitions: "Recognition awards",
      recognitionsEmpty: "No recognitions yet.",
      mentions: "Mentions",
      mentionsEmpty: "No mentions yet.",
      hobbies: "Hobby",
    },
    forms: {
      roleTitle: "Role / position",
      company: "Company",
      description: "Description",
      startDate: "Start date",
      endDate: "End date",
      current: "Current",
      school: "School / university",
      degree: "Degree",
      field: "Field",
      label: "Name",
      level: "Level",
      category: "Category",
      title: "Title",
      issuer: "Issuer",
      awardedAt: "Awarded date",
      kind: "Kind",
      kindAward: "Award",
      kindRecognition: "Recognition",
      kindMention: "Mention",
      icon: "Icon",
      url: "URL",
      addExperience: "Add role",
      addEducation: "Add education",
      addSkill: "Add skill",
      addAward: "Add badge",
      addHobby: "Add hobby",
      addInterest: "Add interest",
      datePresent: "present",
    },
    personality: {
      title: "Personality test (Big Five)",
      intro:
        "30 questions, ~5 minutes. Rate each statement from 1 (strongly disagree) to 5 (strongly agree).",
      axes: {
        openness: "Openness",
        conscientiousness: "Conscientiousness",
        extraversion: "Extraversion",
        agreeableness: "Agreeableness",
        neuroticism: "Emotional stability",
      },
      lowHigh: {
        openness: ["Conventional", "Open"],
        conscientiousness: ["Spontaneous", "Conscientious"],
        extraversion: ["Introverted", "Extraverted"],
        agreeableness: ["Independent", "Agreeable"],
        neuroticism: ["Stable", "Reactive"],
      },
      scale: {
        1: "Strongly disagree",
        2: "Disagree",
        3: "Neutral",
        4: "Agree",
        5: "Strongly agree",
      },
      progress: "Progress: {{done}}/{{total}}",
      submit: "See result",
      submitting: "Calculating result...",
      saved: "Result saved",
      yourScore: "Your score",
      retake: "Retake test",
      back: "Back to profile",
      requireAll: "Answer all questions to see your result.",
      lastTaken: "Last taken: {{date}}",
    },
    publicProfile: {
      title: "Public profile",
      notFound: "Profile not found",
      notFoundBody: "This profile does not exist or has not been published.",
      backHome: "Back to home",
      contactCta: "Get in touch",
    },
  },
};

i18n.addResourceBundle("pl", "translation", extras2Pl, true, true);
i18n.addResourceBundle("en", "translation", extras2En, true, true);

export {};
