@echo off
title Sistema Web SBS COOPAC + INSACO LAFT
color 0A
echo.
echo  ============================================
echo   Sistema Web SBS COOPAC + INSACO LAFT
echo   Iniciando servidor en http://localhost:3000
echo  ============================================
echo.
echo  Credenciales por defecto:
echo    Usuario: admin
echo    Contrasena: Admin123
echo.
echo  (Puedes cambiarlas en el archivo .env)
echo.
cd /d "%~dp0"
node src/server.js
pause
