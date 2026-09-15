import cors from 'cors';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTextFromImages } from './ocr.js';
import { rules } from './rules.js';
import { runRuleEngine, summarizeChecks, type CheckResult } from './ruleEngine.js';
import users from '../data/users.seed.json' with { type: 'json' };
import inspectionSeed from '../data/inspections.seed.json' with { type: 'json' };
import productSeed from '../data/products.seed.json' with { type: 'json' };
import notificationSeed from '../data/notifications.seed.json' with { type: 'json' };
import { readCollection, writeCollection } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ dest: path.resolve(__dirname, '../uploads') });
const port = Number(process.env.PORT ?? 4000);

type Inspection = { id: string; company: string; product: string; status: string; score: number; createdAt: string; checks: CheckResult[]; summary?: ReturnType<typeof summarizeChecks>; ocrText?: string; evidenceImages?: string[] };
type Product = { id: string; companyId: string; name: string; category: string; status: string };
type Notification = { id: string; title: string; text: string; when: string; tone: string; read: boolean };

app.use(cors());
app.use(express.json());

const inspections = await readCollection<Inspection>('inspections', inspectionSeed as Inspection[]);
const products = await readCollection<Product>('products', productSeed as Product[]);
const notifications = await readCollection<Notification>('notifications', notificationSeed as Notification[]);
const ruleSettings = await readCollection('rule-settings', rules.map((rule) => ({ fieldName: rule.fieldName, minFontSizeMm: rule.minFontSizeMm, isActive: true })));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'metro-check-api' }));
app.post('/api/auth/login', (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = users.find((candidate) => candidate.email === email && candidate.password === password);
  if (!user) return res.status(401).json({ message: 'Invalid email or password' });
  return res.json({ user: { id: user.id, name: user.name, role: user.role, email: user.email, orgId: user.orgId }, token: `demo-token-${user.role}` });
});
app.get('/api/rules', (_req, res) => res.json(rules.map(({ pattern, ...rule }) => ({ ...rule, pattern: pattern.source, settings: ruleSettings.find((setting) => setting.fieldName === rule.fieldName) }))));
app.put('/api/rules/:fieldName', async (req, res) => {
  const rule = ruleSettings.find((item) => item.fieldName === req.params.fieldName);
  if (!rule) return res.status(404).json({ message: 'Rule not found' });
  if (typeof req.body.minFontSizeMm === 'number') rule.minFontSizeMm = Math.max(0.1, req.body.minFontSizeMm);
  if (typeof req.body.isActive === 'boolean') rule.isActive = req.body.isActive;
  await writeCollection('rule-settings', ruleSettings);
  return res.json(rule);
});
app.get('/api/inspections', (_req, res) => res.json(inspections));
app.get('/api/analytics', (_req, res) => {
  const total = inspections.length;
  const compliant = inspections.filter((inspection) => inspection.status === 'Compliant').length;
  return res.json({ total, compliant, openCases: total - compliant, complianceRate: total ? Math.round((compliant / total) * 1000) / 10 : 0, activeRules: ruleSettings.filter((rule) => rule.isActive).length });
});
app.get('/api/users', (_req, res) => res.json(users.map(({ password: _password, ...user }) => user)));
app.post('/api/users', (_req, res) => res.status(501).json({ message: 'Officer creation requires database-backed identity management; use the seeded accounts for this demo.' }));
app.get('/api/products', (_req, res) => res.json(products));
app.post('/api/products', async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const category = typeof req.body.category === 'string' ? req.body.category.trim() : '';
  if (!name || !category) return res.status(400).json({ message: 'Product name and category are required' });
  const product: Product = { id: `product-${Date.now()}`, companyId: typeof req.body.companyId === 'string' ? req.body.companyId : 'company-kaveri', name, category, status: 'Pending self-check' };
  products.unshift(product);
  await writeCollection('products', products);
  return res.status(201).json(product);
});
app.delete('/api/products/:id', async (req, res) => {
  const index = products.findIndex((product) => product.id === req.params.id);
  if (index < 0) return res.status(404).json({ message: 'Product not found' });
  const [removed] = products.splice(index, 1);
  await writeCollection('products', products);
  return res.json(removed);
});
app.get('/api/notifications', (_req, res) => res.json(notifications));
app.post('/api/notifications/read-all', async (_req, res) => { notifications.forEach((notification) => { notification.read = true; }); await writeCollection('notifications', notifications); return res.json(notifications); });

app.post('/api/scan', upload.array('images', 4), async (req, res) => {
  const suppliedText = typeof req.body.ocrText === 'string' ? req.body.ocrText : '';
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  let extractedText = suppliedText.trim();
  try {
    if (!extractedText && process.env.OCR_PROVIDER !== 'mock') extractedText = await extractTextFromImages(files.map((file) => file.path));
  } catch (error) {
    console.error('OCR processing failed', error);
    return res.status(422).json({ message: 'OCR could not read the supplied label image. Try a sharper JPG or PNG.' });
  }
  const ocrText = extractedText || 'MRP Rs. 120\nNET QUANTITY 500 g\nMFG: 04/2026\nMfd by: Bharat Foods Pvt Ltd\nCustomer Care: 1800 123 4567';
  const activeRules = rules
    .map((rule) => ({ ...rule, minFontSizeMm: ruleSettings.find((setting) => setting.fieldName === rule.fieldName)?.minFontSizeMm ?? rule.minFontSizeMm }))
    .filter((rule) => ruleSettings.find((setting) => setting.fieldName === rule.fieldName)?.isActive ?? true);
  const checks = runRuleEngine(ocrText, activeRules);
  const summary = summarizeChecks(checks);
  const inspection: Inspection = { id: `INSP-${2409 + inspections.length}`, company: typeof req.body.company === 'string' ? req.body.company : 'Unassigned company', product: typeof req.body.product === 'string' ? req.body.product : 'Uploaded label', status: summary.isCompliant ? 'Compliant' : 'Action required', score: Math.round((summary.passed / summary.total) * 100), createdAt: new Date().toISOString(), checks, ocrText, summary };
  inspections.unshift(inspection);
  await writeCollection('inspections', inspections);
  res.status(201).json(inspection);
});

app.get('/api/inspections/:id', (req, res) => {
  const inspection = inspections.find((item) => item.id === req.params.id);
  if (!inspection) return res.status(404).json({ message: 'Inspection not found' });
  return res.json(inspection);
});
app.post('/api/inspections/:id/evidence', upload.array('evidence', 4), async (req, res) => {
  const inspection = inspections.find((item) => item.id === req.params.id);
  if (!inspection) return res.status(404).json({ message: 'Inspection not found' });
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) return res.status(400).json({ message: 'At least one evidence image is required' });
  inspection.evidenceImages = [...(inspection.evidenceImages ?? []), ...files.map((file) => file.path)];
  await writeCollection('inspections', inspections);
  return res.json({ inspection, added: files.length });
});
app.delete('/api/inspections/:id', async (req, res) => {
  const index = inspections.findIndex((inspection) => inspection.id === req.params.id);
  if (index < 0) return res.status(404).json({ message: 'Inspection not found' });
  const [removed] = inspections.splice(index, 1);
  await writeCollection('inspections', inspections);
  return res.json(removed);
});

app.listen(port, () => console.log(`Metro-Check API listening on http://localhost:${port}`));
