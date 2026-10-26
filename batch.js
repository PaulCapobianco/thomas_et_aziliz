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
// does not support files at all).
export function canShareFiles() {
  try {
    if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
    if (!matchMedia("(pointer: coarse)").matches) return false;
    return navigator.canShare({ files: [new File(["x"], "photo.jpg", { type: "image/jpeg" })] });
  } catch {
    return false;
  }
}
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
      : note || (n ? "" : "Touchez les photos pour les choisir");
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
    $("select-mode").focus({ preventScroll: true });
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
  const summary = ({ done, failed, aborted }) =>
    `${aborted ? "Téléchargement annulé. " : ""}${plural(done, "photo téléchargée", "photos téléchargées")}.${failed ? ` ${plural(failed, "photo n’a pas pu être téléchargée", "photos n’ont pas pu être téléchargées")}.` : ""}`;
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
      return finish(await downloadAll(list, "Le partage n’est pas disponible, téléchargement une par une. "));
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
    $("dl-go").focus({ preventScroll: true });
  }
  const finish = (result) => exit(summary(result));
  // Called directly from the click: navigator.share needs the user gesture, so nothing is awaited before it.
  function share() {
    const { items, base } = prepared;
    navigator
      .share({ files: items.map((item) => item.file) })
      .then(() => {
        commitDownloadCount(Math.max(peekDownloadCount(), base + items.length));
        exit(`${plural(items.length, "photo partagée", "photos partagées")}.`);
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
        finish(await downloadAll(list, "Le partage n’a pas abouti, téléchargement une par une. "));
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
    $("dl-all").focus({ preventScroll: true });
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
