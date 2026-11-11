@echo off
title SmartHome Companion Workbench Dev Server
echo =======================================================
echo   SmartHome Companion Live Dev Workbench
echo =======================================================
echo.
echo Starte Webserver auf Port 5173...
start "" "http://localhost:5173/dev/index.html"
python custom_components\smarthome_companion_hacs\frontend\dev\server.py 5173
pause
