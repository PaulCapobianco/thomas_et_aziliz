// Light / dark theme. Loaded as a blocking script in <head>, before the stylesheets, so the right theme is set
// before the first paint (no flash). Default: the phone's setting; a choice made with the button is remembered in
// localStorage (kept in memory when storage is blocked) and never sent to the site.
(() => {
  const KEY = "wk_theme";
  const root = document.documentElement;
  const dark = matchMedia("(prefers-color-scheme: dark)");
  let memory = null;
  const stored = () => {
    try {
      const value = localStorage.getItem(KEY);
      return value === "dark" || value === "light" ? value : memory;
    } catch {
      return memory;
    }
  };
  const current = () => stored() || (dark.matches ? "dark" : "light");
  function apply(theme) {
    root.dataset.theme = theme;
    document.getElementById("theme-toggle")?.setAttribute("aria-pressed", String(theme === "dark"));
  }
  apply(current());
  // Without an explicit choice, follow the phone when its setting changes (evening mode, for example).
  dark.addEventListener?.("change", () => {
    if (!stored()) apply(current());
  });
  document.addEventListener("DOMContentLoaded", () => {
    const button = document.getElementById("theme-toggle");
    if (!button) return;
    apply(current());
    button.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      memory = next;
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* The choice stays in memory for this page. */
      }
      apply(next);
    });
  });
})();
