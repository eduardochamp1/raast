require('dotenv').config();
const express = require('express');
const path = require('path');

const vehiclesRouter = require('./src/routes/vehicles');
const historyRouter  = require('./src/routes/history');

const app = express();

app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/vehicles', vehiclesRouter);
app.use('/api/history',  historyRouter);

// Diagnóstico: descobre qual endpoint de veículos o usuário tem acesso
app.get('/api/debug', async (req, res) => {
  const { getToken, clearToken } = require('./src/ssx-auth');
  const { ssx } = require('./src/ssx-client');
  const steps = [];

  clearToken();
  try {
    const token = await getToken();
    steps.push({ step: 'login', ok: true });
  } catch (e) {
    return res.json({ steps, error: 'Login falhou: ' + e.message });
  }

  const tryCall = async (label, path, body) => {
    try {
      const raw = await ssx(path, body);
      steps.push({ label, ok: true, isArray: Array.isArray(raw), length: Array.isArray(raw) ? raw.length : undefined, sample: Array.isArray(raw) ? raw[0] : raw });
    } catch (e) {
      steps.push({ label, ok: false, status: e.response?.status, error: e.response?.data?.Message || e.message });
    }
  };

  // Novo endpoint descoberto no Power BI
  await tryCall('GetLastPositions', '/Controlws/LastPosition/GetLastPositions', {
    ClientIntegrationCode: process.env.SSX_CLIENT_CODE
  });

  res.json(steps);
});

// Fallback: serve index.html para rotas não-API (SPA)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚛 SSX Histórico rodando em http://localhost:${PORT}`);
});
