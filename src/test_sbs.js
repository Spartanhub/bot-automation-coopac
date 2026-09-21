import { SbsScraper } from './sbsScraper.js';
import dotenv from 'dotenv';

dotenv.config();

async function runTest() {
  const docType = process.argv[2] || 'DNI';
  const docNumber = process.argv[3] || '74659034';

  console.log(`[TEST] Probando scraper SBS para [${docType}: ${docNumber}]...`);
  
  const scraper = new SbsScraper({
    headless: process.env.PUPPETEER_HEADLESS === 'true'
  });

  try {
    const results = await scraper.consultDocument({
      type: docType,
      number: docNumber,
      outputDir: './temp/test_capturas'
    });

    console.log(`\n✅ Proceso de prueba completado exitosamente.`);
    console.log(`Total capturas obtenidas: ${results.length}`);
    results.forEach((r, idx) => {
      console.log(` ${idx + 1}. [${r.name}] -> ${r.path}`);
    });
  } catch (err) {
    console.error(`❌ Error durante la prueba:`, err.message);
  } finally {
    await scraper.close();
    process.exit(0);
  }
}

runTest();
