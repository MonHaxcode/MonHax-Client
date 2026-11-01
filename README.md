# MonHax Launcher

Minecraft-Launcher mit Modpacks (Fabric), Modrinth + CurseForge, Shadern, Skins und Capes.

## Installer (.exe) bauen
**Variante A, am Windows-PC:** Node.js 20+ installieren, dann `build.bat` doppelklicken.
Der Installer liegt danach in `dist/` (`MonHax Launcher Setup x.x.x.exe`).

**Variante B, automatisch über GitHub:** Ordner in ein GitHub-Repo hochladen. Unter *Actions* baut
`Build Windows Installer` die .exe und die Cosmetics-Mod und stellt sie als Download bereit.
(Nur so ist die Cosmetics-Mod im Installer enthalten.)

## Entwickeln
`npm install` und `npm start`

## Eigenes Hintergrundbild
Lege `renderer/assets/hero.png` ab und ergänze in `renderer/style.css` bei `.art` ein
`background:url(assets/hero.png) center/cover`, dann ersetzt es die Zeichnung auf der Startseite.

## Einstellungen
- Java-Pfad (Java 21 für 1.21.1, Java 25 für 26.x)
- CurseForge-API-Key (console.curseforge.com), Modrinth geht ohne Key
- Microsoft-Login für Online-Server, Skin-Upload und Mojang-Capes

## Cosmetics
- Skins: 64×64 PNG. Capes: 64×32 PNG.
- Mit Microsoft-Konto gehen Skins direkt zu Mojang. Offline wird der Skin als Ressourcenpaket ins Pack gelegt.
- Capes zeigt die Mod `mod/` an (Fabric 1.21.1). Der Launcher kopiert sie automatisch ins Pack.
