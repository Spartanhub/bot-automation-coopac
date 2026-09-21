import fs from 'fs';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode-terminal';
import { SbsScraper } from './sbsScraper.js';
import { InsacoScraper } from './insacoScraper.js';
export class WhatsAppBot {
  constructor() {
    this.sbsScraper = new SbsScraper();
    this.insacoScraper = new InsacoScraper();
    this.isProcessing = false;
    this.queue = [];

    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const hasChrome = fs.existsSync(chromePath);

    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth'
      }),
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wwebjs/wwebjs/main/html/2.2412.54.html'
      },
      puppeteer: {
        headless: true,
        executablePath: hasChrome ? chromePath : undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      }
    });

    this.setupEvents();
  }

  setupEvents() {
    this.client.on('loading_screen', (percent, message) => {
      console.log(`⏳ [WhatsApp] Cargando recursos: ${percent}% ${message ? '(' + message + ')' : ''}`);
    });

    this.client.on('qr', (qr) => {
      console.log('\n======================================================');
      console.log('📱 ESCANEA EL SIGUIENTE CÓDIGO QR CON TU WHATSAPP:');
      console.log('======================================================\n');
      qrcode.generate(qr, { small: true });
    });

    this.client.on('ready', () => {
      console.log('\n✅ ¡Bot de WhatsApp conectado y listo para escuchar consultas!');
      console.log('Formatos aceptados:');
      console.log(' - dni: 74659034');
      console.log(' - carnetex: 00000000 / ce: 00000000');
      console.log(' - ruc: 10746590341\n');
    });

    this.client.on('authenticated', () => {
      console.log('🔒 Sesión de WhatsApp autenticada correctamente.');
    });

    this.client.on('auth_failure', (msg) => {
      console.error('❌ Error de autenticación en WhatsApp:', msg);
    });

    this.client.on('disconnected', (reason) => {
      console.log('⚠️ WhatsApp desconectado:', reason);
    });

    this.client.on('message_create', async (msg) => {
      await this.handleIncomingMessage(msg);
    });
  }

  parseQuery(text) {
    if (!text || typeof text !== 'string') return null;
    const cleanText = text.trim();

    // Ignorar las respuestas automáticas del bot para evitar bucles
    if (cleanText.startsWith('🔍') ||
      cleanText.startsWith('📊') ||
      cleanText.startsWith('✅') ||
      cleanText.startsWith('❌') ||
      cleanText.startsWith('ℹ️') ||
      cleanText.startsWith('📤') ||
      cleanText.startsWith('⚠️') ||
      cleanText.startsWith('⏳') ||
      cleanText.startsWith('📄')) {
      return null;
    }

    // Solo procesaremos si tiene la palabra clave explícita para evitar consultas accidentales
    // Regex para DNI (ej: dni: 74659034, dni 74659034)

    // Se agrega \b (word boundary) para asegurar que "dni" sea una palabra completa aislada
    const dniMatch = cleanText.match(/\b(?:dni)\b\s*[:=]?\s*([0-9]{8})\b/i);
    if (dniMatch) {
      return { type: 'DNI', number: dniMatch[1] };
    }

    // Se agrega \b para que "ce" sea palabra completa y no coincida con "ce lulares" (celulares)
    const ceMatch = cleanText.match(/\b(?:carnetex|carnet_extranjeria|carnet|ce)\b\s*[:=]?\s*([0-9a-zA-Z]{5,15})\b/i);
    if (ceMatch) {
      return { type: 'CE', number: ceMatch[1] };
    }

    const rucMatch = cleanText.match(/\b(?:ruc)\b\s*[:=]?\s*([0-9]{11})\b/i);
    if (rucMatch) {
      return { type: 'RUC', number: rucMatch[1] };
    }

    return null;
  }

  async handleIncomingMessage(msg) {
    const query = this.parseQuery(msg.body);
    if (!query) return;

    const chatId = msg.id?.remote || (msg.from?.includes('@lid') ? msg.to : msg.from);
    console.log(`[WhatsApp] Consulta detectada en [${chatId}]: ${query.type} -> ${query.number}`);

    // Agregar a la cola de procesamiento
    this.queue.push({
      msg,
      query,
      chatId
    });

    this.processQueue();
  }

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const item = this.queue.shift();
    const { msg, query, chatId } = item;

    try {
      await this.client.sendMessage(chatId, `🔍 *Procesando consulta SBS COOPAC + INSACO LAFT*\n📄 *Documento:* ${query.type} - ${query.number}\n⏳ *Espere un momento mientras se obtienen los reportes...*`);

      // ==========================================
      // FASE 1: SBS COOPAC
      // ==========================================
      console.log(`[Bot] Fase 1: Ejecutando scraper SBS para ${query.type}: ${query.number}...`);
      const screenshots = await this.sbsScraper.consultDocument({
        type: query.type,
        number: query.number
      });

      if (!screenshots || screenshots.length === 0) {
        await this.client.sendMessage(chatId, `⚠️ No se generaron capturas para el documento ${query.type}: ${query.number}. Verifique que el número sea correcto.`);
      } else if (screenshots.length === 1 && screenshots[0].noInfo) {
        const shot = screenshots[0];
        const media = MessageMedia.fromFilePath(shot.path);
        await this.client.sendMessage(chatId, media, {
          caption: `ℹ️ *SBS COOPAC - Central de Riesgos*\n\n${shot.message || 'La persona no tiene información reportada a la Central de Riesgos.'}\n\n📄 *Doc:* ${query.type} ${query.number}`
        });
      } else {
        await this.client.sendMessage(chatId, `📤 *Enviando ${screenshots.length} capturas de los módulos activos...*`);

        for (let i = 0; i < screenshots.length; i++) {
          const shot = screenshots[i];
          try {
            const media = MessageMedia.fromFilePath(shot.path);
            await this.client.sendMessage(chatId, media, {
              caption: `📊 *Módulo [${i + 1}/${screenshots.length}]:* ${shot.name || shot.label}\n📄 *Doc:* ${query.type} ${query.number}`
            });
            // Pequeña pausa entre envíos
            await new Promise(r => setTimeout(r, 1000));
          } catch (sendErr) {
            console.error(`[WhatsApp] Error enviando imagen ${shot.name}:`, sendErr.message);
          }
        }

        await this.client.sendMessage(chatId, `✅ *Consulta SBS completada.*\n📄 *Documento:* ${query.type} ${query.number}\n🖼️ *Total capturas:* ${screenshots.length}`);
      }

      // ==========================================
      // FASE 2: INSACO LAFT
      // ==========================================
      await this.client.sendMessage(chatId, `⏳ *Iniciando consulta en listas PLAFT (INSACO)...*`);
      console.log(`[Bot] Fase 2: Ejecutando scraper INSACO para ${query.type}: ${query.number}...`);

      try {
        const insacoResult = await this.insacoScraper.consultDocument({
          type: query.type,
          number: query.number
        });

        const matchMsg = insacoResult.hasMatches
          ? '⚠️ *¡ATENCIÓN! Se encontraron posibles coincidencias en las listas PLAFT.*'
          : '✅ *No se encontraron coincidencias en las listas PLAFT.*';

        if (insacoResult.path) {
          const insacoMedia = MessageMedia.fromFilePath(insacoResult.path);
          await this.client.sendMessage(chatId, insacoMedia, {
            caption: `📄 *REPORTE INSACO LAFT*\n\n${matchMsg}\n\n📄 *Documento:* ${query.type} ${query.number}`
          });
        } else {
          // Fallback por si acaso falló la generación total
          await this.client.sendMessage(chatId, `📄 *REPORTE INSACO LAFT*\n\n${matchMsg}\n\n📄 *Documento:* ${query.type} ${query.number}`);
        }

        await this.client.sendMessage(chatId, `✅ *PROCESO TOTAL COMPLETADO CON ÉXITO.*`);

      } catch (insacoError) {
        console.error(`[Bot] Error en INSACO para ${query.type}: ${query.number}:`, insacoError);
        await this.client.sendMessage(chatId, `❌ *Error al consultar INSACO LAFT*\nDetalle: ${insacoError.message}`);
      }
    } catch (error) {
      console.error(`[Bot] Error procesando consulta ${query.type}: ${query.number}:`, error);
      try {
        await this.client.sendMessage(chatId, `❌ *Error al procesar la consulta en SBS COOPAC*\nDetalle: ${error.message || 'Error de conexión o credenciales'}`);
      } catch (_) { }
    } finally {
      this.isProcessing = false;
      // Procesar siguiente elemento si existe
      if (this.queue.length > 0) {
        this.processQueue();
      }
    }
  }

  async start() {
    console.log('\n[1/2] Iniciando navegador y cargando WhatsApp Web...');
    console.log('[2/2] Esperando código QR (aparecerá en unos segundos)...\n');
    await this.client.initialize();
  }
}
