require('dotenv').config();
const express = require('express');
const path = require('path');

const vehiclesRouter = require('./src/routes/vehicles');
const historyRouter  = require('./src/routes/history');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/vehicles', vehiclesRouter);
app.use('/api/history',  historyRouter);

// Fallback: serve index.html para qualquer rota não-API
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚛 SSX Histórico rodando em http://localhost:${PORT}`);
});
