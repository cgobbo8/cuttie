import { useState, useRef, useEffect } from "react";
import { useCreatorWorkspace } from "../lib/CreatorWorkspaceContext";
import { useTranslation } from "react-i18next";
import { ChevronsUpDown, Check, Search, Users } from "lucide-react";

export default function CreatorSelector() {
  const { t } = useTranslation();
  const { creator, creators, setCreator } = useCreatorWorkspace();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus search on open
  useEffect(() => {
    if (open) {
      setSearch("");
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  const filtered = search.trim()
    ? creators.filter((c) =>
        c.display_name.toLowerCase().includes(search.toLowerCase()) ||
        c.login.toLowerCase().includes(search.toLowerCase())
      )
    : creators;

  if (creators.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm bg-white/[0.04] border border-white/[0.08] rounded-lg hover:bg-white/[0.06] transition-colors"
      >
        {creator ? (
          <>
            {creator.thumbnail ? (
              <img src={creator.thumbnail} alt="" className="w-5 h-5 rounded-full shrink-0 object-cover" />
            ) : (
              <div className="w-5 h-5 rounded-full shrink-0 bg-white/[0.08] flex items-center justify-center">
                <Users className="w-3 h-3 text-zinc-500" />
              </div>
            )}
            <span className="flex-1 text-left text-zinc-200 truncate">{creator.display_name}</span>
          </>
        ) : (
          <>
            <Users className="w-4 h-4 text-zinc-500 shrink-0" />
            <span className="flex-1 text-left text-zinc-400">{t("workspace.allCreators")}</span>
          </>
        )}
        <ChevronsUpDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-[#18181b] border border-white/[0.08] rounded-lg shadow-xl overflow-hidden">
          {creators.length > 5 && (
            <div className="p-2 border-b border-white/[0.06]">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("workspace.searchCreator")}
                  className="w-full pl-8 pr-3 py-1.5 bg-white/[0.04] border border-white/[0.06] rounded-md text-xs text-white placeholder-zinc-600 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="max-h-[280px] overflow-y-auto py-1">
            {/* "All" option */}
            <button
              onClick={() => { setCreator(null); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-white/[0.06] transition-colors"
            >
              <Users className="w-5 h-5 text-zinc-500 shrink-0" />
              <span className="flex-1 text-left text-zinc-300">{t("workspace.allCreators")}</span>
              {creator === null && <Check className="w-3.5 h-3.5 text-white shrink-0" />}
            </button>

            {/* Separator */}
            <div className="border-t border-white/[0.06] my-1" />

            {/* Creator list */}
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => { setCreator(c); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-white/[0.06] transition-colors"
              >
                {c.thumbnail ? (
                  <img src={c.thumbnail} alt="" className="w-5 h-5 rounded-full shrink-0 object-cover" />
                ) : (
                  <div className="w-5 h-5 rounded-full shrink-0 bg-white/[0.08] flex items-center justify-center">
                    <Users className="w-3 h-3 text-zinc-500" />
                  </div>
                )}
                <span className="flex-1 text-left text-zinc-300 truncate">{c.display_name}</span>
                {creator?.id === c.id && <Check className="w-3.5 h-3.5 text-white shrink-0" />}
              </button>
            ))}

            {filtered.length === 0 && search && (
              <p className="px-3 py-2 text-xs text-zinc-600">{t("common.noResults")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
