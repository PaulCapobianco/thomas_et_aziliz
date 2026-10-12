// Export des photos par dossier (administration). Une photo à la fois, archives ZIP par lots, rapport d'échecs, contrôle d'intégrité.
// Aucun droit supplémentaire : la liste vient de admin_list_photos et chaque fichier est lu avec fullUrl() (URL signée, rôle administrateur),
// exactement comme le bouton « Télécharger » de l'aperçu. Aucune clé secrète, aucune nouvelle règle d'accès.
import { $, el, rpc, fullUrl } from "./shared.js";
import { ZipStore, DEFAULT_LIMITS, byChronology, buildCsv, isJpeg, lotIsFull, lotName, photoFileName, sha256Hex } from "./export-zip.js";

const FOLDERS = {
  public: { label: "Galerie commune", filter: "recent" },
  maries: { label: "Uniquement aux mariés", filter: "maries" },
};
const STATUS_LABELS = { published: ["publiée", "publiées"], pending_review: ["en attente", "en attente"], hidden: ["masquée", "masquées"] };
const RETRY_DELAYS = [600, 1800];
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Réglages de test uniquement (lots plus petits, délais courts) ; absents en production.
const options = () => ({ limits: DEFAULT_LIMITS, delays: RETRY_DELAYS, ...(globalThis.__exportOptions || {}) });

export function setupExport(sb) {
  const state = {
    running: false,
    controller: null,
    // Par dossier : photos de la dernière liste, identifiants exportés, échecs, numéros d'ordre et prochain numéro de lot.
    folders: Object.fromEntries(Object.keys(FOLDERS).map((k) => [k, { rows: [], exported: new Set(), failed: new Map(), index: new Map(), nextLot: 1 }])),
  };
  const selectedStatuses = () =>
    new Set(
      [["published", "export-st-published"], ["pending_review", "export-st-pending"], ["hidden", "export-st-hidden"]]
        .filter(([, id]) => $(id).checked)
        .map(([status]) => status),
    );
  const countsText = (rows) =>
    Object.entries(STATUS_LABELS)
      .map(([status, words]) => [rows.filter((r) => r.status === status).length, words])
      .filter(([n]) => n)
      .map(([n, words]) => plural(n, words[0], words[1]))
      .join(" · ");
  async function listFolder(audience) {
    const out = [];
    for (let offset = 0; ; offset += 200) {
      const page = await rpc(sb, "admin_list_photos", { p_filter: FOLDERS[audience].filter, p_limit: 200, p_offset: offset });
      out.push(...page.filter((row) => row.audience === audience));
      if (page.length < 200) break;
    }
    return out.sort(byChronology);
  }
  function renderCounts() {
    const wanted = selectedStatuses();
    for (const audience of Object.keys(FOLDERS)) {
      const rows = state.folders[audience].rows;
      const n = rows.filter((r) => wanted.has(r.status)).length;
      $(`export-count-${audience}`).textContent = plural(n, "photo à exporter", "photos à exporter");
      $(`export-detail-${audience}`).textContent = rows.length ? `Dans ce dossier : ${countsText(rows)}.` : "Aucune photo dans ce dossier.";
      $(`export-btn-${audience}`).disabled = state.running || n === 0;
    }
  }
  async function refreshCounts() {
    if (state.running) return;
    $("export-refresh").disabled = true;
    $("export-error").textContent = "";
    try {
      for (const audience of Object.keys(FOLDERS)) state.folders[audience].rows = await listFolder(audience);
    } catch {
      $("export-error").textContent = "Impossible de lire la liste des photos. Vérifiez votre connexion puis actualisez.";
    }
    $("export-refresh").disabled = false;
    renderCounts();
  }
  function setRunning(running) {
    state.running = running;
    $("export-progress-panel").hidden = !running;
    $("export-refresh").disabled = running;
    for (const id of ["export-st-published", "export-st-pending", "export-st-hidden"]) $(id).disabled = running;
    for (const audience of Object.keys(FOLDERS)) $(`export-btn-${audience}`).disabled = running;
    $("export-retry").disabled = running;
    if (!running) renderCounts();
  }
  async function readPhoto(row, signal, delays) {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(await fullUrl(sb, row), { signal, cache: "no-store" });
        if (!response.ok) throw Object.assign(new Error(`http_${response.status}`), { status: response.status });
        const bytes = new Uint8Array(await response.arrayBuffer());
        const expected = Number(response.headers.get("content-length"));
        if (expected && expected !== bytes.length) throw new Error("incomplete");
        if (!isJpeg(bytes)) throw new Error("not_jpeg");
        return bytes;
      } catch (error) {
        if (signal.aborted) throw error;
        last = error;
        if (attempt < 2) await sleep(delays[attempt] ?? 0);
      }
    }
    throw last;
  }
  const reasonText = (error) =>
    error?.status === 404 || error?.statusCode === "404" || /not.found/i.test(error?.message || "") ? "fichier introuvable" : error?.status === 403 || error?.status === 401 ? "accès refusé" : error?.message === "not_jpeg" ? "fichier invalide" : error?.message === "incomplete" ? "téléchargement incomplet" : "réseau ou service indisponible";
  function save(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = el("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }
  function say(text) {
    $("export-label").textContent = text;
  }
  async function run(audience, retryOnly) {
    if (state.running) return;
    const folder = state.folders[audience];
    const { limits, delays } = options();
    $("export-error").textContent = "";
    $("export-result").hidden = true;
    setRunning(true);
    state.controller = new AbortController();
    const { signal } = state.controller;
    let targets;
    try {
      if (retryOnly) {
        targets = [...folder.failed.values()].map((f) => f.row);
        folder.failed.clear();
      } else {
        folder.rows = await listFolder(audience);
        const wanted = selectedStatuses();
        targets = folder.rows.filter((r) => wanted.has(r.status));
        // Nouvelle exportation : nouveaux numéros d'ordre et numérotation des lots depuis 1.
        folder.exported = new Set();
        folder.failed = new Map();
        folder.index = new Map(targets.map((row, i) => [row.id, i + 1]));
        folder.nextLot = 1;
        folder.filterUsed = [...wanted];
      }
    } catch {
      $("export-error").textContent = "Impossible de lire la liste des photos. Vérifiez votre connexion puis réessayez.";
      setRunning(false);
      return;
    }
    const total = targets.length;
    let processed = 0;
    let zip = new ZipStore();
    let items = [];
    let cancelled = false;
    const remainingInLot = () => Math.min(limits.maxPhotos, total - processed + items.length);
    const lotsTotal = () => folder.nextLot + Math.max(0, Math.ceil((total - processed - (limits.maxPhotos - items.length > 0 ? limits.maxPhotos - items.length : 0)) / limits.maxPhotos));
    const progress = () => {
      say(`Lot ${folder.nextLot} sur ${Math.max(folder.nextLot, lotsTotal())} : ${items.length} sur ${remainingInLot()}`);
      $("export-bar").value = total ? Math.round((processed / total) * 100) : 100;
    };
    const flush = () => {
      if (!items.length) return;
      zip.add("index.csv", new TextEncoder().encode(buildCsv(items)));
      save(zip.finish(), lotName(audience, folder.nextLot));
      folder.nextLot++;
      zip = new ZipStore();
      items = [];
    };
    progress();
    for (const row of targets) {
      if (signal.aborted) {
        cancelled = true;
        break;
      }
      try {
        const bytes = await readPhoto(row, signal, delays);
        const name = photoFileName(folder.index.get(row.id), row);
        const sha256 = await sha256Hex(bytes);
        zip.add(name, bytes, new Date(row.created_at));
        items.push({ name, id: row.id, created_at: row.created_at, audience: row.audience, status: row.status, review_reason: row.review_reason, size: bytes.length, sha256 });
        folder.exported.add(row.id);
        folder.failed.delete(row.id);
      } catch (error) {
        if (signal.aborted) {
          cancelled = true;
          break;
        }
        folder.failed.set(row.id, { row, reason: reasonText(error) });
      }
      processed++;
      if (lotIsFull(items.length, zip.bytes, limits)) flush();
      progress();
    }
    flush();
    state.controller = null;
    setRunning(false);
    await report(audience, cancelled);
  }
  // Contrôle d'intégrité : photos exportées comparées à la base (dossier + statuts choisis), au moment de la fin.
  async function report(audience, cancelled) {
    const folder = state.folders[audience];
    const box = $("export-result");
    $("export-failures").replaceChildren();
    let dbRows;
    try {
      dbRows = (await listFolder(audience)).filter((r) => new Set(folder.filterUsed).has(r.status));
    } catch {
      dbRows = null;
    }
    const lines = [];
    let complete = false;
    if (dbRows) {
      const dbIds = new Set(dbRows.map((r) => r.id));
      const done = [...folder.exported].filter((id) => dbIds.has(id)).length;
      const missing = dbRows.filter((r) => !folder.exported.has(r.id));
      const extra = [...folder.exported].filter((id) => !dbIds.has(id));
      complete = !missing.length && !extra.length && !folder.failed.size && !cancelled;
      lines.push(
        complete
          ? `Export complet : ${done} photos sur ${dbRows.length}.`
          : `${cancelled ? "Export interrompu" : "Export incomplet"} : ${done} photos sur ${dbRows.length}.`,
      );
      for (const row of missing) lines.push(`Manquante : ${row.id.slice(0, 8)} (${folder.failed.get(row.id)?.reason || (cancelled ? "export interrompu" : "ajoutée ou modifiée pendant l’export")})`);
      for (const id of extra) lines.push(`En trop : ${id.slice(0, 8)} (retirée de la sélection pendant l’export)`);
    } else lines.push("Contrôle impossible : la liste des photos n’a pas pu être relue.");
    $("export-summary").textContent = lines[0];
    for (const line of lines.slice(1)) $("export-failures").append(el("li", line));
    const lots = folder.nextLot - 1;
    $("export-lots").textContent = lots ? `${plural(lots, "archive téléchargée", "archives téléchargées")} (${lotName(audience, 1)}${lots > 1 ? ` … ${lotName(audience, lots)}` : ""}).` : "Aucune archive téléchargée.";
    $("export-retry").hidden = !folder.failed.size;
    $("export-retry").dataset.audience = audience;
    $("export-retry").textContent = `Réessayer les échecs (${folder.failed.size})`;
    box.hidden = false;
    $("export-summary").focus();
  }
  for (const audience of Object.keys(FOLDERS)) $(`export-btn-${audience}`).onclick = () => run(audience, false);
  $("export-retry").onclick = () => run($("export-retry").dataset.audience, true);
  $("export-cancel").onclick = () => {
    say("Annulation en cours… le lot en cours est enregistré avec les photos déjà lues.");
    state.controller?.abort();
  };
  $("export-refresh").onclick = refreshCounts;
  for (const id of ["export-st-published", "export-st-pending", "export-st-hidden"]) $(id).onchange = renderCounts;
  const phone = matchMedia("(max-width: 820px), (pointer: coarse)").matches;
  $("export-mobile-warning").hidden = !phone;
  return {
    get active() {
      return state.running;
    },
    cancel: () => state.controller?.abort(),
    show: refreshCounts,
  };
}
