// ─────────────────────────────────────────────────────────────────────────────
// Erweitert-Bereich: Geräte-Info, eigene Firmware flashen & serielle Konsole
// Nutzt esptool-js (lokal vendor-t). Der simple 1-2-3-Flow (ESP Web Tools)
// bleibt davon unberührt — dies ist ein separater Power-User-Pfad.
// ─────────────────────────────────────────────────────────────────────────────
import { ESPLoader, Transport } from "./vendor/esptool-js/bundle.js";

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// USB-UART-Bridges nach VID (aus navigator.serial getInfo())
const USB_BRIDGES = {
  0x10c4: "Silicon Labs (CP210x)",
  0x1a86: "WCH (CH340 / CH9102)",
  0x0403: "FTDI",
  0x303a: "Espressif (native USB)",
};

// Grobe Board-Signaturen (Chip + Flash) → begründete Vermutung, KEINE Garantie.
const KNOWN_BOARDS = [
  {
    name: "Heltec Wireless Paper",
    chip: /ESP32-?S3/i,
    flash: ["8MB"],
    hint: "ESP32-S3FN8, 8 MB, kein PSRAM, SX1262, 2,13″ E-Ink",
    photo: "img/heltec-wireless-paper.png",
  },
];

// Liefert das passende Board-Objekt oder null (begründete Vermutung, keine Garantie).
function matchBoard(chipDesc, flash) {
  for (const b of KNOWN_BOARDS) {
    if (b.chip.test(chipDesc || "") && b.flash.includes(flash)) return b;
  }
  return null;
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

// ─────────────────────────────────────────────────────────────────────────────
// Teil A: Verbinden + Geräte-Info + eigene Firmware flashen (gemeinsame Session)
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
const elPhoto = $("adv-photo");
const elStatus = $("adv-status");
const elProg = $("adv-progress");
const elProgBar = $("adv-progress-bar");

function setFlashEnabled(on) {
  if (elFlash) elFlash.disabled = !on;
  if (elDisconnect) elDisconnect.disabled = !on;
  if (elConnect) elConnect.disabled = on;
}

elOffsetSel?.addEventListener("change", () => {
  if (elCustomOffset) elCustomOffset.hidden = elOffsetSel.value !== "custom";
});

function currentOffset() {
  const v = elOffsetSel?.value ?? "0";
  if (v === "custom") {
    const raw = (elCustomOffset?.value || "").trim().replace(/^0x/i, "");
    const n = parseInt(raw, 16);
    if (!raw || isNaN(n) || n < 0) return null;
    return n;
  }
  return parseInt(v, 10);
}

elConnect?.addEventListener("click", async () => {
  try {
    setStatus(elStatus, "Port wählen…");
    device = await navigator.serial.requestPort();
    transport = new Transport(device, false);
    esploader = new ESPLoader({ transport, baudrate: 115200, terminal: term });

    setStatus(elStatus, "Verbinde & erkenne Chip…");
    term.clean();
    const chipDesc = await esploader.main(); // erkennt Chip, startet Stub

    let mac = "—";
    try {
      const m = await esploader.chip.readMac(esploader);
      // readMac liefert bereits einen String "xx:xx:xx:xx:xx:xx".
      // Fallback, falls eine Version ein Byte-Array zurückgibt.
      mac =
        typeof m === "string"
          ? m.toLowerCase()
          : Array.from(m)
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(":");
    } catch (_) {}

    let flash = "unbekannt";
    try {
      const flid = await esploader.readFlashId();
      flash = esploader.DETECTED_FLASH_SIZES[(flid >> 16) & 0xff] || "unbekannt";
    } catch (_) {}

    // USB-Bridge aus den Port-Infos (identifiziert die UART-Bridge, nicht das Board)
    let bridge = "—";
    try {
      const di = device.getInfo?.() || {};
      if (di.usbVendorId != null) {
        const vendor = USB_BRIDGES[di.usbVendorId] || "unbekannt";
        const ids =
          di.usbVendorId.toString(16).padStart(4, "0") +
          ":" +
          (di.usbProductId ?? 0).toString(16).padStart(4, "0");
        bridge = `${vendor} (${ids})`;
      }
    } catch (_) {}

    const board = matchBoard(chipDesc, flash);
    const guess = board
      ? `vermutlich ${board.name} (${board.hint})`
      : "unbekanntes Board – nur Chip-Daten sicher";

    // Foto des erkannten Moduls
    if (elPhoto) {
      if (board?.photo) {
        elPhoto.src = board.photo;
        elPhoto.alt = board.name;
        elPhoto.hidden = false;
      } else {
        elPhoto.hidden = true;
        elPhoto.removeAttribute("src");
      }
    }

    if (elInfo) {
      elInfo.hidden = false;
      elInfo.innerHTML =
        `<dt>Vermutung</dt><dd>${guess}</dd>` +
        `<dt>Chip</dt><dd>${chipDesc}</dd>` +
        `<dt>MAC</dt><dd>${mac}</dd>` +
        `<dt>Flash</dt><dd>${flash}</dd>` +
        `<dt>USB-Bridge</dt><dd>${bridge}</dd>`;
    }
    connected = true;
    setFlashEnabled(true);
    setStatus(elStatus, "✓ Verbunden. Du kannst jetzt eine Datei flashen.", "ok");
  } catch (e) {
    setStatus(elStatus, "Fehler: " + (e?.message || e), "err");
    await cleanup();
  }
});

elDisconnect?.addEventListener("click", cleanup);

async function cleanup() {
  try {
    if (transport) await transport.disconnect();
  } catch (_) {}
  device = transport = esploader = null;
  connected = false;
  setFlashEnabled(false);
  if (elProg) elProg.hidden = true;
  if (elInfo) elInfo.hidden = true;
  if (elPhoto) elPhoto.hidden = true;
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
// Teil B: Serielle Konsole (eigene Verbindung, liest die laufende Firmware)
// ─────────────────────────────────────────────────────────────────────────────
let conPort = null;
let conTransport = null;
let conRunning = false;

const elConStart = $("adv-con-start");
const elConStop = $("adv-con-stop");
const elConClear = $("adv-con-clear");
const elBaud = $("adv-baud");
const elConOut = $("adv-con-out");
const elConStatus = $("adv-con-status");
const elPanel = $("adv-panel");

// Boot-Log nach dem Panel-Controller durchsuchen (MeshCom:
// "[INIT]...Wireless Paper E-Ink chipId=0x.. -> E0213A367")
let conBuf = "";
let panelFound = false;
function scanPanel(text) {
  if (panelFound) return;
  conBuf = (conBuf + text).slice(-4000);
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

function setConRunning(on) {
  conRunning = on;
  if (elConStart) elConStart.disabled = on;
  if (elConStop) elConStop.disabled = !on;
}

function resetPanel() {
  conBuf = "";
  panelFound = false;
  if (elPanel) {
    elPanel.hidden = true;
    elPanel.textContent = "";
  }
}

elConClear?.addEventListener("click", () => {
  if (elConOut) elConOut.textContent = "";
  resetPanel();
});

elConStart?.addEventListener("click", async () => {
  if (connected) {
    setStatus(
      elConStatus,
      "Bitte erst oben „Trennen“ — Port ist von der Flash-Session belegt.",
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
    setStatus(elConStatus, `Verbunden @ ${baud} Baud — lese…`, "ok");

    const dec = new TextDecoder();
    await conTransport.rawRead(
      (chunk) => {
        if (!elConOut) return;
        const txt = dec.decode(chunk, { stream: true });
        elConOut.textContent += txt;
        elConOut.scrollTop = elConOut.scrollHeight;
        scanPanel(txt);
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
  setConRunning(false);
  await conCleanup();
  setStatus(elConStatus, "Konsole gestoppt.");
});

async function conCleanup() {
  setConRunning(false);
  try {
    if (conTransport) await conTransport.disconnect();
  } catch (_) {}
  conTransport = null;
  conPort = null;
}
