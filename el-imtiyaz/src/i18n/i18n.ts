/**
 * i18n setup — French primary, Arabic secondary, English reserved.
 *
 * Strings are kept inline (no JSON files) so the type checker verifies
 * every key exists at compile time. Translations are flat dotted keys
 * for predictable lookup.
 */
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { fr } from "./fr";
import { ar } from "./ar";

void i18next.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    ar: { translation: ar },
  },
  lng: "fr",
  fallbackLng: "fr",
  supportedLngs: ["fr", "ar"],
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18next;
