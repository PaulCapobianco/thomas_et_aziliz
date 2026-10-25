import { SUPABASE_URL, SUPABASE_KEY, BUCKET } from "./config.js";
export const $ = (id) => document.getElementById(id);
export const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
export function createClient(admin = false) {
  // Public browsing never inherits an administrator's session.
  if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_KEY.startsWith("sb_secret_"))
    return null;
  try {
    if (
      SUPABASE_KEY.split(".").length === 3 &&
      JSON.parse(atob(SUPABASE_KEY.split(".")[1])).role === "service_role"
    )
      return null;
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: admin,
        autoRefreshToken: admin,
        detectSessionInUrl: false,
        storage: admin ? safeSessionStorage() : undefined,
        storageKey: "wedding-admin",
      },
      global: {
        fetch: (url, options) =>
          fetch(url, {
            ...options,
            signal: options?.signal ?? AbortSignal.timeout(45000),
          }),
      },
    });
  } catch {
    return null;
  }
}
function safeSessionStorage() {
  const memory = new Map();
  return {
    getItem: (key) => {
      try {
        return sessionStorage.getItem(key);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem: (key, value) => {
      try {
        sessionStorage.setItem(key, value);
      } catch {
        memory.set(key, value);
      }
    },
    removeItem: (key) => {
      try {
        sessionStorage.removeItem(key);
      } catch {
        memory.delete(key);
      }
    },
  };
}
let identity;
export function browserId() {
  if (identity) return identity;
  try {
    identity = localStorage.getItem("wk_uid");
  } catch {
    /* Storage can be disabled. */
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      identity || "",
    )
  )
    identity = crypto.randomUUID();
  try {
    localStorage.setItem("wk_uid", identity);
  } catch {
    /* Keep the in-memory identity. */
  }
  return identity;
}
export function unwrap(response) {
  if (response.error) throw response.error;
  return response.data;
}
export async function rpc(sb, name, params) {
  return unwrap(await sb.rpc(name, params));
}
export function storage(sb) {
  return sb.storage.from(BUCKET);
}
export function safeUrl(value) {
  const url = new URL(value, location.href);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    (url.protocol === "http:" && url.origin !== location.origin)
  )
    throw new Error("invalid_url");
  return url.href;
}
export async function signPhotos(sb, rows) {
  if (!rows.length) return [];
  const signed = unwrap(
    await storage(sb).createSignedUrls(
      rows.map((row) => row.thumb_path),
      3600,
    ),
  );
  return rows.flatMap((row, i) =>
    signed[i]?.signedUrl
      ? [{ ...row, thumbUrl: safeUrl(signed[i].signedUrl) }]
      : [],
  );
}
// `download` is false, true (generic name, used by the admin) or the file name to impose through the
// signed URL: Storage then answers with Content-Disposition: attachment; filename="…".
export async function fullUrl(sb, row, download = false) {
  const data = unwrap(
    await storage(sb).createSignedUrl(
      row.full_path,
      3600,
      download
        ? { download: typeof download === "string" ? download : "photo-mariage.jpg" }
        : undefined,
    ),
  );
  return safeUrl(data.signedUrl);
}
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
// "31 octobre 2026" -> "311026"; unreadable text falls back to the wedding date.
export function compactDate(text) {
  const match = /(\d{1,2})\s+(\p{L}+)\s+(\d{4})/u.exec(String(text || "").toLowerCase());
  const month = match ? MONTHS.indexOf(match[2]) + 1 : 0;
  if (!month) return "311026";
  return `${match[1].padStart(2, "0")}${String(month).padStart(2, "0")}${match[3].slice(-2)}`;
}
// "Thomas & Aziliz" -> "Thomas-Aziliz": no "&", no accent, no space.
export function compactNames(text) {
  const words = String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .match(/[A-Za-z0-9]+/g);
  return words?.join("-") || "Thomas-Aziliz";
}
export function downloadName(names, dateText, number) {
  return `photo_mariage_${compactNames(names)}_${compactDate(dateText)}_${String(number).padStart(2, "0")}.jpg`;
}
// Per-tab counter (sessionStorage survives a reload; falls back to memory when storage is blocked).
const DOWNLOAD_COUNT_KEY = "wk_downloads";
let memoryCount = 0;
export function peekDownloadCount() {
  try {
    const stored = Number.parseInt(sessionStorage.getItem(DOWNLOAD_COUNT_KEY), 10);
    return Number.isInteger(stored) && stored >= 0 ? Math.max(stored, memoryCount) : memoryCount;
  } catch {
    return memoryCount;
  }
}
export function commitDownloadCount(count) {
  memoryCount = count;
  try {
    sessionStorage.setItem(DOWNLOAD_COUNT_KEY, String(count));
  } catch {
    // Memory copy above keeps the numbering going for this page load.
  }
}
export function errorText(error) {
  if (error?.userMessage) return error.userMessage;
  if (
    error?.code === "42501" ||
    ["401", "403"].includes(String(error?.status || error?.statusCode))
  )
    return "Accès refusé. Vérifiez votre connexion ou contactez les organisateurs.";
  if (error?.code === "rate_limited")
    return "Trop de photos envoyées, réessayez plus tard";
  if (error?.code === "22023" || error?.statusCode === "413")
    return "Photo refusée : vérifiez le format et la taille.";
  return "Connexion interrompue ou service indisponible. Vérifiez votre connexion et réessayez.";
}
export function userError(message) {
  return Object.assign(new Error(message), { userMessage: message });
}
export function bindDialog(dialog, closeButton) {
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !dialog.open) return;
    const controls = [
      ...dialog.querySelectorAll(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]',
      ),
    ].filter((node) => node.getClientRects().length);
    const first = controls[0],
      last = controls.at(-1);
    if (!first) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  closeButton?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  });
}
