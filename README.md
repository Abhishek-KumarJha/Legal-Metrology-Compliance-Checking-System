# Metro-Check

Metro-Check is an explainable Legal Metrology compliance checker for packaged commodities in India. It helps enforcement officers, administrators, and manufacturers inspect label declarations against the Legal Metrology (Packaged Commodities) Rules, 2011.

The system is deliberately transparent: OCR extracts text, a configurable rule registry detects mandatory declarations, and every result includes the detected value, pass/fail state, confidence note, and cited rule section.

## Current capabilities

- Role-based demo login for enforcement officers, administrators, and companies
- Mobile-first label scan flow with multi-image upload
- Tesseract.js OCR with deterministic fallback text for local demos
- Regex-based checks for MRP, net quantity, date marking, manufacturer details, and consumer care
- Persisted local development collections for inspections, products, notifications, and rule settings
- Evidence image upload attached to inspections
- Searchable inspection history with status filtering
- Administrator analytics computed from the inspection register
- Editable minimum font thresholds and active rule states
- Company self-check workflow
- JSON inspection/report export
- Sample label fixtures under `public/fixtures/`

## Technology

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite, Framer Motion, Recharts, Lucide |
| API | Node.js, Express, TypeScript, Multer |
| OCR | Tesseract.js by default |
| Development persistence | JSON collections in `server/data/` |
| Production data model | PostgreSQL schema in `server/data/schema.prisma` |
| File handling | Local disk in development; S3-compatible storage is the production target |

## Requirements

- Node.js 20 or newer
- npm

## Run locally

From the repository root:

```bash
npm install
npm install --prefix client
npm install --prefix server
npm run dev
```

Open the frontend at [http://localhost:5173](http://localhost:5173). The API runs at [http://localhost:4000](http://localhost:4000).

To run the services separately:

```bash
npm run dev --prefix server
npm run dev --prefix client
```

## Demo accounts

All demo accounts use the password `metro-check`.

| Role | Email | Dashboard |
| --- | --- | --- |
| Enforcement officer | `arun.sharma@metrology.gov.in` | `/officer/dashboard` |
| Administrator | `nisha.verma@metrology.gov.in` | `/admin/dashboard` |
| Company | `compliance@kaverihomecare.in` | `/company/dashboard` |

These identities are stored in `server/data/users.seed.json`. They are demonstration credentials only and must be replaced with hashed passwords and a real identity provider before deployment.

## Useful commands

```bash
# Start frontend and API together
npm run dev

# Build both applications
npm run build

# Run the rule-engine regression test
npm test

# Build only one workspace
npm run build --prefix client
npm run build --prefix server
```

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service health check |
| `POST` | `/api/auth/login` | Demo role authentication |
| `GET` | `/api/inspections` | List persisted inspections |
| `POST` | `/api/scan` | Upload label images and run OCR/rules |
| `GET` | `/api/inspections/:id` | Read one inspection |
| `POST` | `/api/inspections/:id/evidence` | Attach evidence images |
| `GET` | `/api/rules` | Read active rule configuration |
| `PUT` | `/api/rules/:fieldName` | Update threshold or active state |
| `GET` | `/api/analytics` | Return computed register metrics |
| `GET` | `/api/products` | List registered products |
| `POST` | `/api/products` | Register a product |
| `DELETE` | `/api/products/:id` | Delete a product |
| `GET` | `/api/notifications` | List notifications |
| `POST` | `/api/notifications/read-all` | Mark notifications as read |
| `GET` | `/api/users` | Read the demo user directory |

The Vite development server proxies `/api` requests to port `4000`.

## Rule engine

The auditable core lives in `server/src/ruleEngine.ts` and `server/src/rules.ts`.

Each rule defines:

- A field name and human-readable label
- A regular expression used against OCR text
- The Legal Metrology rule reference
- A minimum font-size threshold
- An explanatory confidence note

The scan endpoint runs every active rule and returns structured `CheckResult` objects. The engine is intentionally deterministic and inspectable; it does not train or require a custom ML model.

## Data and production migration

Local development uses atomic JSON writes through `server/src/store.ts`. Runtime collections are ignored by Git so a fresh checkout starts from the seed files. The production data model is documented in `server/data/schema.prisma` and covers users, companies, products, inspections, declaration checks, reports, and configurable rules.

Before production deployment, replace the local store with Prisma/PostgreSQL repositories and add:

- Hashed passwords and JWT or OIDC session verification
- Role-based authorization middleware on every protected endpoint
- S3-compatible object storage for labels and evidence
- PDF report generation and signed report links
- Database migrations and a secure seed process
- OCR bounding-box processing for measured font-size validation
- Request rate limits, audit logging, retention policies, and virus scanning for uploads

## Fixtures

Five sample label fixtures are included:

- `label-pass-01.svg`
- `label-pass-02.svg`
- `label-pass-03.svg`
- `label-fail-01.svg`
- `label-fail-02.svg`

They are intended for local workflow testing. The scan flow also accepts JPG and PNG uploads.

## Project layout

```text
client/                 React operator application
server/src/             Express API, OCR adapter, rule engine, local store
server/data/            Seeds, rule configuration, Prisma schema
public/fixtures/        Sample label fixtures
.env.example            Environment variable template
```

## Disclaimer

Metro-Check is a software prototype for inspection workflow support. Its output is not a legal determination and must be reviewed by the competent authority before enforcement action.
