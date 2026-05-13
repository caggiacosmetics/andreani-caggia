const express = require('express');
const axios = require('axios');
const path = require('path');
const session = require('express-session');
const ExcelJS = require('exceljs');
const LOCALIDADES_ANDREANI = require('./localidades_andreani.json');

const app = express();
app.use(express.json());
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

const PROVINCIAS = {
  'A': 'SALTA', 'B': 'BUENOS AIRES', 'C': 'CIUDAD AUTONOMA DE BUENOS AIRES',
  'D': 'SAN LUIS', 'E': 'ENTRE RIOS', 'F': 'LA RIOJA', 'G': 'SANTIAGO DEL ESTERO',
  'H': 'CHACO', 'J': 'SAN JUAN', 'K': 'CATAMARCA', 'L': 'LA PAMPA', 'M': 'MENDOZA',
  'N': 'MISIONES', 'P': 'FORMOSA', 'Q': 'NEUQUEN', 'R': 'RIO NEGRO', 'S': 'SANTA FE',
  'T': 'TUCUMAN', 'U': 'CHUBUT', 'V': 'TIERRA DEL FUEGO', 'W': 'CORRIENTES',
  'X': 'CORDOBA', 'Y': 'JUJUY', 'Z': 'SANTA CRUZ'
};

const LOCALIDADES_MAP = {};
LOCALIDADES_ANDREANI.forEach(l => {
  const parts = l.split(' / ');
  if (parts.length === 3) {
    const [prov, loc, cp] = parts;
    const cpNum = cp.replace(/[^0-9]/g, '');
    LOCALIDADES_MAP[`${prov}|${loc}|${cpNum}`] = l;
    if (!LOCALIDADES_MAP[`${prov}|${cpNum}`]) LOCALIDADES_MAP[`${prov}|${cpNum}`] = l;
  }
});

function buscarLocalidadAndreani(provinciaCode, ciudad, zip) {
  const prov = PROVINCIAS[provinciaCode.toUpperCase()] || provinciaCode.toUpperCase();
  const loc = ciudad.toUpperCase().trim();
  const cpNum = zip.replace(/[^0-9]/g, '').slice(0, 4);
  if (LOCALIDADES_MAP[`${prov}|${loc}|${cpNum}`]) return LOCALIDADES_MAP[`${prov}|${loc}|${cpNum}`];
  if (LOCALIDADES_MAP[`${prov}|${cpNum}`]) return LOCALIDADES_MAP[`${prov}|${cpNum}`];
  const found = LOCALIDADES_ANDREANI.find(l => l.split(' / ')[2]?.replace(/[^0-9]/g, '') === cpNum);
  if (found) return found;
  return `${prov} / ${loc} / ${cpNum}`;
}

function parseTelefono(raw) {
  if (!raw) return { codigo: '', numero: '' };
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('549')) digits = digits.slice(3);
  else if (digits.startsWith('54')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  let codigo = '', numero = '';
  if (digits.length === 10) {
    if (['11','15'].includes(digits.slice(0,2))) { codigo = '011'; numero = digits.slice(2); }
    else { codigo = digits.slice(0, 4); numero = digits.slice(4); }
  } else if (digits.length === 8) { codigo = '011'; numero = digits; }
  else { codigo = digits.slice(0, 3); numero = digits.slice(3); }
  return { codigo, numero };
}

function parseAddress(address1, address2) {
  const a1 = address1 || '';
  const a2 = address2 || '';
  let calle = '', numero = '', piso = '', depto = '';
  const matchNum = a1.match(/^(.*?)\s+(\d+[a-zA-Z]?)(?:\s+(.*))?$/);
  if (matchNum) {
    calle = matchNum[1].trim();
    numero = matchNum[2].trim();
    const resto = matchNum[3] || '';
    const pisoMatch = resto.match(/[Pp]iso\s*(\w+)/);
    const deptoMatch = resto.match(/[Dd]pto\.?\s*([A-Za-z0-9]+)/);
    if (pisoMatch) piso = pisoMatch[1];
    if (deptoMatch) depto = deptoMatch[1];
  } else { calle = a1.trim(); }
  if (!piso) { const m = a2.match(/[Pp]iso\s*(\w+)/); if (m) piso = m[1]; }
  if (!depto) { const m = a2.match(/[Dd]pto\.?\s*([A-Za-z0-9]+)/); if (m) depto = m[1]; }
  return { calle, numero, piso, depto };
}

app.get('/', (req, res) => {
  res.render('index', { shop: req.session.shop, authenticated: !!(req.session.shop && req.session.accessToken) });
});

app.post('/auth', (req, res) => {
  const shop = req.body.shop?.trim().replace('https://', '').replace('http://', '').replace(/\/$/, '');
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
      `https://${shop}/admin/api/2024-04/orders.json?status=any&fulfillment_status=${req.query.status || 'unfulfilled'}&limit=${req.query.limit || 100}`,
      { headers: { 'X-Shopify-Access-Token': accessToken } }
    );
    res.json(response.data);
  } catch (err) { res.status(500).json({ error: err.response?.data || err.message }); }
});

app.post('/api/generate-xlsx', async (req, res) => {
  if (!req.session.accessToken) return res.status(401).json({ error: 'No autenticado' });
  const { orders } = req.body;
  if (!orders || !orders.length) return res.status(400).json({ error: 'No hay pedidos' });

  // Cargar la plantilla oficial de Andreani
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(__dirname, 'plantilla_andreani.xlsx'));
  const sheet = workbook.getWorksheet('A domicilio');

  // Rellenar datos desde fila 3 en adelante
  orders.forEach((o, idx) => {
    const rowNum = idx + 3;
    const addr = o.shipping_address || o.billing_address || {};
    const { calle, numero, piso, depto } = parseAddress(addr.address1, addr.address2);
    const tel = parseTelefono(addr.phone || o.phone || o.customer?.phone);
    const provinciaLocalidadCP = buscarLocalidadAndreani(
      addr.province_code || addr.province || '',
      addr.city || '',
      addr.zip || ''
    );

    const row = sheet.getRow(rowNum);
    row.getCell(1).value  = 'PAQUETE';                                          // Paquete Guardado
    row.getCell(2).value  = 200;                                                // Peso (grs)
    row.getCell(3).value  = 10;                                                 // Alto (cm)
    row.getCell(4).value  = 10;                                                 // Ancho (cm)
    row.getCell(5).value  = 3;                                                  // Profundidad (cm)
    row.getCell(6).value  = parseFloat(o.total_price) || 0;                    // Valor declarado
    row.getCell(7).value  = String(o.order_number || '').replace('#', '');     // Numero Interno
    row.getCell(8).value  = addr.first_name || o.customer?.first_name || '';   // Nombre
    row.getCell(9).value  = addr.last_name  || o.customer?.last_name  || '';   // Apellido
    row.getCell(10).value = '';                                                 // DNI (no disponible)
    row.getCell(11).value = o.email || o.customer?.email || '';                // Email
    row.getCell(12).value = tel.codigo;                                        // Celular código
    row.getCell(13).value = tel.numero;                                        // Celular número
    row.getCell(14).value = calle;                                             // Calle
    row.getCell(15).value = numero;                                            // Número
    row.getCell(16).value = piso;                                              // Piso
    row.getCell(17).value = depto;                                             // Departamento
    row.getCell(18).value = provinciaLocalidadCP;                              // Provincia/Localidad/CP
    row.getCell(19).value = '';                                                // Observaciones
    row.commit();
  });

  const filename = `andreani_${new Date().toISOString().slice(0,10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
});

app.post('/api/generate-csv', (req, res) => { res.redirect(307, '/api/generate-xlsx'); });
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
