const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', [path.join(__dirname, 'views'), path.join(__dirname)]);

const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP || 'caggia-cosmetics.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

app.get('/', (req, res) => {
  res.render('index', { shop: SHOPIFY_SHOP, authenticated: !!SHOPIFY_ACCESS_TOKEN });
});

app.get('/orders', (req, res) => {
  if (!SHOPIFY_ACCESS_TOKEN) return res.redirect('/');
  res.render('orders', { shop: SHOPIFY_SHOP });
});

app.get('/api/orders', async (req, res) => {
  if (!SHOPIFY_ACCESS_TOKEN) return res.status(401).json({ error: 'No configurado' });
  const status = req.query.status || 'unfulfilled';
  const limit = req.query.limit || 100;
  try {
    const response = await axios.get(
      `https://${SHOPIFY_SHOP}/admin/api/2024-04/orders.json?status=any&fulfillment_status=${status}&limit=${limit}`,
      { headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN } }
    );
    res.json(response.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.post('/api/generate-csv', (req, res) => {
  const { orders } = req.body;
  if (!orders || !orders.length) return res.status(400).json({ error: 'No hay pedidos' });
  const headers = ['NombreDestinatario','ApellidoDestinatario','EmailDestinatario','TelefonoDestinatario','CalleDestinatario','NumeroDestinatario','PisoDestinatario','DeptoDestinatario','LocalidadDestinatario','ProvinciaDestinatario','CodigoPostalDestinatario','NumeroPedido','PesoKg','AltoC','AnchoC','ProfundidadC','ValorDeclarado'];
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
      addr.city || '', addr.province || '', addr.zip || '',
      o.order_number || '', '', '', '', '',
      o.total_price || ''
    ];
    rows.push(row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  });
  const csv = '\uFEFF' + rows.join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="andreani_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
