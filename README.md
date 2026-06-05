# ESP Web Flasher · craith.cloud

Ein **browserbasierter Firmware-Flasher** für ESP-Boards – ohne `esptool`, ohne
Kommandozeile, ohne Treiber-Gefrickel. Board anstecken, auswählen, flashen.

Primär gebaut für das **Heltec Wireless Paper** mit der
[MeshCom](https://github.com/icssw-org/MeshCom-Firmware)-Firmware, aber leicht um
weitere Boards erweiterbar.

> 🔗 Live: **https://craith.cloud/espflash/**

Das Flashen läuft komplett **lokal im Browser** über die [Web Serial
API](https://developer.mozilla.org/docs/Web/API/Web_Serial_API) – es werden keine
Firmware-Dateien an einen Server übertragen.

---

## Features

**Einfacher Weg (für alle):**
- Board/Firmware aus einer Liste wählen und mit einem Klick flashen
  ([ESP Web Tools](https://esphome.github.io/esp-web-tools/)).
- Geführter Dialog inkl. optionalem „Erase device".
- Dialog im dunklen craith-Design (Material-3-Theming).

**Erweitert (Power-User, auf Basis von [esptool-js](https://github.com/espressif/esptool-js)):**
- **Geräte-Info auslesen:** Chip, MAC, Flash-Größe, USB-Bridge (VID/PID).
- **Board-Heuristik:** begründete Vermutung des Modells aus Chip + Flash (z. B.
  „vermutlich Heltec Wireless Paper") inkl. Foto.
- **Eigene Firmware flashen:** beliebige `.bin` an wählbarem Offset
  (`0x0` / `0x10000` / eigener Hex-Offset), optional kompletter Erase.
- **Serielle Konsole:** Boot-/Laufzeit-Ausgabe mitlesen; erkennt bei MeshCom den
  E-Ink-Panel-Controller (`E0213A367` / `LCMEN2R13EFC1`) und ordnet ihn der
  Heltec-HW-Gruppe zu.

---

## Browser-Unterstützung

Web Serial ist nur in Chromium-Browsern verfügbar:

| Browser | Status |
|---|---|
| Chrome, Edge, Opera, **Brave** (Desktop) | ✅ funktioniert nativ |
| **Firefox** | ✅ mit der Erweiterung [`firefox-webserial`](https://github.com/kuba2k2/firefox-webserial) (oder Firefox Nightly 151+ mit Web-Serial-Flag) |
| Safari | ❌ kein Web Serial |

Außerdem nötig: ein echtes **USB-Datenkabel** und Auslieferung über **HTTPS**
(oder `localhost`).

---

## Lokal ausführen

Web Serial verlangt einen sicheren Kontext (`https://` oder `http://localhost`).
Ein einfacher statischer Server reicht – z. B.:

```bash
python3 -m http.server 8000
# dann im Browser: http://localhost:8000/
```

Selbst hosten: einfach den **gesamten Ordner** auf einen beliebigen statischen
Webspace mit **HTTPS** legen (kein Build-Schritt nötig).

---

## Projektstruktur

```
index.html                 Seite (einfacher Flow + Erweitert + Credits)
app.js                     Board-Auswahl, kleine UI-Logik
advanced.js                Erweitert-Modul (esptool-js): Info / Flash / Konsole
style.css                  Styling (craith-Dark-Design)
manifest-heltec-wp.json    ESP-Web-Tools-Manifest (Partitionen/Offsets)
firmware/…                 Firmware-Binaries (.bin)
img/…                      Board-Foto(s)
vendor/esp-web-tools/      ESP Web Tools (lokal eingebunden)
vendor/esptool-js/         esptool-js (bundle.js, lokal eingebunden)
```

---

## Weiteres Board hinzufügen

1. **Firmware-Binaries** unter `firmware/<board>/` ablegen.
2. **Manifest** (`manifest-<board>.json`) mit den passenden `parts`/`offset`-Angaben
   anlegen.
3. In **`index.html`** eine `<option>` im `#board`-Dropdown ergänzen.
4. In **`app.js`** einen Eintrag im `BOARDS`-Objekt hinzufügen (`manifest`, `name`,
   optional `photo`, `info`, `specs`).
5. Optional in **`advanced.js`** eine Signatur in `KNOWN_BOARDS` für die Heuristik.

---

## Support & Spenden

Fragen, Feedback oder Bugs? Schreib mir gern:
**[oe3lcr@oevsv.at](mailto:oe3lcr@oevsv.at)**

Wenn dir der Flasher hilft, freue ich mich über eine kleine Unterstützung:

- ☕ Buy Me a Coffee: <https://www.buymeacoffee.com/christianraith>
- 💙 PayPal: <https://paypal.me/christianraith151>

---

## Drittanbieter & Lizenzen

Dieses Projekt steht unter der **MIT-Lizenz** (siehe [`LICENSE`](LICENSE)).
Eingebundene/vendor-te Komponenten behalten ihre eigenen, freien Lizenzen:

- [ESP Web Tools](https://esphome.github.io/esp-web-tools/) (ESPHome)
- [esptool-js](https://github.com/espressif/esptool-js) (Espressif, Apache-2.0)
- [MeshCom-Firmware](https://github.com/icssw-org/MeshCom-Firmware) (icssw.org) –
  die `.bin`-Dateien stammen aus dem MeshCom-Projekt.
- Board-Foto: © Heltec Automation.

---

## Autor

**Christian Raith** · Funkamateur **OE3LCR** · Wiener Neustadt, Österreich
MeshCom · craith.cloud

73! 📡
