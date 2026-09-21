import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

dotenv.config();

/**
 * Módulo de scraping y automatización para el portal INSACO LAFT
 */
export class InsacoScraper {
  constructor(options = {}) {
    this.insacoUrl = options.insacoUrl || process.env.INSACO_URL || 'https://seek.insacolaft.com';
    this.username = options.username || process.env.INSACO_USER || 'kluyocab';
    this.password = options.password || process.env.INSACO_PASS || 'i2R7N+GN';
    this.headless = options.headless !== undefined ? options.headless : (process.env.PUPPETEER_HEADLESS === 'true');
    this.timeout = options.timeout || parseInt(process.env.SBS_TIMEOUT || '45000', 10);
    this.browser = null;
    this.downloadBaseDir = path.resolve('./temp/insaco_pdfs');

    if (!fs.existsSync(this.downloadBaseDir)) {
      fs.mkdirSync(this.downloadBaseDir, { recursive: true });
    }
  }

  /**
   * Inicia la instancia de Puppeteer
   */
  async initBrowser() {
    if (!this.browser) {
      const launchOptions = {
        headless: this.headless ? true : false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1400,900',
          '--ignore-certificate-errors'
        ],
        defaultViewport: {
          width: 1400,
          height: 900
        }
      };

      try {
        this.browser = await puppeteer.launch(launchOptions);
      } catch (err) {
        // Fallback al Google Chrome instalado en el sistema
        this.browser = await puppeteer.launch({
          ...launchOptions,
          channel: 'chrome'
        });
      }
    }
    return this.browser;
  }

  /**
   * Cierra el navegador
   */
  async close() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (err) {
        console.error('Error al cerrar navegador:', err.message);
      }
      this.browser = null;
    }
  }

  /**
   * Inicia sesión en el portal INSACO
   */
  async login(page) {
    console.log(`[INSACO] 1. Navegando a login: ${this.insacoUrl}/#/auth/login...`);
    await page.goto(`${this.insacoUrl}/#/auth/login`, { waitUntil: 'networkidle2', timeout: this.timeout });

    // Esperar un poco a que Angular renderice
    await new Promise(r => setTimeout(r, 2000));

    console.log('[INSACO] 2. Ingresando credenciales...');
    const userInput = await page.waitForSelector('#username', { timeout: 15000 });
    await userInput.click({ clickCount: 3 });
    await userInput.type(this.username, { delay: 30 });

    const passInput = await page.waitForSelector('#password', { timeout: 15000 });
    await passInput.click({ clickCount: 3 });
    await passInput.type(this.password, { delay: 30 });

    console.log('[INSACO] 3. Clic en botón de acceso...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: this.timeout }).catch(() => { }),
      page.click('button[type="submit"]')
    ]);

    await new Promise(r => setTimeout(r, 2000));
    console.log('[INSACO] 4. Login completado.');
  }

  /**
   * Ejecuta la consulta de un documento y descarga el PDF
   * @param {Object} queryParams
   * @param {string} queryParams.type - 'DNI' | 'CE' | 'RUC'
   * @param {string} queryParams.number - Número del documento
   * @returns {Promise<{ path: string, filename: string, hasMatches: boolean }>}
   */
  async consultDocument({ type = 'DNI', number }) {
    if (!number) {
      throw new Error('Debe proporcionar un número de documento.');
    }

    const browser = await this.initBrowser();

    // Configurar directorio de descarga único para esta consulta para evitar mezclar archivos
    const downloadId = randomUUID();
    const currentDownloadDir = path.join(this.downloadBaseDir, downloadId);
    fs.mkdirSync(currentDownloadDir, { recursive: true });

    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    // Configurar comportamiento de descarga
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: currentDownloadDir
    });

    try {
      // Auto-dismiss dialogs/alerts to prevent the scraper from hanging
      page.on('dialog', async dialog => {
        console.log(`[INSACO] Alerta del navegador detectada y descartada: ${dialog.message()}`);
        await dialog.dismiss();
      });

      await page.setViewport({ width: 1400, height: 900 });

      // 1. Iniciar sesión
      await this.login(page);

      // 2. Ir a Consultas
      console.log('[INSACO] 5. Navegando a Consultas...');
      await page.goto(`${this.insacoUrl}/#/admin/search`, { waitUntil: 'networkidle2', timeout: this.timeout });
      await new Promise(r => setTimeout(r, 2000));

      // 3. Determinar código de documento
      const isRUC = type.toUpperCase().includes('RUC') || String(number).length === 11;
      const docCode = isRUC ? '06' : '01'; // 01 = DNI, 06 = RUC

      console.log(`[INSACO] 6. Consultando [${type}: ${number}]...`);

      // Seleccionar filtro por "Documentos" (valor 1)
      await page.select('#filterBy', '1');

      // Seleccionar tipo de documento
      await page.select('#documentType', docCode);

      // Ingresar número
      const docInput = await page.waitForSelector('input[formcontrolname="documentNumber"]', { timeout: 10000 });
      await docInput.click({ clickCount: 3 });
      await docInput.type(String(number).trim(), { delay: 30 });

      // Clic en botón Consultar y esperar
      console.log('[INSACO] 7. Ejecutando búsqueda...');
      await page.click('button[type="submit"].btn-secondary');

      // Esperar a que salga la respuesta o el popup
      await new Promise(r => setTimeout(r, 4000));

      console.log('[INSACO] 8. Analizando resultados y forzando impresión...');

      let hasMatches = false;

      // Verificar si salió el popup de "No se encontraron coincidencias"
      const dialogInfo = await page.evaluate(() => {
        const swal = document.querySelector('.swal2-container');
        const text = document.body.innerText;
        return {
          hasSwal: !!swal,
          hasNoResults: text.includes('No se encontraron coincidencias')
        };
      });

      if (dialogInfo.hasSwal || dialogInfo.hasNoResults) {
        console.log(`[INSACO] -> Sin coincidencias PLAFT para ${number}.`);
        const acceptBtn = await page.$('.swal2-confirm');
        if (acceptBtn) {
          await acceptBtn.click();
        } else {
          // Intentar hacer click en el botón de aceptar si no tiene la clase swal2-confirm
          await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const accept = btns.find(b => b.innerText.trim().toLowerCase().includes('aceptar'));
            if (accept) accept.click();
          });
        }
      } else {
        console.log(`[INSACO] -> ¡Coincidencias encontradas! Buscando botón de 'Ver Información'...`);
        hasMatches = true;

        // Esperar a que el botón del ojito (Ver información) aparezca
        await page.waitForFunction(() => {
          return !!document.querySelector('tbody tr td button, tbody tr td a, .btn-info, .btn-success, [title*="nformaci"]');
        }, { timeout: 10000 }).catch(() => console.log('[INSACO] Timeout esperando botón de Ver Información.'));

        // Hacer click en el botón de Ver Información
        await page.evaluate(() => {
          // Intentar encontrar el botón por título o icono de ojo
          const btns = Array.from(document.querySelectorAll('button, a'));
          let infoBtn = btns.find(b => {
            const h = b.innerHTML.toLowerCase();
            const t = (b.getAttribute('title') || '').toLowerCase();
            return t.includes('informaci') || h.includes('eye') || h.includes('visibility');
          });
          // Si no, simplemente el primer botón dentro de la tabla de resultados
          if (!infoBtn) {
            infoBtn = document.querySelector('tbody tr td button, tbody tr td a');
          }
          if (infoBtn) infoBtn.click();
        });

        console.log(`[INSACO] -> Entrando al detalle, esperando que cargue...`);
        await new Promise(r => setTimeout(r, 4000)); // Esperar que cargue la vista detalle

        console.log(`[INSACO] -> Buscando botón IMPRIMIR en el detalle...`);
        // Esperar a que el botón imprimir aparezca
        await page.waitForFunction(() => {
          const btns = Array.from(document.querySelectorAll('button, a'));
          return btns.some(b => {
            const t = b.innerText.toLowerCase();
            const c = b.className.toLowerCase();
            return t.includes('imprimir') || t.includes('descargar') || t.includes('pdf') ||
              c.includes('print') || c.includes('download') || c.includes('pdf');
          });
        }, { timeout: 10000 }).catch(() => console.log('[INSACO] Timeout esperando botón de imprimir.'));

        // Hacer click
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button, a'));
          const printBtn = btns.find(b => {
            const t = b.innerText.toLowerCase();
            const c = b.className.toLowerCase();
            return t.includes('imprimir') || t.includes('descargar') || t.includes('pdf') ||
              c.includes('print') || c.includes('download') || c.includes('pdf');
          });
          if (printBtn) printBtn.click();
        });
      }

      let finalPdfPath = null;
      let finalFilename = null;
      let downloadedFile = null;

      // Esperar a que termine la descarga nativa (max 15 segundos)
      console.log('[INSACO] 9. Esperando descarga de archivo nativo...');
      let attempts = 0;

      while (attempts < 15) {
        await new Promise(r => setTimeout(r, 1000));
        const files = fs.readdirSync(currentDownloadDir);
        // Filtrar archivos temporales de chrome (.crdownload)
        const finishedFiles = files.filter(f => !f.endsWith('.crdownload') && f.endsWith('.pdf'));

        if (finishedFiles.length > 0) {
          downloadedFile = finishedFiles[0];
          break;
        }
        attempts++;
      }

      const sanitizedNum = String(number).replace(/[^a-zA-Z0-9]/g, '');
      let ext = 'pdf';

      if (!downloadedFile) {
        // Si el botón nativo falló en descargar, forzamos un PDF de la página
        console.log('[INSACO] Generando captura PDF de los resultados...');
        downloadedFile = 'forced_capture.pdf';
        try {
          await page.emulateMediaType('screen');
          await page.pdf({
            path: path.join(currentDownloadDir, downloadedFile),
            format: 'A4',
            printBackground: true
          });
        } catch (e) {
          console.log('[INSACO] Falló PDF. Intentando captura de pantalla...');
          downloadedFile = 'forced_capture.png';
          ext = 'png';
          await page.screenshot({ path: path.join(currentDownloadDir, downloadedFile), fullPage: true });
        }
      } else {
        ext = downloadedFile.split('.').pop();
      }

      const fullPdfPath = path.join(currentDownloadDir, downloadedFile);

      finalFilename = `INSACO_${type}_${sanitizedNum}.${ext}`;
      finalPdfPath = path.join(this.downloadBaseDir, finalFilename);

      fs.renameSync(fullPdfPath, finalPdfPath);

      // Limpiar el directorio temporal de esta consulta
      fs.rmSync(currentDownloadDir, { recursive: true, force: true });

      console.log(`[INSACO] Proceso finalizado. PDF descargado: ${finalFilename}`);

      return {
        path: finalPdfPath,
        filename: finalFilename,
        hasMatches
      };

    } catch (error) {
      console.error('[INSACO] Error general en consultDocument:', error);
      throw error;
    } finally {
      await page.close().catch(() => { });
      await context.close().catch(() => { });
    }
  }
}

export default InsacoScraper;
