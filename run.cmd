@echo off
setlocal
rem UTF-8 en consola: sin esto, acentos y sección de los logs salen mojibake (cp850).
chcp 65001 >nul
"%~dp0node\node.exe" "%~dp0recon.js" %*
