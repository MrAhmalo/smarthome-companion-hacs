@echo off
title SmartHome Companion Workbench Dev Server
echo =======================================================
echo   SmartHome Companion Live Dev Workbench (Zero-Cache)
echo =======================================================
echo.
echo Aktualisiere Frontend-Bundle...
python custom_components\smarthome_companion_hacs\frontend\bundle_frontend.py
echo.
echo Starte Webserver auf Port 5173...
start "" "http://localhost:5173/dev/index.html?t=%random%%random%"
python custom_components\smarthome_companion_hacs\frontend\dev\server.py 5173
pause

