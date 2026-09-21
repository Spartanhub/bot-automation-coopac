import readline from 'readline';
import { SbsScraper } from './sbsScraper.js';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import path from 'path';

dotenv.config();

console.clear();
console.log('===============================================================');
console.log('       🤖 SIMULADOR INTERACTIVO DE CONSULTAS SBS COOPAC       ');
console.log('             (Prueba directa sin escanear WhatsApp)           ');
console.log('===============================================================');
console.log('Formatos de introduccion:');
console.log('   dni: 74659034');
console.log('   ce: 00000000');
console.log('   salir (para terminar)');
console.log('---------------------------------------------------------------\n');

const scraper = new SbsScraper({
  headless: process.env.PUPPETEER_HEADLESS === 'true'
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function parseInput(text) {
  if (!text || typeof text !== 'string') return null;
  const clean = text.trim();

  if (clean.toLowerCase() === 'salir' || clean.toLowerCase() === 'exit') {
    return { type: 'EXIT' };
  }

  const dniMatch = clean.match(/(?:dni\s*[:=]?\s*)?([0-9]{8})$/i);
  if (dniMatch) {
    return { type: 'DNI', number: dniMatch[1] };
  }

  const ceMatch = clean.match(/(?:(?:carnetex|carnet_extranjeria|carnet|ce)\s*[:=]?\s*)([0-9a-zA-Z]{5,15})/i);
  if (ceMatch) {
    return { type: 'CE', number: ceMatch[1] };
  }

  return null;
}

function promptUser() {
  rl.question('\n💬 Escribe tu consulta > ', async (input) => {
    const query = parseInput(input);

    if (!query) {
      console.log('⚠️ Formato no reconocido. Prueba escribiendo: dni: 74659034 o un DNI de 8 dígitos.');
      return promptUser();
    }

    if (query.type === 'EXIT') {
      console.log('\n👋 Cerrando simulador...');
      await scraper.close();
      rl.close();
      process.exit(0);
    }

    console.log(`\n⏳ [1/3] Iniciando consulta para ${query.type}: ${query.number}...`);
    try {
      const outputDir = path.resolve(`./temp/consultas_${query.number}`);
      const screenshots = await scraper.consultDocument({
        type: query.type,
        number: query.number,
        outputDir
      });

      console.log(`\n✅ [2/3] Consulta completada. Se obtuvieron ${screenshots.length} capturas:`);
      screenshots.forEach((s, i) => {
        console.log(`   📸 ${i + 1}. [${s.name}] -> ${s.path}`);
      });

      console.log(`\n📂 [3/3] Abriendo carpeta con las capturas...`);
      exec(`explorer "${outputDir}"`);

    } catch (err) {
      console.error(`\n❌ Error al realizar la consulta: ${err.message}`);
    }

    promptUser();
  });
}

promptUser();
