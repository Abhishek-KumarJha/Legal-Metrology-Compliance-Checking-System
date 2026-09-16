import { useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Upload,
  X,
} from "lucide-react";
import InspectionImage from "./InspectionImage";

type Legibility = {
  fontSizeConsistent: boolean | null;
  fontSizeNote: string;
  spacingIssue: boolean | null;
  spacingNote: string;
  styleSignal: string;
};
type CheckResult = {
  fieldName: string;
  label: string;
  detectedValue: string | null;
  isCompliant: boolean;
  needsReview?: boolean;
  status?:
    | "verified"
    | "detected-low-confidence"
    | "not-detected"
    | "not-visible-in-uploaded-images"
    | "panel-not-provided"
    | "image-quality-insufficient"
    | "manual-verified";
  outputStatus?: "passed" | "needs_review" | "not_visible_in_images";
  ruleSection: string;
  confidenceNote: string;
  confidence?: number | null;
  ocrTokens?: string[];
  sourceText?: string;
  matchedVia?: "explicit_label" | "inferred" | "derived_from_duration";
  numericEvidence?: { digitCountPlausible: boolean; separatorUnambiguous: boolean; structuralCheckPassed: boolean; widthPlausible?: boolean; reviewReason?: string };
  numericReExtraction?: { initial_read: string; candidate_reads: string[]; final_value: string | null; resolution_method: "auto_resolved" | "manual_required"; confidence_per_pass: number[]; crop_attempts?: Array<{ expansion_factor: number; x: number; y: number; width: number; height: number; candidate_reads: string[]; confidence_per_pass: number[]; preview_paths?: string[] }> };
  validationChecks?: { digit_count_ok: boolean; decimal_clear: boolean; proximity_ok: boolean; width_plausible?: boolean };
  sourceImageIndex?: number;
  sourcePanel?: "principal" | "declarations" | "side" | "unknown";
  boundingBox?: { x: number; y: number; width: number; height: number };
  sourceImageWidth?: number;
  sourceImageHeight?: number;
  originalOcrValue?: string | null;
  originalOcrConfidence?: number | null;
  manualValue?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  comparisonStatus?: "match" | "mismatch" | "not-compared";
  registeredValue?: string | null;
  comparisonNote?: string;
  expectedPanel?: "principal" | "declarations";
  legibility?: Legibility;
};
type Inspection = {
  id: string;
  product: string;
  status: string;
  score: number;
  createdAt: string;
  checks?: CheckResult[];
  labelImages?: string[];
  ocrConfidence?: number | null;
  imageQuality?: { resolution: "GOOD" | "FAIR" | "POOR"; blur: "GOOD" | "FAIR" | "POOR"; brightness: "GOOD" | "FAIR" | "POOR"; contrast: "GOOD" | "FAIR" | "POOR"; glare?: "GOOD" | "FAIR" | "POOR"; tiltAngleDeg?: number | null; textHeightPx?: number | null; overallQuality: "GOOD" | "FAIR" | "POOR" | "UNUSABLE"; note: string };
  ocrFallbackUsed?: boolean;
  readability?: {
    readable: boolean;
    note: string;
    minimumWordHeightPx: number | null;
    wordCount: number;
  };
  notes?: string;
  report?: { id: string; downloadUrl: string };
};

export default function FixedConnectedReport({
  inspection,
  onBack,
  onRetake,
}: {
  inspection: Inspection;
  onBack: () => void;
  onRetake?: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [expandedChecks, setExpandedChecks] = useState<Record<string, boolean>>(
    {},
  );
  const checks = inspection.checks ?? [];
  const [localChecks, setLocalChecks] = useState(checks);
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  const [selectedFieldName, setSelectedFieldName] = useState<string>();
  const passed = localChecks.filter((check) => check.isCompliant).length;
  const highlightedCheck = localChecks.find((check) => check.fieldName === selectedFieldName && check.boundingBox) ?? localChecks.find((check) => check.boundingBox && typeof check.sourceImageIndex === "number");
  const verifyManually = async (fieldName: string) => {
    const value = manualValues[fieldName]?.trim();
    if (!value) return;
    try {
      const response = await fetch(
        `/api/inspections/${inspection.id}/checks/${fieldName}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("metro-check-token") ?? ""}`,
          },
          body: JSON.stringify({ value }),
        },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.message ?? "Unable to verify declaration");
      setLocalChecks(
        body.checks ??
          localChecks.map((check) =>
            check.fieldName === fieldName
              ? {
                  ...check,
                  detectedValue: value,
                  isCompliant: true,
                  status: "manual-verified" as const,
                  needsReview: false,
                  confidenceNote: "Manually verified by officer",
                }
              : check,
          ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to verify declaration",
      );
    }
  };
  const downloadReport = async () => {
    if (!inspection.report?.downloadUrl) {
      setError("This inspection has no generated PDF report");
      return;
    }
    try {
      const response = await fetch(inspection.report.downloadUrl, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("metro-check-token") ?? ""}`,
        },
      });
      if (!response.ok) throw new Error("Unable to download report");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${inspection.report.id}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to download report",
      );
    }
  };
  const downloadEditableReport = async () => {
    if (!inspection.report?.id) {
      setError("This inspection has no generated report");
      return;
    }
    try {
      const response = await fetch(
        `/api/reports/${inspection.report.id}/docx`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("metro-check-token") ?? ""}`,
          },
        },
      );
      if (!response.ok) throw new Error("Unable to download editable report");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${inspection.report.id}.docx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to download editable report",
      );
    }
  };
  const uploadAdditionalEvidence = async () => {
    if (!files.length) return;
    const formData = new FormData();
    files.forEach((file) => formData.append("evidence", file));
    try {
      const response = await fetch(
        `/api/inspections/${inspection.id}/evidence`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("metro-check-token") ?? ""}`,
          },
          body: formData,
        },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.message ?? "Unable to upload additional evidence");
      setFiles([]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to upload additional evidence",
      );
    }
  };
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">REPORT / {inspection.id}</span>
          <h1>Inspection result</h1>
        </div>
        <div className="page-actions">
          <button className="button ghost" onClick={onBack}>
            Back to history
          </button>
          <button className="button ghost" onClick={downloadEditableReport}>
            <FileText size={16} /> Editable DOCX
          </button>
          <button className="button primary" onClick={downloadReport}>
            <FileText size={16} /> Download PDF report
          </button>
        </div>
      </div>
      <div
        className={`result-banner ${inspection.status === "Compliant" ? "result-good" : inspection.status === "Review required" ? "result-review" : "result-bad"}`}
      >
        <div className="result-icon">
          {inspection.status === "Compliant" ? (
            <Check size={28} />
          ) : (
            <AlertTriangle size={27} />
          )}
        </div>
        <div>
          <span className="eyebrow">FINAL DETERMINATION</span>
          <h2>
            {inspection.status === "Compliant"
              ? "Label declarations are compliant."
              : inspection.status === "Review required"
                ? "Rescan recommended."
                : "Action required before release."}
          </h2>
          <p>
            {inspection.status === "Review required"
              ? "OCR confidence was too low to confirm missing declarations."
              : `${passed} of ${checks.length || 5} mandatory declarations matched the active rule set.`}
          </p>
          {inspection.notes && <small>{inspection.notes}</small>}
        </div>
        <div className="result-score">
          <strong>
            {inspection.status === "Review required"
              ? "—"
              : `${inspection.score}%`}
          </strong>
          <span>
            {inspection.status === "Review required"
              ? "not scored"
              : "compliance score"}
          </span>
        </div>
        {inspection.status === "Review required" && onRetake && (
          <button className="button primary retake-button" onClick={onRetake}>
            <Upload size={16} /> Retake photo
          </button>
        )}
      </div>
      {inspection.ocrFallbackUsed && (
        <div className="error-banner">
          <AlertTriangle size={16} /> Demo mode - OCR fallback used. This result
          is based on sample text, not the uploaded image.
        </div>
      )}
      {error && (
        <div className="error-banner">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      <div className="report-grid">
        <section className="panel declarations-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">DECLARATION CHECKS</span>
              <h3>Evidence register</h3>
            </div>
            <span className="mono">RULE SET v2.4</span>
          </div>
          {localChecks.length ? (
            localChecks.map((check) => {
              const expanded = Boolean(expandedChecks[check.fieldName]);
              const statusText =
                check.status === "panel-not-provided"
                  ? "Panel not provided"
                  : check.status === "image-quality-insufficient"
                    ? "Image quality insufficient"
                    : check.status === "detected-low-confidence"
                      ? "Detected but low confidence - verify manually"
                        : check.status === "not-visible-in-uploaded-images"
                          ? "Not visible in uploaded images - capture the back/side panel"
                      : check.detectedValue
                        ? `Detected: ${check.detectedValue}`
                        : "No text detected in expected region";
              return (
                <div
                  className={`declaration-row ${check.needsReview ? "needs-review" : check.comparisonStatus === "mismatch" ? "compare-mismatch" : check.isCompliant ? "pass" : "fail"}`}
                  key={check.fieldName}
                  onClick={() => setSelectedFieldName(check.fieldName)}
                >
                  <div className="declaration-status">
                    {check.needsReview ||
                    check.comparisonStatus === "mismatch" ? (
                      <AlertTriangle size={17} />
                    ) : check.isCompliant ? (
                      <Check size={17} />
                    ) : (
                      <X size={17} />
                    )}
                  </div>
                  <div className="declaration-copy">
                    <b>{check.label}</b>
                    <span>{statusText}</span>
                    {check.detectedValue && (
                      <small>
                        OCR confidence: {check.confidence === null || check.confidence === undefined ? "Unavailable" : `${check.confidence}%`}
                      </small>
                    )}
                    <small>
                      Expected: {check.expectedPanel ?? "Unknown"} panel
                      {typeof check.sourceImageIndex === "number" ? ` · Source image ${check.sourceImageIndex + 1}` : ""}
                    </small>
                    <small>Reason: {check.confidenceNote}</small>
                    {check.sourceText && <small>Source text: "{check.sourceText}"</small>}
                    {check.matchedVia && <small>Matched via: {check.matchedVia === "explicit_label" ? "explicit label" : check.matchedVia === "derived_from_duration" ? "duration statement" : "inferred context"}</small>}
                    {check.numericEvidence && <small>Numeric checks: {check.numericEvidence.digitCountPlausible && check.numericEvidence.separatorUnambiguous && check.numericEvidence.structuralCheckPassed && check.numericEvidence.widthPlausible !== false ? "passed" : "manual review required"}</small>}
                    {check.numericReExtraction && <small>Targeted re-scan: {check.numericReExtraction.resolution_method === "auto_resolved" ? `resolved to ${check.numericReExtraction.final_value}` : `manual review required; candidates: ${check.numericReExtraction.candidate_reads.join(", ") || "none"}`}</small>}
                    {check.numericReExtraction?.resolution_method === "manual_required" && check.numericReExtraction.candidate_reads.length > 0 && (
                      <div className="manual-verify-options">
                        <small>Choose a candidate reading:</small>
                        {Array.from(new Set(check.numericReExtraction.candidate_reads)).map((candidate) => (
                          <button className="button ghost" type="button" key={candidate} onClick={(event) => { event.stopPropagation(); setManualValues((current) => ({ ...current, [check.fieldName]: candidate })); }}>
                            {candidate}
                          </button>
                        ))}
                      </div>
                    )}
                    {check.comparisonStatus === "mismatch" && (
                      <small className="mismatch-values">
                        Registered: {check.registeredValue} · Detected:{" "}
                        {check.detectedValue}
                      </small>
                    )}
                    {check.needsReview && (
                      <div className="manual-verify">
                        <input
                          value={manualValues[check.fieldName] ?? ""}
                          placeholder="Enter value you can read"
                          aria-label={`Manual value for ${check.label}`}
                          onChange={(event) =>
                            setManualValues((current) => ({
                              ...current,
                              [check.fieldName]: event.target.value,
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => void verifyManually(check.fieldName)}
                        >
                          Verify
                        </button>
                      </div>
                    )}
                    {check.legibility && (
                      <>
                        <button
                          type="button"
                          className="readability-toggle"
                          aria-expanded={expanded}
                          onClick={() =>
                            setExpandedChecks((current) => ({
                              ...current,
                              [check.fieldName]: !expanded,
                            }))
                          }
                        >
                          Readability detail <ChevronDown size={14} />
                        </button>
                        {expanded && (
                          <div className="legibility-details">
                            <span>
                              Font size:{" "}
                              {check.legibility.fontSizeConsistent === null
                                ? "Unable to assess"
                                : check.legibility.fontSizeConsistent
                                  ? "Consistent"
                                  : "Inconsistent"}{" "}
                              <small>{check.legibility.fontSizeNote}</small>
                            </span>
                            <span>
                              Spacing:{" "}
                              {check.legibility.spacingIssue === null
                                ? "Unable to assess"
                                : check.legibility.spacingIssue
                                  ? "Issue detected"
                                  : "Normal"}{" "}
                              <small>{check.legibility.spacingNote}</small>
                            </span>
                            <span>
                              Style signal:{" "}
                              <small>{check.legibility.styleSignal}</small>
                            </span>
                            {check.ocrTokens?.length ? (
                              <span>
                                Detected OCR evidence: <small>{check.ocrTokens.join(" · ")}</small>
                              </span>
                            ) : null}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div className="declaration-ref">
                    <b>
                      {check.status === "panel-not-provided"
                        ? "PANEL MISSING"
                        : check.status === "not-visible-in-uploaded-images"
                          ? "NOT VISIBLE"
                        : check.status === "detected-low-confidence"
                          ? "VERIFY"
                          : check.status === "image-quality-insufficient"
                            ? "IMAGE QUALITY"
                            : check.needsReview
                              ? "NEEDS REVIEW"
                              : check.comparisonStatus === "match"
                                ? "MATCH"
                                : check.comparisonStatus === "mismatch"
                                  ? "MISMATCH"
                                  : check.comparisonStatus === "not-compared"
                                    ? "NOT COMPARED"
                                    : check.ruleSection}
                    </b>
                    <small>
                      {check.expectedPanel
                        ? `Expected: ${check.expectedPanel} panel`
                        : check.ruleSection}
                    </small>
                  </div>
                  <ChevronRight size={16} />
                </div>
              );
            })
          ) : (
            <div className="empty-report">
              <ClipboardCheck size={27} />
              <p>Open a completed scan to see declaration evidence.</p>
            </div>
          )}
        </section>
        <aside className="panel evidence-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">EVIDENCE</span>
              <h3>Inspection record</h3>
            </div>
          </div>
          <div className="evidence-image">
            <div className="corner c1" />
            <div className="corner c2" />
            <div className="corner c3" />
            <div className="corner c4" />
            <InspectionImage
              src={inspection.labelImages?.[highlightedCheck?.sourceImageIndex ?? 0]}
              alt={`Uploaded label for ${inspection.product}`}
              boundingBox={highlightedCheck?.boundingBox}
              coordinateWidth={highlightedCheck?.sourceImageWidth}
              coordinateHeight={highlightedCheck?.sourceImageHeight}
            />
          </div>
          <p className="evidence-caption">
            Original label image attached automatically from this inspection.
          </p>
          <div className="evidence-meta">
            <div>
              <span>Inspector / trigger</span>
              <b>Recorded in report</b>
            </div>
            <div>
              <span>Captured</span>
              <b>
                {new Date(inspection.createdAt).toLocaleString("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </b>
            </div>
            <div className="confidence-metric">
              <span>OCR confidence</span>
              {inspection.ocrConfidence === null ||
              inspection.ocrConfidence === undefined ? (
                <b>Not available</b>
              ) : (
                <>
                  <b>{inspection.ocrConfidence}%</b>
                  <div
                    className={`confidence-track ${inspection.ocrConfidence < 50 ? "low" : inspection.ocrConfidence < 75 ? "medium" : "high"}`}
                  >
                    <i
                      style={{
                        width: `${Math.max(0, Math.min(100, inspection.ocrConfidence))}%`,
                      }}
                    />
                  </div>
                  <small>Readability threshold: 60%</small>
                </>
              )}
            </div>
            {inspection.imageQuality && (
              <div>
                <span>Image quality</span>
                <b>{inspection.imageQuality.overallQuality}</b>
                <small>{inspection.imageQuality.note}</small>
              </div>
            )}
            <div>
              <span>OCR interpretation</span>
              <b>Field-level confidence</b>
              <small>Overall OCR confidence is shown for context. Each declaration uses only its matched OCR words.</small>
            </div>
            {inspection.readability && (
              <div>
                <span>Readability signal</span>
                <b>
                  {inspection.readability.readable
                    ? "Readable"
                    : "Review required"}
                </b>
                <small>{inspection.readability.note}</small>
              </div>
            )}
          </div>
          <label className="additional-evidence">
            <span>Additional evidence (optional)</span>
            <small>
              Add shelf or packaging-context photos only. The original label is
              already attached.
            </small>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(event) =>
                setFiles(Array.from(event.target.files ?? []))
              }
            />
          </label>
          <button
            className="button secondary full"
            onClick={uploadAdditionalEvidence}
            disabled={!files.length}
          >
            <Upload size={16} />{" "}
            {files.length
              ? `Upload ${files.length} additional image${files.length > 1 ? "s" : ""}`
              : "Choose additional evidence"}
          </button>
        </aside>
      </div>
    </section>
  );
}
