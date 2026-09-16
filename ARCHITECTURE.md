# Metro-Check Architecture

## Runtime flow

1. The React/Vite client authenticates through `POST /api/auth/login` and stores the demo bearer token locally.
2. Officer and company scan screens upload one or more images to `POST /api/scan` using `multipart/form-data`.
3. The Express API runs per-panel Tesseract.js OCR, records confidence and recognized word-height metadata, then applies the active regex rule registry to each field's expected panel.
4. Registered product values are compared after unit normalization for MRP, net quantity, manufacturer, and consumer care.
5. Inspections, checks, reports, notifications, and uploaded evidence are persisted in local JSON collections for development.
6. PDF reports are generated with `pdf-lib`, editable DOCX reports with `docx`, and label evidence is rendered with `sharp`.

## Role boundaries

- Enforcement officers can scan labels, inspect their register, attach evidence, and update assigned case notes.
- Administrators can manage users and rule settings and view state-wide analytics.
- Company users can access only their own products, inspections, evidence, reports, notifications, and company analytics.
- Every company-facing route validates the bearer token and organization ownership on the server.

## Compliance analysis

The current rule engine validates five declarations: MRP, net quantity, date marking, manufacturer/packer, and consumer care. Each field has an expected principal-display or declarations-panel location. OCR results distinguish verified values, low-confidence values, missing panels, missing text, and image-quality failures; invalid values such as quantity-like OCR that does not contain a sane number/unit pair cannot pass.

OCR word height is advisory unless the officer supplies a validated `mm per pixel` calibration scale from a reference marker or calibrated camera. When supplied, the engine calculates measured font height in millimetres and compares it to the configured field threshold. Without calibration, the UI explicitly reports that the result is not a legal millimetre measurement.

Reports are available as PDF and editable DOCX through `/api/reports/:id/download` and `/api/reports/:id/docx`. Inspection History supports product/brand search, status, violation type, and date-range filtering.

## Storage and deployment

Development uses atomic JSON collections and local upload/report directories. This is intentionally simple for demos and team development. Production should replace `server/src/store.ts` with Prisma/PostgreSQL repositories, move uploads and PDFs to object storage, hash passwords, use a real identity provider, add audit logging, and configure HTTPS/CORS origins and secrets through environment variables.

## Verification

```powershell
npm test
npm run build
npm run dev
```

Use the sample fixtures in `public/fixtures/` for repeatable scan demonstrations.
