import cors from 'cors';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
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
const uploadsDir = path.resolve(__dirname, '../uploads');
const fileUrl = (filePath: string) => `/uploads/${path.basename(filePath)}`;
const removeStoredFile = async (url: string | undefined) => { if (!url) return; try { await fs.unlink(path.join(uploadsDir, path.basename(url))); } catch { /* A missing old file does not block replacement. */ } };

type Inspection = { id: string; company: string; companyId?: string; product: string; productId?: string; source?: 'officer' | 'self-check'; caseStatus?: 'open' | 'resubmitted'; notes?: string; status: string; score: number; createdAt: string; checks: CheckResult[]; summary?: ReturnType<typeof summarizeChecks>; ocrText?: string; evidenceImages?: string[] };
type Product = { id: string; companyId: string; name: string; category: string; netQuantity?: string; mrp?: string; manufacturerName?: string; manufacturerAddress?: string; consumerCare?: string; imageUrls?: string[]; status: string };
type Notification = { id: string; companyId?: string; title: string; text: string; when: string; tone: string; read: boolean };

type AuthContext = { id: string; name: string; role: 'officer' | 'admin' | 'company'; orgId: string };
function getUser(req: express.Request): AuthContext | null {
  const id = typeof req.headers['x-user-id'] === 'string' ? req.headers['x-user-id'] : '';
  const user = users.find((candidate) => candidate.id === id);
  return user ? { id: user.id, name: user.name, role: user.role as AuthContext['role'], orgId: user.orgId } : null;
}
function requireUser(req: express.Request, res: express.Response) { const user = getUser(req); if (!user) { res.status(401).json({ message: 'Sign in required' }); return null; } return user; }
function requireCompany(req: express.Request, res: express.Response) { const user = requireUser(req, res); if (!user) return null; if (user.role !== 'company') { res.status(403).json({ message: 'Company access required' }); return null; } return user; }
function productBelongsToCompany(product: Product | undefined, user: AuthContext) { return Boolean(product && product.companyId === user.orgId); }
function inspectionBelongsToCompany(inspection: Inspection, user: AuthContext) { return inspection.companyId === user.orgId || (!inspection.companyId && inspection.company === user.name); }

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

const inspections = await readCollection<Inspection>('inspections', inspectionSeed as Inspection[]);
const products = await readCollection<Product>('products', productSeed as Product[]);
const notifications = await readCollection<Notification>('notifications', notificationSeed as Notification[]);
const ruleSettings = await readCollection('rule-settings', rules.map((rule) => ({ fieldName: rule.fieldName, minFontSizeMm: rule.minFontSizeMm, isActive: true })));
inspections.forEach((inspection) => {
  if (!inspection.source) inspection.source = 'officer';
  if (!inspection.companyId) inspection.companyId = products.find((product) => product.name === inspection.product)?.companyId;
  if (!inspection.productId) inspection.productId = products.find((product) => product.name === inspection.product)?.id;
});
notifications.forEach((notification) => {
  if (!notification.companyId && notification.text.includes('Kaveri Homecare')) notification.companyId = 'company-kaveri';
});

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
app.get('/api/inspections', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  if (user.role === 'company') return res.json(inspections.filter((inspection) => inspectionBelongsToCompany(inspection, user)));
  return res.json(inspections);
});
app.get('/api/analytics', (_req, res) => {
  const total = inspections.length;
  const compliant = inspections.filter((inspection) => inspection.status === 'Compliant').length;
  return res.json({ total, compliant, openCases: total - compliant, complianceRate: total ? Math.round((compliant / total) * 1000) / 10 : 0, activeRules: ruleSettings.filter((rule) => rule.isActive).length });
});
app.get('/api/users', (_req, res) => res.json(users.map(({ password: _password, ...user }) => user)));
app.post('/api/users', (_req, res) => res.status(501).json({ message: 'Officer creation requires database-backed identity management; use the seeded accounts for this demo.' }));
app.get('/api/products', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  return res.json(user.role === 'company' ? products.filter((product) => product.companyId === user.orgId) : products);
});
app.post('/api/products', upload.array('images', 4), async (req, res) => {
  const user = requireCompany(req, res); if (!user) return;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const category = typeof req.body.category === 'string' ? req.body.category.trim() : '';
  if (!name || !category) return res.status(400).json({ message: 'Product name and category are required' });
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const product: Product = { id: `product-${Date.now()}`, companyId: user.orgId, name, category, netQuantity: req.body.netQuantity, mrp: req.body.mrp, manufacturerName: req.body.manufacturerName, manufacturerAddress: req.body.manufacturerAddress, consumerCare: req.body.consumerCare, imageUrls: files.map((file) => fileUrl(file.path)), status: 'Not yet checked' };
  products.unshift(product);
  await writeCollection('products', products);
  return res.status(201).json(product);
});
app.put('/api/products/:id', upload.array('images', 4), async (req, res) => {
  const user = requireCompany(req, res); if (!user) return;
  const product = products.find((item) => item.id === req.params.id);
  if (!product || !productBelongsToCompany(product, user)) return res.status(404).json({ message: 'Product not found' });
  for (const field of ['name', 'category', 'netQuantity', 'mrp', 'manufacturerName', 'manufacturerAddress', 'consumerCare'] as const) if (typeof req.body[field] === 'string') product[field] = req.body[field].trim();
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length) { await Promise.all((product.imageUrls ?? []).map(removeStoredFile)); product.imageUrls = files.map((file) => fileUrl(file.path)); }
  await writeCollection('products', products); return res.json(product);
});
app.delete('/api/products/:id', async (req, res) => {
  const user = requireCompany(req, res); if (!user) return;
  const index = products.findIndex((product) => product.id === req.params.id && product.companyId === user.orgId);
  if (index < 0) return res.status(404).json({ message: 'Product not found' });
  const [removed] = products.splice(index, 1);
  await writeCollection('products', products);
  return res.json(removed);
});
app.get('/api/products/:id/history', (req, res) => {
  const user = requireCompany(req, res); if (!user) return;
  const product = products.find((item) => item.id === req.params.id);
  if (!product || !productBelongsToCompany(product, user)) return res.status(404).json({ message: 'Product not found' });
  return res.json(inspections.filter((inspection) => inspection.productId === product.id || (!inspection.productId && inspection.product === product.name && inspectionBelongsToCompany(inspection, user))));
});
app.get('/api/notifications', (req, res) => {
  const user = requireCompany(req, res); if (!user) return;
  return res.json(notifications.filter((notification) => notification.companyId === user.orgId || (!notification.companyId && notification.text.includes(user.name))));
});
app.post('/api/notifications/read-all', async (req, res) => {
  const user = requireCompany(req, res); if (!user) return;
  notifications.filter((notification) => notification.companyId === user.orgId || (!notification.companyId && notification.text.includes(user.name))).forEach((notification) => { notification.read = true; });
  await writeCollection('notifications', notifications); return res.json(notifications.filter((notification) => notification.companyId === user.orgId || (!notification.companyId && notification.text.includes(user.name))));
});

app.post('/api/scan', upload.array('images', 4), async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  if (user.role === 'company' && typeof req.body.company === 'string' && req.body.company !== user.name) return res.status(403).json({ message: 'A company can only scan its own labels' });
  const productId = typeof req.body.productId === 'string' ? req.body.productId : undefined;
  const linkedProduct = productId ? products.find((product) => product.id === productId) : undefined;
  if (user.role === 'company' && productId && !productBelongsToCompany(linkedProduct, user)) return res.status(404).json({ message: 'Product not found' });
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
  const company = user.role === 'company' ? user.name : (typeof req.body.company === 'string' ? req.body.company : 'Unassigned company');
  const inspection: Inspection = { id: `INSP-${2409 + inspections.length}`, company, companyId: user.role === 'company' ? user.orgId : undefined, product: linkedProduct?.name ?? (typeof req.body.product === 'string' ? req.body.product : 'Uploaded label'), productId, source: user.role === 'company' ? 'self-check' : 'officer', status: summary.isCompliant ? 'Compliant' : 'Action required', score: Math.round((summary.passed / summary.total) * 100), createdAt: new Date().toISOString(), checks, ocrText, summary };
  inspections.unshift(inspection);
  if (user.role === 'company' && typeof req.body.resubmissionOf === 'string') {
    const original = inspections.find((item) => item.id === req.body.resubmissionOf && inspectionBelongsToCompany(item, user));
    if (original) { original.caseStatus = 'resubmitted'; original.notes = 'Corrected label resubmitted for review'; }
  }
  if (linkedProduct && user.role === 'company') linkedProduct.status = inspection.status === 'Compliant' ? 'Compliant' : 'Non-compliant';
  if (user.role === 'company') await writeCollection('products', products);
  if (user.role === 'company' && linkedProduct) notifications.unshift({ id: `notification-${Date.now()}`, companyId: user.orgId, title: inspection.status === 'Compliant' ? 'Re-verification passed' : 'Re-verification failed', text: `${linkedProduct.name} self-check ${inspection.status === 'Compliant' ? 'passed' : 'still needs attention'}`, when: 'Just now', tone: inspection.status === 'Compliant' ? 'info' : 'warning', read: false });
  if (user.role === 'company') await writeCollection('notifications', notifications);
  await writeCollection('inspections', inspections);
  res.status(201).json(inspection);
});

app.get('/api/inspections/:id', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const inspection = inspections.find((item) => item.id === req.params.id);
  if (!inspection || (user.role === 'company' && !inspectionBelongsToCompany(inspection, user))) return res.status(404).json({ message: 'Inspection not found' });
  return res.json(inspection);
});
app.post('/api/inspections/:id/evidence', upload.array('evidence', 4), async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const inspection = inspections.find((item) => item.id === req.params.id);
  if (!inspection || (user.role === 'company' && !inspectionBelongsToCompany(inspection, user))) return res.status(404).json({ message: 'Inspection not found' });
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) return res.status(400).json({ message: 'At least one evidence image is required' });
  inspection.evidenceImages = [...(inspection.evidenceImages ?? []), ...files.map((file) => fileUrl(file.path))];
  await writeCollection('inspections', inspections);
  return res.json({ inspection, added: files.length });
});
app.delete('/api/inspections/:id', async (req, res) => {
  const user = requireUser(req, res); if (!user || user.role === 'company') return;
  const index = inspections.findIndex((inspection) => inspection.id === req.params.id);
  if (index < 0) return res.status(404).json({ message: 'Inspection not found' });
  const [removed] = inspections.splice(index, 1);
  await writeCollection('inspections', inspections);
  return res.json(removed);
});

app.get('/api/company/overview', (req, res) => {
  const user = requireCompany(req, res); if (!user) return;
  const ownProducts = products.filter((product) => product.companyId === user.orgId);
  const ownInspections = inspections.filter((inspection) => inspectionBelongsToCompany(inspection, user));
  const compliant = ownInspections.filter((inspection) => inspection.status === 'Compliant').length;
  const failures = new Map<string, number>();
  ownInspections.forEach((inspection) => inspection.checks.filter((check) => !check.isCompliant).forEach((check) => failures.set(check.label, (failures.get(check.label) ?? 0) + 1)));
  const weekly = Array.from({ length: 6 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - (5 - index) * 7); const start = new Date(date); start.setDate(start.getDate() - 6); const items = ownInspections.filter((inspection) => { const created = new Date(inspection.createdAt); return created >= start && created <= date; }); return { week: `${date.getDate()} Sep`, value: items.length ? Math.round(items.filter((item) => item.status === 'Compliant').length / items.length * 100) : 0 }; });
  return res.json({ company: user.name, products: ownProducts, inspections: ownInspections, flagged: ownInspections.filter((inspection) => inspection.source === 'officer' && inspection.status !== 'Compliant'), notifications: notifications.filter((notification) => notification.companyId === user.orgId), metrics: { totalProducts: ownProducts.length, complianceRate: ownInspections.length ? Math.round(compliant / ownInspections.length * 100) : 0, selfChecks: ownInspections.filter((inspection) => inspection.source === 'self-check').length, openFlags: ownInspections.filter((inspection) => inspection.status !== 'Compliant').length }, trend: weekly, failureBreakdown: Array.from(failures, ([name, value]) => ({ name, value })) });
});

app.get('/api/reports/:id', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const inspection = inspections.find((item) => item.id === req.params.id);
  if (!inspection || (user.role === 'company' && (!inspectionBelongsToCompany(inspection, user) || inspection.source !== 'officer'))) return res.status(404).json({ message: 'Report not found' });
  const lines = [`Metro-Check inspection report`, `Inspection: ${inspection.id}`, `Company: ${inspection.company}`, `Product: ${inspection.product}`, `Status: ${inspection.status}`, `Score: ${inspection.score}%`, ...inspection.checks.map((check) => `${check.isCompliant ? 'PASS' : 'FAIL'} ${check.label}: ${check.detectedValue ?? 'Not detected'} (${check.ruleSection})`), `Generated: ${new Date().toISOString()}`];
  const escapePdf = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT /F1 11 Tf 50 760 Td ${lines.map((line, index) => `${index ? '0 -18 Td ' : ''}(${escapePdf(line)}) Tj`).join(' ')} ET`;
  const pdf = `%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>endobj\n4 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n5 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream endobj\ntrailer<< /Root 1 0 R >>\n%%EOF`;
  res.type('application/pdf').set('Content-Disposition', `attachment; filename="${inspection.id}.pdf"`).send(pdf);
});

app.listen(port, () => console.log(`Metro-Check API listening on http://localhost:${port}`));
