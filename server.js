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
