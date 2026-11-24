@echo off
rem Lanzador de la GUI Electron con el Node/Electron portátil del proyecto.
rem No requiere Node en PATH.
cd /d "%~dp0"
"node_modules\electron\dist\electron.exe" .
