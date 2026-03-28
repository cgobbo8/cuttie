import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import fr from "./fr.json";
import en from "./en.json";
import es from "./es.json";

const LANGUAGE_STORAGE_KEY = "cuttie_language";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      fr: { translation: fr },
      en: { translation: en },
      es: { translation: es },
    },
    fallbackLng: "fr",
    supportedLngs: ["fr", "en", "es"],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      // Order: 1) localStorage override, 2) browser navigator language
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
  });

// Sync <html lang=""> with the active language
i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
});
// Set initial value
document.documentElement.lang = i18n.language;

export { LANGUAGE_STORAGE_KEY };
export default i18n;
