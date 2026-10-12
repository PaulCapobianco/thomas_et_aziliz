// Export des photos : archive ZIP « stockée » (sans compression : les JPEG ne se compressent pas), CRC-32, SHA-256, CSV et noms.
// Module sans dépendance ni accès au DOM : utilisé par l'administration (navigateur) et testé aussi sous Node.
const TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
const dosDate = (d) => ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
const dosTime = (d) => (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
const enc = new TextEncoder();

// Construit une archive ZIP par morceaux : chaque photo devient un Blob (le moteur du navigateur peut le garder hors du tas JS),
// seul l'en-tête de chaque entrée reste en mémoire. Pas de ZIP64 : un lot reste très en dessous de 4 Go et de 65 535 entrées.
export class ZipStore {
  constructor() {
    this.parts = [];
    this.entries = [];
    this.offset = 0;
  }
  get count() {
    return this.entries.length;
  }
  get bytes() {
    return this.offset;
  }
  // data : Uint8Array (déjà en mémoire pour calculer le CRC) ; il n'est pas conservé, seulement son Blob.
  add(name, data, date = new Date()) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true); // noms en UTF-8
    header.setUint16(8, 0, true); // méthode 0 = stocké
    header.setUint16(10, dosTime(date), true);
    header.setUint16(12, dosDate(date), true);
    header.setUint32(14, crc, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, 0, true);
    this.entries.push({ nameBytes, crc, size: data.length, offset: this.offset, time: dosTime(date), date: dosDate(date) });
    this.parts.push(header.buffer, nameBytes, new Blob([data]));
    this.offset += 30 + nameBytes.length + data.length;
  }
  finish() {
    const start = this.offset;
    let size = 0;
    for (const e of this.entries) {
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 20, true);
      h.setUint16(8, 0x0800, true);
      h.setUint16(10, 0, true);
      h.setUint16(12, e.time, true);
      h.setUint16(14, e.date, true);
      h.setUint32(16, e.crc, true);
      h.setUint32(20, e.size, true);
      h.setUint32(24, e.size, true);
      h.setUint16(28, e.nameBytes.length, true);
      h.setUint32(42, e.offset, true);
      this.parts.push(h.buffer, e.nameBytes);
      size += 46 + e.nameBytes.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, start, true);
    this.parts.push(end.buffer);
    return new Blob(this.parts, { type: "application/zip" });
  }
}

export const folderKey = (audience) => (audience === "maries" ? "maries" : "public");
export const lotName = (audience, lot) => `mariage-${folderKey(audience)}-lot-${String(lot).padStart(2, "0")}.zip`;
// 0001_2026-10-31T1432_1a2b3c4d.jpg : numéro d'ordre chronologique (stable), date d'envoi en UTC, 8 premiers caractères de l'identifiant.
export function photoFileName(index, row) {
  const d = new Date(row.created_at);
  const stamp = d.toISOString().slice(0, 16).replace(":", "");
  return `${String(index).padStart(4, "0")}_${stamp}_${String(row.id).slice(0, 8)}.jpg`;
}
export const byChronology = (a, b) =>
  String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id));
export const CSV_HEADER = "fichier,identifiant,date_envoi,audience,statut,raison_attente,taille_octets,sha256";
const cell = (value) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
export function csvLine(item) {
  return [item.name, item.id, new Date(item.created_at).toISOString(), item.audience, item.status, item.review_reason ?? "", item.size, item.sha256]
    .map(cell)
    .join(",");
}
export const buildCsv = (items) => `${[CSV_HEADER, ...items.map(csvLine)].join("\r\n")}\r\n`;
// Un lot se ferme au premier des deux seuils : nombre de photos ou octets.
export const lotIsFull = (count, bytes, limits) => count >= limits.maxPhotos || bytes >= limits.maxBytes;
export const DEFAULT_LIMITS = { maxPhotos: 100, maxBytes: 150 * 1024 * 1024 };
export const isJpeg = (bytes) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
