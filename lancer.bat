@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Installez Node.js depuis https://nodejs.org puis relancez. & pause & exit /b)
if not exist node_modules call npm install
node server.js
pause
