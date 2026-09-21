import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { SbsScraper } from './sbsScraper.js';
import { InsacoScraper } from './insacoScraper.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const TEMP_DIR = path.join(ROOT, 'temp');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cambia_este_secreto';
const SESSION_HOURS = parseInt(process.env.SESSION_HOURS || '8', 10);
const WEB_USER = process.env.WEB_USER || 'admin';
const WEB_PASS = process.env.WEB_PASS || 'Admin123';

// ─── Jobs en memoria y Cola de Espera ───────────────────────────────────────
const jobs = new Map();
const requestQueue = [];
let isProcessing = false;

function createJob(consultantName = 'Anónimo') {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  jobs.set(id, {
    id,
    consultantName,
    status: 'pending',   // pending | running | done | error
    steps: [],           // { time, text, type } — 'info' | 'success' | 'error' | 'warn'
    sbsResults: [],      // [{ label, url }]
    insacoResult: null,  // { url, filename, hasMatches } | null
    error: null,
    createdAt: Date.now()
  });
  return id;
}

function jobLog(id, text, type = 'info') {
  const job = jobs.get(id);
  if (!job) return;
  job.steps.push({ time: Date.now(), text, type });
  console.log(`[JOB ${id}] ${text}`);
}

// Limpiar jobs viejos (> 2 h) cada 30 min
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}, 30 * 60 * 1000);

// ─── Middlewares ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());
app.use('/temp', express.static(TEMP_DIR));   // Servir capturas e imágenes
app.use('/public', express.static(PUBLIC));   // CSS, JS, assets, imágenes

// ─── Middleware de autenticación JWT ─────────────────────────────────────────
function requireAuth(req, res, next) {
  // Login desactivado a petición del usuario
  req.user = { username: 'Usuario' };
  next();
}

// ─── Rutas de autenticación ───────────────────────────────────────────────────

// GET /login — Página de login
app.get('/login', (req, res) => {
  res.redirect('/');
});

// POST /api/auth/login — Procesa credenciales
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === WEB_USER && password === WEB_PASS) {
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: `${SESSION_HOURS}h` });
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: SESSION_HOURS * 60 * 60 * 1000
    });
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// GET /api/auth/me — Info de sesión
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ username: req.user.username, sessionHours: SESSION_HOURS });
});

// ─── Rutas principales (protegidas) ──────────────────────────────────────────

// GET / — App principal
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

// POST /api/consultar — Crear consulta y añadir a la cola
app.post('/api/consultar', requireAuth, (req, res) => {
  const { type, number, consultantName } = req.body || {};

  if (!type || !number) {
    return res.status(400).json({ error: 'Faltan parámetros: type y number son requeridos' });
  }

  const validTypes = ['DNI', 'RUC', 'CE'];
  if (!validTypes.includes(type.toUpperCase())) {
    return res.status(400).json({ error: `Tipo de documento inválido. Use: ${validTypes.join(', ')}` });
  }

  const finalName = (consultantName || 'Anónimo').trim();
  const jobId = createJob(finalName);
  const job = jobs.get(jobId);
  job.docType = type.toUpperCase();
  job.docNumber = String(number).trim();

  // Añadir a la cola y procesar si está libre
  requestQueue.push(jobId);
  jobLog(jobId, `Añadido a la cola de espera. Posición: ${requestQueue.length}`, 'info');
  processQueue();

  res.json({ jobId });
});

// GET /api/queue — Obtener estado de la cola
app.get('/api/queue', requireAuth, (req, res) => {
  const queueStatus = [];
  
  // Agregar al que se está procesando actualmente
  for (const [id, job] of jobs) {
    if (job.status === 'running') {
      queueStatus.push({
        id: job.id,
        consultantName: job.consultantName,
        docType: job.docType,
        docNumber: job.docNumber,
        status: 'Procesando'
      });
    }
  }

  // Agregar a los que están en cola
  requestQueue.forEach((id, index) => {
    const job = jobs.get(id);
    if (job) {
      queueStatus.push({
        id: job.id,
        consultantName: job.consultantName,
        docType: job.docType,
        docNumber: job.docNumber,
        status: `En espera (Pos. ${index + 1})`
      });
    }
  });

  res.json({ queue: queueStatus });
});

// Función para procesar la cola uno a uno
async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  isProcessing = true;

  const jobId = requestQueue.shift();
  const job = jobs.get(jobId);

  if (job && job.status === 'pending') {
    job.status = 'running';
    jobLog(jobId, `Iniciando procesamiento de consulta...`, 'info');
    try {
      await runConsulta(jobId, job.docType, job.docNumber);
    } catch (err) {
      job.status = 'error';
      job.error = err.message;
    }
  }

  isProcessing = false;
  // Llamar al siguiente de forma asíncrona
  setTimeout(processQueue, 1000);
}

// GET /api/estado/:jobId — Polling del estado del job
app.get('/api/estado/:jobId', requireAuth, (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job no encontrado' });

  res.json({
    id: job.id,
    status: job.status,
    steps: job.steps,
    sbsResults: job.sbsResults,
    insacoResult: job.insacoResult,
    error: job.error,
    docType: job.docType,
    docNumber: job.docNumber
  });
});

// GET /api/descargar/:jobId — Descarga el reporte INSACO con nombre y tipo MIME correcto
app.get('/api/descargar/:jobId', requireAuth, (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.insacoResult) return res.status(404).json({ error: 'Archivo no encontrado' });

  // Reconstruir la ruta absoluta desde la URL relativa almacenada
  const relUrl = job.insacoResult.url.replace(/^\/temp\//, '');
  const absolutePath = path.join(TEMP_DIR, relUrl);

  if (!fs.existsSync(absolutePath)) {
    return res.status(404).json({ error: 'El archivo no existe en el servidor' });
  }

  const filename = job.insacoResult.filename || `INSACO_${job.docType}_${job.docNumber}.pdf`;
  const ext = filename.split('.').pop().toLowerCase();
  const mimeTypes = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg' };
  const mimeType = mimeTypes[ext] || 'application/octet-stream';

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.sendFile(absolutePath);
});

// ─── Lógica principal de consulta ────────────────────────────────────────────
async function runConsulta(jobId, type, number) {
  const job = jobs.get(jobId);
  if (!job) return;

  const outputDir = path.join(TEMP_DIR, 'capturas');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // ── FASE 1: SBS COOPAC ──
  jobLog(jobId, `Iniciando consulta SBS COOPAC para ${type}: ${number}`, 'info');
  const sbsScraper = new SbsScraper();

  try {
    jobLog(jobId, 'Abriendo portal SBS y autenticando...', 'info');
    const screenshots = await sbsScraper.consultDocument({ type, number, outputDir });
    await sbsScraper.close();

    if (!screenshots || screenshots.length === 0) {
      jobLog(jobId, 'No se generaron capturas en SBS', 'warn');
    } else if (screenshots[0].noInfo) {
      jobLog(jobId, screenshots[0].message || 'Sin información reportada en SBS', 'warn');
      for (const s of screenshots) {
        const relPath = path.relative(TEMP_DIR, s.path).replace(/\\/g, '/');
        job.sbsResults.push({ label: s.label || s.name, url: `/temp/${relPath}`, noInfo: true, message: s.message });
      }
    } else {
      for (const s of screenshots) {
        const relPath = path.relative(TEMP_DIR, s.path).replace(/\\/g, '/');
        job.sbsResults.push({ label: s.label || s.name, url: `/temp/${relPath}` });
        jobLog(jobId, `Módulo capturado: ${s.label || s.name}`, 'success');
      }
      jobLog(jobId, `SBS COOPAC: ${screenshots.length} capturas obtenidas`, 'success');
    }
  } catch (sbsError) {
    await sbsScraper.close().catch(() => {});
    jobLog(jobId, `Error en SBS COOPAC: ${sbsError.message}`, 'error');
    job.sbsResults = [];
  }

  // ── FASE 2: INSACO LAFT ──
  jobLog(jobId, 'Iniciando consulta INSACO LAFT (listas PLAFT)...', 'info');
  const insacoScraper = new InsacoScraper();

  try {
    jobLog(jobId, 'Abriendo portal INSACO y autenticando...', 'info');
    const insacoResult = await insacoScraper.consultDocument({ type, number });
    await insacoScraper.close();

    const relPath = path.relative(TEMP_DIR, insacoResult.path).replace(/\\/g, '/');
    job.insacoResult = {
      url: `/temp/${relPath}`,
      filename: insacoResult.filename,
      hasMatches: insacoResult.hasMatches
    };

    const matchMsg = insacoResult.hasMatches
      ? 'ATENCION: Coincidencias encontradas en listas PLAFT'
      : 'Sin coincidencias en listas PLAFT';
    jobLog(jobId, matchMsg, insacoResult.hasMatches ? 'warn' : 'success');
    jobLog(jobId, 'Proceso completo finalizado con exito', 'success');
  } catch (insacoError) {
    await insacoScraper.close().catch(() => {});
    jobLog(jobId, `Error en INSACO LAFT: ${insacoError.message}`, 'error');
    job.insacoResult = null;
  }

  job.status = 'done';
}

// ─── Iniciar servidor ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n========================================');
  console.log(`  Sistema Web SBS COOPAC + INSACO LAFT`);
  console.log(`  Servidor: http://localhost:${PORT}`);
  console.log('========================================\n');
  console.log(`  Usuario: ${WEB_USER}`);
  console.log(`  Sesion expira en: ${SESSION_HOURS} horas\n`);
});

export default app;
