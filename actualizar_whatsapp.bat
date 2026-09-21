@echo off
echo 1. Cerrando cualquier proceso Node activo...
taskkill /f /im node.exe >nul 2>&1

echo 2. Limpiando archivos corruptos de whatsapp-web.js...
rmdir /s /q "node_modules\whatsapp-web.js" >nul 2>&1

echo 3. Instalando whatsapp-web.js desde GitHub (esto puede tardar unos segundos)...
call npm install github:pedroslopez/whatsapp-web.js#main

echo.
echo =========================================
echo Actualizacion completada. Ahora puedes iniciar el bot.
echo =========================================
pause
