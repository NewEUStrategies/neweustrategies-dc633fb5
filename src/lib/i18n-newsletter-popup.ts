import i18n from "./i18n";

// Klucze publicznego popupu newslettera w wariancie "showcase".
const pl = {
  newsletter: {
    showcase: {
      slide: "Slajd",
    },
  },
};

const en = {
  newsletter: {
    showcase: {
      slide: "Slide",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
