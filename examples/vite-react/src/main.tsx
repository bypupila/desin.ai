import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { initDesinInspector } from "@desin-ai/inspector";
import { createProjectStorage } from "@desin-ai/inspector-vite/client";
import { getReactSourceInfo } from "@desin-ai/inspector-react";

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
