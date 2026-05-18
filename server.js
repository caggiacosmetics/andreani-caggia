const express = require('express');
const axios = require('axios');
const path = require('path');
const session = require('express-session');
const { spawn } = require('child_process');
const LOCALIDADES_ANDREANI = require('./localidades_andreani.json');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '250mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', [path.join(__dirname, 'views'), path.join(__dirname)]);

app.use(session({
  secret: process.env.SESSION_SECRET || 'shopify-andreani-secret-2024',
  resave: true,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SCOPES = 'read_orders,read_customers';
const HOST = process.env.HOST || 'http://localhost:3000';

app.get('/', (req, res) => {
  res.render('index', { shop: req.session.shop, authenticated: !!(req.session.shop && req.session.accessToken) });
});

app.post('/auth', (req, res) => {
  const shop = req.body.shop?.trim().replace('https://','').replace('http://','').replace(/\/$/,'');
  if (!shop) return res.redirect('/?error=missing_shop');
  req.session.shop = shop;
  const redirectUri = `${HOST}/auth/callback`;
  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=nonce123`;
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { code, shop } = req.query;
  try {
    const response = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: SHOPIFY_API_KEY, client_secret: SHOPIFY_API_SECRET, code
    });
    req.session.accessToken = response.data.access_token;
    req.session.shop = shop;
    res.redirect('/orders');
  } catch (err) { res.redirect('/?error=token_failed'); }
});

app.get('/orders', (req, res) => {
  if (!req.session.accessToken) return res.redirect('/');
  res.render('orders', { shop: req.session.shop });
});

app.get('/api/orders', async (req, res) => {
  if (!req.session.accessToken) return res.status(401).json({ error: 'No autenticado' });
  const { shop, accessToken } = req.session;
  try {
    const response = await axios.get(
      `https://${shop}/admin/api/2024-04/orders.json?status=any&fulfillment_status=${req.query.status||'unfulfilled'}&limit=${req.query.limit||100}`,
      { headers: { 'X-Shopify-Access-Token': accessToken } }
    );
    res.json(response.data);
  } catch (err) { res.status(500).json({ error: err.response?.data || err.message }); }
});

app.post('/api/generate-xlsx', (req, res) => {
  if (!req.session.accessToken) return res.status(401).json({ error: 'No autenticado' });
  const { orders } = req.body;
  if (!orders || !orders.length) return res.status(400).json({ error: 'No hay pedidos' });

  const filename = `andreani_${new Date().toISOString().slice(0,10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const py = spawn('python3', [path.join(__dirname, 'fill_andreani.py')]);
  py.stdin.write(JSON.stringify({ orders }));
  py.stdin.end();
  py.stdout.pipe(res);
  py.stderr.on('data', d => console.error('Python error:', d.toString()));
  py.on('close', code => { if (code !== 0) console.error('Python exit code:', code); });
});

app.post('/api/generate-csv', (req, res) => { res.redirect(307, '/api/generate-xlsx'); });
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
