const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const session = require('express-session');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', [path.join(__dirname, 'views'), path.join(__dirname)]);

app.use(session({
  secret: process.env.SESSION_SECRET || 'shopify-andreani-secret-2024',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SCOPES = 'read_orders,read_customers';
const HOST = process.env.HOST || 'http://localhost:3000';

// ---- HOME ----
app.get('/', (req, res) => {
  const shop = req.session.shop;
  const token = req.session.accessToken;
  res.render('index', { shop, authenticated: !!(shop && token) });
});

// ---- STEP 1: Iniciar OAuth ----
app.post('/auth', (req, res) => {
  const shop = req.body.shop?.trim().replace('https://', '').replace('http://', '').replace(/\/$/, '');
  if (!shop) return res.redirect('/?error=missing_shop');

  const state = crypto.randomBytes(16).toString('hex');
  req.session.state = state;
  req.session.shop = shop;

  const redirectUri = `${HOST}/auth/callback`;
  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

  res.redirect(authUrl);
});

// ---- STEP 2: Callback OAuth ----
app.get('/auth/callback', async (req, res) => {
  const { code, state, shop, hmac } = req.query;

  // Verificar state
  if (state !== req.session.state) {
    return res.status(403).send('State mismatch. Intentá de nuevo.');
  }

  // Verificar HMAC
  const params = Object.keys(req.query)
    .filter(k => k !== 'hmac')
    .sort()
    .map(k => `${k}=${req.query[k]}`)
    .join('&');

  const digest = crypto.createHmac('sha256', SHOPIFY_API_SECRET).update(params).digest('hex');
  if (digest !== hmac) {
    return res.status(403).send('HMAC inválido.');
  }

  // Obtener access token
  try {
    const response = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code
    });

    req.session.accessToken = response.data.access_token;
    req.session.shop = shop;
    res.redirect('/orders');
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.redirect('/?error=token_failed');
  }
});

// ---- PEDIDOS ----
app.get('/orders', async (req, res) => {
  if (!req.session.accessToken) return res.redirect('/');
  res.render('orders', { shop: req.session.shop });
});

// ---- API: Traer pedidos ----
app.get('/api/orders', async (req, res) => {
  if (!req.session.accessToken) return res.status(401).json({ error: 'No autenticado' });

  const { shop, accessToken } = req.session;
  const status = req.query.status || 'unfulfilled';
  const limit = req.query.limit || 100;

  try {
    const response = await axios.get(
      `https://${shop}/admin/api/2024-04/orders.json?status=any&fulfillment_status=${status}&limit=${limit}`,
      { headers: { 'X-Shopify-Access-Token': accessToken } }
    );
    res.json(response.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ---- API: Generar CSV ----
app.post('/api/generate-csv', (req, res) => {
  if (!req.session.accessToken) return res.status(401).json({ error: 'No autenticado' });

  const { orders } = req.body;
  if (!orders || !orders.length) return res.status(400).json({ error: 'No hay pedidos' });

  const headers = [
    'NombreDestinatario', 'ApellidoDestinatario', 'EmailDestinatario',
    'TelefonoDestinatario', 'CalleDestinatario', 'NumeroDestinatario',
    'PisoDestinatario', 'DeptoDestinatario', 'LocalidadDestinatario',
    'ProvinciaDestinatario', 'CodigoPostalDestinatario', 'NumeroPedido',
    'PesoKg', 'AltoC', 'AnchoC', 'ProfundidadC', 'ValorDeclarado'
  ];

  const rows = [headers.join(',')];

  orders.forEach(o => {
    const addr = o.shipping_address || o.billing_address || {};
    const address1 = addr.address1 || '';
    const streetMatch = address1.match(/^(.*?)[\s,]+(\d+[\w/]*)[\s,]*(.*)$/);
    const calle = streetMatch ? streetMatch[1].trim() : address1;
    const numero = streetMatch ? streetMatch[2].trim() : '';
    const addr2 = addr.address2 || '';
    const pisoMatch = addr2.match(/[Pp]iso\s*(\d+)/);
    const deptoMatch = addr2.match(/[Dd]pto\.?\s*([A-Za-z0-9]+)/);

    const row = [
      addr.first_name || o.customer?.first_name || '',
      addr.last_name || o.customer?.last_name || '',
      o.email || o.customer?.email || '',
      addr.phone || o.phone || o.customer?.phone || '',
      calle, numero,
      pisoMatch ? pisoMatch[1] : '',
      deptoMatch ? deptoMatch[1] : '',
      addr.city || '',
      addr.province || '',
      addr.zip || '',
      o.order_number || '',
      '', '', '', '',
      o.total_price || ''
    ];

    rows.push(row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  });

  const csv = '\uFEFF' + rows.join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="andreani_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

// ---- LOGOUT ----
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
