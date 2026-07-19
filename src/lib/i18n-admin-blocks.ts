// Zasoby i18n dla edytorów bloków w panelu admina (src/components/admin/blocks/edit/*).
// Każdy blok ma własną podprzestrzeń nazw pod adminBlocks.*.
import i18n from "@/lib/i18n";

const pl = {
  adminBlocks: {
    common: {
      remove: "Usuń",
    },
    faq: {
      sectionTitle: "Tytuł sekcji (np. Najczęstsze pytania)",
      question: "Pytanie {{n}}",
      answer: "Odpowiedź",
      addQuestion: "Dodaj pytanie",
    },
    affiliate: {
      heading: "Produkt afiliacyjny",
      sponsored: "Sponsorowane (rel=sponsored)",
      title: "Tytuł produktu",
      store: "Sklep (np. Amazon)",
      imageUrl: "URL obrazka",
      description: "Krótki opis",
      price: "Cena",
      currency: "Waluta (PLN/EUR/USD)",
      rating: "Ocena 0-5",
      ctaLabel: "Etykieta CTA (Kup teraz)",
      ctaHref: "Link partnerski",
    },
    cover: {
      bgUrl: "URL obrazu tła (cover)…",
      title: "Wpisz tytuł…",
    },
    file: {
      label: "Nazwa pliku do wyświetlenia…",
      url: "URL pliku (PDF, ZIP, DOCX…)",
      showButton: 'Pokaż przycisk „Pobierz"',
    },
    group: {
      childCount: "{{count}} blok(i)",
      background: "Kolor tła (np. #f4f4f5)",
      padding: "Padding (px)",
      nestedHint: "Edycja zagnieżdżonych bloków - w kolejnym kroku (Etap 1b: nested editor).",
    },
    heading: {
      placeholder: "Nagłówek H{{level}}…",
    },
    image: {
      url: "Wklej URL obrazu lub ścieżkę z biblioteki mediów…",
      settingsHint: "Ustawienia (alt, caption, link) w panelu po prawej.",
      caption: "Podpis (opcjonalnie)…",
    },
  },
};

const en: typeof pl = {
  adminBlocks: {
    common: {
      remove: "Delete",
    },
    faq: {
      sectionTitle: "Section title (e.g. Frequently asked questions)",
      question: "Question {{n}}",
      answer: "Answer",
      addQuestion: "Add question",
    },
    affiliate: {
      heading: "Affiliate product",
      sponsored: "Sponsored (rel=sponsored)",
      title: "Product title",
      store: "Store (e.g. Amazon)",
      imageUrl: "Image URL",
      description: "Short description",
      price: "Price",
      currency: "Currency (PLN/EUR/USD)",
      rating: "Rating 0-5",
      ctaLabel: "CTA label (Buy now)",
      ctaHref: "Affiliate link",
    },
    cover: {
      bgUrl: "Background image URL (cover)…",
      title: "Enter a title…",
    },
    file: {
      label: "File name to display…",
      url: "File URL (PDF, ZIP, DOCX…)",
      showButton: 'Show the "Download" button',
    },
    group: {
      childCount: "{{count}} block(s)",
      background: "Background color (e.g. #f4f4f5)",
      padding: "Padding (px)",
      nestedHint: "Editing nested blocks - in the next step (Stage 1b: nested editor).",
    },
    heading: {
      placeholder: "Heading H{{level}}…",
    },
    image: {
      url: "Paste an image URL or a path from the media library…",
      settingsHint: "Settings (alt, caption, link) in the panel on the right.",
      caption: "Caption (optional)…",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
