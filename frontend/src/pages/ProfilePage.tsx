import { useTranslation } from "react-i18next";
import { useAuth } from "../lib/AuthContext";
import { Globe, Lock, Mail } from "lucide-react";
import { LANGUAGE_STORAGE_KEY } from "../lib/i18n";
import { useToast } from "../components/Toast";

const LANGUAGES = [
  { code: "fr", labelKey: "profile.french" },
  { code: "en", labelKey: "profile.english" },
  { code: "es", labelKey: "profile.spanish" },
] as const;

export default function ProfilePage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();

  const handleLanguageChange = (code: string) => {
    i18n.changeLanguage(code);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  };

  const handleChangePassword = () => {
    toast.success(t("profile.changePasswordAlert"));
  };

  return (
    <div className="animate-fade-in">
      <h1 className="text-xl font-semibold text-white tracking-tight mb-6">
        {t("profile.title")}
      </h1>

      <div className="space-y-4 max-w-lg">
        {/* Email */}
        <div className="surface-static rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-white/[0.06] flex items-center justify-center">
              <Mail className="w-4 h-4 text-zinc-400" />
            </div>
            <div>
              <h2 className="text-sm font-medium text-white">{t("profile.emailLabel")}</h2>
            </div>
          </div>
          <p className="text-sm text-zinc-400 pl-12">{user?.email}</p>
        </div>

        {/* Language */}
        <div className="surface-static rounded-xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-white/[0.06] flex items-center justify-center">
              <Globe className="w-4 h-4 text-zinc-400" />
            </div>
            <div>
              <h2 className="text-sm font-medium text-white">{t("profile.languageLabel")}</h2>
            </div>
          </div>
          <div className="flex gap-2 pl-12">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleLanguageChange(lang.code)}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                  i18n.language.startsWith(lang.code)
                    ? "bg-white text-black font-medium"
                    : "bg-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.1] border border-white/[0.08]"
                }`}
              >
                {t(lang.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Change password */}
        <div className="surface-static rounded-xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-white/[0.06] flex items-center justify-center">
              <Lock className="w-4 h-4 text-zinc-400" />
            </div>
            <div>
              <h2 className="text-sm font-medium text-white">{t("auth.password")}</h2>
            </div>
          </div>
          <div className="pl-12">
            <button
              onClick={handleChangePassword}
              className="px-4 py-2 text-sm font-medium text-zinc-300 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] rounded-lg transition-colors"
            >
              {t("profile.changePassword")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
