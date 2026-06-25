# SmartHome Companion HACS

Dies ist das Backend für den SmartHome Companion Kiosk (Entwickelt in Flutter).
Es speichert die Rolladen-Konfiguration in Home Assistant, stellt Status-Sensoren für die Einrichtung bereit und liefert die Sonneneinstrahlungs-Berechnungen. Die eigentliche Rolladen-Aktorik ist im Add-on über `BlindsManager` vorgesehen; die konkrete Service-Ausführung ist dort aktuell noch als Platzhalter angelegt.

## Installation per FTP / Samba

1. Navigiere in das Konfigurationsverzeichnis deines Home Assistant Servers (`/config/`).
2. Öffne oder erstelle den Ordner `custom_components`.
3. Kopiere den gesamten Ordner `smarthome_companion_hacs` hierher. Der Pfad sollte am Ende so aussehen: 
   `/config/custom_components/smarthome_companion_hacs/manifest.json`.
4. Starte Home Assistant neu.
5. Das System sollte die Integration automatisch als Backend-Dienst im Hintergrund starten und dir die neuen Sensoren z.B. `sensor.haus_sued_helligkeit` bereitstellen.

## Benutzung im Kiosk
Auf dem Wand-Display findest du im Launcher nun den Punkt "Einrichten". Sobald die Integration aktiv ist, kannst du darüber neue Rollläden einlernen, kopieren und flexibel verwalten. Die Logik läuft autark und zuverlässig hier auf deiner Home Assistant Maschine.
