import React from "react";
import { createRoot } from "react-dom/client";
// B612, drawn by Airbus for cockpit displays, packaged with the app so no font comes from the internet.
// @spec APP-UI-025
import "@fontsource/b612/400.css";
import "@fontsource/b612/700.css";
import "@fontsource/b612-mono/400.css";
import "@fontsource/b612-mono/700.css";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
