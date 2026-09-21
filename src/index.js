import { WhatsAppBot } from './whatsappHandler.js';
import dotenv from 'dotenv';

dotenv.config();

console.log('====================================================');
console.log(' INICIANDO BOT WHATSAPP - SBS COOPAC');
console.log('====================================================');

const bot = new WhatsAppBot();

bot.start().catch((err) => {
  console.error('Fatal Error al iniciar el Bot:', err);
  process.exit(1);
});

// Manejo de salida limpia
process.on('SIGINT', async () => {
  console.log('\nCerrando servicios...');
  if (bot.scraper) {
    await bot.scraper.close();
  }
  process.exit(0);
});
