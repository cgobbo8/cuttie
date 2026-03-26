import { BrowserRouter, Routes, Route } from "react-router";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import JobPage from "./pages/JobPage";
import EditPage from "./pages/EditPage";
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
        <Route path=":jobId/edit" element={<EditPage />} />
      </Routes>
    </BrowserRouter>
  );
}
