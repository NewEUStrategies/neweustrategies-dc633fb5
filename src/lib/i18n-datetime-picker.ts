// Nakładka i18n selektora daty i godziny (`components/ui/datetime-picker`).
//
// Selektor dostaje język w propsach (`lang`), a nie z `i18n.language`, więc
// woła `t(klucz, { lng: lang })`. Import efektem ubocznym:
//   import "@/lib/i18n-datetime-picker";
import i18n from "./i18n";

export const dateTimePickerPl = {
  dateTimePicker: {
    time: "Godzina",
    hour: "Godzina",
    minute: "Minuta",
  },
} as const;

export const dateTimePickerEn = {
  dateTimePicker: {
    time: "Time",
    hour: "Hour",
    minute: "Minute",
  },
} as const;

i18n.addResourceBundle("pl", "translation", dateTimePickerPl, true, true);
i18n.addResourceBundle("en", "translation", dateTimePickerEn, true, true);
