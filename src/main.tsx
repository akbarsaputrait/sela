import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App, { route } from "./App.tsx"
import { DebugPanel } from "@/components/debug-panel.tsx"
import { ExternalLinkGuard } from "@/components/external-link-guard.tsx"

const currentWindow = route()

document.documentElement.dataset.window = currentWindow

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ExternalLinkGuard />
    {import.meta.env.DEV && currentWindow === "main" ? <DebugPanel /> : null}
    <div data-ui-scroll-container={currentWindow === "main" ? "" : undefined}>
      <App />
    </div>
  </StrictMode>
)
