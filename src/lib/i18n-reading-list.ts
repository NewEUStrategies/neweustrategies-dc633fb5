import i18n from "./i18n";

// Overlay dla /reading-list (zapisane / obserwowane / rekomendacje).
// Wcześniej strona miała hardcodowane polskie literały - wszystkie stringi
// przechodzą przez ten bundle (PL + EN).

const pl = {
  readingList: {
    loading: "Ładowanie...",
    loadingRecommendations: "Ładowanie rekomendacji...",
    browseArticles: "Przeglądaj artykuły",
    signIn: "Zaloguj się",
    disabledTitle: "Personalizacja jest wyłączona",
    disabledBody: "Administrator wyłączył listy czytelnicze i rekomendacje na tej stronie.",
    savedEmpty: "Nie masz jeszcze żadnych zapisanych artykułów.",
    guestSavedInfo:
      "Zapisujesz jako gość - lista jest przechowywana tylko na tym urządzeniu. Zaloguj się, aby zabrać ją ze sobą.",
    guestSavedEmpty: "Nie masz jeszcze zapisanych artykułów na tym urządzeniu.",
    guestRemove: "Usuń z zapisanych",
    savedAt: "Zapisano {{date}}",
    followedEmpty: "Nie obserwujesz jeszcze żadnych autorów, kategorii ani tagów.",
    followedEmptyCta: "Dostosuj zainteresowania",
    followedFeedEmpty:
      "Obserwowani autorzy i tematy nie mają jeszcze nowych publikacji - zajrzyj wkrótce.",
    followedGuest: "Obserwowanie autorów i tematów jest dostępne po zalogowaniu.",
    loadMore: "Wczytaj więcej",
    yourFollows: "Obserwujesz",
    unfollow: "Przestań obserwować: {{name}}",
    categories: "Kategorie",
    tags: "Tagi",
    authors: "Autorzy",
    anonymousAuthor: "Anonim",
    recommendedEmpty:
      "Brak rekomendacji. Zaobserwuj kategorie lub przeczytaj kilka wpisów, abyśmy mogli dopasować propozycje.",
    recommendedError: "Nie udało się wczytać rekomendacji.",
    retry: "Spróbuj ponownie",
    reasons: {
      author: "Obserwowany autor",
      category: "Obserwowana kategoria",
      tag: "Obserwowany tag",
      history: "Na podstawie lektur",
      fresh: "Nowość",
    },
  },
};

const en: typeof pl = {
  readingList: {
    loading: "Loading...",
    loadingRecommendations: "Loading recommendations...",
    browseArticles: "Browse articles",
    signIn: "Sign in",
    disabledTitle: "Personalization is disabled",
    disabledBody: "The administrator has disabled reading lists and recommendations on this site.",
    savedEmpty: "You have no saved articles yet.",
    guestSavedInfo:
      "You are saving as a guest - the list lives only on this device. Sign in to take it with you.",
    guestSavedEmpty: "No articles saved on this device yet.",
    guestRemove: "Remove from saved",
    savedAt: "Saved {{date}}",
    followedEmpty: "You are not following any authors, categories or tags yet.",
    followedEmptyCta: "Customize interests",
    followedFeedEmpty: "Your followed authors and topics have no new posts yet - check back soon.",
    followedGuest: "Following authors and topics is available after signing in.",
    loadMore: "Load more",
    yourFollows: "You follow",
    unfollow: "Unfollow: {{name}}",
    categories: "Categories",
    tags: "Tags",
    authors: "Authors",
    anonymousAuthor: "Anonymous",
    recommendedEmpty:
      "No recommendations yet. Follow some categories or read a few posts so we can tailor suggestions.",
    recommendedError: "Could not load recommendations.",
    retry: "Try again",
    reasons: {
      author: "Followed author",
      category: "Followed category",
      tag: "Followed tag",
      history: "Based on your reading",
      fresh: "Fresh",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
