@echo off
setlocal EnableExtensions
title VideoShaheed - Avvio locale
cd /d "%~dp0"

echo.
echo ========================================
echo          VideoShaheed locale
echo ========================================
echo.

if not exist "%~dp0scripts\windows-start.ps1" (
  echo ERRORE: alcuni file del progetto sono mancanti.
  echo Scarica nuovamente lo ZIP completo da GitHub.
  echo.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-start.ps1"
set "APP_EXIT_CODE=%ERRORLEVEL%"

if not "%APP_EXIT_CODE%"=="0" (
  echo.
  echo VideoShaheed non e riuscito ad avviarsi.
  echo Controlla la connessione Internet e riprova.
  echo Se il problema continua, invia una foto di questa finestra.
  echo.
  pause
)

exit /b %APP_EXIT_CODE%
