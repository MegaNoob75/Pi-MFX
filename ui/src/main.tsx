import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { blockNativeBrowserChrome } from "./blockNativeChrome";
import { isKioskDisplay } from "./keyboard/mode";
import "./index.css";

if (isKioskDisplay()) {
    document.documentElement.setAttribute("data-mfx-kiosk", "true");
}

blockNativeBrowserChrome();

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
