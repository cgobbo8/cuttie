import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./lib/i18n";
import "./app.css";
import App from "./App";
import { watchClientErrors } from "./lib/clientErrors";

watchClientErrors();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
