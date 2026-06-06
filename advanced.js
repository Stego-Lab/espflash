// ─────────────────────────────────────────────────────────────────────────────
// Erweitert-Bereich: Hardware-Erkennung, eigene Firmware flashen & serielle Konsole
// Nutzt esptool-js (lokal vendor-t). Der simple 1-2-3-Flow (ESP Web Tools)
// bleibt davon unberührt — dies ist ein separater Power-User-Pfad.
//
// Erkennungs-Strategie (zwei Stufen, weil eine eindeutige Board-Erkennung allein
// aus dem Bootloader physikalisch nicht möglich ist):
//   1) BOOTLOADER (sofort beim Verbinden, esptool-js): Chip-Familie + Flash-Größe
//      + eingebautes PSRAM/Flash → grenzt auf eine KANDIDATEN-GRUPPE ein.
//      Die MAC-OUI gehört IMMER Espressif und sagt nichts über Heltec/Lilygo aus,
//      genauso die USB-Bridge — beide werden nur informativ angezeigt.
//   2) FIRMWARE (serielle Konsole): MeshCom liefert auf den Befehl „--info“ ein
//      JSON mit der HWID → das ist die EINDEUTIGE Board-Bestätigung.
// ─────────────────────────────────────────────────────────────────────────────
import { ESPLoader, Transport } from "./vendor/esptool-js/bundle.js";

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// USB-UART-Bridges nach VID (aus navigator.serial getInfo()).
// Identifiziert die UART-Bridge, NICHT das Board — viele Boards teilen sich dieselbe.
const USB_BRIDGES = {
  0x10c4: "Silicon Labs (CP210x)",
  0x1a86: "WCH (CH340 / CH9102)",
  0x0403: "FTDI",
  0x303a: "Espressif (native USB)",
};

// ── MeshCom-Board-Datenbank ─────────────────────────────────────────────────
// Alle von esptool.oevsv.at unterstützten Module. Die HWIDs stammen aus
// MeshCom-Firmware/src/configuration_global.h (MODUL_HARDWARE-Defines) und werden
// per „--info“ zur eindeutigen Erkennung herangezogen.
//
// Felder:
//   family : "ESP32-S3" | "ESP32" | "nRF52840"  (entspricht esptool-js CHIP_NAME)
//   flash  : erwartete Flash-Größen (z. B. ["8MB"]); [] = beliebig / nicht prüfen
//   psram  : true = mit PSRAM, false = ohne, null = unbekannt/kein Ausschluss
//   hwid   : MeshCom-HWID(s) für den --info-Abgleich
//   bridge : typische USB-UART-Bridge (nur informativ)
//   nrf52  : true → nicht per Web-Serial/esptool erkenn- oder flashbar (nur UF2)
const KNOWN_BOARDS = [
  // ── Heltec ESP32-S3 (S3FN8: 8 MB Flash im Package, KEIN PSRAM) ─────────────
  { id: "heltec-wireless-paper", name: "Heltec Wireless Paper", family: "ESP32-S3",
    flash: ["8MB"], psram: false, hwid: [57], bridge: "CP2102",
    photo: "img/heltec-wireless-paper.png",
    hint: "ESP32-S3FN8 · SX1262 · 2,13″ E-Ink · kein PSRAM" },
  { id: "heltec-v3", name: "Heltec WiFi LoRa 32 V3", family: "ESP32-S3",
    flash: ["8MB"], psram: false, hwid: [43], bridge: "CP2102",
    photo: "img/heltec-v3.png",
    hint: "ESP32-S3FN8 · SX1262 · 0,96″ OLED · kein PSRAM" },
  { id: "heltec-v4", name: "Heltec WiFi LoRa 32 V4", family: "ESP32-S3",
    flash: ["8MB"], psram: false, hwid: [52], bridge: "CP2102",
    photo: "img/heltec-v4.png",
    hint: "ESP32-S3 · SX1262 · 0,96″ OLED" },
  { id: "heltec-tracker", name: "Heltec Wireless Tracker", family: "ESP32-S3",
    flash: ["8MB"], psram: false, hwid: [41], bridge: "CP2102",
    photo: "img/heltec-tracker.png",
    hint: "ESP32-S3 · SX1262 · UC6580-GNSS · 0,96″ TFT" },
  { id: "heltec-stick-v3", name: "Heltec Wireless Stick V3", family: "ESP32-S3",
    flash: ["8MB"], psram: false, hwid: [42], bridge: "CP2102",
    photo: "img/heltec-stick-v3.png",
    hint: "ESP32-S3 · SX1262 · 0,49″ OLED" },
  { id: "heltec-e290", name: "Heltec Vision Master E290", family: "ESP32-S3",
    flash: ["8MB"], psram: false, hwid: [44], bridge: "CP2102",
    photo: "img/heltec-e290.png",
    hint: "ESP32-S3 · SX1262 · 2,9″ E-Ink" },

  // ── Heltec ESP32 (classic) ────────────────────────────────────────────────
  { id: "heltec-v2", name: "Heltec WiFi LoRa 32 V2", family: "ESP32",
    flash: ["8MB", "4MB"], psram: false, hwid: [10, 11], bridge: "CP2102",
    photo: "img/board-placeholder.svg",
    hint: "ESP32 · SX1276 · 0,96″ OLED" },

  // ── Lilygo / TTGO ESP32-S3 ────────────────────────────────────────────────
  { id: "lilygo-t3s3", name: "Lilygo T3-S3", family: "ESP32-S3",
    flash: ["16MB"], psram: null, hwid: [55], bridge: "native USB / CH9102",
    photo: "img/lilygo-t3s3.jpg",
    hint: "ESP32-S3 · SX1262/SX1276 · 0,96″ OLED" },
  { id: "tbeam-1w", name: "Lilygo T-Beam 1W", family: "ESP32-S3",
    flash: ["16MB"], psram: true, hwid: [51], bridge: "native USB",
    photo: "img/tbeam-1w.jpg",
    hint: "ESP32-S3 · 1-W-PA · GNSS" },
  { id: "tbeam-supreme", name: "Lilygo T-Beam Supreme", family: "ESP32-S3",
    flash: ["16MB"], psram: true, hwid: [47], bridge: "native USB",
    photo: "img/lilygo-tbeam-supreme.jpg",
    hint: "ESP32-S3 (N16R8, 8 MB PSRAM) · LR1121/SX1262 · GNSS" },
  { id: "t-connect-pro", name: "Lilygo T-Connect Pro", family: "ESP32-S3",
    flash: ["16MB"], psram: true, hwid: [56], bridge: "native USB",
    photo: "img/lilygo-tconnect-pro.jpg",
    hint: "ESP32-S3 · Touch-Display" },
  { id: "t-deck", name: "Lilygo T-Deck", family: "ESP32-S3",
    flash: ["16MB"], psram: true, hwid: [8], bridge: "native USB",
    photo: "img/lilygo-tdeck.jpg",
    hint: "ESP32-S3 (8 MB PSRAM) · Tastatur · 2,8″ TFT" },
  { id: "t-deck-plus", name: "Lilygo T-Deck Plus", family: "ESP32-S3",
    flash: ["16MB"], psram: true, hwid: [46], bridge: "native USB",
    photo: "img/lilygo-tdeck-plus.jpg",
    hint: "ESP32-S3 (8 MB PSRAM) · GNSS · Akku" },
  { id: "t-deck-pro", name: "Lilygo T-Deck Pro", family: "ESP32-S3",
    flash: ["16MB"], psram: true, hwid: [50], bridge: "native USB",
    photo: "img/lilygo-tdeck-pro.jpg",
    hint: "ESP32-S3 · E-Ink · Tastatur" },

  // ── Lilygo / TTGO ESP32 (classic) ─────────────────────────────────────────
  { id: "tbeam", name: "Lilygo T-Beam", family: "ESP32",
    flash: ["4MB", "8MB"], psram: false, hwid: [4, 12], bridge: "CP2102 / CH9102",
    photo: "img/lilygo-tbeam.jpg",
    hint: "ESP32 · SX1276 · NEO-6M/8M-GNSS · AXP-PMU" },
  { id: "tbeam-sx1262", name: "Lilygo T-Beam (SX1262)", family: "ESP32",
    flash: ["4MB", "8MB"], psram: false, hwid: [45], bridge: "CP2102 / CH9102",
    photo: "img/lilygo-tbeam.jpg",
    hint: "ESP32 · SX1262 · GNSS · AXP-PMU" },
  { id: "tbeam-sx1268", name: "Lilygo T-Beam (SX1268)", family: "ESP32",
    flash: ["4MB", "8MB"], psram: false, hwid: [5], bridge: "CP2102 / CH9102",
    photo: "img/lilygo-tbeam.jpg",
    hint: "ESP32 · SX1268 (433 MHz) · GNSS" },
  { id: "tlora", name: "Lilygo T-LoRa", family: "ESP32",
    flash: ["4MB"], psram: false, hwid: [1, 2], bridge: "CP2102 / CH9102",
    photo: "img/tlora.jpg",
    hint: "ESP32 · SX127x · 0,96″ OLED" },

  // ── Ebyte E22 (ESP32-DevKitC + E22-LoRa-Modul) ────────────────────────────
  { id: "ebyte-e22", name: "Ebyte E22 (ESP32)", family: "ESP32",
    flash: ["4MB", "8MB", "16MB"], psram: null, hwid: [39], bridge: "CP2102 / CH340",
    photo: "img/board-placeholder.svg",
    hint: "ESP32-DevKitC · E22 (SX1262/SX1268) · 433/868/915 MHz" },
  { id: "ebyte-e22-s3", name: "Ebyte E22 S3", family: "ESP32-S3",
    flash: ["16MB"], psram: true, hwid: [48], bridge: "native USB / CH343",
    photo: "img/board-placeholder.svg",
    hint: "ESP32-S3-DevKitC-1 (N16R8) · E22 · 433/868/915 MHz" },

  // ── nRF52840 — NICHT per Web-Serial/esptool erkenn- oder flashbar (nur UF2) ─
  { id: "rak4631", name: "RAK WisBlock RAK4631", family: "nRF52840",
    flash: [], psram: null, hwid: [9], bridge: "—", nrf52: true,
    photo: "img/rak4631.png",
    hint: "nRF52840 · SX1262 · UF2/ZIP-Flash (kein esptool)" },
  { id: "t-echo", name: "Lilygo T-Echo", family: "nRF52840",
    flash: [], psram: null, hwid: [7], bridge: "—", nrf52: true,
    photo: "img/lilygo-techo.jpg",
    hint: "nRF52840 · SX1262 · E-Ink · UF2/ZIP-Flash (kein esptool)" },
  { id: "heltec-t114", name: "Heltec Mesh Node T114", family: "nRF52840",
    flash: [], psram: null, hwid: [54], bridge: "—", nrf52: true,
    photo: "img/heltec-t114.png",
    hint: "nRF52840 · SX1262 · 1,14″ TFT · UF2/ZIP-Flash (kein esptool)" },
];

// HWID → Board-Objekt (für die eindeutige --info-Erkennung)
const BOARD_BY_HWID = (() => {
  const m = new Map();
  for (const b of KNOWN_BOARDS) for (const h of b.hwid || []) m.set(h, b);
  return m;
})();

// Bootloader-Eingrenzung: liefert ALLE Boards, deren Signatur zu den sicher
// auslesbaren Chip-Daten passt (Kandidaten-Gruppe, KEINE Garantie).
function matchCandidates({ family, flash, psram }) {
  return KNOWN_BOARDS.filter((b) => {
    if (b.nrf52) return false; // nRF52 kann der Bootloader gar nicht melden
    if (b.family !== family) return false;
    if (b.flash.length && flash && flash !== "unbekannt" && !b.flash.includes(flash))
      return false;
    // PSRAM nur als Ausschluss, wenn beide Seiten eindeutig sind
    if (psram === true && b.psram === false) return false;
    if (psram === false && b.psram === true) return false;
    return true;
  });
}

// Panel-Controller (MeshCom-Boot-Log) → Heltec-HW-Gruppe
function panelToHw(panel) {
  const p = (panel || "").toUpperCase();
  if (p.includes("LCMEN")) return "HW V1.1";
  if (p.includes("E0213A367")) return "HW V1.0 / V1.1.1 / V1.2";
  return "unbekannt";
}

// Web Serial vorhanden? Sonst Bereich deaktivieren.
if (!("serial" in navigator)) {
  const note = $("adv-unsupported");
  if (note) note.hidden = false;
  const fs = $("adv-fieldset");
  if (fs) fs.setAttribute("disabled", "");
}

// ── Status-Helfer ────────────────────────────────────────────────────────────
function setStatus(el, msg, kind = "") {
  if (!el) return;
  el.textContent = msg;
  el.className = "adv-status" + (kind ? " " + kind : "");
}

// HTML-Escape für unsichere Strings (Chip-Desc, Firmware-Strings)
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Uint8Array → "binary string" (esptool-js erwartet 1 Zeichen = 1 Byte)
function u8ToBinaryString(u8) {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return s;
}

// Klassischer Hard-Reset in den App-Modus (CP2102: RTS→EN, DTR→IO0)
async function resetToApp(tr) {
  try {
    await tr.setDTR(false);
    await tr.setRTS(true); // EN low → Reset
    await sleep(100);
    await tr.setDTR(false);
    await tr.setRTS(false); // EN high, IO0 high → App-Boot
    await sleep(50);
  } catch (_) {}
}

// ── Board-Galerie rendern (Kandidaten oder eindeutiges Board) ────────────────
// boards: Array von Board-Objekten; opts.confirmed = eindeutig bestätigt (1 Board)
function renderGallery(boards, opts = {}) {
  const gal = $("adv-gallery");
  if (!gal) return;
  if (!boards || !boards.length) {
    gal.hidden = true;
    gal.innerHTML = "";
    return;
  }
  const cls = opts.confirmed ? "adv-board confirmed" : "adv-board";
  gal.innerHTML = boards
    .map(
      (b) => `
      <figure class="${cls}">
        <img src="${esc(b.photo)}" alt="${esc(b.name)}" loading="lazy"
             onerror="this.onerror=null;this.src='img/board-placeholder.svg'" />
        <figcaption>
          <b>${esc(b.name)}</b>
          <span>${esc(b.hint)}</span>
        </figcaption>
      </figure>`
    )
    .join("");
  gal.hidden = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Teil A: Verbinden + Hardware-Erkennung + eigene Firmware flashen
// ─────────────────────────────────────────────────────────────────────────────
let device = null;
let transport = null;
let esploader = null;
let connected = false;

const logEl = $("adv-log");
const term = {
  clean() {
    if (logEl) logEl.textContent = "";
  },
  writeLine(data) {
    this.write((data ?? "") + "\n");
  },
  write(data) {
    if (!logEl) return;
    logEl.textContent += data ?? "";
    logEl.scrollTop = logEl.scrollHeight;
  },
};

const elConnect = $("adv-connect");
const elDisconnect = $("adv-disconnect");
const elFlash = $("adv-flash");
const elFile = $("adv-file");
const elOffsetSel = $("adv-offset");
const elCustomOffset = $("adv-offset-custom");
const elErase = $("adv-erase");
const elInfo = $("adv-info");
const elStatus = $("adv-status");
const elProg = $("adv-progress");
const elProgBar = $("adv-progress-bar");

function setFlashEnabled(on) {
  if (elFlash) elFlash.disabled = !on;
  if (elConnect) elConnect.disabled = on;
  // Die „Stoppen“-Buttons bleiben immer klickbar (siehe stopAll).
}

// Beendet ALLES, was gerade offen ist — sowohl die Flash-/Auslese-Session
// (Teil A) als auch die serielle Konsole (Teil B). Beide „Stoppen“-Buttons
// rufen diese Funktion, damit sie identisch und jederzeit funktionieren.
//
// Reentrancy-Guard: mehrfaches/schnelles Klicken darf NICHT mehrere parallele
// disconnect()-Aufrufe auf denselben Web-Serial-Stream auslösen — das brachte
// den Browser-Tab zum Absturz. Überlappende Aufrufe werden hier verworfen.
let stopping = false;
async function stopAll() {
  if (stopping) return;
  stopping = true;
  try {
    setConRunning(false); // Lese-Schleife der Konsole beenden
    await cleanup(); // Teil A: esptool-Session trennen
    await conCleanup(); // Teil B: Konsole trennen
  } finally {
    stopping = false;
  }
}

elOffsetSel?.addEventListener("change", () => {
  if (elCustomOffset) elCustomOffset.hidden = elOffsetSel.value !== "custom";
});

function currentOffset() {
  const v = elOffsetSel?.value ?? "0";
  if (v === "custom") {
    const raw = (elCustomOffset?.querySelector("input")?.value || "")
      .trim()
      .replace(/^0x/i, "");
    const n = parseInt(raw, 16);
    if (!raw || isNaN(n) || n < 0) return null;
    return n;
  }
  return parseInt(v, 10);
}

// Liest die sicher verfügbaren Chip-Daten (Familie, Flash, PSRAM, MAC, Bridge).
async function readChipFacts(chipDesc) {
  const facts = {
    family: esploader.chip?.CHIP_NAME || "?",
    chipDesc: chipDesc || esploader.chip?.CHIP_NAME || "?",
    flash: "unbekannt",
    psram: null,
    psramText: "",
    embFlashText: "",
    mac: "—",
    bridge: "—",
  };

  // MAC (OUI gehört IMMER Espressif → kein Board-Indikator, nur Bestätigung)
  try {
    const m = await esploader.chip.readMac(esploader);
    facts.mac =
      typeof m === "string"
        ? m.toLowerCase()
        : Array.from(m)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(":");
  } catch (_) {}

  // Flash-Größe
  try {
    const flid = await esploader.readFlashId();
    facts.flash =
      esploader.DETECTED_FLASH_SIZES[(flid >> 16) & 0xff] || "unbekannt";
  } catch (_) {}

  // Chip-Features (enthält bei S3/S2 eingebautes Flash + PSRAM aus eFuse)
  try {
    const feats = await esploader.chip.getChipFeatures(esploader);
    const list = Array.isArray(feats) ? feats.map((f) => String(f).trim()) : [];
    const psramHit = list.find((f) => /Embedded PSRAM\s+(\d+)MB/i.test(f));
    const flashHit = list.find((f) => /Embedded Flash\s+(\d+)MB/i.test(f));
    if (psramHit) {
      facts.psram = true;
      facts.psramText = psramHit;
    } else if (list.some((f) => /No Embedded PSRAM/i.test(f))) {
      facts.psram = false;
    }
    if (flashHit) facts.embFlashText = flashHit;
  } catch (_) {}

  // USB-Bridge aus den Port-Infos (identifiziert die UART-Bridge, nicht das Board)
  try {
    const di = device.getInfo?.() || {};
    if (di.usbVendorId != null) {
      const vendor = USB_BRIDGES[di.usbVendorId] || "unbekannt";
      const ids =
        di.usbVendorId.toString(16).padStart(4, "0") +
        ":" +
        (di.usbProductId ?? 0).toString(16).padStart(4, "0");
      facts.bridge = `${vendor} (${ids})`;
    }
  } catch (_) {}

  return facts;
}

// Baut die Info-Tabelle + Galerie aus den Chip-Fakten und Kandidaten.
function showDetection(facts) {
  const candidates = matchCandidates({
    family: facts.family,
    flash: facts.flash,
    psram: facts.psram,
  });

  let verdict;
  if (candidates.length === 1) {
    verdict = `sehr wahrscheinlich <b>${esc(candidates[0].name)}</b>`;
  } else if (candidates.length > 1) {
    verdict =
      `${candidates.length} mögliche Module ` +
      `(${esc(facts.family)}${
        facts.flash !== "unbekannt" ? " · " + esc(facts.flash) : ""
      }) — zur eindeutigen Bestimmung unten die <b>serielle Konsole</b> starten`;
  } else {
    verdict =
      `kein bekanntes MeshCom-Modul zu diesen Chip-Daten — ` +
      `nur die Chip-Werte sind gesichert`;
  }

  const psramStr =
    facts.psram === true
      ? facts.psramText || "ja"
      : facts.psram === false
      ? "nein"
      : "n/v";

  if (elInfo) {
    elInfo.hidden = false;
    elInfo.innerHTML =
      `<dt>Einschätzung</dt><dd>${verdict}</dd>` +
      `<dt>Chip</dt><dd>${esc(facts.chipDesc)}</dd>` +
      `<dt>Flash</dt><dd>${esc(facts.flash)}${
        facts.embFlashText ? " · " + esc(facts.embFlashText) : ""
      }</dd>` +
      `<dt>PSRAM</dt><dd>${psramStr}</dd>` +
      `<dt>MAC</dt><dd>${esc(facts.mac)} <span class="adv-muted">(Espressif-OUI – kein Board-Indikator)</span></dd>` +
      `<dt>USB-Bridge</dt><dd>${esc(facts.bridge)} <span class="adv-muted">(identifiziert die UART-Bridge, nicht das Board)</span></dd>`;
  }

  renderGallery(candidates, { confirmed: candidates.length === 1 });
}

elConnect?.addEventListener("click", async () => {
  try {
    setStatus(elStatus, "Port wählen…");
    device = await navigator.serial.requestPort();
    transport = new Transport(device, false);
    // baudrate = Ziel-Rate für den Flash-Transfer (schnell). esptool-js synct
    // zuerst sicher im ROM bei romBaudrate (115200) und schaltet dann hoch.
    esploader = new ESPLoader({
      transport,
      baudrate: 921600,
      romBaudrate: 115200,
      terminal: term,
    });

    setStatus(elStatus, "Verbinde & erkenne Chip…");
    term.clean();
    const chipDesc = await esploader.main(); // erkennt Chip, startet Stub

    setStatus(elStatus, "Lese Hardware-Daten…");
    const facts = await readChipFacts(chipDesc);
    showDetection(facts);

    connected = true;
    setFlashEnabled(true);
    const cand = matchCandidates({
      family: facts.family,
      flash: facts.flash,
      psram: facts.psram,
    });
    setStatus(
      elStatus,
      cand.length === 1
        ? `✓ Verbunden – ${cand[0].name} erkannt.`
        : cand.length > 1
        ? `✓ Verbunden – ${cand.length} mögliche Module. Konsole für eindeutige Erkennung.`
        : "✓ Verbunden. Du kannst jetzt eine Datei flashen.",
      "ok"
    );
  } catch (e) {
    setStatus(elStatus, "Fehler: " + (e?.message || e), "err");
    await cleanup();
  }
});

elDisconnect?.addEventListener("click", async () => {
  await stopAll();
  setStatus(elStatus, "Gestoppt – Verbindung getrennt.");
});

async function cleanup() {
  // Referenz lokal sichern und Variable SOFORT nullen, damit ein zweiter
  // (überlappender) Aufruf denselben Transport nicht erneut schließt.
  const t = transport;
  device = transport = esploader = null;
  connected = false;
  setFlashEnabled(false);
  if (elProg) elProg.hidden = true;
  if (elInfo) elInfo.hidden = true;
  renderGallery([]);
  try {
    if (t) await t.disconnect();
  } catch (_) {}
}

elFlash?.addEventListener("click", async () => {
  if (!connected || !esploader) {
    setStatus(elStatus, "Erst verbinden.", "err");
    return;
  }
  const file = elFile?.files?.[0];
  if (!file) {
    setStatus(elStatus, "Bitte eine .bin-Datei wählen.", "err");
    return;
  }
  const offset = currentOffset();
  if (offset == null) {
    setStatus(elStatus, "Ungültiger Offset (hex erwartet, z. B. 10000).", "err");
    return;
  }
  const erase = !!elErase?.checked;
  const ok = window.confirm(
    `„${file.name}" (${file.size.toLocaleString("de")} Bytes) an Offset ` +
      `0x${offset.toString(16)} flashen?` +
      (erase ? "\n\n⚠ Vorher wird der GESAMTE Flash gelöscht." : "")
  );
  if (!ok) return;

  try {
    if (elProg) elProg.hidden = false;
    setProgress(0);
    setStatus(elStatus, "Lese Datei…");
    const buf = await file.arrayBuffer();
    const data = u8ToBinaryString(new Uint8Array(buf));

    setStatus(elStatus, erase ? "Lösche & schreibe…" : "Schreibe Flash…");
    await esploader.writeFlash({
      fileArray: [{ data, address: offset }],
      flashSize: "keep",
      flashMode: "keep",
      flashFreq: "keep",
      eraseAll: erase,
      compress: true,
      reportProgress: (_i, written, total) => setProgress(written / total),
    });

    setStatus(elStatus, "Geschrieben – starte Board neu…");
    await resetToApp(transport);
    setProgress(1);
    setStatus(elStatus, "✓ Fertig. Board neu gestartet.", "ok");
  } catch (e) {
    setStatus(elStatus, "Flash-Fehler: " + (e?.message || e), "err");
  }
});

function setProgress(frac) {
  const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
  if (elProgBar) elProgBar.style.width = pct + "%";
  if (elProg) elProg.setAttribute("aria-valuenow", String(pct));
}

// ─────────────────────────────────────────────────────────────────────────────
// Teil B: Serielle Konsole — liest die laufende Firmware & bestätigt das Board
//         eindeutig über den MeshCom-Befehl „--info“ (HWID).
// ─────────────────────────────────────────────────────────────────────────────
let conPort = null;
let conTransport = null;
let conRunning = false;
let conWriter = null;

const elConStart = $("adv-con-start");
const elConStop = $("adv-con-stop");
const elConClear = $("adv-con-clear");
const elConInfo = $("adv-con-info");
const elBaud = $("adv-baud");
const elConOut = $("adv-con-out");
const elConStatus = $("adv-con-status");
const elPanel = $("adv-panel");

let conBuf = "";
let panelFound = false;
let hwidFound = false;

// Boot-Log nach dem Panel-Controller durchsuchen (Heltec E-Ink-Versionen)
function scanPanel(text) {
  if (panelFound) return;
  const m =
    conBuf.match(/->\s*(E0213A367|LCMEN2R13EFC1)/i) ||
    conBuf.match(/\b(E0213A367|LCMEN2R13EFC1)\b/i);
  if (m && elPanel) {
    panelFound = true;
    const panel = m[1].toUpperCase();
    elPanel.hidden = false;
    elPanel.className = "adv-panel ok";
    elPanel.textContent = `🟢 Erkanntes Panel: ${panel} → ${panelToHw(panel)}`;
  }
}

// MeshCom-„--info“ gibt die HWID in zwei Formaten aus:
//   • Serial-Klartext: „…NODE 57 <Heltec Wireless Paper>…“ (HWID + Langname)
//   • Phone/JSON:      „"HWID":57“
// Sobald wir eine HWID sehen, ist das Board EINDEUTIG bestimmt.
function scanHwid(text) {
  if (hwidFound) return;
  let hwid = null;
  let fwName = null;

  // Bevorzugt das Klartext-Format mit direktem Board-Namen
  const nodeM = conBuf.match(/NODE\s+(\d{1,3})\s*<([^>]+)>/i);
  if (nodeM) {
    hwid = parseInt(nodeM[1], 10);
    fwName = nodeM[2].trim();
  } else {
    const jsonM = conBuf.match(/"?HWID"?\s*[:=]\s*"?(\d{1,3})/i);
    if (jsonM) hwid = parseInt(jsonM[1], 10);
  }
  if (hwid == null) return;

  const board = BOARD_BY_HWID.get(hwid);
  hwidFound = true;

  if (board) {
    setStatus(
      elConStatus,
      `✓ Eindeutig erkannt: ${board.name} (HWID ${hwid})`,
      "ok"
    );
    // Galerie oben auf das eine bestätigte Board setzen
    renderGallery([board], { confirmed: true });
    if (elInfo && !elInfo.hidden) {
      const dd = elInfo.querySelector("dd");
      if (dd)
        dd.innerHTML = `eindeutig <b>${esc(board.name)}</b> · von der Firmware bestätigt (HWID ${hwid})`;
    }
  } else {
    setStatus(
      elConStatus,
      `Firmware meldet HWID ${hwid}${fwName ? " (" + fwName + ")" : ""} – nicht in der Board-Liste.`,
      "ok"
    );
  }
}

function setConRunning(on) {
  conRunning = on;
  if (elConStart) elConStart.disabled = on;
  if (elConInfo) elConInfo.disabled = !on;
  // „Stoppen“ bleibt immer klickbar (siehe stopAll).
}

function resetPanel() {
  conBuf = "";
  panelFound = false;
  hwidFound = false;
  if (elPanel) {
    elPanel.hidden = true;
    elPanel.textContent = "";
  }
}

elConClear?.addEventListener("click", () => {
  if (elConOut) elConOut.textContent = "";
  resetPanel();
});

// „--info“ an die laufende Firmware senden → erzwingt die HWID-Ausgabe
async function sendCmd(cmd) {
  if (!conTransport || !conRunning) return;
  try {
    if (!conWriter && conTransport.device?.writable) {
      conWriter = conTransport.device.writable.getWriter();
    }
    if (conWriter) {
      const enc = new TextEncoder();
      await conWriter.write(enc.encode(cmd + "\r\n"));
    }
  } catch (e) {
    setStatus(elConStatus, "Konnte Befehl nicht senden: " + (e?.message || e), "err");
  }
}

elConInfo?.addEventListener("click", async () => {
  setStatus(elConStatus, "Sende „--info“ an die Firmware…");
  await sendCmd("--info");
});

elConStart?.addEventListener("click", async () => {
  if (connected) {
    setStatus(
      elConStatus,
      "Bitte zuerst „Stoppen“ — der Port ist noch von der Auslese-/Flash-Session belegt.",
      "err"
    );
    return;
  }
  try {
    resetPanel();
    setStatus(elConStatus, "Port wählen…");
    conPort = await navigator.serial.requestPort();
    conTransport = new Transport(conPort, false);
    const baud = parseInt(elBaud?.value || "115200", 10);
    await conTransport.connect(baud);
    await resetToApp(conTransport); // Board neu starten → App-Ausgabe
    setConRunning(true);
    setStatus(
      elConStatus,
      `Verbunden @ ${baud} Baud — lese… (Tipp: „ℹ Board abfragen“ für eindeutige Erkennung)`,
      "ok"
    );

    // Nach dem Boot automatisch einmal --info anfragen
    sleep(2500).then(() => sendCmd("--info"));

    const dec = new TextDecoder();
    await conTransport.rawRead(
      (chunk) => {
        if (!elConOut) return;
        const txt = dec.decode(chunk, { stream: true });
        elConOut.textContent += txt;
        elConOut.scrollTop = elConOut.scrollHeight;
        conBuf = (conBuf + txt).slice(-8000);
        scanPanel(txt);
        scanHwid(txt);
      },
      () => !conRunning // stoppt die Lese-Schleife
    );
  } catch (e) {
    setStatus(elConStatus, "Fehler: " + (e?.message || e), "err");
  } finally {
    await conCleanup();
  }
});

elConStop?.addEventListener("click", async () => {
  await stopAll();
  setStatus(elConStatus, "Gestoppt – Verbindung getrennt.");
});

async function conCleanup() {
  setConRunning(false);
  // Referenzen lokal sichern und Variablen SOFORT nullen — verhindert, dass
  // ein zweiter (überlappender) Aufruf denselben Port erneut schließt bzw.
  // den Lock doppelt freigibt (das war die Absturz-Ursache beim Mehrfachklick).
  const w = conWriter;
  const t = conTransport;
  conWriter = null;
  conTransport = null;
  conPort = null;
  try {
    if (w) w.releaseLock?.();
  } catch (_) {}
  try {
    if (t) await t.disconnect();
  } catch (_) {}
}

// ── Beide „Stoppen“-Buttons reagieren gemeinsam ──────────────────────────────
// Sie tun funktional dasselbe (stopAll). Drückt man einen, erscheinen BEIDE
// gedrückt (rotes Aufleuchten). Pointer-Events decken Maus & Touch ab.
const stopButtons = [elDisconnect, elConStop].filter(Boolean);
const setStopPressed = (on) =>
  stopButtons.forEach((b) => b.classList.toggle("is-pressed", on));
stopButtons.forEach((b) =>
  b.addEventListener("pointerdown", () => setStopPressed(true))
);
window.addEventListener("pointerup", () => setStopPressed(false));
window.addEventListener("pointercancel", () => setStopPressed(false));
