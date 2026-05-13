const express = require('express');
const axios = require('axios');
const path = require('path');
const session = require('express-session');
const ExcelJS = require('exceljs');

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

// Mapa de códigos de provincia Shopify → nombre completo Andreani
const PROVINCIAS = {
  'A': 'SALTA',
  'B': 'BUENOS AIRES',
  'C': 'CIUDAD AUTONOMA DE BUENOS AIRES',
  'D': 'SAN LUIS',
  'E': 'ENTRE RIOS',
  'F': 'LA RIOJA',
  'G': 'SANTIAGO DEL ESTERO',
  'H': 'CHACO',
  'J': 'SAN JUAN',
  'K': 'CATAMARCA',
  'L': 'LA PAMPA',
  'M': 'MENDOZA',
  'N': 'MISIONES',
  'P': 'FORMOSA',
  'Q': 'NEUQUEN',
  'R': 'RIO NEGRO',
  'S': 'SANTA FE',
  'T': 'TUCUMAN',
  'U': 'CHUBUT',
  'V': 'TIERRA DEL FUEGO',
  'W': 'CORRIENTES',
  'X': 'CORDOBA',
  'Y': 'JUJUY',
  'Z': 'SANTA CRUZ'
};

// Parsea teléfono → { codigo, numero }
function parseTelefono(raw) {
  if (!raw) return { codigo: '', numero: '' };
  // Limpiar: sacar todo excepto dígitos
  let digits = String(raw).replace(/\D/g, '');
  // Si empieza con 549 (formato internacional AR con celular)
  if (digits.startsWith('549')) digits = digits.slice(3);
  // Si empieza con 54 (formato internacional AR)
  else if (digits.startsWith('54')) digits = digits.slice(2);
  // Si empieza con 0, sacar el 0
  if (digits.startsWith('0')) digits = digits.slice(1);
  // Los primeros 2-4 dígitos son el código de área
  // Códigos de 4 dígitos: el número tiene 6 dígitos → ej: 2944 + 550608
  // Códigos de 3 dígitos: el número tiene 7 dígitos → ej: 011 + 4567890
  // Códigos de 2 dígitos: el número tiene 8 dígitos → ej: 11 + 45678901
  let codigo = '', numero = '';
  if (digits.length === 10) {
    // Número celular estándar argentino
    if (['11','15'].includes(digits.slice(0,2))) {
      codigo = '011'; numero = digits.slice(2);
    } else {
      codigo = digits.slice(0, 4); numero = digits.slice(4);
    }
  } else if (digits.length === 8) {
    codigo = '011'; numero = digits;
  } else {
    codigo = digits.slice(0, 3); numero = digits.slice(3);
  }
  return { codigo, numero };
}

// Parsea address1 → { calle, numero, piso, depto }
function parseAddress(address1, address2) {
  let calle = '', numero = '', piso = '', depto = '';
  const a1 = address1 || '';
  const a2 = address2 || '';

  // Buscar número en address1: "Calle 1234" o "Calle 1234 Piso 2 Depto A"
  const matchNum = a1.match(/^(.*?)\s+(\d+[a-zA-Z]?)(?:\s+(.*))?$/);
  if (matchNum) {
    calle = matchNum[1].trim();
    numero = matchNum[2].trim();
    const resto = matchNum[3] || '';
    // Buscar piso/depto en el resto de address1
    const pisoMatch = resto.match(/[Pp]iso\s*(\w+)/);
    const deptoMatch = resto.match(/[Dd]pto\.?\s*([A-Za-z0-9]+)/);
    if (pisoMatch) piso = pisoMatch[1];
    if (deptoMatch) depto = deptoMatch[1];
  } else {
    calle = a1.trim();
  }

  // Si no encontró piso/depto, buscar en address2
  if (!piso || !depto) {
    const pisoMatch2 = a2.match(/[Pp]iso\s*(\w+)/);
    const deptoMatch2 = a2.match(/[Dd]pto\.?\s*([A-Za-z0-9]+)/);
    if (pisoMatch2 && !piso) piso = pisoMatch2[1];
    if (deptoMatch2 && !depto) depto = deptoMatch2[1];
  }

  return { calle, numero, piso, depto };
}

app.get('/', (req, res) => {
  const shop = req.session.shop;
  const token = req.session.accessToken;
  res.render('index', { shop, authenticated: !!(shop && token) });
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

app.get('/orders', (req, res) => {
  if (!req.session.accessToken) return res.redirect('/');
  res.render('orders', { shop: req.session.shop });
});

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

app.post('/api/generate-xlsx', async (req, res) => {
  if (!req.session.accessToken) return res.status(401).json({ error: 'No autenticado' });
  const { orders } = req.body;
  if (!orders || !orders.length) return res.status(400).json({ error: 'No hay pedidos' });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('A domicilio');

  // Fila 1: grupos de encabezado (igual a la planilla de Andreani)
  sheet.mergeCells('A1:G1'); sheet.getCell('A1').value = 'Características';
  sheet.mergeCells('H1:M1'); sheet.getCell('H1').value = 'Destinatario';
  sheet.mergeCells('N1:R1'); sheet.getCell('N1').value = 'Domicilio destino';
  sheet.getCell('S1').value = 'Observaciones';

  // Estilo fila 1
  ['A1','H1','N1','S1'].forEach(cell => {
    sheet.getCell(cell).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getCell(cell).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    sheet.getCell(cell).alignment = { horizontal: 'center' };
  });

  // Fila 2: columnas exactas de Andreani
  const headers = [
    'Paquete Guardado',      // A - col 1
    'Peso (grs)',             // B - col 2
    'Alto (cm)',              // C - col 3
    'Ancho (cm)',             // D - col 4
    'Profundidad (cm)',       // E - col 5
    'Valor declarado ($ C/IVA)', // F - col 6
    'Numero Interno',         // G - col 7
    'Nombre',                 // H - col 8
    'Apellido',               // I - col 9
    'DNI',                    // J - col 10
    'Email',                  // K - col 11
    'Celular código',         // L - col 12
    'Celular número',         // M - col 13
    'Calle',                  // N - col 14
    'Número',                 // O - col 15
    'Piso',                   // P - col 16
    'Departamento',           // Q - col 17
    'Provincia / Localidad / CP', // R - col 18
    'Observaciones'           // S - col 19
  ];

  const headerRow = sheet.getRow(2);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FF000000' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    cell.alignment = { horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' }
    };
  });
  headerRow.height = 35;

  // Anchos de columna
  const colWidths = [18, 12, 10, 10, 14, 22, 15, 15, 15, 12, 28, 14, 16, 22, 10, 8, 12, 35, 20];
  colWidths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  // Datos
  orders.forEach((o, idx) => {
    const addr = o.shipping_address || o.billing_address || {};
    const { calle, numero, piso, depto } = parseAddress(addr.address1, addr.address2);
    const tel = parseTelefono(addr.phone || o.phone || o.customer?.phone);
    const provinciaCode = addr.province_code || addr.province || '';
    const provinciaNombre = PROVINCIAS[provinciaCode.toUpperCase()] || provinciaCode.toUpperCase();
    const localidad = (addr.city || '').toUpperCase();
    const cp = (addr.zip || '').replace(/'/g, '').trim();
    const provinciaLocalidadCP = `${provinciaNombre} / ${localidad} / ${cp}`;

    const nombre = addr.first_name || o.customer?.first_name || '';
    const apellido = addr.last_name || o.customer?.last_name || '';

    const dataRow = sheet.getRow(idx + 3);
    const values = [
      'PAQUETE',
      '',           // Peso - completar manualmente
      '',           // Alto
      '',           // Ancho
      '',           // Profundidad
      parseFloat(o.total_price) || '',
      String(o.order_number || '').replace('#', ''),
      nombre,
      apellido,
      '',           // DNI - no disponible en Shopify
      o.email || o.customer?.email || '',
      tel.codigo,
      tel.numero,
      calle,
      numero,
      piso,
      depto,
      provinciaLocalidadCP,
      ''            // Observaciones
    ];

    values.forEach((v, i) => {
      const cell = dataRow.getCell(i + 1);
      cell.value = v;
      cell.alignment = { vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
      };
      // Fila alternada
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
      }
    });
    dataRow.height = 20;
  });

  const filename = `andreani_${new Date().toISOString().slice(0,10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
});

// Mantener el endpoint CSV viejo por compatibilidad
app.post('/api/generate-csv', (req, res) => {
  res.redirect(307, '/api/generate-xlsx');
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
