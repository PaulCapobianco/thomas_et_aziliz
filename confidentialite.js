// Fills the contact address from config.js (PRIVACY_EMAIL). Nothing is invented: while it is empty the page keeps its fallback text.
// Namespace import: a config.js without this constant (older copy, test mock) must not break the page.
import * as config from "./config.js";

const PRIVACY_EMAIL = String(config.PRIVACY_EMAIL ?? "");
if (/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(PRIVACY_EMAIL)) {
  for (const node of document.querySelectorAll("[data-contact]")) {
    const link = document.createElement("a");
    link.href = `mailto:${PRIVACY_EMAIL}`;
    link.textContent = PRIVACY_EMAIL;
    node.replaceChildren(link);
  }
}
