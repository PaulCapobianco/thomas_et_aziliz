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
bindDialog($("confirm-dialog"));
let offset = 0;
let filter = "reported",
  rows = [],
  paused = false,
  busy = false,
  previewRow,
  generation = 0;
const reasons = {
  nsfw: "Contenu à vérifier",
  paused: "Publications suspendues",
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
function clearSessionUI() {
  generation++;
  rows = [];
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
      ["hidden", "Masquer"],
      ["published", row.status === "pending_review" ? "Publier" : "Restaurer"],
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
}
async function load(more = false) {
  if (!sb || busy) return;
  busy = true;
  const request = generation;
  $("admin-refresh").disabled = $("admin-more").disabled = true;
  try {
    const state = await rpc(sb, "admin_status");
    const list = await rpc(sb, "admin_list_photos", {
      p_filter: filter,
      p_limit: 48,
      p_offset: more ? offset : 0,
    });
    const signed = await signPhotos(sb, list);
    if (request !== generation) return;
    offset = (more ? offset : 0) + list.length;
    paused = state.paused;
    $("publication-state").textContent = paused
      ? "Nouvelles publications suspendues (la galerie reste visible)"
      : "Galerie publique en ligne";
    $("pause").textContent = paused
      ? "Reprendre les publications"
      : "Suspendre les nouvelles publications";
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
    $("admin-more").hidden = list.length < 48;
    $("release-actions").hidden = filter !== "pending";
    $("dashboard").hidden = false;
    $("login").hidden = true;
    $("logout").hidden = false;
  } catch (error) {
    if (request !== generation) return;
    if (error.code === "42501" || Number(error.status) === 401) {
      clearSessionUI();
      $("admin-message").textContent =
        "Ce compte n’a pas accès à l’administration.";
    } else $("admin-message").textContent = errorText(error);
  } finally {
    busy = false;
    $("admin-refresh").disabled = $("admin-more").disabled = false;
    render();
  }
}
async function mutate(operation, message = "Action enregistrée.") {
  if (busy) return;
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
  if (busy) return;
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
  } catch {
    $("admin-message").textContent =
      "Connexion impossible. Vérifiez vos identifiants et votre connexion.";
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
        "Reprenez les publications avant de libérer un groupe de photos.";
      return;
    }
    if (
      !(await confirmAction(
        reason === "model_unavailable"
          ? "Publier les photos sans premier filtrage automatique ? Examinez-les avant de confirmer. Les photos signalées par le filtre restent en attente."
          : "Publier les photos mises en attente uniquement à cause de la pause ?",
      ))
    )
      return;
    mutate(() => rpc(sb, "admin_release_pending", { p_reason: reason }));
  };
});
$("admin-refresh").onclick = () => load();
$("admin-more").onclick = () => load(true);
bindDialog($("admin-preview"), $("preview-close"));
async function showPreview(row) {
  previewRow = row;
  $("preview-image").hidden = true;
  $("preview-image").removeAttribute("src");
  $("preview-message").textContent = "Chargement…";
  $("admin-preview").showModal();
  try {
    const url = await fullUrl(sb, row);
    if (!$("admin-preview").open || previewRow !== row) return;
    $("preview-image").src = url;
    $("preview-image").hidden = false;
    $("preview-message").textContent = "";
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
