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
  $("hero-kicker").textContent = "LE MARIAGE DE";
  $("private-names").textContent = `à ${NAMES}`;
}
$("date").textContent = DATE_TXT;
if (LOCATION) {
  $("location").textContent = LOCATION;
  $("location").hidden = false;
}
if (COUPLE_PHOTO) {
  const img = new Image();
  img.alt = "";
  img.className = "hero-photo";
  img.onload = () => {
    document.querySelector(".hero").prepend(img);
    document.querySelector(".hero").classList.add("has-photo");
  };
  img.src = COUPLE_PHOTO;
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
  lastRefresh = 0,
  activeIndex = 0,
  lightboxRequest = 0,
  returnFocusId;
function route(focus = false) {
  const share = location.hash === "#partager";
  // The floating action only helps on the gallery view; it never covers the share form.
  $("fab-bar").hidden = share || !allowed || !sb;
  document.body.classList.toggle("has-fab", !share && allowed && !!sb);
  $("gallery-view").hidden = share;
  $("share-view").hidden = !share;
  document
    .querySelectorAll("[data-route]")
    .forEach((link) =>
      share === (link.dataset.route === "partager")
        ? link.setAttribute("aria-current", "page")
        : link.removeAttribute("aria-current"),
    );
  document.title = `${share ? "Partager vos souvenirs" : "Nos souvenirs"} — ${NAMES || "Mariage du 31 octobre 2026"}`;
  if (focus && allowed) {
    if (share) $("share-title").focus();
    else $("main").focus();
    window.scrollTo(0, 0);
  }
}
// One gesture: a tap on "Ajouter mes photos" opens the photo chooser straight away. The link still navigates
// to the share page (where the same button remains if the browser refuses to open the chooser).
// Avoid two identical buttons on the first screen: the floating bar appears once the hero button scrolls away.
if ("IntersectionObserver" in window)
  new IntersectionObserver(([entry]) =>
    $("fab-bar").classList.toggle("is-quiet", entry.isIntersecting),
  ).observe(document.querySelector(".hero-cta"));
document.querySelectorAll("[data-pick]").forEach((link) =>
  link.addEventListener("click", () => {
    if (!sb || !allowed) return;
    location.hash = "#partager";
    route(true);
    try {
      $("files").click();
    } catch {
      /* The share page shows the same button. */
    }
  }),
);
window.addEventListener("hashchange", () =>
  route(location.hash !== "#souvenirs"),
);
route();
function renderGallery() {
  const focusedId = document.activeElement?.dataset.photoId;
  $("gallery").replaceChildren();
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
async function loadGallery(more = false) {
  if (!sb || !allowed || busy) return;
  busy = true;
  $("refresh").disabled = $("more").disabled = true;
  const currentId = rows[activeIndex]?.id;
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
      fetched.push(...(await signPhotos(sb, lastPage)));
      before = lastPage.at(-1) || before;
    } while (!more && lastPage.length === 48 && fetched.length < target);
    rows = [
      ...new Map(
        (more ? [...rows, ...fetched] : fetched).map((row) => [row.id, row]),
      ).values(),
    ];
    cursor = before;
    $("more").hidden = lastPage.length !== 48;
    lastRefresh = Date.now();
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
    $("gallery-status").textContent =
      "Impossible de charger les photos pour le moment. Vérifiez votre connexion et réessayez.";
  } finally {
    busy = false;
    $("refresh").disabled = $("more").disabled = false;
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
  $("photo-position").textContent = `${activeIndex + 1} / ${rows.length}`;
  $("previous").disabled = activeIndex === 0;
  $("next").disabled = activeIndex === rows.length - 1;
}
async function openPhoto(index) {
  if (!rows[index]) return;
  activeIndex = index;
  const request = ++lightboxRequest;
  const dialog = $("lightbox");
  if (!dialog.open) {
    returnFocusId = rows[index].id;
    dialog.showModal();
  }
  $("full-photo").hidden = true;
  $("full-photo").removeAttribute("src");
  $("lightbox-status").textContent = "Chargement…";
  updatePosition();
  try {
    const url = await fullUrl(sb, rows[index]);
    if (request !== lightboxRequest || !dialog.open) return;
    $("full-photo").onload = () => {
      if (request === lightboxRequest) $("lightbox-status").textContent = "";
    };
    $("full-photo").onerror = () => {
      $("full-photo").hidden = true;
      $("lightbox-status").textContent =
        "Cette photo n’est plus disponible. Actualisez la galerie.";
    };
    $("full-photo").src = url;
    $("full-photo").hidden = false;
  } catch {
    if (request === lightboxRequest)
      $("lightbox-status").textContent =
        "Cette photo n’est plus disponible. Actualisez la galerie.";
  }
}
bindDialog($("lightbox"), $("close-lightbox"));
bindDialog($("report-dialog"), $("report-cancel"));
$("lightbox").addEventListener("close", () => {
  lightboxRequest++;
  $("full-photo").removeAttribute("src");
  $("full-photo").hidden = true;
  const opener = [...$("gallery").children].find(
    (node) => node.dataset.photoId === returnFocusId,
  );
  (opener || $("refresh")).focus({ preventScroll: true });
});
$("previous").onclick = () => openPhoto(activeIndex - 1);
$("next").onclick = () => openPhoto(activeIndex + 1);
$("lightbox").addEventListener("keydown", (event) => {
  if ($("report-dialog").open) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    openPhoto(activeIndex + (event.key === "ArrowLeft" ? -1 : 1));
  }
});
let touchStart;
$("full-photo").addEventListener(
  "touchstart",
  (event) => {
    touchStart =
      event.touches.length === 1
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
        : null;
  },
  { passive: true },
);
$("full-photo").addEventListener(
  "touchend",
  (event) => {
    if (!touchStart) return;
    const dx = event.changedTouches[0].clientX - touchStart.x,
      dy = event.changedTouches[0].clientY - touchStart.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy))
      openPhoto(activeIndex + (dx < 0 ? 1 : -1));
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
setupUploads(allowed ? sb : null, () => loadGallery());
renderGallery();
if (!sb)
  $("gallery-status").textContent =
    "L’album se prépare. Les photos et les envois seront disponibles prochainement.";
else loadGallery();
