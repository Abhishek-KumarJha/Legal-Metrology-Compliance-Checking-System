import cors from 'cors';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTextFromImages } from './ocr.js';
import { rules } from './rules.js';
import { runRuleEngine, summarizeChecks, type CheckResult } from './ruleEngine.js';
import userSeed from '../data/users.seed.json' with { type: 'json' };
import inspectionSeed from '../data/inspections.seed.json' with { type: 'json' };
import productSeed from '../data/products.seed.json' with { type: 'json' };
import notificationSeed from '../data/notifications.seed.json' with { type: 'json' };
import { readCollection, writeCollection } from './store.js';
import { generateCompliancePdf } from './report.js';
import { compareChecks, type ComparedCheck } from './productMatching.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ dest: path.resolve(__dirname, '../uploads') });
const port = Number(process.env.PORT ?? 4000);

type Inspection = { id: string; company: string; companyId?: string; product: string; productId?: string; status: string; score: number; createdAt: string; checks: ComparedCheck[]; summary?: ReturnType<typeof summarizeChecks>; ocrText?: string; labelImages?: string[]; evidenceImages?: string[]; submittedBy?: 'company' | 'officer' | 'admin' };
type Product = { id: string; companyId: string; name: string; category: string; status: string; declaredMrp?: number; declaredNetQuantity?: number; declaredNetUnit?: string; manufacturerDetails?: string; consumerCareDetails?: string; labelImages?: string[] };
type Notification = { id: string; title: string; text: string; when: string; tone: string; read: boolean; companyId?: string; inspectionId?: string };
type User = { id: string; name: string; role: 'officer' | 'admin' | 'company'; email: string; password: string; orgId: string; active?: boolean };
type Report = { id: string; inspectionId: string; companyId: string; productId: string; companyName: string; productName: string; productCategory: string; triggeredBy: string; generatedAt: string; verdict: string; score: number; pdfPath: string };

app.use(cors());
app.use(express.json());

const inspections = await readCollection<Inspection>('inspections', inspectionSeed as Inspection[]);
const products = await readCollection<Product>('products', productSeed as Product[]);
for (const seedProduct of productSeed as Product[]) {
  const existing = products.find((product) => product.id === seedProduct.id);
  if (existing) Object.assign(existing, seedProduct);
  else products.push(seedProduct);
}
await writeCollection('products', products);
const notifications = await readCollection<Notification>('notifications', notificationSeed as Notification[]);
const ruleSettings = await readCollection('rule-settings', rules.map((rule) => ({ fieldName: rule.fieldName, minFontSizeMm: rule.minFontSizeMm, isActive: true })));
const users = await readCollection<User>('users', userSeed as User[]);
for (const seedUser of userSeed as User[]) {
  const existing = users.find((user) => user.email.toLowerCase() === seedUser.email.toLowerCase());
  if (!existing) users.push({ ...seedUser, active: true });
  else if (existing.id === seedUser.id && existing.active === false) existing.active = true;
}
await writeCollection('users', users);
const reports = await readCollection<Report>('reports', []);
const labelDirectory = path.resolve(__dirname, '../uploads/labels');

function inspectionPayload(inspection: Inspection) {
  const report = reports.find((candidate) => candidate.inspectionId === inspection.id);
  return {
    ...inspection,
    labelImages: (inspection.labelImages ?? []).map((filename) => `/api/inspections/${inspection.id}/images/${encodeURIComponent(filename)}`),
    report: report ? { id: report.id, generatedAt: report.generatedAt, verdict: report.verdict, score: report.score, triggeredBy: report.triggeredBy, downloadUrl: `/api/reports/${report.id}/download` } : undefined
  };
}

function requestRole(req: express.Request): User['role'] | null {
  return requestUser(req)?.role ?? null;
}

function requestUser(req: express.Request) {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token?.startsWith('demo-token-')) return null;
  const userId = token.slice('demo-token-'.length);
  return users.find((user) => user.id === userId && user.active !== false) ?? users.find((user) => user.role === userId && user.active !== false) ?? null;
}

function requireAdmin(req: express.Request, res: express.Response) {
  const role = requestRole(req);
  if (!role) { res.status(401).json({ message: 'Administrator authentication is required' }); return false; }
  if (role !== 'admin') { res.status(403).json({ message: 'Only administrators can manage officer accounts' }); return false; }
  return true;
}

function requireCompany(req: express.Request, res: express.Response) {
  const user = requestUser(req);
  if (!user) { res.status(401).json({ message: 'Authentication is required' }); return null; }
  if (user.role !== 'company') { res.status(403).json({ message: 'Only a company account can access this workspace' }); return null; }
  return user;
}

function companyInspections(companyId: string) {
  return inspections.filter((inspection) => inspection.companyId === companyId);
}

function productStatus(product: Product, companyChecks: Inspection[]) {
  const checks = companyChecks.filter((inspection) => inspection.productId === product.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  if (!checks.length) return 'Not yet checked';
  return checks[0].status === 'Compliant' ? 'Compliant' : 'Non-compliant';
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'metro-check-api' }));
app.post('/api/auth/login', (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = users.find((candidate) => candidate.active !== false && candidate.email.toLowerCase() === email && candidate.password === password);
  if (!user) return res.status(401).json({ message: 'Invalid email or password' });
  return res.json({ user: { id: user.id, name: user.name, role: user.role, email: user.email, orgId: user.orgId }, token: `demo-token-${user.id}` });
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
  const user = requestUser(req);
  if (!user) return res.status(401).json({ message: 'Authentication is required' });
  const visible = user.role === 'company' ? inspections.filter((inspection) => inspection.companyId === user.orgId) : inspections;
  return res.json(visible.map(inspectionPayload));
});
app.get('/api/analytics', (_req, res) => {
  const total = inspections.length;
  const compliant = inspections.filter((inspection) => inspection.status === 'Compliant').length;
  return res.json({ total, compliant, openCases: total - compliant, complianceRate: total ? Math.round((compliant / total) * 1000) / 10 : 0, activeRules: ruleSettings.filter((rule) => rule.isActive).length });
});
app.get('/api/users', (_req, res) => res.json(users.map(({ password: _password, ...user }) => user)));
app.post('/api/users', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!name || !email || !password) return res.status(400).json({ message: 'Name, email, and password are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address' });
  if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });
  if (users.some((user) => user.email.toLowerCase() === email)) return res.status(409).json({ message: 'Email already in use' });
  const officer: User = { id: `user-${Date.now()}`, name, role: 'officer', email, password, orgId: 'district-04', active: true };
  users.push(officer);
  await writeCollection('users', users);
  const { password: _password, ...safeUser } = officer;
  return res.status(201).json(safeUser);
});
app.patch('/api/users/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const user = users.find((candidate) => candidate.id === req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (typeof req.body.name === 'string' && req.body.name.trim()) user.name = req.body.name.trim();
  if (typeof req.body.active === 'boolean') user.active = req.body.active;
  await writeCollection('users', users);
  const { password: _password, ...safeUser } = user;
  return res.json(safeUser);
});
app.get('/api/products', (req, res) => {
  const user = requestUser(req);
  if (!user) return res.status(401).json({ message: 'Authentication is required' });
  const visible = user?.role === 'company' ? products.filter((product) => product.companyId === user.orgId) : products;
  return res.json(visible);
});
app.post('/api/products', upload.array('images', 4), async (req, res) => {
  const user = requestUser(req);
  if (!user || user.role !== 'company') return res.status(403).json({ message: 'Only a signed-in company account can register products' });
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const category = typeof req.body.category === 'string' ? req.body.category.trim() : '';
  if (!name || !category) return res.status(400).json({ message: 'Product name and category are required' });
  const declaredMrp = req.body.declaredMrp === undefined || req.body.declaredMrp === '' ? undefined : Number(req.body.declaredMrp);
  const declaredNetQuantity = req.body.declaredNetQuantity === undefined || req.body.declaredNetQuantity === '' ? undefined : Number(req.body.declaredNetQuantity);
  if (declaredMrp !== undefined && (!Number.isFinite(declaredMrp) || declaredMrp < 0)) return res.status(400).json({ message: 'Registered MRP must be a valid positive number' });
  if (declaredNetQuantity !== undefined && (!Number.isFinite(declaredNetQuantity) || declaredNetQuantity <= 0)) return res.status(400).json({ message: 'Registered net quantity must be a valid positive number' });
  const productId = `product-${Date.now()}`;
  const productFiles = (req.files as Express.Multer.File[] | undefined) ?? [];
  const labelImages: string[] = [];
  await fs.mkdir(labelDirectory, { recursive: true });
  for (const [index, file] of productFiles.entries()) { const filename = `${productId}-label-${index}-${path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')}`; await fs.rename(file.path, path.join(labelDirectory, filename)); labelImages.push(filename); }
  const product: Product = { id: productId, companyId: user.orgId, name, category, status: 'Pending self-check', declaredMrp, declaredNetQuantity, declaredNetUnit: typeof req.body.declaredNetUnit === 'string' ? req.body.declaredNetUnit.trim() : undefined, manufacturerDetails: typeof req.body.manufacturerDetails === 'string' ? req.body.manufacturerDetails.trim() : undefined, consumerCareDetails: typeof req.body.consumerCareDetails === 'string' ? req.body.consumerCareDetails.trim() : undefined, labelImages };
  products.unshift(product);
  await writeCollection('products', products);
  return res.status(201).json(product);
});
app.put('/api/products/:id', async (req, res) => {
  const user = requireCompany(req, res);
  if (!user) return;
  const product = products.find((candidate) => candidate.id === req.params.id && candidate.companyId === user.orgId);
  if (!product) return res.status(404).json({ message: 'Product not found' });
  for (const field of ['name', 'category', 'declaredNetUnit', 'manufacturerDetails', 'consumerCareDetails'] as const) {
    if (typeof req.body[field] === 'string') product[field] = req.body[field].trim();
  }
  if (req.body.declaredMrp !== undefined) product.declaredMrp = Number(req.body.declaredMrp);
  if (req.body.declaredNetQuantity !== undefined) product.declaredNetQuantity = Number(req.body.declaredNetQuantity);
  await writeCollection('products', products);
  return res.json(product);
});
app.delete('/api/products/:id', async (req, res) => {
  const user = requireCompany(req, res);
  if (!user) return;
  const index = products.findIndex((product) => product.id === req.params.id && product.companyId === user.orgId);
  if (index < 0) return res.status(404).json({ message: 'Product not found' });
  const [removed] = products.splice(index, 1);
  await writeCollection('products', products);
  return res.json(removed);
});
app.get('/api/notifications', (req, res) => { const user = requestUser(req); if (!user) return res.status(401).json({ message: 'Authentication is required' }); const visible = user.role === 'company' ? notifications.filter((notification) => !notification.companyId || notification.companyId === user.orgId) : notifications; return res.json(visible); });
app.post('/api/notifications/read-all', async (req, res) => { const user = requestUser(req); notifications.forEach((notification) => { if (user?.role !== 'company' || !notification.companyId || notification.companyId === user.orgId) notification.read = true; }); await writeCollection('notifications', notifications); const visible = user?.role === 'company' ? notifications.filter((notification) => !notification.companyId || notification.companyId === user.orgId) : notifications; return res.json(visible); });

app.get('/api/company/dashboard', (req, res) => {
  const user = requireCompany(req, res);
  if (!user) return;
  const ownInspections = companyInspections(user.orgId).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const ownProducts = products.filter((product) => product.companyId === user.orgId);
  const compliantProducts = ownProducts.filter((product) => productStatus(product, ownInspections) === 'Compliant').length;
  const failedChecks = ownInspections.flatMap((inspection) => inspection.checks.filter((check) => !check.isCompliant).map((check) => ({ ...check, inspectionId: inspection.id, product: inspection.product, createdAt: inspection.createdAt })));
  return res.json({ company: user.name, products: ownProducts.map((product) => ({ ...product, status: productStatus(product, ownInspections) })), inspections: ownInspections.slice(0, 12).map(inspectionPayload), flagged: ownInspections.filter((inspection) => inspection.status !== 'Compliant').map(inspectionPayload), reports: reports.filter((report) => report.companyId === user.orgId).map(({ pdfPath: _pdfPath, ...report }) => ({ ...report, downloadUrl: `/api/reports/${report.id}/download` })), notifications: notifications.filter((item) => !item.companyId || item.companyId === user.orgId), metrics: { productCount: ownProducts.length, complianceRate: ownProducts.length ? Math.round((compliantProducts / ownProducts.length) * 100) : 0, inspectionCount: ownInspections.length, openCases: ownInspections.filter((inspection) => inspection.status !== 'Compliant').length }, failedChecks });
});
app.get('/api/company/products/:id/history', (req, res) => {
  const user = requireCompany(req, res);
  if (!user) return;
  const product = products.find((candidate) => candidate.id === req.params.id && candidate.companyId === user.orgId);
  if (!product) return res.status(404).json({ message: 'Product not found' });
  return res.json({ product: { ...product, status: productStatus(product, companyInspections(user.orgId)) }, inspections: companyInspections(user.orgId).filter((inspection) => inspection.productId === product.id).map(inspectionPayload) });
});
app.get('/api/company/analytics', (req, res) => {
  const user = requireCompany(req, res);
  if (!user) return;
  const own = companyInspections(user.orgId);
  const weeks = Array.from({ length: 6 }, (_, index) => { const end = Date.now() - index * 7 * 86400000; const start = end - 7 * 86400000; const sample = own.filter((inspection) => { const time = new Date(inspection.createdAt).getTime(); return time >= start && time < end; }); return { week: `W-${6 - index}`, value: sample.length ? Math.round(sample.reduce((sum, inspection) => sum + inspection.score, 0) / sample.length) : 0 }; }).reverse();
  const failures = own.flatMap((inspection) => inspection.checks.filter((check) => !check.isCompliant).map((check) => check.label)).reduce<Record<string, number>>((counts, label) => ({ ...counts, [label]: (counts[label] ?? 0) + 1 }), {});
  return res.json({ trend: weeks, failures: Object.entries(failures).map(([label, value]) => ({ label, value })) });
});

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
  const actor = requestUser(req);
  if (!actor || !['officer', 'admin', 'company'].includes(actor.role)) return res.status(401).json({ message: 'A signed-in officer, administrator, or company account is required to run a scan' });
  const companyId = actor?.role === 'company' ? actor.orgId : (typeof req.body.companyId === 'string' && req.body.companyId) || 'company-kaveri';
  const productId = typeof req.body.productId === 'string' && req.body.productId ? req.body.productId : undefined;
  if (actor?.role === 'company' && req.body.companyId && req.body.companyId !== actor.orgId) return res.status(403).json({ message: 'Company self-checks can only use your company record' });
  const product = productId ? products.find((candidate) => candidate.id === productId && candidate.companyId === companyId) : undefined;
  if (actor.role === 'company' && productId && !product) return res.status(403).json({ message: 'You can only run self-checks for your company products' });
  const companyName = companyId === 'company-kaveri' ? 'Kaveri Homecare' : companyId === 'company-bharat' ? 'Bharat Foods Pvt Ltd' : companyId;
  const ocrText = extractedText || 'MRP Rs. 120\nNET QUANTITY 500 g\nMFG: 04/2026\nMfd by: Bharat Foods Pvt Ltd\nCustomer Care: 1800 123 4567';
  const activeRules = rules
    .map((rule) => ({ ...rule, minFontSizeMm: ruleSettings.find((setting) => setting.fieldName === rule.fieldName)?.minFontSizeMm ?? rule.minFontSizeMm }))
    .filter((rule) => ruleSettings.find((setting) => setting.fieldName === rule.fieldName)?.isActive ?? true);
  const formatChecks = runRuleEngine(ocrText, activeRules);
  const checks = compareChecks(formatChecks, product);
  const passedChecks = checks.filter((check) => check.isCompliant && check.comparisonStatus !== 'mismatch').length;
  const summary = { passed: passedChecks, failed: checks.length - passedChecks, total: checks.length, isCompliant: passedChecks === checks.length };
  const createdAt = new Date().toISOString();
  const inspectionId = `INSP-${2409 + inspections.length}`;
  await fs.mkdir(labelDirectory, { recursive: true });
  const labelImages: string[] = [];
  for (const [index, file] of files.entries()) {
    const filename = `${inspectionId}-${index}-${path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await fs.rename(file.path, path.join(labelDirectory, filename));
    labelImages.push(filename);
  }
  const inspection: Inspection = { id: inspectionId, company: typeof req.body.company === 'string' ? req.body.company : companyName, companyId, product: typeof req.body.product === 'string' ? req.body.product : product?.name ?? 'Uploaded label', productId: product?.id ?? (req.body.productId ? productId : undefined), status: summary.isCompliant ? 'Compliant' : 'Action required', score: Math.round((summary.passed / summary.total) * 100), createdAt, checks, ocrText, summary, labelImages, submittedBy: actor.role };
  inspections.unshift(inspection);
  await writeCollection('inspections', inspections);
  const reportId = `RPT-${Date.now()}`;
  const pdfPath = await generateCompliancePdf({ reportId, inspectionId: inspection.id, companyName, companyId, productName: inspection.product, productCategory: product?.category ?? 'Unregistered', actorLabel: actor?.role === 'company' ? 'Company self-check' : actor?.name ?? 'Enforcement inspection', createdAt, status: inspection.status, score: inspection.score, checks, imagePaths: labelImages.map((filename) => path.join(labelDirectory, filename)) }, path.resolve(__dirname, '../reports'));
  const report: Report = { id: reportId, inspectionId: inspection.id, companyId, productId: product?.id ?? productId, companyName, productName: inspection.product, productCategory: product?.category ?? 'Unregistered', triggeredBy: actor?.role === 'company' ? 'Company self-check' : actor?.name ?? 'Enforcement inspection', generatedAt: createdAt, verdict: inspection.status, score: inspection.score, pdfPath };
  reports.unshift(report);
  await writeCollection('reports', reports);
  notifications.unshift({ id: `notification-${Date.now()}`, title: actor.role === 'company' ? (inspection.status === 'Compliant' ? 'Self-check passed' : 'Self-check needs attention') : (inspection.status === 'Compliant' ? 'Inspection report available' : 'Action required'), text: `${inspection.product} ${inspection.status === 'Compliant' ? 'passed' : 'needs review'} in inspection ${inspection.id}`, when: 'Just now', tone: inspection.status === 'Compliant' ? 'info' : 'warning', read: false, companyId, inspectionId: inspection.id });
  await writeCollection('notifications', notifications);
  res.status(201).json(inspectionPayload(inspection));
});

app.get('/api/inspections/:id', (req, res) => {
  const user = requestUser(req);
  const inspection = inspections.find((item) => item.id === req.params.id);
  if (!user) return res.status(401).json({ message: 'Authentication is required' });
  if (!inspection) return res.status(404).json({ message: 'Inspection not found' });
  if (user.role === 'company' && inspection.companyId !== user.orgId) return res.status(403).json({ message: 'You can only access your company inspections' });
  return res.json(inspectionPayload(inspection));
});
app.get('/api/inspections/:id/images/:filename', (req, res) => {
  const user = requestUser(req);
  const inspection = inspections.find((item) => item.id === req.params.id);
  if (!user) return res.status(401).json({ message: 'Authentication is required' });
  if (!inspection) return res.status(404).json({ message: 'Inspection not found' });
  if (user.role === 'company' && inspection.companyId !== user.orgId) return res.status(403).json({ message: 'You can only access your company images' });
  if (!inspection.labelImages?.includes(req.params.filename)) return res.status(404).json({ message: 'Label image not found' });
  return res.sendFile(path.join(labelDirectory, req.params.filename));
});
app.get('/api/reports', (req, res) => { const user = requestUser(req); if (!user) return res.status(401).json({ message: 'Authentication is required' }); const visible = user.role === 'company' ? reports.filter((report) => report.companyId === user.orgId) : reports; return res.json(visible.map(({ pdfPath: _pdfPath, ...report }) => ({ ...report, downloadUrl: `/api/reports/${report.id}/download` }))); });
app.get('/api/reports/:id/download', async (req, res) => { const user = requestUser(req); if (!user) return res.status(401).json({ message: 'Authentication is required' }); const report = reports.find((candidate) => candidate.id === req.params.id); if (!report) return res.status(404).json({ message: 'Report not found' }); if (user.role === 'company' && report.companyId !== user.orgId) return res.status(403).json({ message: 'You can only access reports for your company' }); res.download(report.pdfPath, `${report.id}.pdf`); });
app.get('/api/companies/:companyId/reports', (req, res) => { const user = requestUser(req); if (!user) return res.status(401).json({ message: 'Authentication is required' }); if (user.role === 'company' && user.orgId !== req.params.companyId) return res.status(403).json({ message: 'You can only access your company reports' }); return res.json(reports.filter((report) => report.companyId === req.params.companyId).map(({ pdfPath: _pdfPath, ...report }) => ({ ...report, downloadUrl: `/api/reports/${report.id}/download` }))); });
app.post('/api/inspections/:id/evidence', upload.array('evidence', 4), async (req, res) => {
  const user = requestUser(req);
  const inspection = inspections.find((item) => item.id === req.params.id);
  if (!user) return res.status(401).json({ message: 'Authentication is required' });
  if (!inspection) return res.status(404).json({ message: 'Inspection not found' });
  if (user.role === 'company' && inspection.companyId !== user.orgId) return res.status(403).json({ message: 'You can only add evidence to your company inspections' });
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) return res.status(400).json({ message: 'At least one evidence image is required' });
  inspection.evidenceImages = [...(inspection.evidenceImages ?? []), ...files.map((file) => file.path)];
  await writeCollection('inspections', inspections);
  return res.json({ inspection, added: files.length });
});
app.delete('/api/inspections/:id', async (req, res) => {
  const user = requestUser(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ message: 'Only administrators can delete inspections' });
  const index = inspections.findIndex((inspection) => inspection.id === req.params.id);
  if (index < 0) return res.status(404).json({ message: 'Inspection not found' });
  const [removed] = inspections.splice(index, 1);
  await writeCollection('inspections', inspections);
  return res.json(removed);
});

app.listen(port, () => console.log(`Metro-Check API listening on http://localhost:${port}`));
