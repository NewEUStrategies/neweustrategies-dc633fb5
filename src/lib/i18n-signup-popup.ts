import i18n from "./i18n";

// Klucze publicznego popupu rejestracji konta (wariant "showcase").
// Treści redakcyjne (nagłówki, opisy, etykiety pól, zgody) pochodzą z bazy
// w dwóch wersjach językowych - tutaj żyją wyłącznie napisy interfejsu.
const pl = {
  signupPopup: {
    slide: "Slajd",
    next: "Następny kadr",
  },
};

const en = {
  signupPopup: {
    slide: "Slide",
    next: "Next frame",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
