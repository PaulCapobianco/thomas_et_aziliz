// Burger menu under 768 px (guest pages). A blocking script in <head>: the class below hides the links before the
// first paint, so the header never flashes its desktop layout. Without JavaScript the links simply stay visible.
(() => {
  const root = document.documentElement;
  root.classList.add("menu-js");
  const narrow = matchMedia("(max-width: 767px)");
  document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.getElementById("menu-toggle");
    const menu = document.getElementById("site-menu");
    if (!toggle || !menu) return;
    const backdrop = document.createElement("div");
    backdrop.className = "menu-backdrop";
    document.body.append(backdrop);
    const isOpen = () => toggle.getAttribute("aria-expanded") === "true";
    function set(open, focus = false) {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
      menu.classList.toggle("is-open", open);
      document.body.classList.toggle("menu-open", open);
      if (!open && focus) toggle.focus();
    }
    toggle.addEventListener("click", () => set(!isOpen()));
    backdrop.addEventListener("click", () => set(false));
    // A tap on a link closes the menu; the link itself keeps working (same page hash or another page).
    menu.addEventListener("click", (event) => event.target.closest("a") && set(false));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isOpen()) set(false, true);
    });
    // Widening the window (rotation, desktop) leaves nothing stuck open or locked.
    narrow.addEventListener?.("change", () => !narrow.matches && set(false));
  });
})();
