import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Módulo de scraping y automatización para el portal SBS COOPAC - Central de Riesgos
 */
export class SbsScraper {
  constructor(options = {}) {
    this.sbsUrl = options.sbsUrl || process.env.SBS_URL || 'https://coopac.sbs.gob.pe/auth.web/index.jsp';
    this.username = options.username || process.env.SBS_USER || 'X74659034';
    this.password = options.password || process.env.SBS_PASS || 'Fladep26';
    this.headless = options.headless !== undefined ? options.headless : (process.env.PUPPETEER_HEADLESS === 'true');
    this.timeout = options.timeout || parseInt(process.env.SBS_TIMEOUT || '45000', 10);
    this.browser = null;
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
   * Inicia sesión en el portal SBS COOPAC y resuelve conflictos de sesiones previas
   */
  async login(page) {
    console.log(`[SBS] 1. Navegando a portal de autenticación: ${this.sbsUrl}...`);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    // Usamos domcontentloaded para que no espere inútilmente a conexiones rezagadas (networkidle2 puede dar timeout si la página es pesada)
    await page.goto(this.sbsUrl, { waitUntil: 'domcontentloaded', timeout: this.timeout }).catch(e => {
      console.log(`[SBS] Advertencia en goto: ${e.message}. Continuando de todos modos...`);
    });

    console.log('[SBS] 2. Ingresando credenciales...');
    await page.waitForSelector('#codUsuario', { timeout: 15000 });
    await page.click('#codUsuario', { clickCount: 3 });
    await page.type('#codUsuario', this.username, { delay: 40 });

    await page.waitForSelector('#txtClave', { timeout: 15000 });
    await page.click('#txtClave', { clickCount: 3 });
    await page.type('#txtClave', this.password, { delay: 40 });

    console.log('[SBS] 3. Clic en botón Ingresar...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: this.timeout }).catch(() => { }),
      page.click('#inicio')
    ]);

    await new Promise(r => setTimeout(r, 2000));

    // Si aparece la pantalla de sesión activa anterior, confirmar cierre y apertura de nueva
    if (page.url().includes('SessionActiva.jsp') || (await page.$('#miform button[type="submit"], #miform button'))) {
      console.log('[SBS] Detectada sesión previa. Confirmando cierre de sesión anterior...');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: this.timeout }).catch(() => { }),
        page.click('#miform button[type="submit"], #miform button')
      ]);
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log('[SBS] 4. Acceso autenticado al menú principal.');
  }

  /**
   * Navega desde el menú principal hacia el módulo de Central de Riesgos
   */
  async goToCentralRiesgos(page) {
    console.log('[SBS] 5. Ingresando al módulo de Central de Riesgos...');
    await page.evaluate(() => {
      if (typeof base !== 'undefined' && base.getOpcionFromMenu) {
        base.getOpcionFromMenu('/crw-sf-coopac/loginPortalCoopac?c_c_producto=00013&token=');
      } else {
        const el = document.querySelector('.contenedor');
        if (el) el.click();
      }
    });

    await page.waitForSelector('form[action*="buscarposicionconsolidada"], select[name="as_tipo_doc"]', { timeout: 25000 });
    console.log('[SBS] Formulario de Central de Riesgos cargado.');
  }

  /**
   * Ejecuta la consulta de un documento y captura todos los módulos activos
   * @param {Object} queryParams
   * @param {string} queryParams.type - 'DNI' | 'CE'
   * @param {string} queryParams.number - Número del documento
   * @param {string} queryParams.outputDir - Directorio de almacenamiento de imágenes
   * @returns {Promise<Array<{ name: string, label: string, path: string }>>}
   */
  async consultDocument({ type = 'DNI', number, outputDir = './temp/capturas' }) {
    if (!number) {
      throw new Error('Debe proporcionar un número de documento.');
    }

    // Asegurar directorio de capturas
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const browser = await this.initBrowser();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const screenshots = [];

    try {
      // Auto-dismiss dialogs/alerts to prevent the scraper from hanging
      page.on('dialog', async dialog => {
        console.log(`[SBS] Alerta del navegador detectada y descartada: ${dialog.message()}`);
        await dialog.dismiss();
      });

      await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1.5 });

      // 1. Iniciar sesión
      await this.login(page);

      // 2. Ir a Central de Riesgos
      await this.goToCentralRiesgos(page);

      // 3. Determinar código de documento según SBS
      // 11 = LE/DNI, 12 = Carnet de Extranjería, 15 = Pasaporte, 21 = RUC
      const isCE = type.toUpperCase().includes('CE') || type.toUpperCase().includes('CARNET') || type.toUpperCase().includes('EXT');
      const isRUC = type.toUpperCase().includes('RUC');
      
      let docCode = '11';
      let docLabel = 'DNI';
      if (isCE) {
        docCode = '12';
        docLabel = 'Carné de Extranjería';
      } else if (isRUC) {
        docCode = '21';
        docLabel = 'RUC';
      }

      console.log(`[SBS] 6. Consultando [${docLabel}: ${number}]...`);
      await page.select('select[name="as_tipo_doc"]', docCode);

      await page.click('input[name="as_doc_iden"]', { clickCount: 3 });
      await page.type('input[name="as_doc_iden"]', String(number).trim(), { delay: 40 });

      // Clic en botón Consultar
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: this.timeout }).catch(() => { }),
        page.click('#btnConsultar, input[value="Consultar"]')
      ]);

      await new Promise(r => setTimeout(r, 2500));

      const timestamp = Date.now();
      const sanitizedNum = String(number).replace(/[^a-zA-Z0-9]/g, '');

      // Verificar si la persona no tiene información reportada, no presenta saldos o aparece un mensaje único
      const alertInfo = await page.evaluate(() => {
        const bodyText = document.body ? document.body.innerText : '';
        const hasMenu = !!document.querySelector('#idOp0, #Menu, a[onclick*="verConsolidado"], #idOp1');

        // Buscar textos característicos de 'sin información' o 'sin saldos'
        const isNoSaldos = bodyText.includes('no presenta saldos');
        const isNoInfo = bodyText.includes('no tiene información reportada') ||
          bodyText.includes('no registra información') ||
          bodyText.includes('intente ingresando el Código SBS') ||
          bodyText.includes('No se encontraron registros') ||
          isNoSaldos;

        let message = '';
        if (isNoInfo) {
          // Intentar extraer el texto específico del recuadro de alerta
          const allElements = Array.from(document.querySelectorAll('div, td, p, span, font, center'));
          const matchEl = allElements.find(el => {
            const txt = el.innerText ? el.innerText.trim() : '';
            return (
              (txt.includes('no presenta saldos') ||
                txt.includes('no tiene información reportada') ||
                txt.includes('no registra información')) &&
              txt.length < 200
            );
          });

          if (matchEl) {
            message = matchEl.innerText.trim();
          } else if (isNoSaldos) {
            message = 'La persona no presenta saldos en la Posición Consolidada.';
          } else {
            message = 'La persona consultada no tiene información reportada a la Central de Riesgos.';
          }
        }

        return {
          isNoInfo: isNoInfo || !hasMenu,
          isNoSaldos: isNoSaldos,
          message: message || (isNoInfo ? 'Consulta finalizada sin registros activos de saldo.' : '')
        };
      });

      if (alertInfo.isNoInfo) {
        const estadoDesc = alertInfo.isNoSaldos ? 'Sin saldos en Posición Consolidada' : 'Sin información reportada';
        console.log(`[SBS] ℹ️ Documento con alerta única [${estadoDesc}]: ${alertInfo.message}`);
        const suffix = alertInfo.isNoSaldos ? 'sin_saldos' : 'sin_informacion';
        const filePath = path.join(outputDir, `${sanitizedNum}_${suffix}_${timestamp}.png`);
        await page.screenshot({ path: filePath, fullPage: true });

        screenshots.push({
          name: alertInfo.isNoSaldos ? 'Sin Saldos' : 'Sin Información Reportada',
          label: alertInfo.isNoSaldos ? 'Sin Saldos' : 'Sin Información Reportada',
          path: filePath,
          noInfo: true,
          message: alertInfo.message
        });

        console.log(` -> Capturado resultado único: ${filePath}`);
        console.log(`[SBS] Proceso finalizado. Total capturas obtenidas: ${screenshots.length}`);
        return screenshots;
      }

      // Definición de los módulos activos (Consolidado, Detallada, Histórica)
      const modules = [
        { key: '1_consolidado', label: 'Consolidado', opId: 'idOp0', funcName: 'verConsolidado' },
        { key: '2_detallada', label: 'Detallada', opId: 'idOp4', funcName: 'verDetallada' },
        { key: '3_historica', label: 'Histórica', opId: 'idOp2', funcName: 'verxHistorico' }
        // Deshabilitados temporalmente:
        // { key: 'tipo_credito', label: 'Por Tipo de Crédito', opId: 'idOp1', funcName: 'verxTipodeCredito' },
        // { key: 'adicional', label: 'Adicional', opId: 'idOp3', funcName: 'verAdicional' },
        // { key: 'al_cliente', label: 'Al Cliente', opId: 'idOp5', funcName: 'verPau' },
        // { key: 'otros_reportes', label: 'Otros Reportes', opId: 'idOp6', funcName: 'verOtrosReportes' },
        // { key: 'rio', label: 'RIO', opId: 'idOp7', funcName: 'verRio' }
      ];

      console.log('[SBS] 7. Iniciando captura de los módulos del reporte...');

      for (let i = 0; i < modules.length; i++) {
        const mod = modules[i];
        console.log(`[SBS] Módulo [${i + 1}/${modules.length}]: ${mod.label}`);

        try {
          if (i > 0) {
            // Activar el módulo
            await page.evaluate((opId, funcName) => {
              const el = document.getElementById(opId);
              if (el) {
                el.click();
                return;
              }
              const links = Array.from(document.querySelectorAll('#Menu a, a'));
              const target = links.find(a => a.id === opId || a.getAttribute('onclick')?.includes(funcName));
              if (target) {
                target.click();
                return;
              }
              if (typeof window[funcName] === 'function') {
                try { window[funcName](); } catch (_) { }
              }
            }, mod.opId, mod.funcName).catch(() => { });

            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => { });
            await new Promise(r => setTimeout(r, 2000));
          } else {
            // El módulo inicial Consolidado ya está listo
            await new Promise(r => setTimeout(r, 1000));
          }

          const filePath = path.join(outputDir, `${sanitizedNum}_${mod.key}_${timestamp}.png`);
          await page.screenshot({ path: filePath, fullPage: true });

          screenshots.push({
            name: mod.label,
            label: mod.label,
            path: filePath
          });
          console.log(` -> Capturado: ${filePath}`);
        } catch (modError) {
          console.warn(`[SBS] Error al capturar módulo ${mod.label}:`, modError.message);
        }
      }

      console.log(`[SBS] Proceso finalizado. Total capturas obtenidas: ${screenshots.length}`);
      return screenshots;

    } catch (error) {
      console.error('[SBS] Error general en consultDocument:', error);
      try {
        const errPath = path.join(outputDir, `error_${number}_${Date.now()}.png`);
        await page.screenshot({ path: errPath, fullPage: true });
      } catch (_) { }
      throw error;
    } finally {
      await page.close().catch(() => { });
      await context.close().catch(() => { });
    }
  }
}

export default SbsScraper;
