import { createRoot } from "react-dom/client";
import { getActiveAdapter } from "../lib/site-adapters";
import { sendToBackground } from "../lib/messages";
import { ContentApp } from "./ContentApp";
import { SHADOW_STYLES } from "./shadow-styles";

async function main() {
  const adapter = getActiveAdapter(location.href);
  if (!adapter) return;

  const { connected } = await sendToBackground<{ connected: boolean }>({ type: "GET_CONNECTION_STATE" });
  if (!connected) return; // nothing to show on an unpaired page

  const host = document.createElement("div");
  host.id = "ai-memory-extension-root";
  document.body.appendChild(host);

  // Closed ShadowRoot: the host page's own scripts cannot inspect or restyle this UI, and this
  // UI's styles never leak into the host page either (manifest/vite config comments).
  const shadowRoot = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = SHADOW_STYLES;
  shadowRoot.appendChild(style);

  const mountPoint = document.createElement("div");
  shadowRoot.appendChild(mountPoint);

  createRoot(mountPoint).render(<ContentApp adapter={adapter} />);
}

main();
