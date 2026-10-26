import {
  $,
  el,
  fullUrl,
  downloadName,
  peekDownloadCount,
  commitDownloadCount,
} from "./shared.js";
// Multi-selection and grouped download on the public gallery. Only the photos of `getRows()` (what the server
// lists as public and published) can be selected; every file is signed by Storage like the single download.
export const BATCH_LIMIT = 20;
export const DOWNLOAD_GAP_MS = 450;
const PARALLEL_FETCHES = 3;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
// Native sharing of files: touch devices only (a desktop share sheet is worse than plain downloads, and Firefox
// does not support files at all). When it is not offered, the reason is returned so the guest (and we) can see it.
export function shareSupport() {
  try {
    if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function")
      return { ok: false, reason: "ce navigateur ne partage pas les fichiers" };
    if (!matchMedia("(pointer: coarse)").matches) return { ok: false, reason: "appareil non tactile" };
    // Android's share sheet has no simple "save to the gallery": there the plain download is used.
    if (!isIOS()) return { ok: false, reason: "le partage n’est utilisé que sur iPhone et iPad" };
    if (!navigator.canShare({ files: [new File(["x"], "photo.jpg", { type: "image/jpeg" })] }))
      return { ok: false, reason: "ce navigateur refuse le partage de photos" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "partage indisponible" };
  }
}
export const canShareFiles = () => shareSupport().ok;
const isIOS = () => {
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
};
// Where a downloaded file ends up (a link download never goes to Photos on iPhone).
const isAndroid = () => /Android/.test(navigator.userAgent || "");
export function whereFiles() {
  if (isIOS()) return "dans l’app Fichiers (dossier Téléchargements)";
  if (isAndroid())
    return "dans le dossier Téléchargements (app Fichiers) et, selon votre téléphone, dans l’album « Téléchargements » de la Galerie";
  return "dans votre dossier Téléchargements";
}
// Chrome on Android asks once "Autoriser plusieurs téléchargements ?"; refusing it silently blocks every file after the first.
const MULTI_HINT = "Si Chrome demande « Autoriser plusieurs téléchargements », touchez « Autoriser ».";
// The focus is moved by script after some actions so that a keyboard or screen-reader user does not lose their place.
// For a finger or a mouse that move is useless, and some phones draw a frame around a control focused by script, so
// it only happens when the last input was the keyboard.
let keyboardUsed = false;
document.addEventListener("keydown", () => (keyboardUsed = true), true);
document.addEventListener("pointerdown", () => (keyboardUsed = false), true);
const focusForKeyboard = (node) => keyboardUsed && node.focus({ preventScroll: true });
export function setupBatch({ sb, names, dateText, getRows, onChange }) {
  let active = false,
    phase = "idle", // idle | preparing | ready | downloading
    prepared = null, // { items: [{ row, file }], base }
    note = "",
    controller = null;
  const selected = new Set();
  const rowsSelected = () => getRows().filter((row) => selected.has(row.id));
  const count = () => rowsSelected().length;
  const busy = () => phase === "preparing" || phase === "downloading";
  function overLimit() {
    return count() > BATCH_LIMIT;
  }
  function render() {
    const n = count(),
      all = getRows().length;
    $("select-mode").hidden = !getRows().length && !active;
    $("select-mode-label").textContent = active ? "Quitter la sélection" : "Sélectionner";
    $("select-mode").setAttribute("aria-pressed", String(active));
    $("dl-bar").hidden = !active;
    document.body.classList.toggle("selecting", active);
    if (!active) return;
    $("dl-count").textContent = n ? plural(n, "photo sélectionnée", "photos sélectionnées") : "Aucune photo sélectionnée";
    $("dl-note").textContent = overLimit()
      ? `${BATCH_LIMIT} photos au maximum par lot. Décochez ${plural(n - BATCH_LIMIT, "photo", "photos")} pour continuer.`
      : note || (n ? methodNote() : "Touchez les photos pour les choisir");
    const share = canShareFiles();
    $("dl-go").textContent =
      phase === "preparing"
        ? "Préparation…"
        : phase === "downloading"
          ? "Téléchargement…"
          : phase === "ready"
            ? `Partager ${plural(prepared.items.length, "photo", "photos")}`
            : `${share ? "Préparer" : "Télécharger"} ${plural(n, "photo", "photos")}`;
    $("dl-go").disabled = phase === "ready" ? false : busy() || !n || overLimit();
    $("dl-all").textContent = n === all && all ? "Tout désélectionner" : "Tout sélectionner";
    $("dl-all").disabled = busy() || !all;
    $("dl-progress").hidden = !busy();
  }
  // What will happen on this device, and why, before the guest taps anything.
  function methodNote() {
    const support = shareSupport();
    return support.ok
      ? "Partage disponible : « Préparer » puis « Partager », puis « Enregistrer » pour les mettre dans Photos."
      : isAndroid()
        ? `Téléchargement direct : photos dans Téléchargements (app Fichiers). ${MULTI_HINT}`
        : `Téléchargement direct (${support.reason}). Retrouvez les photos ${whereFiles()}.`;
  }
  function progress(done, total, intro = "") {
    $("dl-progress").max = total;
    $("dl-progress").value = done;
    $("dl-note").textContent = `${intro}${phase === "preparing" ? "Préparation" : "Téléchargement"} : ${done} sur ${total}`;
  }
  function decorate(button, row, index) {
    button.querySelector(".pick-box")?.remove();
    if (!active) return;
    const on = selected.has(row.id);
    button.classList.add("is-selecting");
    button.classList.toggle("is-selected", on);
    button.setAttribute("aria-pressed", String(on));
    button.setAttribute("aria-label", `${on ? "Retirer de" : "Ajouter à"} la sélection : photo ${index + 1}`);
    const box = el("span", on ? "✓" : "", "pick-box");
    box.setAttribute("aria-hidden", "true");
    button.append(box);
  }
  function paint() {
    const rows = getRows();
    document.querySelectorAll("#gallery .photo-card").forEach((button) => {
      const index = rows.findIndex((row) => row.id === button.dataset.photoId);
      if (index >= 0) decorate(button, rows[index], index);
    });
  }
  function invalidate() {
    if (phase === "ready") phase = "idle";
    prepared = null;
    note = "";
  }
  function changed() {
    invalidate();
    render();
    paint();
  }
  function exit(message = "") {
    active = false;
    phase = "idle";
    prepared = null;
    note = "";
    controller = null;
    selected.clear();
    render();
    onChange();
    $("gallery-status").textContent = message;
    focusForKeyboard($("select-mode"));
  }
  // One file at a time through a signed URL with the imposed name: the same mechanism as the single download.
  async function downloadAll(list, intro = "") {
    phase = "downloading";
    note = "";
    render();
    let done = 0,
      failed = 0;
    for (let i = 0; i < list.length && !controller.signal.aborted; i++) {
      progress(i, list.length, intro);
      try {
        // The number is only consumed once the file was handed to the browser.
        const number = peekDownloadCount() + 1;
        const name = downloadName(names, dateText, number);
        const a = el("a");
        a.href = await fullUrl(sb, list[i], name);
        a.download = name;
        if (controller.signal.aborted) break;
        document.body.append(a);
        a.click();
        a.remove();
        commitDownloadCount(number);
        done++;
      } catch {
        failed++;
      }
      if (i < list.length - 1) await sleep(DOWNLOAD_GAP_MS, controller.signal);
    }
    return { done, failed, aborted: controller.signal.aborted };
  }
  const summary = ({ done, failed, aborted }, why = "") =>
    `${why ? `${why} ` : ""}${aborted ? "Téléchargement annulé. " : ""}${plural(done, "photo téléchargée", "photos téléchargées")}.${failed ? ` ${plural(failed, "photo n’a pas pu être téléchargée", "photos n’ont pas pu être téléchargées")}.` : ""}${done ? ` Retrouvez-${done > 1 ? "les" : "la"} ${whereFiles()}.` : ""}${done > 1 && isAndroid() ? ` ${MULTI_HINT} Sinon, seules les premières photos arrivent.` : ""}`;
  async function fetchAll(list) {
    phase = "preparing";
    note = "";
    render();
    const blobs = new Array(list.length);
    let next = 0,
      finished = 0,
      refused = 0,
      networkFailed = false;
    progress(0, list.length);
    const worker = async () => {
      while (next < list.length && !controller.signal.aborted && !networkFailed) {
        const i = next++;
        let url;
        try {
          url = await fullUrl(sb, list[i]);
        } catch {
          refused++; // Storage refuses this photo (no longer public): it is simply left out.
          progress(++finished, list.length);
          continue;
        }
        try {
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) throw new Error("fetch");
          const blob = await response.blob();
          if (!blob.size) throw new Error("empty");
          blobs[i] = blob;
        } catch {
          if (!controller.signal.aborted) networkFailed = true;
        }
        progress(++finished, list.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_FETCHES, list.length) }, worker));
    return { blobs, refused, networkFailed };
  }
  async function start() {
    const list = rowsSelected();
    if (busy() || !list.length || list.length > BATCH_LIMIT) return;
    controller = new AbortController();
    if (!canShareFiles()) {
      const result = await downloadAll(list);
      if (controller) exit(summary(result));
      return;
    }
    const { blobs, refused, networkFailed } = await fetchAll(list);
    if (controller?.signal.aborted || !controller) return;
    if (networkFailed) {
      // Preparing failed (network, CORS): fall back to the plain downloads, never a broken share.
      const why = "Impossible de préparer les photos pour le partage (réseau ou autorisation).";
      return finish(await downloadAll(list, `${why} Téléchargement une par une. `), why);
    }
    const base = peekDownloadCount();
    const items = list
      .map((row, i) => ({ row, blob: blobs[i] }))
      .filter((item) => item.blob)
      .map((item, i) => ({
        row: item.row,
        file: new File([item.blob], downloadName(names, dateText, base + i + 1), { type: "image/jpeg" }),
      }));
    if (!items.length) {
      phase = "idle";
      note = "Ces photos ne sont plus disponibles. Actualisez la galerie.";
      return render();
    }
    prepared = { items, base };
    phase = "ready";
    note = `Photos prêtes${refused ? ` (${plural(refused, "photo n’est plus disponible et a été ignorée", "photos ne sont plus disponibles et ont été ignorées")})` : ""}. Appuyez sur « Partager ».`;
    render();
    focusForKeyboard($("dl-go"));
  }
  const finish = (result, why = "") => exit(summary(result, why));
  // Called directly from the click: navigator.share needs the user gesture, so nothing is awaited before it.
  function share() {
    const { items, base } = prepared;
    navigator
      .share({ files: items.map((item) => item.file) })
      .then(() => {
        commitDownloadCount(Math.max(peekDownloadCount(), base + items.length));
        exit(`${plural(items.length, "photo partagée", "photos partagées")}. Si vous avez choisi « Enregistrer », retrouvez-${items.length > 1 ? "les" : "la"} dans Photos.`);
      })
      .catch(async (error) => {
        if (error?.name === "AbortError") {
          // Dismissed by the guest: nothing consumed, the prepared photos stay ready for another try.
          note = "Partage annulé. Vos photos restent prêtes : appuyez sur « Partager » pour réessayer.";
          return render();
        }
        const list = items.map((item) => item.row);
        prepared = null;
        controller = new AbortController();
        const why = `Le partage a été refusé (${error?.name || "erreur inconnue"}).`;
        finish(await downloadAll(list, `${why} Téléchargement une par une. `), why);
      });
  }
  // Cancelling a running grouped download ends it: what was already handed to the browser stays, the selection is cleared.
  function cancel() {
    if (!busy()) return exit();
    controller.abort();
    if (phase === "preparing") exit("Préparation annulée.");
  }
  $("select-mode").onclick = () => {
    if (active) return cancel();
    active = true;
    render();
    onChange();
    focusForKeyboard($("dl-all"));
  };
  $("dl-all").onclick = () => {
    const rows = getRows();
    if (selected.size && selected.size === rows.length) selected.clear();
    else rows.forEach((row) => selected.add(row.id));
    changed();
  };
  $("dl-go").onclick = () => (phase === "ready" ? share() : start());
  $("dl-cancel").onclick = cancel;
  return {
    active: () => active,
    toggle(id) {
      if (busy()) return;
      selected.has(id) ? selected.delete(id) : selected.add(id);
      changed();
    },
    // Called for every card of a gallery render: marks it, and drops nothing (prune does).
    decorate,
    prune() {
      const ids = new Set(getRows().map((row) => row.id));
      let dropped = false;
      for (const id of [...selected]) if (!ids.has(id)) (selected.delete(id), (dropped = true));
      if (dropped) invalidate();
      render();
    },
    render,
  };
}

// "Enregistrer dans Photos": native share of the photo shown in the lightbox. The file is fetched when the photo
// opens, so the tap calls navigator.share at once (the user gesture is still valid). `download` is the existing
// single download, used as the fallback; it resolves to true when the file was handed to the browser.
const NOTE_MS = 12000;
export function setupSinglePhoto({ sb, names, dateText, download }) {
  let prepared = null,
    token = 0,
    timer = 0;
  const say = (text) => {
    clearTimeout(timer);
    $("save-note").textContent = text;
    if (text) timer = setTimeout(() => ($("save-note").textContent = ""), NOTE_MS);
  };
  const show = (visible) => {
    $("save-photo").hidden = !visible;
    $("lightbox-actions").classList.toggle("has-save", visible);
  };
  const label = () => "Enregistrer dans Photos"; // the button only exists on iPhone and iPad
  function reset() {
    token++;
    prepared = null;
    say("");
    if (!shareSupport().ok) return show(false);
    show(true);
    $("save-photo").disabled = true;
    $("save-photo-label").textContent = "Préparation de la photo…";
  }
  function fail(reason, mine = token) {
    if (mine !== token) return;
    prepared = null;
    show(false);
    say(`Enregistrement dans Photos indisponible (${reason}). Utilisez « Télécharger ».`);
  }
  async function load(url, mine = token) {
    if (mine !== token || $("save-photo").hidden) return;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("http");
      const blob = await response.blob();
      if (!blob.size) throw new Error("empty");
      if (mine !== token) return;
      prepared = blob;
      $("save-photo").disabled = false;
      $("save-photo-label").textContent = label();
    } catch {
      fail("réseau ou autorisation", mine);
    }
  }
  $("save-photo").addEventListener("click", () => {
    if (!prepared) return;
    // Everything before navigator.share is synchronous.
    const number = peekDownloadCount() + 1;
    const file = new File([prepared], downloadName(names, dateText, number), { type: "image/jpeg" });
    navigator
      .share({ files: [file] })
      .then(() => {
        commitDownloadCount(Math.max(peekDownloadCount(), number));
        say("Photo partagée. Si vous avez choisi « Enregistrer l’image », retrouvez-la dans Photos.");
      })
      .catch(async (error) => {
        if (error?.name === "AbortError") return say("Enregistrement annulé. Vous pouvez réessayer.");
        const why = `Le partage a été refusé (${error?.name || "erreur inconnue"}).`;
        say(`${why} Téléchargement direct…`);
        if (await download()) say(`${why} Photo téléchargée : retrouvez-la ${whereFiles()}.`);
      });
  });
  return { reset, load, fail, say };
}
