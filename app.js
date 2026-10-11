import { NAMES, DATE_TXT, SECRET, LOCATION, COUPLE_PHOTO } from "./config.js";
import {
  $,
  el,
  createClient,
  rpc,
  signPhotos,
  fullUrl,
  browserId,
  bindDialog,
} from "./shared.js";
import { setupUploads } from "./uploads.js";
const sb = createClient();
if (NAMES) {
  $("names").textContent = NAMES;
}
$("date").textContent = DATE_TXT;
if (LOCATION) {
  $("location").textContent = LOCATION;
  $("location").hidden = false;
}
if (COUPLE_PHOTO) {
  document.querySelector(".hero-photo").src = COUPLE_PHOTO;
}
let allowed = true;
const key = new URLSearchParams(location.search).get("k");
let savedKey = key;
try {
  if (key) localStorage.setItem("wk", key);
  savedKey ||= localStorage.getItem("wk");
} catch {
  /* QR remains usable without storage. */
}
if (SECRET && savedKey !== SECRET) {
  allowed = false;
  $("main").hidden = true;
  $("locked").hidden = false;
}
let rows = [],
  cursor = null,
  busy = false,
  refreshQueued = false,
  forceSign = false,
  loaded = false,
  loadFailures = 0,
  lastResign = 0,
  lastRefresh = 0,
  activeIndex = 0,
  lightboxRequest = 0,
  returnFocusId;
const galleryWaiters = [];
let navigating = false;
let savedScroll;
let backgroundNodes = [];
let uploads;
const frame = $("photo-frame");
const viewport = document.querySelector(".photo-viewport");
function sizePhotoFrame() {
  const ratio = frame.dataset.orientation === "portrait" ? 2 / 3 : 3 / 2;
  const width = Math.min(viewport.clientWidth, viewport.clientHeight * ratio);
  frame.style.width = `${width}px`;
  frame.style.height = `${width / ratio}px`;
}
function orientPhoto(image) {
  if (!image.naturalWidth || !image.naturalHeight) return;
  frame.dataset.orientation = image.naturalWidth < image.naturalHeight ? "portrait" : "landscape";
  sizePhotoFrame();
}
new ResizeObserver(sizePhotoFrame).observe(viewport);
function lockBackground() {
  savedScroll = { x: window.scrollX, y: window.scrollY };
  backgroundNodes = [...document.body.children].filter(
    (node) => !node.matches("dialog, script") && !node.inert,
  );
  backgroundNodes.forEach((node) => { node.inert = true; });
  document.documentElement.style.setProperty("--page-scroll-top", `${-savedScroll.y}px`);
  document.documentElement.classList.add("photo-modal-open");
}
function unlockBackground() {
  const root = document.documentElement;
  const behavior = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
  root.classList.remove("photo-modal-open");
  root.style.removeProperty("--page-scroll-top");
  backgroundNodes.forEach((node) => { node.inert = false; });
  backgroundNodes = [];
  if (savedScroll) window.scrollTo(savedScroll.x, savedScroll.y);
  root.style.scrollBehavior = behavior;
  savedScroll = null;
}
let wasShare = false;
function route(focus = false) {
  const share = location.hash === "#partager";
  // Arriving on the share page by any path starts again from the destination choice.
  if (share && !wasShare) uploads?.startSharing();
  wasShare = share;
  const activeRoute = share
    ? "partager"
    : location.hash === "#souvenirs"
      ? "souvenirs"
      : "galerie";
  // The floating action only helps on the gallery view; it never covers the share form.
  $("fab-bar").hidden = share || !allowed || !sb;
  document.body.classList.toggle("has-fab", !share && allowed && !!sb);
  $("gallery-view").hidden = share;
  $("share-view").hidden = !share;
  document
    .querySelectorAll("[data-route]")
    .forEach((link) =>
      link.dataset.route === activeRoute
        ? link.setAttribute("aria-current", "page")
        : link.removeAttribute("aria-current"),
    );
  document.title = `${share ? "Partager des photos" : "Les photos de notre mariage"} — ${NAMES || "Thomas & Aziliz"}`;
  if (focus && allowed) {
    if (share) $("share-title").focus();
    else $("main").focus();
    window.scrollTo(0, 0);
  }
  // The anchor can be hidden when arriving from the share screen.
  if (activeRoute === "souvenirs" && allowed) $("souvenirs").scrollIntoView();
}
// One gesture: a tap on "Ajouter mes photos" opens the photo chooser straight away. The link still navigates
// to the share page (where the same button remains if the browser refuses to open the chooser).
// Avoid two identical buttons on the first screen: the floating bar appears once the hero button scrolls away.
if ("IntersectionObserver" in window)
  new IntersectionObserver(([entry]) =>
    $("fab-bar").classList.toggle("is-quiet", entry.isIntersecting),
  ).observe(document.querySelector(".hero-cta"));
// Every "share" entry point (hero button, floating bar, menu link) leads to the same first step: the destination
// choice. None of them opens the file chooser; that only happens from a destination card.
document.querySelectorAll("[data-pick], [data-route=partager]").forEach((link) =>
  link.addEventListener("click", () => {
    uploads?.startSharing();
    if (!link.matches("[data-pick]") || !sb || !allowed) return;
    location.hash = "#partager";
    route(true);
  }),
);
window.addEventListener("hashchange", () =>
  route(location.hash !== "#souvenirs"),
);
route();
function renderGallery() {
  const focusedId = document.activeElement?.dataset.photoId;
  $("gallery").replaceChildren();
  if (!rows.length && !loaded) {
    // Never claim the album is empty before the first successful answer (or after a failed one).
    const wait = el("div", undefined, "empty");
    wait.append(
      el("h3", loadFailures ? "Les souvenirs n’ont pas pu être chargés." : "Chargement des souvenirs…"),
      el(
        "p",
        loadFailures
          ? "Nouvelle tentative en cours. Vous pouvez aussi appuyer sur « Actualiser »."
          : "Quelques secondes…",
      ),
    );
    $("gallery").append(wait);
    return;
  }
  if (!rows.length) {
    const empty = el("div", undefined, "empty");
    empty.append(
      el("span", "✧", "empty-symbol"),
      el("h3", "Le premier souvenir sera le vôtre."),
      el(
        "p",
        "La galerie est encore vide. Soyez les premiers à partager un souvenir.",
      ),
    );
    $("gallery").append(empty);
    return;
  }
  rows.forEach((row, index) => {
    const button = el("button", undefined, "photo-card");
    button.dataset.photoId = row.id;
    button.setAttribute("aria-label", `Ouvrir la photo ${index + 1}`);
    const img = el("img");
    img.src = row.thumbUrl;
    img.alt = "Souvenir partagé du mariage";
    img.width = 400;
    img.height = 500;
    img.loading = "lazy";
    img.decoding = "async";
    img.onerror = () => {
      button.setAttribute(
        "aria-label",
        "Photo indisponible, actualisez la galerie",
      );
      img.hidden = true;
      // Most likely an expired or refused signature: ask for fresh ones, at most every 20 seconds.
      if (Date.now() - lastResign > 20000) {
        lastResign = Date.now();
        forceSign = true;
        loadGallery();
      }
    };
    button.append(img);
    button.onclick = () => openPhoto(index);
    $("gallery").append(button);
  });
  if (focusedId)
    [...$("gallery").children]
      .find((node) => node.dataset.photoId === focusedId)
      ?.focus({ preventScroll: true });
}
// A signed URL stays valid for an hour: keep the one of a photo already on screen so a refresh does not
// re-download every thumbnail (new signatures mean new URLs, which bypass the browser cache).
const SIGNATURE_REUSE_MS = 45 * 60000;
async function signNewRows(page) {
  const known = new Map(rows.map((row) => [row.id, row]));
  const reusable = (row) => {
    const old = known.get(row.id);
    return !forceSign && old?.thumbUrl && Date.now() - old.signedAt < SIGNATURE_REUSE_MS
      ? old
      : null;
  };
  const signed = new Map(
    (await signPhotos(sb, page.filter((row) => !reusable(row)))).map((row) => [
      row.id,
      { ...row, signedAt: Date.now() },
    ]),
  );
  return page.flatMap((row) => {
    const old = reusable(row);
    return old
      ? [{ ...row, thumbUrl: old.thumbUrl, signedAt: old.signedAt }]
      : signed.has(row.id)
        ? [signed.get(row.id)]
        : [];
  });
}
async function loadGallery(more = false) {
  if (!sb || !allowed) return;
  if (busy) {
    // A refresh asked while another one runs (typically right after an upload) must not be lost.
    if (!more) refreshQueued = true;
    await new Promise((resolve) => galleryWaiters.push(resolve));
    if (more) return loadGallery(true);
    return;
  }
  busy = true;
  $("refresh").disabled = $("more").disabled = true;
  try {
    // Refresh the loaded window, not just page 1: removes hidden photos further down too.
    const target = more ? 48 : Math.max(48, Math.ceil(rows.length / 48) * 48);
    let fetched = [],
      before = more ? cursor : null,
      lastPage;
    do {
      lastPage = await rpc(sb, "gallery_page", {
        p_limit: 48,
        p_before_published: before?.published_at ?? null,
        p_before_id: before?.id ?? null,
      });
      fetched.push(...(await signNewRows(lastPage)));
      before = lastPage.at(-1) || before;
    } while (!more && lastPage.length === 48 && fetched.length < target);
    const currentId = rows[activeIndex]?.id;
    rows = [
      ...new Map(
        (more ? [...rows, ...fetched] : fetched).map((row) => [row.id, row]),
      ).values(),
    ];
    cursor = before;
    $("more").hidden = lastPage.length !== 48;
    lastRefresh = Date.now();
    loaded = true;
    loadFailures = 0;
    forceSign = false;
    $("gallery-status").textContent = "";
    renderGallery();
    if ($("lightbox").open) {
      const index = rows.findIndex((row) => row.id === currentId);
      if (index < 0) {
        $("lightbox").close();
        $("gallery-status").textContent = "Cette photo n’est plus disponible.";
      } else {
        activeIndex = index;
        updatePosition();
      }
    }
  } catch {
    // Photos already on screen stay on screen: only the message changes.
    loadFailures++;
    $("gallery-status").textContent =
      "Impossible de charger les photos pour le moment. Vérifiez votre connexion et réessayez.";
    if (!loaded) renderGallery();
    if (!loaded && loadFailures <= 3) setTimeout(() => loadGallery(), 5000);
  } finally {
    busy = false;
    galleryWaiters.splice(0).forEach((resolve) => resolve());
    $("refresh").disabled = $("more").disabled = false;
    if (refreshQueued) {
      refreshQueued = false;
      loadGallery();
    }
  }
}
$("refresh").onclick = () => loadGallery();
$("more").onclick = () => loadGallery(true);
setInterval(() => {
  if (
    !document.hidden &&
    location.hash !== "#partager" &&
    !$("report-dialog").open
  )
    loadGallery();
}, 60000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - lastRefresh > 30 * 60000) loadGallery();
});
function updatePosition() {
  const focused = document.activeElement;
  $("photo-position").textContent = `${activeIndex + 1} / ${rows.length}`;
  $("previous").disabled = activeIndex === 0;
  $("next").disabled = navigating || (activeIndex === rows.length - 1 && $("more").hidden);
  // Chromium drops focus from a newly disabled button, losing dialog keyboard events.
  if ($("lightbox").open && focused?.disabled && $("lightbox").contains(focused)) {
    $("close-lightbox").focus({ preventScroll: true });
  }
}
async function openPhoto(index) {
  if (!rows[index]) return;
  activeIndex = index;
  const request = ++lightboxRequest;
  const dialog = $("lightbox");
  if (!dialog.open) {
    returnFocusId = rows[index].id;
    lockBackground();
    dialog.showModal();
  }
  // Show the already loaded thumbnail at once, then swap in the full-resolution file when it has been decoded.
  $("full-photo").onerror = null;
  $("full-photo").onload = () => {
    if (request === lightboxRequest) orientPhoto($("full-photo"));
  };
  $("full-photo").src = rows[index].thumbUrl;
  $("full-photo").hidden = false;
  orientPhoto($("full-photo"));
  sizePhotoFrame();
  $("lightbox-status").textContent = "Chargement en haute définition…";
  updatePosition();
  try {
    const url = await fullUrl(sb, rows[index]);
    if (request !== lightboxRequest || !dialog.open) return;
    const loader = new Image();
    loader.onload = () => {
      if (request !== lightboxRequest) return;
      orientPhoto(loader);
      $("full-photo").src = url;
      $("lightbox-status").textContent = "";
    };
    loader.onerror = () => {
      if (request !== lightboxRequest) return;
      $("full-photo").hidden = true;
      $("lightbox-status").textContent =
        "Cette photo n’est plus disponible. Actualisez la galerie.";
    };
    loader.src = url;
  } catch {
    if (request === lightboxRequest) {
      $("full-photo").hidden = true;
      $("lightbox-status").textContent =
        "Cette photo n’est plus disponible. Actualisez la galerie.";
    }
  }
}
bindDialog($("lightbox"), $("close-lightbox"));
bindDialog($("report-dialog"), $("report-cancel"));
$("lightbox").addEventListener("close", () => {
  lightboxRequest++;
  $("full-photo").removeAttribute("src");
  $("full-photo").hidden = true;
  unlockBackground();
  const opener = [...$("gallery").children].find(
    (node) => node.dataset.photoId === returnFocusId,
  );
  (opener || $("refresh")).focus({ preventScroll: true });
});
async function movePhoto(delta) {
  if (rows[activeIndex + delta]) return openPhoto(activeIndex + delta);
  if (delta < 0 || navigating || $("more").hidden) return;
  const currentId = rows[activeIndex]?.id;
  const request = lightboxRequest;
  navigating = true;
  $("lightbox-status").textContent = "Chargement des photos suivantes…";
  updatePosition();
  try {
    await loadGallery(true);
    if (!$("lightbox").open || request !== lightboxRequest) return;
    const index = rows.findIndex((row) => row.id === currentId);
    if (index >= 0 && rows[index + 1]) await openPhoto(index + 1);
    else $("lightbox-status").textContent = $("more").hidden
      ? "Vous avez vu toutes les photos."
      : "Chargement interrompu. Réessayez avec la flèche suivante.";
  } finally {
    navigating = false;
    updatePosition();
  }
}
$("previous").onclick = () => movePhoto(-1);
$("next").onclick = () => movePhoto(1);
$("lightbox").addEventListener("keydown", (event) => {
  if ($("report-dialog").open) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    movePhoto(event.key === "ArrowLeft" ? -1 : 1);
  }
});
let touchStart;
$("full-photo").addEventListener(
  "touchstart",
  (event) => {
    touchStart =
      event.touches.length === 1 && (window.visualViewport?.scale ?? 1) <= 1
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
        : null;
  },
  { passive: true },
);
$("full-photo").addEventListener("touchmove", (event) => {
  if (event.touches.length !== 1) touchStart = null;
}, { passive: true });
$("full-photo").addEventListener(
  "touchend",
  (event) => {
    if (!touchStart) return;
    const dx = event.changedTouches[0].clientX - touchStart.x,
      dy = event.changedTouches[0].clientY - touchStart.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy))
      movePhoto(dx < 0 ? 1 : -1);
    touchStart = null;
  },
  { passive: true },
);
$("download").onclick = async () => {
  $("download").disabled = true;
  try {
    const a = el("a");
    a.href = await fullUrl(sb, rows[activeIndex], true);
    a.download = "photo-mariage.jpg";
    document.body.append(a);
    a.click();
    a.remove();
  } catch {
    $("lightbox-status").textContent =
      "Téléchargement indisponible. Réessayez.";
  } finally {
    $("download").disabled = false;
  }
};
$("report-open").onclick = () => {
  $("report-status").textContent = "";
  $("report-dialog").showModal();
};
$("report-form").onsubmit = async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const { result } = await rpc(sb, "report_photo", {
      p_photo_id: rows[activeIndex].id,
      p_reporter: browserId(),
      p_reason: $("report-reason").value,
    });
    const messages = {
      reported: "Merci, votre signalement a été envoyé.",
      already_reported: "Vous avez déjà signalé cette photo.",
      not_found: "Cette photo n’est plus disponible.",
      rate_limited:
        "Trop de signalements en peu de temps, réessayez dans quelques minutes.",
    };
    $("report-status").textContent =
      messages[result] || "Une erreur est survenue, réessayez.";
    if (["reported", "not_found"].includes(result)) {
      $("report-dialog").close();
      $("lightbox").close();
      await loadGallery();
      $("gallery-status").textContent = messages[result];
    }
  } catch {
    $("report-status").textContent = "Une erreur est survenue, réessayez.";
  } finally {
    button.disabled = false;
  }
};
uploads = setupUploads(allowed ? sb : null, () => loadGallery());
if (!sb) loaded = true;
renderGallery();
if (!sb)
  $("gallery-status").textContent =
    "L’album se prépare. Les photos et les envois seront disponibles prochainement.";
else loadGallery();
