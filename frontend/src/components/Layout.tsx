import { Outlet, Link } from "react-router";

export default function Layout() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background ambient blobs */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-purple-500/[0.04] blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-blue-500/[0.03] blur-[120px]" />
        <div className="absolute top-[40%] right-[20%] w-[400px] h-[400px] rounded-full bg-pink-500/[0.02] blur-[100px]" />
      </div>

      {/* Header */}
      <header className="border-b border-white/[0.04] py-5">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <Link to="/" className="group flex items-center gap-3">
            <span className="text-2xl font-extrabold tracking-tight text-white group-hover:text-purple-400 transition-colors">
              Cuttie
            </span>
            <span className="text-sm text-zinc-600 font-medium hidden sm:inline">
              Twitch VOD Clip Finder
            </span>
          </Link>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto px-6 py-12">
        <Outlet />
      </main>
    </div>
  );
}
