'use strict';
// config DEVE ser o primeiro import — valida env vars antes de qualquer outra coisa
const config = require('./src/config');

const express      = require('express');
const path         = require('path');
const helmet       = require('helmet');
const compression  = require('compression');
const rateLimit    = require('express-rate-limit');
const { randomUUID } = require('crypto');

const logger         = require('./src/logger');
const vehiclesRouter = require('./src/routes/vehicles');
const historyRouter  = require('./src/routes/history');
const basesRouter    = require('./src/routes/bases');
const groupsRouter   = require('./src/routes/groups');
const overnightRouter = require('./src/routes/overnight');
const { initCron }   = require('./src/cron');

const app = express();

// ── Segurança ─────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", 'unpkg.com', 'cdn.sheetjs.com', "'unsafe-inline'"],
      styleSrc:    ["'self'", 'unpkg.com', 'fonts.googleapis.com', "'unsafe-inline'"],
      fontSrc:     ["'self'", 'fonts.gstatic.com'],
      imgSrc:      ["'self'", 'data:', '*.tile.openstreetmap.org', '*.basemaps.cartocdn.com', '*.tile.carto.com'],
      connectSrc:  ["'self'"],
      frameSrc:    ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // necessário para tiles de mapa externos
}));

// ── Compressão gzip ───────────────────────────────────────────────────────────
app.use(compression());

// ── Rate limiting ─────────────────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max:      config.rateLimitGeneral,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Muitas requisições. Tente novamente em breve.' },
});

const overnightLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max:      config.rateLimitOvernight,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Limite de relatórios por minuto atingido. Aguarde antes de gerar outro.' },
});

app.use('/api/', generalLimiter);
app.use('/api/overnight/report', overnightLimiter);

// ── Request ID + logging ──────────────────────────────────────────────────────
app.use((req, res, next) => {
  req.id = randomUUID().slice(0, 8);
  const t0 = Date.now();
  res.on('finish', () => {
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
    logger[level](
      { reqId: req.id, method: req.method, url: req.url, status: res.statusCode, ms: Date.now() - t0 },
      `${req.method} ${req.url} ${res.statusCode}`
    );
  });
  next();
});

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50kb' }));

// ── Arquivos estáticos ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  let dbStatus = 'ok';
  try {
    const db = require('./src/db');
    db.prepare('SELECT 1').get();
  } catch {
    dbStatus = 'error';
  }
  const status = dbStatus === 'ok' ? 'ok' : 'degraded';
  res.status(status === 'ok' ? 200 : 503).json({
    status,
    db:      dbStatus,
    uptime:  Math.round(process.uptime()),
    version: require('./package.json').version,
  });
});

// ── Rotas API ─────────────────────────────────────────────────────────────────
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/history',  historyRouter);
app.use('/api/bases',    basesRouter);
app.use('/api/groups',   groupsRouter);
app.use('/api/overnight', overnightRouter);

// ── Debug (apenas em desenvolvimento) ────────────────────────────────────────
if (config.nodeEnv === 'development') {
  app.get('/api/debug', async (req, res) => {
    const { getToken, clearToken } = require('./src/ssx-auth');
    const { ssx } = require('./src/ssx-client');
    const steps = [];
    clearToken();
    try {
      await getToken();
      steps.push({ step: 'login', ok: true });
    } catch (e) {
      return res.json({ steps, error: 'Login falhou: ' + e.message });
    }
    try {
      const raw = await ssx('/Controlws/LastPosition/GetLastPositions', { ClientIntegrationCode: config.ssxClientCode });
      steps.push({ label: 'GetLastPositions', ok: true, isArray: Array.isArray(raw), length: Array.isArray(raw) ? raw.length : undefined });
    } catch (e) {
      steps.push({ label: 'GetLastPositions', ok: false, error: e.message });
    }
    res.json(steps);
  });
}

// ── Fallback SPA ──────────────────────────────────────────────────────────────
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error({ err, reqId: req.id }, 'Erro não tratado');
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// ── Inicialização ─────────────────────────────────────────────────────────────
const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, '🚛 RAAST rodando');
  initCron();
});

// ── Graceful Shutdown ─────────────────────────────────────────────────────────
function shutdown(signal) {
  logger.info({ signal }, 'Sinal recebido — encerrando servidor graciosamente...');
  server.close(() => {
    logger.info('Servidor encerrado. Saindo.');
    process.exit(0);
  });
  // Forçar saída após 10 segundos se não fechar normalmente
  setTimeout(() => {
    logger.error('Timeout no shutdown — forçando saída.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled Promise Rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught Exception — encerrando');
  process.exit(1);
});
