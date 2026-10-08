import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { CreatorWorkspaceProvider } from "./lib/CreatorWorkspaceContext";
import { TransmitProvider } from "./lib/TransmitContext";
import { TooltipProvider } from "./components/ui/Tooltip";
import { ToastProvider } from "./components/Toast";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectPage from "./pages/ProjectPage";
import MontagePage from "./pages/MontagePage";
import ExportStepPage from "./pages/ExportStepPage";
import EditPageOld from "./pages/EditPage";
import EditPage from "./pages/RemotionEditPage";
import ExportsPage from "./pages/ExportsPage";
import LoginPage from "./pages/LoginPage";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
import { SettingsProvider, useSettings } from "./lib/SettingsContext";
import { BackdropProvider } from "./lib/BackdropContext";
import { ChannelProvider } from "./lib/ChannelContext";
import ChannelPage from "./pages/ChannelPage";
import GamesPage from "./pages/GamesPage";
import CreatorsPage from "./pages/CreatorsPage";
import WorkersPage from "./pages/WorkersPage";
import WelcomePage from "./pages/WelcomePage";
import TemplateEditorPage from "./pages/TemplateEditorPage";
import type { ReactNode } from "react";

function Splash() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-ground">
      <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/** First launch: channel, keys and webcam before anything else */
function RequireOnboarding({ children }: { children: ReactNode }) {
  const { settings, loaded } = useSettings();

  if (!loaded) return <Splash />;
  if (settings && !settings.onboarded) return <Navigate to="/bienvenue" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/bienvenue"
        element={
          <ProtectedRoute>
            <WelcomePage />
          </ProtectedRoute>
        }
      />
      <Route
        element={
          <ProtectedRoute>
            <RequireOnboarding>
              <Layout />
            </RequireOnboarding>
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
        <Route path="settings" element={<SettingsPage />} />
        <Route path="chaine" element={<ChannelPage />} />
        <Route path="modeles/:id" element={<TemplateEditorPage />} />
        <Route path=":jobId" element={<ProjectPage />} />
        <Route path=":jobId/montage" element={<MontagePage />} />
        <Route path=":jobId/export" element={<ExportStepPage />} />
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
      <SettingsProvider>
      <TransmitProvider>
        <TooltipProvider>
          <ToastProvider>
            <BackdropProvider>
              <ChannelProvider>
                <BrowserRouter>
                  <CreatorWorkspaceProvider>
                    <AppRoutes />
                  </CreatorWorkspaceProvider>
                </BrowserRouter>
              </ChannelProvider>
            </BackdropProvider>
          </ToastProvider>
        </TooltipProvider>
      </TransmitProvider>
      </SettingsProvider>
    </AuthProvider>
  );
}
