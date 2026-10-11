import { NSFW_ENABLED } from "./config.js";
import {
  $,
  el,
  browserId,
  rpc,
  storage,
  unwrap,
  errorText,
  userError,
} from "./shared.js";
export const NSFW_SUSPECT_PORN_HENTAI = 0.6;
export const NSFW_SEXY_STRONG = 0.85;
export const NSFW_SEXY_WITH_PORN = 0.25;
export const NSFW_LOAD_TIMEOUT_MS = 15000;
export const NSFW_CLASSIFY_TIMEOUT_MS = 8000;
// Output sizes. The bucket refuses objects above 3 MiB (migration 0003), so the full image keeps a safety margin.
export const FULL_MAX_SIDE = 3000;
export const FULL_QUALITY = 0.9;
export const THUMB_MAX_SIDE = 800;
export const THUMB_QUALITY = 0.75;
const OBJECT_BUDGET_BYTES = 2_900_000;
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_PIXELS = 60_000_000;
const RETRY_DELAYS = [1000, 3000];
let modelPromise;
let modelUnavailable = false;
function timeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
export function verdict(predictions) {
  const classes = new Map(
    predictions.map((item) => [item.className, item.probability]),
  );
  if (
    !["Porn", "Hentai", "Sexy", "Neutral", "Drawing"].every(
      (name) =>
        Number.isFinite(classes.get(name)) &&
        classes.get(name) >= 0 &&
        classes.get(name) <= 1,
    )
  )
    return "unavailable";
  const explicit = classes.get("Porn") + classes.get("Hentai");
  return explicit >= NSFW_SUSPECT_PORN_HENTAI ||
    (classes.get("Sexy") >= NSFW_SEXY_STRONG && explicit >= NSFW_SEXY_WITH_PORN)
    ? "suspect"
    : "clean";
}
async function classify(canvas) {
  if (!NSFW_ENABLED || modelUnavailable) return "unavailable";
  try {
    // Tests replace the library API before page load, never via a production URL flag.
    modelPromise ??= (async () => {
      const library =
        window.nsfwjs || (await import("./vendor/nsfwjs/nsfwjs.js"));
      return library.load(
        new URL("./vendor/nsfwjs/models/mobilenet_v2/", import.meta.url).href,
      );
    })();
    const model = await timeout(modelPromise, NSFW_LOAD_TIMEOUT_MS);
    return verdict(
      await timeout(model.classify(canvas), NSFW_CLASSIFY_TIMEOUT_MS),
    );
  } catch {
    // A timed-out inference must not overlap with subsequent photos on a small phone.
    modelUnavailable = true;
    return "unavailable";
  }
}
export function validateFile(file) {
  if (
    !/^(image\/(jpeg|png|webp|heic|heif))$/i.test(file.type) &&
    !(file.type === "" && /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name))
  )
    throw userError("Format non pris en charge");
  if (!file.size || file.size > MAX_FILE_BYTES)
    throw userError("La photo doit peser entre 1 octet et 30 Mo.");
}
export async function decode(file) {
  validateFile(file);
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      source = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
    } catch {
      throw userError(
        "Image illisible. Pour une photo HEIC, essayez une copie JPEG.",
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (
    !source.width ||
    !source.height ||
    source.width * source.height > MAX_PIXELS
  ) {
    source.close?.();
    throw userError(
      "Image trop grande : utilisez une photo de 60 mégapixels maximum.",
    );
  }
  return source;
}
// Downscale in steps of at most 2x with high-quality smoothing: one big drawImage step aliases and softens fine detail.
// Never enlarges a source that is already smaller than maxSide.
export function canvasFor(source, maxSide) {
  const ratio = Math.min(1, maxSide / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * ratio));
  const height = Math.max(1, Math.round(source.height * ratio));
  let current = source,
    currentWidth = source.width,
    currentHeight = source.height,
    previous = null;
  while (currentWidth / 2 > width && currentHeight / 2 > height) {
    const stepWidth = Math.ceil(currentWidth / 2),
      stepHeight = Math.ceil(currentHeight / 2);
    const step = document.createElement("canvas");
    step.width = stepWidth;
    step.height = stepHeight;
    const stepContext = step.getContext("2d");
    stepContext.imageSmoothingQuality = "high";
    stepContext.drawImage(current, 0, 0, stepWidth, stepHeight);
    if (previous) previous.width = previous.height = 0;
    previous = current = step;
    currentWidth = stepWidth;
    currentHeight = stepHeight;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(current, 0, 0, width, height);
  if (previous) previous.width = previous.height = 0;
  return canvas;
}
export function jpeg(canvas, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(userError("Impossible de préparer cette image.")),
      "image/jpeg",
      quality,
    ),
  );
}
// Keeps the target quality; only a very detailed photo is encoded a little lighter so it always fits the bucket limit.
export async function jpegWithin(canvas, quality, maxBytes = OBJECT_BUDGET_BYTES) {
  let blob;
  for (const q of [quality, quality - 0.05, quality - 0.1, quality - 0.15, quality - 0.2]) {
    blob = await jpeg(canvas, q);
    if (blob.size <= maxBytes) return blob;
  }
  return blob;
}
export async function uploadObject(sb, path, blob) {
  // Plan B integration point: replace only this implementation if real Storage test A fails.
  return unwrap(
    await storage(sb).upload(path, blob, {
      contentType: "image/jpeg",
      upsert: false,
    }),
  );
}
function networkError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  return (
    ["TimeoutError", "AbortError"].includes(error?.name) ||
    (!error?.userMessage &&
      !error?.code &&
      (!status || status >= 500 || status === 408))
  );
}
export async function uploadPhoto(sb, file, audience, seen, update = () => {}) {
  let source, thumbCanvas, fullCanvas;
  try {
    update("Préparation…");
    source = await decode(file);
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
      ),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    if (seen.has(`${audience}:${hash}`)) return "duplicate";
    thumbCanvas = canvasFor(source, THUMB_MAX_SIDE);
    fullCanvas = canvasFor(source, FULL_MAX_SIDE);
    source.close?.();
    source = null;
    let verdictValue, thumb, full;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // One hash per RPC is within the <=200 contract; repeat after uncertain finalization.
        const duplicates = await rpc(sb, "check_duplicates", {
          p_audience: audience,
          p_hashes: [hash],
        });
        if (duplicates.includes(hash)) {
          seen.add(`${audience}:${hash}`);
          return "duplicate";
        }
        if (!thumb) {
          update(
            audience === "public"
              ? "Préparation et premier filtrage…"
              : "Préparation…",
          );
          verdictValue =
            audience === "public" ? await classify(thumbCanvas) : "skipped";
          thumb = await jpegWithin(thumbCanvas, THUMB_QUALITY);
          full = await jpegWithin(fullCanvas, FULL_QUALITY);
          thumbCanvas.width =
            thumbCanvas.height =
            fullCanvas.width =
            fullCanvas.height =
              0;
          if (thumb.size > 3145728 || full.size > 3145728)
            throw userError(
              "Photo trop lourde après compression. Essayez une copie plus petite.",
            );
        }
        const id = crypto.randomUUID();
        update(attempt ? `Nouvelle tentative ${attempt + 1}/3…` : "Envoi…");
        await uploadObject(sb, `${audience}/thumbs/${id}.jpg`, thumb);
        await uploadObject(sb, `${audience}/full/${id}.jpg`, full);
        const result = await rpc(sb, "register_photo", {
          p_id: id,
          p_audience: audience,
          p_sha256: hash,
          p_uploader: browserId(),
          p_nsfw: verdictValue,
        });
        if (result.result === "rate_limited")
          throw Object.assign(new Error("rate_limited"), {
            code: "rate_limited",
          });
        if (
          !["published", "pending_review", "duplicate", "registered"].includes(
            result.result,
          )
        )
          throw userError("Réponse inattendue. Réessayez cet envoi.");
        seen.add(`${audience}:${hash}`);
        return result.result;
      } catch (error) {
        if (attempt === 2 || !networkError(error)) throw error;
        update("Connexion interrompue. Nouvelle tentative…");
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAYS[attempt]),
        );
      }
    }
  } finally {
    source?.close?.();
    for (const canvas of [thumbCanvas, fullCanvas])
      if (canvas) canvas.width = canvas.height = 0;
  }
}
// ---- Status message: one block, one message at a time -------------------------------------------------
// success: disappears after 5 s; pending (kept for review): "OK" button, disappears after 10 s;
// error: never disappears by itself (reason, count, "Réessayer les échecs", "Fermer"); info: replaced freely.
const SUCCESS_MS = 5000,
  PENDING_MS = 10000,
  FADE_MS = 400;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
function createMessage(onChange = () => {}) {
  let timer = 0,
    kind = "";
  const box = () => $("upload-message");
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clearNow = () => {
    clearTimeout(timer);
    kind = "";
    box().classList.remove("is-open", "is-leaving");
    delete box().dataset.kind;
    $("upload-status").textContent = "";
    $("upload-status").classList.remove("error");
    $("message-retry").hidden = $("message-close").hidden = true;
    onChange();
  };
  const dismiss = () => {
    clearTimeout(timer);
    if (reduced()) return clearNow();
    box().classList.add("is-leaving");
    timer = setTimeout(clearNow, FADE_MS);
  };
  return {
    get kind() {
      return kind;
    },
    clear: clearNow,
    dismiss,
    show(next, text, { retry = false, close = "", autoHide = 0 } = {}) {
      // A running error is only replaced by another error or an explicit action, never by information.
      if (kind === "error" && next === "info") return;
      clearTimeout(timer);
      kind = next;
      box().classList.remove("is-leaving");
      box().classList.add("is-open");
      box().dataset.kind = next;
      $("upload-status").classList.toggle("error", next === "error");
      $("upload-status").textContent = text;
      $("message-retry").hidden = !retry;
      $("message-close").hidden = !close;
      $("message-close").textContent = close;
      if (autoHide) timer = setTimeout(dismiss, autoHide);
      onChange();
    },
  };
}
function finalMessage(items, cancelled) {
  const count = (result) => items.filter((item) => item.result === result).length;
  const sent = (item) => ["published", "registered"].includes(item.result);
  const priv = items.filter((item) => item.audience === "maries" && sent(item)).length;
  const shared = items.filter((item) => item.audience !== "maries" && sent(item)).length;
  const dup = count("duplicate"),
    pend = count("pending_review"),
    failed = items.filter((item) => item.result === "error");
  const done = [];
  if (shared)
    done.push(`${plural(shared, "photo ajoutée", "photos ajoutées")} à la galerie`);
  if (priv)
    done.push(`${plural(priv, "photo envoyée", "photos envoyées")} aux mariés`);
  if (dup)
    done.push(`${plural(dup, "doublon ignoré", "doublons ignorés")} (déjà envoyé)`);
  const pending = pend
    ? `${plural(pend, "photo reçue", "photos reçues")} : ${pend > 1 ? "elles apparaîtront" : "elle apparaîtra"} dans la galerie après vérification par les organisateurs.`
    : "";
  if (failed.length) {
    const reasons = [...new Set(failed.map((item) => item.reason).filter(Boolean))];
    const why = reasons.length
      ? ` Raison : ${reasons.slice(0, 2).join(" ; ")}${reasons.length > 2 ? " ; …" : ""}.`
      : "";
    return {
      kind: "error",
      options: { retry: true, close: "Fermer" },
      text:
        `${plural(failed.length, "photo n’a pas pu être envoyée", "photos n’ont pas pu être envoyées")}.${why}` +
        (done.length ? ` Bien reçues : ${done.join(" · ")}.` : "") +
        (pending ? ` ${pending}` : ""),
    };
  }
  const head = cancelled ? "Envoi arrêté ; les photos restantes peuvent être envoyées. " : "";
  if (pend)
    return {
      kind: "pending",
      options: { close: "OK", autoHide: PENDING_MS },
      text: head + (done.length ? `${done.join(" · ")}. ` : "") + pending,
    };
  if (cancelled)
    return { kind: "info", options: { close: "OK" }, text: head + (done.length ? `${done.join(" · ")}.` : "") };
  return {
    kind: "success",
    options: { autoHide: SUCCESS_MS },
    text: done.length ? `${done.join(" · ")}.` : "Terminé.",
  };
}
export function setupUploads(sb, onComplete) {
  const message = createMessage(() => render());
  let items = [],
    busy = false,
    cancelled = false;
  const revoke = (item) => {
    if (item.url) {
      URL.revokeObjectURL(item.url);
      item.url = null;
    }
  };
  function render() {
    $("selection").replaceChildren();
    $("selection-title").textContent =
      `Vos photos sélectionnées (${items.length})`;
    items.forEach((item) => {
      const li = el("li");
      if (item.url) {
        const img = el("img");
        img.src = item.url;
        img.alt = `Aperçu de ${item.file.name}`;
        img.width = 160;
        img.height = 160;
        li.append(img);
      }
      const remove = el("button", "×", "remove");
      remove.type = "button";
      remove.setAttribute("aria-label", `Retirer ${item.file.name}`);
      remove.disabled = busy;
      remove.onclick = () => {
        revoke(item);
        items = items.filter((candidate) => candidate !== item);
        render();
      };
      li.append(
        remove,
        el("p", item.file.name),
        el(
          "p",
          item.message || "Prête à envoyer",
          item.result === "error" ? "error" : "",
        ),
      );
      $("selection").append(li);
    });
    const audience = document.querySelector("[name=audience]:checked").value;
    const waiting = items.filter((item) => !item.result).length;
    $("send-destination").textContent = waiting
      ? `Destination : ${audience === "maries" ? "envoi privé, uniquement aux mariés" : "galerie commune, visible par tous les invités"}.`
      : "";
    $("send").disabled = busy || !sb || !waiting;
    $("send").textContent =
      `Envoyer ${items.filter((item) => !item.result).length} photo(s)`;
    $("retry").hidden =
      !items.some((item) => item.result === "error") ||
      !$("message-retry").hidden;
    $("retry").disabled = busy;
    $("upload-controls").disabled = busy;
  }
  document
    .querySelectorAll("[name=audience]")
    .forEach((radio) => radio.addEventListener("change", render));
  $("files").onchange = async (event) => {
    const files = [...event.target.files];
    event.target.value = "";
    busy = true;
    render();
    message.show("info", "Préparation des aperçus…");
    for (const file of files) {
      const item = { file };
      let source, canvas;
      try {
        source = await decode(file);
        canvas = canvasFor(source, 180);
        item.url = URL.createObjectURL(await jpeg(canvas, 0.6));
      } catch (error) {
        item.result = "error";
        item.reason = errorText(error);
        item.message = `Échec : ${item.reason}`;
      } finally {
        source?.close?.();
        if (canvas) canvas.width = canvas.height = 0;
      }
      items.push(item);
    }
    busy = false;
    const ready = items.filter((item) => !item.result).length;
    const unreadable = items.filter((item) => item.result === "error");
    if (unreadable.length) {
      const reasons = [...new Set(unreadable.map((item) => item.reason))];
      message.show(
        "error",
        `${plural(unreadable.length, "fichier n’a pas pu être utilisé", "fichiers n’ont pas pu être utilisés")}. Raison : ${reasons.slice(0, 2).join(" ; ")}.${ready ? ` ${plural(ready, "photo est prête", "photos sont prêtes")} à être envoyée${ready > 1 ? "s" : ""}.` : ""}`,
        { retry: true, close: "Fermer" },
      );
    } else if (ready)
      message.show("info", `${ready} photo(s) prête(s). Vérifiez la destination, puis appuyez sur « Envoyer ».`);
    else message.show("info", "Aucune photo utilisable dans cette sélection.");
    render();
  };
  async function run(retry = false) {
    if (busy || !sb) return;
    const audience = document.querySelector("[name=audience]:checked").value;
    const batch = items.filter((item) =>
      retry ? item.result === "error" : !item.result,
    );
    if (!batch.length) return;
    busy = true;
    cancelled = false;
    message.clear();
    render();
    $("progress-panel").hidden = false;
    $("cancel-upload").disabled = false;
    $("progress").value = 0;
    const seen = new Set();
    let processed = 0;
    for (const item of batch) {
      if (cancelled) break;
      // A retry must honor the destination explicitly selected for this submission.
      item.audience = audience;
      try {
        item.result = await uploadPhoto(
          sb,
          item.file,
          item.audience,
          seen,
          (message) => {
            $("progress-label").textContent =
              `${processed} sur ${batch.length} photos traitées · ${message}`;
          },
        );
        item.reason = "";
        item.message =
          item.result === "duplicate"
            ? "Déjà envoyée, ignorée"
            : item.result === "pending_review"
              ? "Reçue, elle apparaîtra après validation"
              : item.audience === "maries"
                ? "Envoyé aux mariés."
                : item.result === "published"
                  ? "Ajoutée à la galerie"
                  : "Photo reçue.";
        revoke(item);
      } catch (error) {
        item.result = "error";
        item.reason = errorText(error);
        item.message = `Échec : ${item.reason}`;
      }
      processed++;
      $("progress").value = Math.round((processed / batch.length) * 100);
      $("progress-label").textContent =
        `${processed} sur ${batch.length} photos traitées (${Math.round((processed / batch.length) * 100)} %)`;
      render();
    }
    busy = false;
    $("cancel-upload").disabled = true;
    render();
    // The progress block gives way to the final message: never both on screen.
    $("progress-panel").hidden = true;
    const final = finalMessage(items, cancelled);
    message.show(final.kind, final.text, final.options);
    render();
    $("upload-message").scrollIntoView({ block: "nearest" });
    onComplete();
  }
  $("upload-form").onsubmit = (event) => {
    event.preventDefault();
    run();
  };
  $("retry").onclick = () => run(true);
  $("message-retry").onclick = () => run(true);
  $("message-close").onclick = () => message.dismiss();
  $("cancel-upload").onclick = () => {
    cancelled = true;
    $("cancel-upload").disabled = true;
    $("progress-label").textContent = "Arrêt demandé : la photo en cours se termine…";
  };
  window.addEventListener("beforeunload", (event) => {
    if (busy) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("pagehide", () => items.forEach(revoke));
  if (!sb) {
    message.show(
      "error",
      "Les envois ne sont pas encore ouverts : le service photo n'est pas configuré sur ce site. Prévenez les organisateurs.",
    );
    $("files").disabled = true;
  }
  render();
}
