import { BrowserRouter, Routes, Route } from "react-router";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import JobPage from "./pages/JobPage";
import EditPageOld from "./pages/EditPage";
import EditPage from "./pages/RemotionEditPage";
import ExportsPage from "./pages/ExportsPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="exports" element={<ExportsPage />} />
          <Route path=":jobId" element={<JobPage />} />
        </Route>
        {/* Edit page: fullscreen, outside the standard layout */}
        <Route path=":jobId/edit-old" element={<EditPageOld />} />
        <Route path=":jobId/edit" element={<EditPage />} />
      </Routes>
    </BrowserRouter>
  );
}
