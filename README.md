# Bot de WhatsApp para Consulta SBS COOPAC y INSACO LAFT

Este bot automatiza la consulta de personas en la Central de Riesgos del portal **SBS COOPAC** y en las listas PLAFT del portal **INSACO LAFT (Grilaft)** a través de **WhatsApp**. El flujo genera capturas de pantalla de los módulos de la SBS y luego descarga y envía el reporte en PDF de INSACO.

---

## 📋 Módulos Capturados
El bot extrae y captura los siguientes módulos activos del reporte:
1. **Consolidado** (Resumen general de calificación y deuda)
2. **Detallada** (Desglose por entidades financieras / cooperativas)
3. **Histórica** (Comportamiento crediticio en el tiempo)

*(Los módulos adicionales como Tipo de Crédito, Al Cliente, RIO, etc. pueden habilitarse cuando se requiera).*

### INSACO LAFT
1. **Búsqueda PLAFT** (Consulta en listas de Lavado de Activos y Financiamiento del Terrorismo)
2. **Descarga de PDF** (Reporte completo, independientemente de si hay coincidencias o no)

---

## 🚀 Requisitos e Instalación

1. **Node.js**: Instalado versión 18+ o LTS (v24.x).
2. **Instalar dependencias**:
   ```bash
   npm install
   ```

---

## ⚙️ Configuración (`.env`)

El archivo `.env` contiene las credenciales de acceso al portal SBS:

```env
SBS_URL=https://coopac.sbs.gob.pe/auth.web/index.jsp
SBS_USER=X74659034
SBS_PASS=Fladep26
PUPPETEER_HEADLESS=true
PUPPETEER_SLOWMO=50
SBS_TIMEOUT=45000

# Credenciales INSACO LAFT
INSACO_URL=https://seek.insacolaft.com
INSACO_USER=kluyocab
INSACO_PASS=i2R7N+GN
```

---

## ▶️ Ejecución

### 1. Iniciar el Bot de WhatsApp:
Ejecuta el archivo:
- Doble clic en `iniciar_bot.bat` o
- Desde la consola:
  ```bash
  npm start
  ```

### 2. Vinculación:
- En la consola aparecerá un código QR.
- Abre **WhatsApp** en tu teléfono > **Dispositivos Vinculados** > **Vincular un dispositivo** y escanea el código QR de la consola.
- La sesión quedará guardada en la carpeta `.wwebjs_auth` para no requerir escanear nuevamente.

---

## 💬 Uso desde WhatsApp

Envía un mensaje a la cuenta de WhatsApp vinculada con cualquiera de los siguientes formatos:

- **Para DNI**:
  ```text
  dni: 74659034
  ```
  o
  ```text
  dni 74659034
  ```

- **Para Carné de Extranjería**:
  ```text
  carnetex: 00000000
  ```
  o
  ```text
  ce: 00000000
  ```

### Respuesta del Bot:
1. El bot responderá de inmediato confirmando la recepción y procesando la consulta.
2. **Fase 1 (SBS):** Ingresará al portal SBS COOPAC, generará las capturas de cada módulo activo y las enviará a WhatsApp.
3. **Fase 2 (INSACO):** Ingresará al portal INSACO LAFT, consultará las listas PLAFT y enviará a WhatsApp el reporte completo en formato PDF.
4. Enviará un mensaje final de confirmación con el éxito del proceso completo.

---

## 🧪 Prueba Aislada del Scraper (Sin WhatsApp)

Puedes probar la extracción de capturas directamente desde la consola con:

```bash
npm run test:sbs DNI 74659034
```
o
```bash
npm run test:sbs CE 00000000
```
Las capturas se guardarán en `temp/test_capturas/`.
