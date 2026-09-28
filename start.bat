@echo off
chcp 65001 >nul
title Pink Web Site - Shokruza
cd /d "%~dp0"
echo.
echo   ==========================================
echo    Открываю сайт... Не закрывай это окно.
echo   ==========================================
echo.
start "" "index.html"
echo Сайт открыт в браузере. Папка: %~dp0
echo.
timeout /t 8 >nul
exit /b 0
