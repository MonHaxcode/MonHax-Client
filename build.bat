@echo off
echo Installiere Abhaengigkeiten...
call npm install || goto :err
echo Baue Installer...
call npm run build || goto :err
echo.
echo Fertig! Den Installer findest du im Ordner "dist".
pause
exit /b 0
:err
echo Fehler beim Bauen. Ist Node.js 20+ installiert?
pause
exit /b 1
