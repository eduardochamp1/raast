const cron = require('node-cron');
const { readJSON, writeJSON, ensureFile } = require('./data-store');
const { getCachedVehicles }   = require('./routes/vehicles');
const { analyzeVehicleNight } = require('./overnight');

function initCron() {
  // Ensure data files exist on startup
  ensureFile('bases.json',            []);
  ensureFile('groups.json',           []);
  ensureFile('overnight-config.json', { from: '22:00', to: '06:00' });
  ensureFile('alerts.json',           []);

  // Every day at 07:00 local time
  cron.schedule('0 7 * * *', async () => {
    console.log('[cron] Iniciando análise de pernoite...');
    try {
      const bases   = readJSON('bases.json', []);
      const groups  = readJSON('groups.json', []);
      const config  = readJSON('overnight-config.json', { from: '22:00', to: '06:00' });
      const alerts  = readJSON('alerts.json', []);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;

      const vehicles    = await getCachedVehicles();
      const plateToCode = Object.fromEntries(vehicles.map(v => [v.plate, v.integrationCode]));

      for (const group of groups) {
        for (const plate of group.placas) {
          const integrationCode = plateToCode[plate];
          if (!integrationCode) continue;
          // Skip if alert for this plate+date already exists
          if (alerts.some(a => a.placa === plate && a.data === dateStr)) continue;

          try {
            const result = await analyzeVehicleNight(integrationCode, dateStr, bases, config);
            if (result.situacao === 'fora') {
              alerts.push({
                id:    require('crypto').randomUUID(),
                data:  dateStr,
                placa: plate,
                grupo: group.nome,
                lat:   result.lat,
                lng:   result.lng,
                visto: false,
              });
            }
          } catch (err) {
            console.error(`[cron] Erro ao analisar ${plate}:`, err.message);
          }
        }
      }

      writeJSON('alerts.json', alerts);
      console.log('[cron] Análise concluída');
    } catch (err) {
      console.error('[cron] Erro geral:', err.message);
    }
  });

  console.log('[cron] Job de pernoite agendado para 07:00 diário');
}

module.exports = { initCron };
