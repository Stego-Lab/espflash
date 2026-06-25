# Serielle Konsole für das Heltec Vision Master E213

`e213_monitor.py` – ein robuster serieller Monitor mit **Auto-Reconnect** für das
Heltec Vision Master E213.

## Warum dieses Tool?

Das E213 hängt über den **nativen USB-Serial/JTAG** des ESP32-S3 am Rechner – es hat
**keinen** USB-UART-Chip (CP2102/CH340) wie die Wireless Paper. Dieser Port
**re-enumeriert auf macOS im Betrieb gelegentlich kurz** (verschwindet und kommt wieder,
ohne dass das Board neu startet). Ein normaler Monitor wie `screen` **bricht dabei ab**.

`e213_monitor.py` verbindet nach so einem Aussetzer **automatisch neu** und überbrückt die
Lücke – die Konsole läuft einfach weiter.

## Voraussetzungen

- **Python 3** (auf macOS/Linux meist vorinstalliert; Windows: [python.org](https://www.python.org/))
- **pyserial**:
  ```bash
  python3 -m pip install pyserial
  ```

## Starten

```bash
python3 e213_monitor.py
```

Das Tool sucht den E213-Port automatisch (`/dev/cu.usbmodem*` auf macOS). Optional einen
festen Port und/oder eine Baudrate angeben:

```bash
python3 e213_monitor.py /dev/cu.usbmodem1101 115200
```

## Bedienung

| Aktion | so geht's |
|---|---|
| **Ausgabe lesen** | läuft automatisch |
| **Befehl senden** | Zeile tippen + **ENTER** (z. B. `--info`, `--pos`) – wird mit `\n` ans Board geschickt |
| **Beenden** | **Ctrl-C** |

## Was es tut

- Verbindet automatisch mit dem ersten gefundenen `usbmodem`-Port.
- Liest fortlaufend und gibt die Board-Ausgabe aus.
- **Verschwindet der Port** (Re-Enumeration), verbindet das Tool **automatisch neu** – im
  Gegensatz zu `screen`, das dann abbricht.
- Lese- und Schreib-Thread laufen parallel: Eingabe blockiert die Ausgabe nicht.

> **Tipp:** Falls `pyserial` über PlatformIO installiert ist, kannst du das Tool auch direkt
> mit dessen Python starten:
> `~/.platformio/penv/bin/python e213_monitor.py`

---
*Teil der MeshCom-Firmware für das Heltec Vision Master E213 · craith.cloud/espflash*
