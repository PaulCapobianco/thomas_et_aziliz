import {
  $,
  el,
  createClient,
  rpc,
  storage,
  unwrap,
  signPhotos,
  fullUrl,
  bindDialog,
  errorText,
} from "./shared.js";
const sb = createClient(true);
$("admin-message").textContent = "";
bindDialog($("confirm-dialog"));
let offset = 0;
let filter = "reported",
  rows = [],
  paused = false,
  busy = false,
  previewRow,
  generation = 0,
  batchRunning = false,
  lastSignature = "";
// Photos ticked for a batch action (pending queue and "Récentes"); kept by id across refreshes.
const selected = new Set();
const batchTab = () => filter === "pending" || filter === "recent";
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const SIGNATURE_REUSE_MS = 45 * 60000;
const reasons = {
  nsfw: "Contenu à vérifier",
  paused: "En attente de validation",
  model_unavailable: "Vérification automatique indisponible",
  reports: "Signalements",
  admin: "Masquée par un administrateur",
  embarrassing: "Photo gênante",
  child: "Photo d’un enfant",
  other: "Autre",
};
const statuses = {
  published: "Publiée",
  pending_review: "En attente de validation",
  hidden: "Masquée",
};
function loginErrorText(error) {
  const text = String(error?.message || "");
  // Hosted GoTrue sends a stable code; older versions only send the message.
  const code =
    error?.code ||
    (/invalid login credentials/i.test(text) ? "invalid_credentials" : "") ||
    (/email not confirmed/i.test(text) ? "email_not_confirmed" : "") ||
    (/rate limit/i.test(text) ? "over_request_rate_limit" : "");
  const status = Number(error?.status || 0);
  if (code === "invalid_credentials")
    return "Adresse e-mail ou mot de passe incorrect.";
  if (code === "email_not_confirmed")
    return "Cette adresse e-mail n’est pas confirmée. Dans Supabase, ouvrez Authentication > Users et confirmez l’utilisateur.";
  if (code === "over_request_rate_limit" || status === 429)
    return "Trop de tentatives de connexion. Patientez quelques minutes puis réessayez.";
  if (status >= 400 && status < 500)
    return `Connexion refusée par le service (${code || status}). Contactez l’organisateur.`;
  return "Connexion impossible : service injoignable. Vérifiez votre réseau puis réessayez.";
}
function clearSessionUI() {
  generation++;
  rows = [];
  selected.clear();
  lastSignature = "";
  batchRunning = false;
  $("batch-bar").hidden = true;
  document.body.classList.remove("has-batch");
  $("dashboard").hidden = true;
  $("logout").hidden = true;
  $("login").hidden = false;
  $("admin-photos").replaceChildren();
  $("stats").replaceChildren();
  $("admin-preview").close();
  $("confirm-dialog").close();
  $("preview-image").removeAttribute("src");
}
function confirmAction(message) {
  $("confirm-message").textContent = message;
  $("confirm-dialog").showModal();
  return new Promise((resolve) => {
    $("confirm-yes").onclick = () => $("confirm-dialog").close("yes");
    $("confirm-no").onclick = () => $("confirm-dialog").close("no");
    $("confirm-dialog").addEventListener(
      "close",
      () => {
        resolve($("confirm-dialog").returnValue === "yes");
        $("confirm-dialog").returnValue = "";
      },
      { once: true },
    );
  });
}
function render() {
  $("admin-photos").replaceChildren();
  if (!rows.length)
    $("admin-photos").append(
      el("p", "Aucune photo dans cette sélection.", "empty"),
    );
  for (const row of rows) {
    const card = el("article", undefined, "admin-card");
    const preview = el("button", undefined, "admin-preview");
    preview.setAttribute("aria-label", "Examiner la photo");
    const img = el("img");
    img.src = row.thumbUrl;
    img.alt = "Photo du mariage à modérer";
    img.loading = "lazy";
    img.width = 400;
    img.height = 300;
    preview.append(img);
    preview.onclick = () => showPreview(row);
    const title =
      row.audience === "maries" ? "Mariés uniquement" : statuses[row.status];
    if (batchTab()) {
      const box = el("label", undefined, "select-box");
      const input = el("input");
      input.type = "checkbox";
      input.dataset.id = row.id;
      input.checked = selected.has(row.id);
      input.setAttribute("aria-label", "Sélectionner cette photo");
      input.onchange = () => {
        if (input.checked) selected.add(row.id);
        else selected.delete(row.id);
        card.classList.toggle("is-selected", input.checked);
        updateBatchBar();
      };
      box.append(input);
      card.append(box);
      card.classList.toggle("is-selected", input.checked);
    }
    card.append(
      preview,
      el("h3", title),
      el(
        "p",
        `${row.report_count} signalement(s) · ${new Date(row.created_at).toLocaleString("fr-FR")}`,
      ),
    );
    if (row.review_reason)
      card.append(el("p", reasons[row.review_reason] || "À examiner"));
    if (row.report_reasons?.length)
      card.append(
        el(
          "p",
          row.report_reasons
            .map((reason) => reasons[reason] || "Autre")
            .join(" · "),
        ),
      );
    const actions = el("div", undefined, "actions");
    for (const [status, label] of [
      [
        "hidden",
        filter === "pending" ? "Refuser" : filter === "recent" ? "Retirer" : "Masquer",
      ],
      ["published", row.status === "pending_review" ? "Valider" : "Restaurer"],
      ["deleted", "Supprimer"],
    ]) {
      const button = el("button", label, status === "hidden" ? "primary" : "");
      button.disabled = busy || row.status === status;
      button.onclick = () => setStatus(row, status);
      actions.append(button);
    }
    card.append(actions);
    $("admin-photos").append(card);
  }
  updateBatchBar();
}
function updateBatchBar(progress) {
  const count = selected.size;
  const show = count > 0 && batchTab() && !$("dashboard").hidden;
  $("batch-bar").hidden = !show;
  document.body.classList.toggle("has-batch", show);
  $("batch-approve").hidden = $("batch-reject").hidden = filter !== "pending";
  $("batch-remove").hidden = filter !== "recent";
  $("batch-approve").textContent = `Valider (${count})`;
  $("batch-reject").textContent = `Refuser (${count})`;
  $("batch-remove").textContent = `Retirer (${count})`;
  $("batch-summary").textContent = progress
    ? `Traitement : ${progress.done} sur ${progress.total}…`
    : `${plural(count, "photo sélectionnée", "photos sélectionnées")}`;
  $("batch-progress").hidden = !progress;
  if (progress) $("batch-progress").value = Math.round((progress.done / progress.total) * 100);
  for (const id of ["batch-approve", "batch-reject", "batch-remove"])
    $(id).disabled = batchRunning || busy;
  const everything = rows.length > 0 && rows.every((row) => selected.has(row.id));
  $("select-all").hidden = !batchTab() || !rows.length;
  $("select-all").disabled = batchRunning || busy;
  $("select-all").textContent = everything
    ? "Tout désélectionner"
    : `Tout sélectionner (${rows.length})`;
}
// One request per photo, in order, with visible progress and a clear report. Failed photos stay selected.
async function runBatch(kind) {
  const targets = rows.filter((row) => selected.has(row.id));
  if (!targets.length || busy || batchRunning) return;
  const status = kind === "approve" ? "published" : "hidden";
  if (
    kind === "reject" &&
    !(await confirmAction(
      `Refuser ${plural(targets.length, "photo", "photos")} ? ${targets.length > 1 ? "Elles ne seront pas publiées" : "Elle ne sera pas publiée"} (vous pourrez ${targets.length > 1 ? "les" : "la"} retrouver dans l’onglet Masquées).`,
    ))
  )
    return;
  if (kind === "approve") {
    const flagged = targets.filter((row) => row.review_reason === "nsfw").length;
    if (
      flagged &&
      !(await confirmAction(
        `${plural(flagged, "photo signalée", "photos signalées")} par le filtre automatique ${flagged > 1 ? "sont" : "est"} dans la sélection. Les avez-vous examinées avant de les publier ?`,
      ))
    )
      return;
  }
  batchRunning = true;
  const request = generation;
  let done = 0;
  const failed = [];
  updateBatchBar({ done, total: targets.length });
  for (const row of targets) {
    try {
      const result = await rpc(sb, "admin_set_status", { p_id: row.id, p_status: status });
      if (result.result === "not_found") throw Object.assign(new Error(), { userMessage: "photo introuvable" });
      selected.delete(row.id);
    } catch (error) {
      failed.push(errorText(error).replace(/\.$/, ""));
      if (error?.code === "42501") break; // session lost: stop, do not hammer
    }
    done++;
    if (request !== generation) break;
    updateBatchBar({ done, total: targets.length });
  }
  batchRunning = false;
  const ok = done - failed.length;
  const verb = kind === "approve" ? "validée" : kind === "reject" ? "refusée" : "retirée";
  const verbs = verb + "s";
  $("admin-message").textContent =
    `${plural(ok, `photo ${verb}`, `photos ${verbs}`)}${kind === "approve" ? " : visible dans la galerie" : ""}.` +
    (failed.length
      ? ` ${plural(failed.length, "échec", "échecs")} : ${[...new Set(failed)].slice(0, 2).join(" ; ")}. ${failed.length > 1 ? "Ces photos restent sélectionnées" : "Cette photo reste sélectionnée"} : réessayez.`
      : "");
  await load();
}
// Reuse the signed thumbnail URL of a photo already on screen (valid one hour) so refreshes do not reload the grid.
async function signRows(list) {
  const known = new Map(rows.map((row) => [row.id, row]));
  const reusable = (row) => {
    const old = known.get(row.id);
    return old?.thumbUrl && Date.now() - old.signedAt < SIGNATURE_REUSE_MS ? old : null;
  };
  const fresh = new Map(
    (await signPhotos(sb, list.filter((row) => !reusable(row)))).map((row) => [row.id, { ...row, signedAt: Date.now() }]),
  );
  return list.flatMap((row) => {
    const old = reusable(row);
    return old ? [{ ...row, thumbUrl: old.thumbUrl, signedAt: old.signedAt }] : fresh.has(row.id) ? [fresh.get(row.id)] : [];
  });
}
async function load(more = false, silent = false) {
  if (!sb || busy || batchRunning) return;
  busy = true;
  const request = generation;
  if (!silent) $("admin-refresh").disabled = $("admin-more").disabled = true;
  let changed = true;
  try {
    const state = await rpc(sb, "admin_status");
    // The pending queue is read in one go (up to 200) so the priority sort covers all of it.
    const limit =
      filter === "pending" ? 200 : more ? 48 : Math.min(200, Math.max(48, rows.length));
    const list = await rpc(sb, "admin_list_photos", {
      p_filter: filter,
      p_limit: limit,
      p_offset: more ? offset : 0,
    });
    const signed = await signRows(list);
    if (request !== generation) return;
    offset = (more ? offset : 0) + list.length;
    paused = state.paused;
    $("publication-state").textContent = paused
      ? "Validation avant publication activée : chaque nouvelle photo attend votre validation (la galerie existante reste visible)"
      : "Galerie publique en ligne";
    $("pause").textContent = paused
      ? "Désactiver la validation avant publication"
      : "Activer la validation avant publication";
    $("pending-count").textContent = ` (${state.pending})`;
    $("stats").replaceChildren();
    for (const [label, value] of [
      ["Publiées", state.published],
      ["Signalées", state.reported],
      ["En attente", state.pending],
      ["Masquées", state.hidden],
      ["Mariés", state.maries],
      ["Stockage", `${(state.storage_bytes / 1e6).toFixed(1)} Mo`],
    ]) {
      const stat = el("div");
      stat.append(el("strong", String(value)), el("span", label));
      $("stats").append(stat);
    }
    rows = more
      ? [...new Map([...rows, ...signed].map((row) => [row.id, row])).values()]
      : signed;
    // Queue order: photos flagged by the automatic filter first, then the newest.
    if (filter === "pending")
      rows.sort(
        (a, b) =>
          (a.review_reason === "nsfw" ? 0 : 1) - (b.review_reason === "nsfw" ? 0 : 1) ||
          String(b.created_at).localeCompare(String(a.created_at)),
      );
    // A refresh never loses the ticks of photos still listed; photos that left the list are forgotten.
    for (const id of [...selected]) if (!rows.some((row) => row.id === id)) selected.delete(id);
    const signature = rows
      .map((row) => [row.id, row.status, row.review_reason, row.report_count].join())
      .join("|");
    changed = !silent || signature !== lastSignature || more;
    lastSignature = signature;
    $("admin-more").hidden = list.length < limit;
    $("release-actions").hidden = filter !== "pending";
    $("dashboard").hidden = false;
    $("login").hidden = true;
    $("logout").hidden = false;
  } catch (error) {
    if (request !== generation) return;
    if (error.code === "42501" || Number(error.status) === 401) {
      clearSessionUI();
      // A connected account that is not in public.admin_users must not stay signed in.
      await sb.auth.signOut({ scope: "local" }).catch(() => {});
      $("admin-message").textContent =
        "Ce compte n’a pas accès à l’administration : il est bien connecté, mais n’est pas dans la liste des administrateurs.";
    } else $("admin-message").textContent = errorText(error);
  } finally {
    busy = false;
    if (!silent) $("admin-refresh").disabled = $("admin-more").disabled = false;
    if (changed) {
      // Keep keyboard / touch focus on the same checkbox across the redraw.
      const focused = document.activeElement?.dataset?.id;
      render();
      if (focused)
        [...$("admin-photos").querySelectorAll("input[data-id]")]
          .find((input) => input.dataset.id === focused)
          ?.focus({ preventScroll: true });
    } else updateBatchBar();
  }
}
async function mutate(operation, message = "Action enregistrée.") {
  if (busy || batchRunning) return;
  busy = true;
  document.querySelectorAll("#dashboard button").forEach((button) => {
    button.disabled = true;
  });
  try {
    await operation();
    $("admin-message").textContent = message;
  } catch (error) {
    $("admin-message").textContent = errorText(error);
  } finally {
    busy = false;
    document.querySelectorAll("#dashboard button").forEach((button) => {
      button.disabled = false;
    });
    await load();
  }
}
async function setStatus(row, status) {
  if (busy || batchRunning) return;
  if (
    status === "deleted" &&
    !(await confirmAction(
      "Supprimer définitivement cette photo ? Cette action est irréversible.",
    ))
  )
    return;
  if (
    status === "published" &&
    row.review_reason === "nsfw" &&
    !(await confirmAction(
      "Vous avez examiné cette photo et souhaitez la publier ?",
    ))
  )
    return;
  if (
    status === "hidden" &&
    row.status === "pending_review" &&
    !(await confirmAction(
      "Refuser cette photo ? Elle ne sera pas publiée (vous pourrez la retrouver dans l’onglet Masquées).",
    ))
  )
    return;
  let removalFailed = false;
  await mutate(async () => {
    const result = await rpc(sb, "admin_set_status", {
      p_id: row.id,
      p_status: status,
    });
    if (result.result === "not_found")
      throw Object.assign(new Error(), {
        userMessage: "Cette photo n’est plus disponible.",
      });
    if (status === "deleted") {
      try {
        // Storage answers 200 with only the objects it really deleted: an empty or short list is a failure too.
        const removed = unwrap(
          await storage(sb).remove([row.full_path, row.thumb_path]),
        );
        if (removed?.length !== 2) removalFailed = true;
      } catch {
        removalFailed = true;
      }
    }
  });
  if (removalFailed)
    $("admin-message").textContent =
      "Photo retirée. Les fichiers n’ont pas pu être effacés du stockage ; prévenez l’organisateur pour terminer le nettoyage.";
}
$("login").onsubmit = async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $("admin-message").textContent = "";
  try {
    unwrap(
      await sb.auth.signInWithPassword({
        email: $("email").value.trim(),
        password: $("password").value,
      }),
    );
    $("password").value = "";
    await load();
  } catch (error) {
    $("admin-message").textContent = loginErrorText(error);
  } finally {
    $("password").value = "";
    button.disabled = false;
  }
};
$("logout").onclick = async () => {
  clearSessionUI();
  try {
    unwrap(await sb.auth.signOut({ scope: "local" }));
    $("admin-message").textContent = "Vous êtes déconnecté.";
  } catch {
    $("admin-message").textContent =
      "La déconnexion n’a pas pu être confirmée. Fermez cet onglet.";
  }
};
$("pause").onclick = () =>
  mutate(() => rpc(sb, "admin_set_paused", { p_paused: !paused }));
document.querySelectorAll("[data-filter]").forEach((button) => {
  button.onclick = () => {
    if (busy) return;
    filter = button.dataset.filter;
    selected.clear();
    lastSignature = "";
    document
      .querySelectorAll("[data-filter]")
      .forEach((tab) =>
        tab.setAttribute("aria-pressed", String(tab === button)),
      );
    load();
  };
});
document.querySelectorAll("[data-release]").forEach((button) => {
  button.onclick = async () => {
    const reason = button.dataset.release;
    if (paused) {
      $("admin-message").textContent =
        "Désactivez la validation avant publication avant de libérer un groupe de photos.";
      return;
    }
    if (
      !(await confirmAction(
        reason === "model_unavailable"
          ? "Publier les photos sans premier filtrage automatique ? Examinez-les avant de confirmer. Les photos signalées par le filtre restent en attente."
          : "Publier toutes les photos en attente de validation ? Examinez-les avant de confirmer.",
      ))
    )
      return;
    mutate(() => rpc(sb, "admin_release_pending", { p_reason: reason }));
  };
});
$("batch-approve").onclick = () => runBatch("approve");
$("batch-reject").onclick = () => runBatch("reject");
$("batch-remove").onclick = () => runBatch("remove");
$("select-all").onclick = () => {
  const everything = rows.every((row) => selected.has(row.id));
  selected.clear();
  if (!everything) rows.forEach((row) => selected.add(row.id));
  render();
};
// The queue refreshes by itself every 30 s (ticks kept, nothing redrawn when nothing changed).
setInterval(() => {
  if (
    !sb ||
    $("dashboard").hidden ||
    busy ||
    batchRunning ||
    document.hidden ||
    $("confirm-dialog").open ||
    $("admin-preview").open
  )
    return;
  load(false, true);
}, 30000);
$("admin-refresh").onclick = () => load();
$("admin-more").onclick = () => load(true);
bindDialog($("admin-preview"), $("preview-close"));
async function showPreview(row) {
  previewRow = row;
  // The grid thumbnail appears at once; the full-resolution file replaces it when decoded.
  $("preview-image").src = row.thumbUrl;
  $("preview-image").hidden = false;
  $("preview-message").textContent = "Chargement en haute définition…";
  $("admin-preview").showModal();
  try {
    const url = await fullUrl(sb, row);
    if (!$("admin-preview").open || previewRow !== row) return;
    const loader = new Image();
    loader.onload = () => {
      if (!$("admin-preview").open || previewRow !== row) return;
      $("preview-image").src = url;
      $("preview-message").textContent = "";
    };
    loader.onerror = () => {
      if (previewRow === row) $("preview-message").textContent = "Photo indisponible. Réessayez.";
    };
    loader.src = url;
  } catch {
    $("preview-message").textContent = "Photo indisponible. Réessayez.";
  }
}
$("admin-preview").addEventListener("close", () => {
  previewRow = null;
  $("preview-image").removeAttribute("src");
});
$("preview-download").onclick = async () => {
  try {
    const a = el("a");
    a.href = await fullUrl(sb, previewRow, true);
    a.download = "photo-mariage.jpg";
    document.body.append(a);
    a.click();
    a.remove();
  } catch {
    $("preview-message").textContent = "Téléchargement indisponible.";
  }
};
if (!sb) {
  $("admin-message").textContent =
    "L’administration sera disponible après la configuration du service photo.";
  $("login").querySelector("button").disabled = true;
} else {
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") clearSessionUI();
  });
  try {
    const { session } = unwrap(await sb.auth.getSession());
    if (session) await load();
  } catch {
    $("admin-message").textContent = "Session indisponible. Reconnectez-vous.";
  }
}
