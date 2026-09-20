import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./index.css";

const THEME_KEY = "octopus.theme";
const themePreference = localStorage.getItem(THEME_KEY);
const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const shouldUseDarkTheme =
  themePreference === "light" ? false : themePreference === "system" ? systemPrefersDark : true;
document.documentElement.classList.toggle("dark", shouldUseDarkTheme);
document.documentElement.style.colorScheme = shouldUseDarkTheme ? "dark" : "light";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider>
      <App />
      <Toaster />
    </TooltipProvider>
  </React.StrictMode>,
);
