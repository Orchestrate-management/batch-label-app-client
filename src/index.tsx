import "./index.css";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { installErrorSink } from "./lib/error-sink";
import { listenForUncaughtErrors } from "./lib/global-errors";

/**
 * Before React, because an error thrown while React is booting is exactly the kind this
 * catches and the kind nobody would otherwise ever see.
 *
 * This installs listeners only. Every report they file goes through the same
 * lib/report-error.ts seam every other call site uses.
 */
listenForUncaughtErrors(window);

/**
 * And where that seam points, which is the whole of entry 6 in docs/PRODUCTION_TODO.md.
 *
 * One line, no call site moved. With VITE_SENTRY_DSN unset this installs nothing at all and
 * reports stay on the maker's own console — see lib/error-sink.ts, and lib/scrub-report.ts
 * for the allow-list that decides what a third party is ever told.
 *
 * Not awaited: the vendor is fetched off the critical path and the app does not wait for
 * telemetry to boot. It cannot reject.
 */
void installErrorSink();

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<App />);
}
