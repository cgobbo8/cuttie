import { NavLink, useNavigate } from "react-router";
import { useState } from "react";
import { Clapperboard, Cpu, Film, FolderOpen, Gamepad2, Home, LogOut, Plus, Scissors, Settings, Users, type LucideIcon } from "lucide-react";
import NewProjectModal from "./NewProjectModal";
import CreatorSelector from "./CreatorSelector";
import { useAuth } from "../lib/AuthContext";
import { useCreatorWorkspace } from "../lib/CreatorWorkspaceContext";
import { useSettings } from "../lib/SettingsContext";
import { useTranslation } from "react-i18next";

function NavItem({ to, icon: Icon, label, end }: { to: string; icon: LucideIcon; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 h-10 px-3 rounded-[14px] text-[14px] transition-colors duration-200 ${
          isActive
            ? "bg-white/[0.11] text-white font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]"
            : "text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]"
        }`
      }
    >
      <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
      {label}
    </NavLink>
  );
}

export default function Sidebar() {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const { user, logout } = useAuth();
  const { isAllMode } = useCreatorWorkspace();
  const { appInfo } = useSettings();
  // Desktop app: single local streamer — no account, workspaces or admin pages
  const isLocalApp = appInfo?.mode === "local" && appInfo.auto_login;
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <>
      <aside className="w-[244px] shrink-0 h-[calc(100dvh-1.5rem)] sticky top-3 ml-3 my-3 flex flex-col glass rounded-[28px] p-3">
        <NavLink to="/" className="flex items-center gap-2.5 px-2.5 pt-1.5 pb-5">
          <span className="w-8 h-8 rounded-[10px] bg-brand grid place-items-center shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
            <Scissors className="w-4 h-4 text-white" strokeWidth={2.25} />
          </span>
          <span className="text-[17px] font-semibold tracking-[-0.02em] text-white">Cuttie</span>
        </NavLink>

        {!isLocalApp && (
          <div className="mb-2">
            <CreatorSelector />
          </div>
        )}

        <button onClick={() => setModalOpen(true)} className="btn btn-primary w-full mb-4">
          <Plus className="w-4 h-4" strokeWidth={2.25} />
          {t("sidebar.newAnalysis")}
        </button>

        <nav className="flex-1 space-y-1">
          <NavItem to="/" end icon={Home} label={t("sidebar.home")} />
          <NavItem to="/projects" icon={isLocalApp ? Clapperboard : FolderOpen} label={t("sidebar.analyses")} />
          <NavItem to="/exports" icon={Film} label={t("sidebar.exports")} />
          {!isLocalApp && (
            <>
              <NavItem to="/games" icon={Gamepad2} label={t("sidebar.games")} />
              {isAllMode && <NavItem to="/creators" icon={Users} label={t("sidebar.creators")} />}
              <NavItem to="/workers" icon={Cpu} label={t("sidebar.workers")} />
            </>
          )}
        </nav>

        <div className="space-y-1 pt-3 border-t border-white/[0.06]">
          <NavItem to="/settings" icon={Settings} label={t("sidebar.settings")} />
          {user && !isLocalApp && (
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 h-10 px-3 rounded-[14px] text-[14px] text-red-400/80 hover:text-red-300 hover:bg-red-500/[0.08] transition-colors w-full"
            >
              <LogOut className="w-[18px] h-[18px]" strokeWidth={1.75} />
              {t("auth.logout")}
            </button>
          )}
        </div>
      </aside>

      <NewProjectModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
