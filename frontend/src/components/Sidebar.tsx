import { NavLink, useNavigate } from "react-router";
import { useState } from "react";
import { Film, FolderOpen, LogOut, Plus } from "lucide-react";
import NewProjectModal from "./NewProjectModal";
import { useAuth } from "../lib/AuthContext";

export default function Sidebar() {
  const [modalOpen, setModalOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
      isActive
        ? "bg-white/[0.08] text-white font-medium"
        : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
    }`;

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <>
      <aside className="w-[240px] shrink-0 h-screen sticky top-0 flex flex-col border-r border-white/[0.06] bg-[#09090b]">
        {/* Logo */}
        <div className="px-5 py-5 flex items-center justify-between">
          <NavLink to="/" className="flex items-center gap-2.5">
            <span className="text-lg font-bold tracking-tight text-white">
              Cuttie
            </span>
          </NavLink>
        </div>

        {/* New project button */}
        <div className="px-3 mb-1">
          <button
            onClick={() => setModalOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nouveau projet
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3 space-y-0.5">
          <NavLink to="/" end className={navClass}>
            <FolderOpen className="w-4 h-4" />
            Projets
          </NavLink>
          <NavLink to="/exports" className={navClass}>
            <Film className="w-4 h-4" />
            Exports
          </NavLink>
        </nav>

        {/* User section */}
        {user && (
          <div className="px-3 py-3 border-t border-white/[0.06]">
            <div className="flex items-center gap-3 px-2">
              <div className="w-8 h-8 rounded-full bg-white/[0.08] flex items-center justify-center text-xs font-medium text-zinc-300 shrink-0">
                {user.initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-300 truncate">{user.email}</p>
              </div>
              <button
                onClick={handleLogout}
                title="Se deconnecter"
                className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </aside>

      <NewProjectModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
