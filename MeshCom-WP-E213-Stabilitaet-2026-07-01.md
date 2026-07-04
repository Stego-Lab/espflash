# Stabilitäts- & Robustheits-Analyse — MeshCom Firmware (Wireless Paper + Vision Master E213)

**Datum:** 2026-07-01
**Boards:** Heltec Wireless Paper (ESP32-S3) + Heltec Vision Master E213 (ESP32-S3)
**Methode:** Multi-Agenten-Analyse (mehrere parallele Auditor-Dimensionen), anschließend **jeder Befund adversarisch am echten Code gegengeprüft** (Datei:Zeile-Beleg, sonst verworfen) und dedupliziert. Zusätzlich `cppcheck 2.21` als deterministisches Ausgangsmaterial.
**Read-only:** Es wurde **kein Code verändert** — dieser Report benennt ausschließlich Befunde und beschreibende Fix-Vorschläge.

> **Hinweis zum Umfang:** Dieses öffentliche Dokument deckt die **stabilitäts-, display- und energiebezogenen** Aspekte der Analyse ab (Robustheit im Dauerbetrieb, E-Ink, Akku/Deepsleep, Timing). Weitere Befunde werden im Rahmen einer verantwortungsvollen Offenlegung (**Responsible Disclosure**) zunächst nur dem Maintainer vorgelegt und hier nicht mit Details oder Code-Stellen aufgeführt.

---

## Executive Summary (öffentlicher Teil)

| Severity | Anzahl | Bedeutung |
|---|---|---|
| 🟠 **Orange** (High) | **4** | Ausfall/Degradation unter realistischen Sonderbedingungen (Netzverlust, leerer Akku, Panel-Fehler) |
| 🟡 **Gelb** (Medium) | **5** | Robustheit/Korrektheit, destabilisiert langfristig |
| 🔵 **Blau** (Low) | **2** | Code-Smell/Hinweis |
| **Summe (öffentlich)** | **11** | adversarisch verifiziert |

**Gesamtbild:** 🟢 **keine kritischen (roten) Befunde.** Die im 06-12-Audit adressierten Kern-Ursachenketten (Deepsleep-Wakeup, Sleep-Strom, AKKU-LOW) halten im **Preview-Build**. Die wichtigste Handlungsempfehlung: mehrere der Power/Deepsleep-Härtungen greifen **nur im Preview-Build** — die reinen Default-Builds (`env:wireless-paper`, `env:vision-master-e213`) tragen sie noch nicht.

### Schnellübersicht

| # | Sev | Bereich | Board | Befund |
|---|---|---|---|---|
| 1 | 🟠 | Timing | beide | NTP-Retry-Unterlauf: erste ~14 min nach Boot Dauer-Poll statt 60-s-Retry |
| 2 | 🟠 | Power/Deepsleep | beide | Low-Voltage-Flash-Write im Default-Build bei ~3,3 V Cutoff |
| 3 | 🟠 | Power/Deepsleep | WP | Default-WP-Build: `--deepsleep` armiert keine Wakeup-Quelle |
| 4 | 🟠 | Power/Deepsleep | beide | Batteriemessung kann pausieren → Low-Voltage-Deepsleep löst nicht aus |
| 5 | 🟡 | Display/E-Ink | beide | Panel-Auto-Erkennung ohne Validierung/Fallback |
| 6 | 🟡 | Display/E-Ink | beide | V1.2/E213-Statuszeile: Teilrefresh ohne periodischen Voll-Refresh → Ghosting |
| 7 | 🟡 | Display/Power | E213 | E213-Serie (non-preview) fehlt der Grau-Fix beim Akku-leer-Deepsleep |
| 8 | 🟡 | Hang | beide | E-Ink BUSY-Poll blockiert Loop bis 8 s pro `wait()` bei Panel-Fehler |
| 9 | 🟡 | Hang | beide | Endlos-Busywait im Spektral-Scan (`--spectrum`) ohne Timeout |
| 10 | 🔵 | Timing | alle | `millis()`-49,7-Tage-Wrap: additives Timer-Muster statt Differenzform |
| 11 | 🔵 | E213 | E213 | `landscape()` kennt E213 nicht → latenter 180°-Flip (**bereits behoben**) |

---

## Farb-Legende

- 🟠 **Orange · High** — Ausfall unter realistischen Sonderbedingungen
- 🟡 **Gelb · Medium** — Robustheit/Korrektheit
- 🔵 **Blau · Low/Hinweis** — Code-Smell

---

## 🟠 Orange · High

### 🟠 1 · NTP-Retry-Unterlauf: erste ~14 min nach Boot Dauer-Poll statt 60-s-Retry

- **Board:** WP + E213 (Preview-Build) · **Bereich:** Timing
- **Problem:** Steht WLAN/IP, ist aber der NTP-/Zeitserver beim Boot nicht erreichbar (z. B. HAMNET/Firewall, Serverausfall), greift in den ersten ~14 Minuten nach jedem Boot ein Underflow-Guard, der den gewollten 60-s-Retry in einen **Dauer-Poll** verwandelt. Der blockierende NTP-Aufruf (~1 s) läuft dann faktisch in jeder Loop-Iteration → die Hauptschleife wird bis zu 14 min lang ~1 s pro Durchlauf blockiert (träges Display/Button, verpasste LoRa-RX-Fenster). Selbstheilend nach ~14 min.
- **Fix-Vorschlag (nicht angewandt):** In der Boot-Phase einen separaten Retry-Zeitstempel führen statt den Trigger-Wert auf 0 (= Sofort-Trigger) zu setzen; die Sonderbedeutung „0" vom Retry-Pfad entkoppeln.

### 🟠 2 · Low-Voltage-Flash-Write bei ~3,3 V Cutoff (Default-Builds)

- **Board:** WP + E213 (Default-Build) · **Bereich:** Power/Deepsleep
- **Problem:** In den committfähigen Default-Builds wird beim Erreichen der Mindestspannung (3,3 V) ein Settings-Write (Flash/NVS) ausgelöst — am **tiefsten Akkupunkt**, während der LoRa-Chip noch im Empfang läuft. Der Spannungseinbruch unter Last kann den Write abbrechen → NVS-Korruption/Settings-Verlust. Genau dieser Pfad ist im **Preview-Build bewusst deaktiviert**, in den Default-Builds aber noch aktiv.
- **Fix-Vorschlag (nicht angewandt):** Den flash-schreibenden Aufruf im Low-Voltage-Pfad auch für die Default-Builds unterdrücken (das sichtbare Löschen übernimmt ohnehin die Deepsleep-Anzeige ohne Settings-Write).

### 🟠 3 · Default-WP-Build: `--deepsleep` armiert keine Wakeup-Quelle

- **Board:** Wireless Paper (Default-Build) · **Bereich:** Power/Deepsleep
- **Problem:** Im reinen Default-Build (ohne Preview) läuft sowohl der manuelle Long-Press-`--deepsleep` als auch der Low-Voltage-Auto-Deepsleep in den Tiefschlaf, **ohne eine Aufweckquelle zu setzen** und **ohne** die Stromspar-Sequenz (LoRa schlafen legen, VEXT aus). Folge 1: das Gerät ist nur per RESET/Power-Cycle weckbar, das bistabile E-Ink wirkt „eingefroren". Folge 2: der „Deepsleep" senkt den Strom nicht, der leere LiPo entlädt weiter. Preview- und E213-Builds sind geschützt.
- **Fix-Vorschlag (nicht angewandt):** Den Guard so erweitern, dass auch der Default-WP-Build ext1-Wakeup (GPIO0/Taste) armiert und die Stromspar-Sequenz vor dem Tiefschlaf ausführt.

### 🟠 4 · Batteriemessung kann pausieren → Low-Voltage-Deepsleep löst nicht aus

- **Board:** WP + E213 · **Bereich:** Power/Deepsleep
- **Problem:** Die periodische Batteriemessung ist an einen internen Betriebszustand gekoppelt, der unter seltenen Timing-Bedingungen nicht sauber zurückgesetzt wird. Läuft die Messung dadurch nicht mehr, löst der Low-Voltage-Deepsleep nicht mehr aus → der Akku kann bis zur schädigenden Tiefentladung leerlaufen. Selten (Race-bedingt), aber einmal eingetreten dauerhaft bis zum Reboot.
- **Fix-Vorschlag (nicht angewandt):** Den internen Zustand zuverlässig zurücksetzen **oder** die Batteriemessung nicht hart daran koppeln (z. B. erzwungene Messung nach einer Deadline).

---

## 🟡 Gelb · Medium

### 🟡 5 · Panel-Auto-Erkennung ohne Validierung/Fallback

- **Board:** WP + E213 · **Bereich:** Display/E-Ink
- **Problem:** Die Panel-Erkennung (V1.1 vs. V1.2/E0213) entscheidet über **einen einzigen** BUSY-Pin-Read 100 ms nach dem Reset, ohne Retry, Plausibilitäts-Check oder Board-Hardcode. Auch das E213 (Hardware fix) hängt komplett an dieser Laufzeit-Probe. Wird der Pin durch Fertigungsstreuung/marginale Einschaltzeit falsch gelesen, lädt der falsche Display-Treiber → jeder Refresh läuft in den 8-s-Timeout, das Display ist bis zum Reboot praktisch tot.
- **Fix-Vorschlag (nicht angewandt):** Mehrfach abtasten (Mehrheitsentscheid) statt Einzelsample; BUSY-Pin mit definiertem Pull konfigurieren; für das E213 (fixe Hardware) das Panel hart setzen und die Probe nur für das Wireless Paper verwenden.

### 🟡 6 · V1.2/E213-Statuszeile: Teilrefresh ohne periodischen Voll-Refresh → Ghosting

- **Board:** WP (V1.2) + E213 · **Bereich:** Display/E-Ink
- **Problem:** Bei einem statisch stehenden Node (keine Seitenwechsel) wird die oberste Statuszeile stundenlang nur per Partial-Update aufgefrischt. E-Ink-Partial-Updates ohne periodischen Voll-Refresh akkumulieren Ghosting/Restschatten → die Uhr/Akku-Zeile wird zunehmend unscharf. Der V1.1-Pfad vermeidet das (60-s-Voll-Refresh), für V1.2/E213 fehlt ein entsprechender Zähler. Rein kosmetisch (keine Stabilitätsfolge).
- **Fix-Vorschlag (nicht angewandt):** Auf dem V1.2/E213-Pfad nach N Partial-Refreshes (bzw. alle paar Minuten) einmal einen Voll-Refresh der Statuszeile erzwingen.

### 🟡 7 · E213-Serie (non-preview) fehlt der Grau-Fix beim Akku-leer-Deepsleep

- **Board:** Vision Master E213 (Default-Build) · **Bereich:** Display/Power
- **Problem:** Der Grau-Fix (LoRa vor dem E-Ink-Voll-Refresh schlafen legen + kurze Erholpause, damit der Display-Boost bei fast leerem Akku anschwingt) ist nur im Preview-Build aktiv. Im Standard-E213-Env läuft der energiehungrige AKKU-LOW-Voll-Refresh, während der Funkchip noch zieht → die AKKU-LOW-Anzeige kann grau/unlesbar werden, genau wenn sie den User informieren soll. Das WP ist nicht betroffen (wird als Preview ausgeliefert).
- **Fix-Vorschlag (nicht angewandt):** Den LoRa-schlafen-legen-Vorlauf für den Akku-leer-Pfad auch für das E213 scharf schalten.

### 🟡 8 · E-Ink BUSY-Poll blockiert Loop bis 8 s pro `wait()` bei Panel-Fehler

- **Board:** WP + E213 · **Bereich:** Hang
- **Problem:** Der BUSY-Poll läuft im Loop-Kontext mit einem 8-s-Timeout. Der Timeout verhindert zwar den früheren Endlos-Hang, aber bei einem tatsächlich nicht antwortenden Panel (Fehlkonfiguration, fehlgeschlagener Refresh bei fast leerem Akku) friert der Haupt-Loop pro `wait()` bis zu 8 s ein; ein Voll-Refresh ruft `wait()` mehrfach → kumuliert Dutzende Sekunden, in denen LoRa-RX/Button/Batterie-Check blockiert sind. Kein Reset, aber spürbarer Stall unter Panel-Fehler.
- **Fix-Vorschlag (nicht angewandt):** Timeout deutlich senken (Voll-Refresh ≤ 2 s, also z. B. 3 s statt 8 s) und `wait()` kooperativ gestalten; nach Timeout weitere Updates bis zum nächsten sauberen Reset unterdrücken.

### 🟡 9 · Endlos-Busywait im Spektral-Scan (`--spectrum`) ohne Timeout

- **Board:** WP + E213 · **Bereich:** Hang
- **Problem:** Das experimentelle Admin-Debug-Kommando `--spectrum` pollt den Scan-Status **ohne** Timeout. Kehrt der Funkchip den Status wegen SPI-Glitch oder marginaler Versorgung nie zurück, dreht der Haupt-Loop endlos → alles (LoRa/Display/Button/Batterie) tot bis zum manuellen Power-Cycle. Auslösung nur über das bewusste, als experimentell markierte Kommando (kein Fremddaten-Pfad).
- **Fix-Vorschlag (nicht angewandt):** Busywait mit Deadline absichern (z. B. Abbruch nach 3 s, Fehler loggen statt endlos warten).

---

## 🔵 Blau · Low/Hinweis

### 🔵 10 · `millis()`-49,7-Tage-Wrap: additives Timer-Muster

- **Board:** alle · **Bereich:** Timing
- **Problem:** Das additive Muster `timer + intervall < millis()` ist gegen den `millis()`-Überlauf (alle ~49,7 Tage Dauerbetrieb) nicht robust — nahe dem Überlauf feuert der Zweig für einen Wrap-Zyklus zu früh. Die meisten Instanzen self-healen (Timer wird jede Iteration neu gesetzt), daher niedrige Severity; es bleibt ein kurzer Wrap-Glitch pro ~49,7 Tage je Timer.
- **Fix-Vorschlag (nicht angewandt):** Durchgängig auf die überlaufsichere Differenzform `(millis() - timer) >= intervall` umstellen (Unsigned-Subtraktion ist gegen den Wrap immun).

### 🔵 11 · `landscape()` kennt E213 nicht → latenter 180°-Flip (bereits behoben)

- **Board:** Vision Master E213 · **Bereich:** E213-spezifisch
- **Problem:** Die gemeinsame `landscape()`-Routine hatte Zweige für E290 und Wireless Paper, aber keinen für das E213 → es fiel in den `else`-Pfad (180° gegenüber der gewünschten Ausrichtung). Aktuell harmlos, weil der Boot-Pfad die Rotation unmittelbar überschrieb — aber eine latente Falle für künftige Aufrufer.
- **Status:** ✅ **Behoben** — mit dem `--rotate`-Feature hat `landscape()` jetzt einen eigenen E213-Zweig, die board-eigene Orientierung ist an einer Stelle definiert.

---

## Anhang A — Als sauber bewertet / geprüfte Hot-Paths

Positivbefund: In folgenden dauerhaft laufenden Pfaden fanden die Auditoren **keine** verwertbaren Schwachstellen über die oben gelisteten hinaus:

- **LoRa-RX-Interrupt / DIO1-Callback** — keine unsicheren Shared-State-Zugriffe ohne Guard.
- **Deepsleep-Wakeup (Preview/E213)** — Wakeup-Quelle + Stromspar-Sequenz korrekt (die 06-12-Fixes halten).
- **Batterie-Glitch-Filter** — Ausreißerbereinigung (±2 %) plausibel, keine Division durch 0 im regulären Pfad.
- **Panel-Auto-Erkennung (BUSY-Polarität)** — funktional korrekt; einziger Kritikpunkt ist der fehlende Fallback (Befund 5).
- **Command-Parser (Preview)** — die 06-12 gehärtete serielle Eingabe (USB/UART) ist robust (kein Regress gefunden).
- **E213-Batterie-Kalibrierung** — Teiler-/Polaritäts-Pfad korrekt vom Wireless Paper getrennt.

---

## Anhang B — Bezug zum 06-12-Audit (Display-Freeze)

Die **Power/Deepsleep**-Befunde sind teils Wiedervorlagen der Ursachenketten von 2026-06-12, geprüft gegen den aktuellen Stand:

| Heutiger Befund | Bezug 06-12 | Neu erkannt |
|---|---|---|
| 🟠 Low-Voltage-Flash-Write | K2/K5 | im **Default-Build** noch aktiv (nur Preview gefixt) |
| 🟠 `--deepsleep` ohne Wakeup + Stromspar-Sequenz | K1/K7 | im **Default-Build** noch aktiv (nur Preview/E213 gefixt) |
| 🟠 Batteriemessung kann pausieren | K8 | bestätigt — weiterhin offen |

**Kernaussage:** Die Fixes greifen im **Preview**-Build; die committfähigen Default-Builds tragen K1/K2/K5 weiterhin. Das ist die wichtigste Handlungsempfehlung dieser Analyse.

---

*Read-only-Analyse — es wurde **kein Code verändert.** Alle Fix-Vorschläge sind beschreibend (nicht angewandt). Weitere Befunde bleiben im Rahmen einer verantwortungsvollen Offenlegung zunächst dem Maintainer vorbehalten. Erzeugt durch einen adversarisch verifizierten Multi-Agenten-Lauf.*
