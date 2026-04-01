import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { CreatorWorkspaceProvider } from "./lib/CreatorWorkspaceContext";
import { TransmitProvider } from "./lib/TransmitContext";
import { TooltipProvider } from "./components/ui/Tooltip";
import { ToastProvider } from "./components/Toast";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import ProjectsPage from "./pages/ProjectsPage";
import JobPage from "./pages/JobPage";
import EditPageOld from "./pages/EditPage";
import EditPage from "./pages/RemotionEditPage";
import ExportsPage from "./pages/ExportsPage";
import LoginPage from "./pages/LoginPage";
import ProfilePage from "./pages/ProfilePage";
import GamesPage from "./pages/GamesPage";
import CreatorsPage from "./pages/CreatorsPage";
import WorkersPage from "./pages/WorkersPage";
import type { ReactNode } from "react";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
        <div className="w-5 h-5 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="games" element={<GamesPage />} />
        <Route path="creators" element={<CreatorsPage />} />
        <Route path="exports" element={<ExportsPage />} />
        <Route path="workers" element={<WorkersPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path=":jobId" element={<JobPage />} />
      </Route>
      {/* Edit pages: fullscreen, outside the standard layout */}
      <Route
        path=":jobId/edit-old"
        element={
          <ProtectedRoute>
            <EditPageOld />
          </ProtectedRoute>
        }
      />
      <Route
        path=":jobId/edit"
        element={
          <ProtectedRoute>
            <EditPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <TransmitProvider>
        <TooltipProvider>
          <ToastProvider>
            <BrowserRouter>
              <CreatorWorkspaceProvider>
                <AppRoutes />
              </CreatorWorkspaceProvider>
            </BrowserRouter>
          </ToastProvider>
        </TooltipProvider>
      </TransmitProvider>
    </AuthProvider>
  );
}
