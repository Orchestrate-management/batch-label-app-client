import "./index.css";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { listenForUncaughtErrors } from "./lib/global-errors";

/**
 * Before React, because an error thrown while React is booting is exactly the kind this
 * catches and the kind nobody would otherwise ever see.
 *
 * This installs listeners only. Reports go where they have always gone — the maker's own
 * console, via lib/report-error.ts — and choosing a destination is entry 6 in
 * docs/PRODUCTION_TODO.md, which is nobody's decision to make in passing.
 */
listenForUncaughtErrors(window);

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<App />);
}
