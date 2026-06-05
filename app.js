// ESP Web Flasher – Board-Auswahl
// Neues Board ergänzen: 1 Eintrag hier + 1 <option> in index.html + eigenes Manifest.

const BOARDS = {
  "heltec-wireless-paper": {
    manifest: "manifest-heltec-wp.json",
    name: "Heltec Wireless Paper",
    photo: "img/heltec-wireless-paper.png",
    info: "ESP32-S3 · Panel V1.1 & V1.2 · MeshCom-Firmware",
    specs: "ESP32-S3FN8 · 8 MB Flash · kein PSRAM · SX1262 LoRa · 2,13″ E-Ink · CP2102",
  },
  // "naechstes-board": { manifest: "manifest-xyz.json", name: "...", photo: "...", info: "...", specs: "..." },
};

const select = document.getElementById("board");
const installer = document.getElementById("installer");
const boardInfo = document.getElementById("board-info");
const unsupported = document.getElementById("unsupported");

function applyBoard(id) {
  const board = BOARDS[id];
  if (!board) return;
  installer.setAttribute("manifest", board.manifest);
  if (boardInfo && board.info) boardInfo.textContent = board.info;
}

select.addEventListener("change", (e) => applyBoard(e.target.value));

// Initiales Board setzen
applyBoard(select.value);

// Hinweis einblenden, falls der Browser kein Web Serial kann
if (!("serial" in navigator)) {
  unsupported.hidden = false;
}

// Kontakt-E-Mail erst per JS zusammensetzen (steht nicht als x@y im Roh-HTML)
const mailEl = document.getElementById("contact-mail");
if (mailEl && mailEl.dataset.u && mailEl.dataset.d) {
  const addr = mailEl.dataset.u + "@" + mailEl.dataset.d;
  mailEl.href = "mailto:" + addr;
  mailEl.textContent = addr;
}
