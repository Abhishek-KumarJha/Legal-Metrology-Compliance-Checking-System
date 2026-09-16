import cors from 'cors';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeImages, assessLegibility, assessReadability, boundingBoxForValue, fieldEvidenceForValue, validateScaleMmPerPixel, type ImageQuality } from './ocr.js';
import { minimumFontSizeForPack, rules } from './rules.js';
import { assessNumericEvidence, classifyEvidenceStatus, runRuleEngine, sourceTextForField, summarizeChecks, validationChecksForNumericEvidence, type CheckResult } from './ruleEngine.js';
import userSeed from '../data/users.seed.json' with { type: 'json' };
import inspectionSeed from '../data/inspections.seed.json' with { type: 'json' };
import productSeed from '../data/products.seed.json' with { type: 'json' };
import notificationSeed from '../data/notifications.seed.json' with { type: 'json' };
import { readCollection, writeCollection } from './store.js';
import { generateCompliancePdf } from './report.js';
import { generateComplianceDocx } from './editableReport.js';
import { compareChecks, type ComparedCheck } from './productMatching.js';
import { applyOcrFallback } from './ocrFallback.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({
  dest: path.resolve(__dirname, '../uploads'),
  limits: { fileSize: 10 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, callback) => callback(null, file.mimetype.startsWith('image/'))
});
const port = Number(process.env.PORT ?? 4000);

type Inspection = { id: string; company: string; companyId?: string; product: string; productId?: string; status: string; score: number; createdAt: string; checks: ComparedCheck[]; summary?: ReturnType<typeof summarizeChecks>; ocrText?: string; ocrConfidence?: number | null; imageQuality?: import('./ocr.js').ImageQuality; ocrFallbackUsed?: boolean; readability?: { confidenceOk: boolean; heightOk: boolean; readable: boolean; note: string; minimumWordHeightPx: number | null; wordCount: number }; labelImages?: string[]; evidenceImages?: string[]; notes?: string; caseStatus?: 'open' | 'resubmitted' | 'closed'; resubmissionOf?: string; submittedBy?: 'company' | 'officer' | 'supervisor' | 'admin' };
type Product = { id: string; companyId: string; name: string; category: string; status: string; declaredMrp?: number; declaredNetQuantity?: number; declaredNetUnit?: string; manufacturerDetails?: string; consumerCareDetails?: string; labelImages?: string[] };
type Notification = { id: string; title: string; text: string; when: string; tone: string; read: boolean; companyId?: string; inspectionId?: string };
type User = { id: string; name: string; role: 'officer' | 'supervisor' | 'admin' | 'company'; email: string; password: string; orgId: string; active?: boolean };
type RuleSetting = { fieldName: string; minFontSizeMm: number; isActive: boolean; readabilityThreshold: number; verificationThreshold: number };
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
const defaultRuleSettings = rules.map((rule): RuleSetting => ({ fieldName: rule.fieldName, minFontSizeMm: rule.minFontSizeMm, isActive: true, readabilityThreshold: 60, verificationThreshold: 85 }));
const ruleSettings = await readCollection<RuleSetting>('rule-settings', defaultRuleSettings);
for (const defaultSetting of defaultRuleSettings) {
  const existing = ruleSettings.find((setting) => setting.fieldName === defaultSetting.fieldName);
  if (existing) {
    existing.readabilityThreshold ??= defaultSetting.readabilityThreshold;
    existing.verificationThreshold ??= defaultSetting.verificationThreshold;
  } else ruleSettings.push(defaultSetting);
}
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

function productPayload(product: Product) {
  return {
    ...product,
    companyName: product.companyId === 'company-kaveri' ? 'Kaveri Homecare' : product.companyId === 'company-bharat' ? 'Bharat Foods Pvt Ltd' : product.companyId,
    imageUrls: (product.labelImages ?? []).map((filename) => `/api/products/${product.id}/images/${encodeURIComponent(filename)}`)
  };
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const parsed = Number(String(value).replace(/(?:₹|rs\.?|inr)/gi, '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : NaN;
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
  if (typeof req.body.readabilityThreshold === 'number') rule.readabilityThreshold = Math.min(100, Math.max(0, req.body.readabilityThreshold));
  if (typeof req.body.verificationThreshold === 'number') rule.verificationThreshold = Math.min(100, Math.max(rule.readabilityThreshold, req.body.verificationThreshold));
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
  const pendingReview = inspections.filter((inspection) => inspection.status === 'Review required' || inspection.status === 'Needs review').length;
  const nonCompliant = inspections.filter((inspection) => !['Compliant', 'Review required', 'Needs review'].includes(inspection.status)).length;
  const decided = compliant + nonCompliant;
  return res.json({ total, compliant, pendingReview, nonCompliant, openCases: nonCompliant, complianceRate: decided ? Math.round((compliant / decided) * 1000) / 10 : 0, activeRules: ruleSettings.filter((rule) => rule.isActive).length });
});
app.get('/api/users', (req, res) => { if (!requireAdmin(req, res)) return; return res.json(users.map(({ password: _password, ...user }) => user)); });
app.post('/api/users', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const role = typeof req.body.role === 'string' ? req.body.role : '';
  const scope = typeof req.body.scope === 'string' ? req.body.scope.trim() : '';
  if (!name || !email || !password || !role || !scope) return res.status(400).json({ message: 'Name, email, password, role, and district/scope are required' });
  if (!['officer', 'supervisor', 'admin', 'company'].includes(role)) return res.status(400).json({ message: 'Choose a supported account role' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address' });
  if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });
  if (users.some((user) => user.email.toLowerCase() === email)) return res.status(409).json({ message: 'Email already in use' });
  const officer: User = { id: `user-${Date.now()}`, name, role: role as User['role'], email, password, orgId: scope, active: true };
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
  return res.json(visible.map(productPayload));
});
app.get('/api/products/:id/images/:filename', (req, res) => {
  const user = requestUser(req);
  if (!user) return res.status(401).json({ message: 'Authentication is required' });
  const product = products.find((candidate) => candidate.id === req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found' });
  if (user.role === 'company' && product.companyId !== user.orgId) return res.status(403).json({ message: 'You can only access your company product images' });
  if (!product.labelImages?.includes(req.params.filename)) return res.status(404).json({ message: 'Product image not found' });
  return res.sendFile(path.join(labelDirectory, req.params.filename));
});
app.post('/api/products', upload.array('images', 4), async (req, res) => {
  const user = requestUser(req);
  if (!user || user.role !== 'company') return res.status(403).json({ message: 'Only a signed-in company account can register products' });
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const category = typeof req.body.category === 'string' ? req.body.category.trim() : '';
  if (!name || !category) return res.status(400).json({ message: 'Product name and category are required' });
  const declaredMrpValue = req.body.declaredMrp ?? req.body.mrp;
  const declaredNetQuantityValue = req.body.declaredNetQuantity ?? req.body.netQuantity;
  const declaredMrp = optionalNumber(declaredMrpValue);
  const declaredNetQuantity = optionalNumber(declaredNetQuantityValue);
  if (declaredMrp !== undefined && (!Number.isFinite(declaredMrp) || declaredMrp < 0)) return res.status(400).json({ message: 'Registered MRP must be a valid positive number' });
  if (declaredNetQuantity !== undefined && (!Number.isFinite(declaredNetQuantity) || declaredNetQuantity <= 0)) return res.status(400).json({ message: 'Registered net quantity must be a valid positive number' });
  const productId = `product-${Date.now()}`;
  const productFiles = (req.files as Express.Multer.File[] | undefined) ?? [];
  const labelImages: string[] = [];
  await fs.mkdir(labelDirectory, { recursive: true });
  for (const [index, file] of productFiles.entries()) { const filename = `${productId}-label-${index}-${path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')}`; await fs.rename(file.path, path.join(labelDirectory, filename)); labelImages.push(filename); }
  const product: Product = { id: productId, companyId: user.orgId, name, category, status: 'Pending self-check', declaredMrp, declaredNetQuantity, declaredNetUnit: typeof (req.body.declaredNetUnit ?? req.body.netUnit) === 'string' ? (req.body.declaredNetUnit ?? req.body.netUnit).trim() : undefined, manufacturerDetails: typeof (req.body.manufacturerDetails ?? req.body.manufacturerName) === 'string' ? (req.body.manufacturerDetails ?? req.body.manufacturerName).trim() : undefined, consumerCareDetails: typeof (req.body.consumerCareDetails ?? req.body.consumerCare) === 'string' ? (req.body.consumerCareDetails ?? req.body.consumerCare).trim() : undefined, labelImages };
  products.unshift(product);
  await writeCollection('products', products);
  return res.status(201).json(productPayload(product));
});
app.put('/api/products/:id', upload.array('images', 4), async (req, res) => {
  const user = requireCompany(req, res);
  if (!user) return;
  const product = products.find((candidate) => candidate.id === req.params.id && candidate.companyId === user.orgId);
  if (!product) return res.status(404).json({ message: 'Product not found' });
  const textFields = { name: req.body.name, category: req.body.category, declaredNetUnit: req.body.declaredNetUnit ?? req.body.netUnit, manufacturerDetails: req.body.manufacturerDetails ?? req.body.manufacturerName, consumerCareDetails: req.body.consumerCareDetails ?? req.body.consumerCare };
  for (const [field, value] of Object.entries(textFields) as Array<[keyof typeof textFields, unknown]>) {
    if (typeof value === 'string') product[field] = value.trim();
  }
  if (req.body.declaredMrp !== undefined || req.body.mrp !== undefined) product.declaredMrp = optionalNumber(req.body.declaredMrp ?? req.body.mrp);
  if (req.body.declaredNetQuantity !== undefined || req.body.netQuantity !== undefined) product.declaredNetQuantity = optionalNumber(req.body.declaredNetQuantity ?? req.body.netQuantity);
  if (product.declaredMrp !== undefined && (!Number.isFinite(product.declaredMrp) || product.declaredMrp < 0)) return res.status(400).json({ message: 'Registered MRP must be a valid positive number' });
  if (product.declaredNetQuantity !== undefined && (!Number.isFinite(product.declaredNetQuantity) || product.declaredNetQuantity <= 0)) return res.status(400).json({ message: 'Registered net quantity must be a valid positive number' });
  const productFiles = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (productFiles.length) {
    await fs.mkdir(labelDirectory, { recursive: true });
    for (const [index, file] of productFiles.entries()) {
      const filename = `${product.id}-label-${Date.now()}-${index}-${path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await fs.rename(file.path, path.join(labelDirectory, filename));
      product.labelImages = [...(product.labelImages ?? []), filename];
    }
  }
  await writeCollection('products', products);
  return res.json(productPayload(product));
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
app.get('/api/company/overview', (req, res) => {
  const user = requireCompany(req, res);
  if (!user) return;
  const ownInspections = companyInspections(user.orgId).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const ownProducts = products.filter((product) => product.companyId === user.orgId);
  const compliantProducts = ownProducts.filter((product) => productStatus(product, ownInspections) === 'Compliant').length;
  const failures = ownInspections.flatMap((inspection) => inspection.checks.filter((check) => !check.isCompliant).map((check) => check.label)).reduce<Record<string, number>>((counts, label) => ({ ...counts, [label]: (counts[label] ?? 0) + 1 }), {});
  const trend = Array.from({ length: 6 }, (_, index) => { const end = Date.now() - index * 7 * 86400000; const start = end - 7 * 86400000; const sample = ownInspections.filter((inspection) => { const time = new Date(inspection.createdAt).getTime(); return time >= start && time < end; }); return { week: `W-${6 - index}`, value: sample.length ? Math.round(sample.reduce((sum, inspection) => sum + inspection.score, 0) / sample.length) : 0 }; }).reverse();
  const mapInspection = (inspection: Inspection) => ({ ...inspectionPayload(inspection), source: inspection.submittedBy === 'company' ? 'self-check' : 'officer', caseStatus: inspection.status === 'Compliant' ? 'closed' : 'open' });
  return res.json({ company: user.name, products: ownProducts.map((product) => ({ ...product, netQuantity: product.declaredNetQuantity && product.declaredNetUnit ? `${product.declaredNetQuantity} ${product.declaredNetUnit}` : undefined, mrp: product.declaredMrp ? `Rs. ${product.declaredMrp}` : undefined, manufacturerName: product.manufacturerDetails, consumerCare: product.consumerCareDetails, imageUrls: (product.labelImages ?? []).map((filename) => `/api/products/${product.id}/images/${encodeURIComponent(filename)}`), status: productStatus(product, ownInspections) })), inspections: ownInspections.map(mapInspection), flagged: ownInspections.filter((inspection) => inspection.status !== 'Compliant' && inspection.submittedBy !== 'company').map(mapInspection), notifications: notifications.filter((item) => !item.companyId || item.companyId === user.orgId), metrics: { totalProducts: ownProducts.length, complianceRate: ownProducts.length ? Math.round((compliantProducts / ownProducts.length) * 100) : 0, selfChecks: ownInspections.filter((inspection) => inspection.submittedBy === 'company').length, openFlags: ownInspections.filter((inspection) => inspection.status !== 'Compliant' && inspection.submittedBy !== 'company').length }, trend, failureBreakdown: Object.entries(failures).map(([name, value]) => ({ name, value })) });
});
app.get('/api/company/products/:id/history', (req, res) => {
  const user = requireCompany(req, res);
  if (!user) return;
  const product = products.find((candidate) => candidate.id === req.params.id && candidate.companyId === user.orgId);
  if (!product) return res.status(404).json({ message: 'Product not found' });
  return res.json({ product: { ...productPayload(product), status: productStatus(product, companyInspections(user.orgId)) }, inspections: companyInspections(user.orgId).filter((inspection) => inspection.productId === product.id).map(inspectionPayload) });
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
  const actor = requestUser(req);
  if (!actor || !['officer', 'supervisor', 'admin', 'company'].includes(actor.role)) return res.status(401).json({ message: 'A signed-in officer, supervisor, administrator, or company account is required to run a scan' });
  if (!files.length && !suppliedText.trim()) return res.status(400).json({ message: 'Add at least one label image before running the compliance check' });
  let extractedText = suppliedText.trim();
  let ocrAnalysis = { text: extractedText, confidence: null as number | null, minimumWordHeightPx: null as number | null, typicalWordHeightPx: null as number | null, wordCount: 0, words: [] as import('./ocr.js').OcrWord[], pages: [] as import('./ocr.js').OcrPage[] };
  try {
    if (!extractedText && process.env.OCR_PROVIDER !== 'mock') { ocrAnalysis = await analyzeImages(files.map((file) => file.path)); extractedText = ocrAnalysis.text; }
  } catch (error) {
    console.error('OCR processing failed', error);
    return res.status(422).json({ message: 'OCR could not read the supplied label image. Try a sharper JPG or PNG.' });
  }
  const companyId = actor?.role === 'company' ? actor.orgId : (typeof req.body.companyId === 'string' && req.body.companyId) || 'company-kaveri';
  const productId = typeof req.body.productId === 'string' && req.body.productId ? req.body.productId : undefined;
  const scaleMmPerPixelValue = typeof req.body.scaleMmPerPixel === 'string' ? Number(req.body.scaleMmPerPixel) : undefined;
  const scaleMmPerPixel = scaleMmPerPixelValue && Number.isFinite(scaleMmPerPixelValue) && scaleMmPerPixelValue > 0 ? scaleMmPerPixelValue : undefined;
  if (scaleMmPerPixelValue !== undefined && (!Number.isFinite(scaleMmPerPixelValue) || !validateScaleMmPerPixel(scaleMmPerPixelValue).valid)) return res.status(422).json({ message: 'The supplied mm-per-pixel calibration is implausible. Validate it against a reference marker and enter a value between 0.001 and 0.5 mm/pixel.' });
  if (actor?.role === 'company' && req.body.companyId && req.body.companyId !== actor.orgId) return res.status(403).json({ message: 'Company self-checks can only use your company record' });
  const product = productId ? products.find((candidate) => candidate.id === productId && candidate.companyId === companyId) : undefined;
  if (actor.role === 'company' && productId && !product) return res.status(403).json({ message: 'You can only run self-checks for your company products' });
  const companyName = companyId === 'company-kaveri' ? 'Kaveri Homecare' : companyId === 'company-bharat' ? 'Bharat Foods Pvt Ltd' : companyId;
  const fallback = applyOcrFallback(extractedText, process.env.NODE_ENV !== 'production' && process.env.DEMO_OCR_FALLBACK === 'true');
  const ocrText = fallback.text;
  const readability = { ...assessReadability(ocrAnalysis), minimumWordHeightPx: ocrAnalysis.minimumWordHeightPx, wordCount: ocrAnalysis.wordCount };
  const qualityRank = { GOOD: 0, FAIR: 1, POOR: 2, UNUSABLE: 3 } as const;
  const imageQuality = ocrAnalysis.pages.length
    ? [...ocrAnalysis.pages].sort((left, right) => qualityRank[right.imageQuality.overallQuality] - qualityRank[left.imageQuality.overallQuality])[0].imageQuality
    : undefined;
  const activeRules = rules
    .map((rule) => ({ ...rule, minFontSizeMm: Math.max(ruleSettings.find((setting) => setting.fieldName === rule.fieldName)?.minFontSizeMm ?? rule.minFontSizeMm, minimumFontSizeForPack(product?.declaredNetQuantity, product?.declaredNetUnit)) }))
    .filter((rule) => ruleSettings.find((setting) => setting.fieldName === rule.fieldName)?.isActive ?? true);
  const panelValues = Array.isArray(req.body.panel) ? req.body.panel : req.body.panel ? [req.body.panel] : [];
  const providedPanels: Array<'principal' | 'declarations' | 'unknown' | undefined> = files.map((_file, index) => panelValues[index] === 'principal' || panelValues[index] === 'declarations'
    ? panelValues[index]
    : files.length > 1
      ? 'unknown'
      : 'unknown');
  const panelClassificationIsExplicit = providedPanels.length > 0 && providedPanels.every((panel) => panel === 'principal' || panel === 'declarations');
  const panelChecks = activeRules.map((rule) => {
    const setting = ruleSettings.find((candidateSetting) => candidateSetting.fieldName === rule.fieldName) ?? defaultRuleSettings.find((candidateSetting) => candidateSetting.fieldName === rule.fieldName)!;
    const pageCandidates = ocrAnalysis.pages.map((page, sourceImageIndex) => {
      // Panel labels are hints only. Every reconstructed OCR line is searched;
      // declaration filtering must never hide a valid field on another panel.
      const lines = page.lines;
      const pageAnalysis = { confidence: page.confidence, minimumWordHeightPx: page.minimumWordHeightPx, typicalWordHeightPx: page.typicalWordHeightPx, words: page.words };
      const windows = lines.map((line, index) => ({ text: line.text, words: line.words, lineIndex: index }));
      if (rule.fieldName === 'consumerCare') {
        windows.push(...lines.filter((line) => /@|\b(?:1800|[6-9]\d{2})[\s-]?\d{3}[\s-]?\d{3,4}\b|www\.|https?:\/\//i.test(line.text)).map((line, index) => ({ text: line.text, words: line.words, lineIndex: index })));
      }
      if (rule.fieldName === 'manufacturer') {
        windows.push(...lines.slice(0, -1).map((line, index) => ({ text: `${line.text}\n${lines[index + 1].text}`, words: [...line.words, ...lines[index + 1].words], lineIndex: index })));
      }
      return windows.map((window) => {
        const candidate = assessLegibility(runRuleEngine(window.text, [rule]), { ...pageAnalysis, words: window.words, scaleMmPerPixel })[0];
        const fieldEvidence = fieldEvidenceForValue(candidate.detectedValue, window.words);
        const imageUnusable = page.imageQuality.overallQuality === 'UNUSABLE';
        const sourceText = sourceTextForField(rule.fieldName, window.text, candidate.detectedValue);
        const numericEvidence = assessNumericEvidence(rule.fieldName, candidate.detectedValue, window.text, fieldEvidence.tokens);
        const numericReviewRequired = Boolean(numericEvidence?.reviewReason);
        const status = candidate.isCompliant && !numericReviewRequired
          ? classifyEvidenceStatus(true, fieldEvidence.confidence, imageUnusable, setting.verificationThreshold)
          : imageUnusable ? 'image-quality-insufficient' : candidate.isCompliant ? 'detected-low-confidence' : candidate.status ?? 'not-detected';
        return { ...candidate, status, confidenceNote: numericReviewRequired ? numericEvidence?.reviewReason ?? 'Numeric evidence requires manual review.' : candidate.confidenceNote, confidence: fieldEvidence.confidence, ocrTokens: fieldEvidence.tokens, sourceText, numericEvidence, validationChecks: validationChecksForNumericEvidence(numericEvidence), sourceImageIndex, sourcePanel: providedPanels[sourceImageIndex] ?? 'unknown', boundingBox: fieldEvidence.boundingBox, sourceImageWidth: page.width, sourceImageHeight: page.height, imageQuality: page.imageQuality, lineIndex: window.lineIndex };
      });
    }).flat().filter((candidate) => candidate.detectedValue);
    const bestCandidate = [...pageCandidates].sort((left, right) => (right.confidence ?? -1) - (left.confidence ?? -1))[0];
    if (bestCandidate) return { ...bestCandidate, isCompliant: bestCandidate.status === 'verified', confidenceNote: bestCandidate.numericEvidence?.reviewReason ?? (bestCandidate.status === 'detected-low-confidence' ? 'Declaration detected, but matched OCR word confidence is below the configured verification threshold.' : bestCandidate.status === 'image-quality-insufficient' ? 'Image quality is too poor for reliable inspection.' : bestCandidate.confidenceNote) };
    const requiredPanelMissing = ocrAnalysis.pages.length > 0 && panelClassificationIsExplicit && !providedPanels.includes(rule.expectedPanel);
    const hasPartialEvidence = ocrAnalysis.pages.some((page) => page.lines.some((line) => rule.fieldName === 'consumerCare' ? /@|www\.|https?:\/\/|\b(?:1800|[6-9]\d{2})\b/i.test(line.text) : rule.fieldName === 'manufacturer' ? /(?:pvt|ltd|limited|inc\.?|corp\.?|street|road|[0-9]{5,6})/i.test(line.text) : false));
    const notVisible = !requiredPanelMissing && !hasPartialEvidence && ['manufacturer', 'consumerCare'].includes(rule.fieldName);
    return { fieldName: rule.fieldName, label: rule.label, detectedValue: null, isCompliant: false, ruleSection: rule.ruleSection, confidenceNote: requiredPanelMissing ? 'Expected panel was not provided after checking all uploaded images.' : notVisible ? `This declaration was not visible in the uploaded images. It is commonly found on the back/side panel; capture an additional panel photo.` : 'No declaration matched on any uploaded image.', minFontSizeMm: rule.minFontSizeMm, expectedPanel: rule.expectedPanel, status: requiredPanelMissing ? 'panel-not-provided' as const : notVisible ? 'not-visible-in-uploaded-images' as const : 'not-detected' as const };
  });
  const checks = compareChecks(panelChecks, product).map((check) => ({ ...check, needsReview: check.status !== 'verified' }));
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
  const hasPanelGap = checks.some((check) => check.status === 'panel-not-provided');
  const hasQualityFailure = checks.some((check) => check.status === 'image-quality-insufficient');
  const notes = fallback.fallbackUsed
    ? 'Demo mode - OCR fallback used. This result is based on sample text, not the uploaded image.'
    : hasPanelGap
    ? 'One or more declarations could not be checked because the expected panel was not provided.'
    : hasQualityFailure
    ? 'Image quality was insufficient for one or more panels. Retake only the affected panel.'
    : !checks.some((check) => check.isCompliant)
      ? 'No mandatory declarations were confirmed by OCR. Verify the visible values manually or provide the expected panel.'
      : typeof req.body.notes === 'string' ? req.body.notes.trim() : undefined;
  const inspectionStatus = hasPanelGap ? 'Insufficient evidence' : checks.some((check) => check.status !== 'verified') ? 'Review required' : summary.isCompliant ? 'Compliant' : 'Action required';
  const inspection: Inspection = { id: inspectionId, company: typeof req.body.company === 'string' ? req.body.company : companyName, companyId, product: typeof req.body.product === 'string' ? req.body.product : product?.name ?? 'Uploaded label', productId: product?.id ?? (req.body.productId ? productId : undefined), status: inspectionStatus, score: Math.round((summary.passed / summary.total) * 100), createdAt, checks, ocrText, ocrConfidence: ocrAnalysis.confidence, imageQuality, ocrFallbackUsed: fallback.fallbackUsed, readability, summary, labelImages, notes, caseStatus: req.body.resubmissionOf ? 'resubmitted' : summary.isCompliant ? 'closed' : 'open', resubmissionOf: typeof req.body.resubmissionOf === 'string' ? req.body.resubmissionOf : undefined, submittedBy: actor.role };
  inspections.unshift(inspection);
  await writeCollection('inspections', inspections);
  const reportId = `RPT-${Date.now()}`;
  const pdfPath = await generateCompliancePdf({ reportId, inspectionId, companyName, companyId, productName: inspection.product, productCategory: product?.category ?? 'Unregistered', actorLabel: actor?.role === 'company' ? 'Company self-check' : actor?.name ?? 'Enforcement inspection', createdAt, status: inspection.status, score: inspection.score, ocrFallbackUsed: inspection.ocrFallbackUsed, readability: inspection.readability, checks, imagePaths: labelImages.map((filename) => path.join(labelDirectory, filename)) }, path.resolve(__dirname, '../reports'));
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
app.get('/api/reports/:id/docx', async (req, res) => { const user = requestUser(req); if (!user) return res.status(401).json({ message: 'Authentication is required' }); const report = reports.find((candidate) => candidate.id === req.params.id); if (!report) return res.status(404).json({ message: 'Report not found' }); if (user.role === 'company' && report.companyId !== user.orgId) return res.status(403).json({ message: 'You can only access reports for your company' }); const inspection = inspections.find((candidate) => candidate.id === report.inspectionId); if (!inspection) return res.status(404).json({ message: 'Inspection not found' }); const docxPath = await generateComplianceDocx({ reportId: report.id, inspectionId: inspection.id, companyName: report.companyName, companyId: report.companyId, productName: inspection.product, productCategory: report.productCategory, actorLabel: report.triggeredBy, createdAt: inspection.createdAt, status: inspection.status, score: inspection.score, ocrFallbackUsed: inspection.ocrFallbackUsed, readability: inspection.readability, checks: inspection.checks, imagePaths: (inspection.labelImages ?? []).map((filename) => path.join(labelDirectory, filename)) }, path.resolve(__dirname, '../reports')); return res.download(docxPath, `${report.id}.docx`); });
app.get('/api/reports/:id/editable', (req, res) => { const user = requestUser(req); if (!user) return res.status(401).json({ message: 'Authentication is required' }); const report = reports.find((candidate) => candidate.id === req.params.id); if (!report) return res.status(404).json({ message: 'Report not found' }); if (user.role === 'company' && report.companyId !== user.orgId) return res.status(403).json({ message: 'You can only access reports for your company' }); const inspection = inspections.find((candidate) => candidate.id === report.inspectionId); return res.json({ report, inspection }); });
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
app.patch('/api/inspections/:id/case', async (req, res) => {
  const user = requestUser(req);
  const inspection = inspections.find((candidate) => candidate.id === req.params.id);
  if (!user) return res.status(401).json({ message: 'Authentication is required' });
  if (!inspection) return res.status(404).json({ message: 'Inspection not found' });
  if (!['officer', 'supervisor', 'admin'].includes(user.role)) return res.status(403).json({ message: 'Only government enforcement accounts can update inspection cases' });
  if (['officer', 'supervisor'].includes(user.role) && inspection.companyId !== user.orgId && inspection.companyId !== 'company-kaveri') return res.status(403).json({ message: 'You can only update inspections assigned to your district' });
  if (typeof req.body.notes === 'string') inspection.notes = req.body.notes.trim();
  if (['open', 'resubmitted', 'closed'].includes(req.body.caseStatus)) inspection.caseStatus = req.body.caseStatus;
  await writeCollection('inspections', inspections);
  return res.json(inspectionPayload(inspection));
});
app.patch('/api/inspections/:id/checks/:fieldName', async (req, res) => {
  const user = requestUser(req);
  const inspection = inspections.find((candidate) => candidate.id === req.params.id);
  if (!user) return res.status(401).json({ message: 'Authentication is required' });
  if (!inspection) return res.status(404).json({ message: 'Inspection not found' });
  if (!['officer', 'supervisor', 'admin'].includes(user.role)) return res.status(403).json({ message: 'Only government enforcement accounts can verify declaration values' });
  const value = typeof req.body.value === 'string' ? req.body.value.trim() : '';
  const check = inspection.checks.find((candidate) => candidate.fieldName === req.params.fieldName);
  if (!check) return res.status(404).json({ message: 'Declaration check not found' });
  if (!value) return res.status(400).json({ message: 'A verified value is required' });
  check.originalOcrValue ??= check.detectedValue;
  check.originalOcrConfidence ??= check.confidence ?? inspection.ocrConfidence ?? null;
  check.manualValue = value;
  check.verifiedBy = user.name;
  check.verifiedAt = new Date().toISOString();
  check.manualReason = typeof req.body.reason === 'string' ? req.body.reason.trim() || 'Officer confirmed the value from the source evidence' : 'Officer confirmed the value from the source evidence';
  check.detectedValue = value;
  check.isCompliant = true;
  check.status = 'manual-verified';
  check.needsReview = false;
  check.confidenceNote = `Manually verified by ${user.name}`;
  const passedChecks = inspection.checks.filter((candidate) => candidate.isCompliant).length;
  inspection.summary = { passed: passedChecks, failed: inspection.checks.length - passedChecks, total: inspection.checks.length, isCompliant: passedChecks === inspection.checks.length };
  inspection.score = Math.round((passedChecks / inspection.checks.length) * 100);
  inspection.status = inspection.summary.isCompliant ? 'Compliant' : 'Action required';
  inspection.caseStatus = inspection.summary.isCompliant ? 'closed' : 'open';
  await writeCollection('inspections', inspections);
  return res.json(inspectionPayload(inspection));
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

app.use(((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 10 MB or smaller' : error.code === 'LIMIT_FILE_COUNT' ? 'You can upload up to four images' : 'The uploaded image could not be accepted';
    return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ message });
  }
  return res.status(500).json({ message: 'Unexpected server error. Please try again.' });
}) as express.ErrorRequestHandler);

app.listen(port, () => console.log(`Metro-Check API listening on http://localhost:${port}`));
