import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { initDesinInspector } from "@design-bypupila/inspector";
import { createProjectStorage } from "@design-bypupila/inspector/vite/client";
import { getReactSourceInfo } from "@design-bypupila/inspector/react";

if (import.meta.env.DEV) {
  initDesinInspector({
    framework: "react",
    storage: createProjectStorage(),
    sourceResolver: getReactSourceInfo,
  });
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
