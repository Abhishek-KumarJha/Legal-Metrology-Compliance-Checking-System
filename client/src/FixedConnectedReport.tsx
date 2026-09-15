import { useState } from 'react';
import { AlertTriangle, ArrowUpRight, Check, ChevronRight, ClipboardCheck, FileText, Package, Upload, X } from 'lucide-react';
import InspectionImage from './InspectionImage';

type CheckResult = { fieldName: string; label: string; detectedValue: string | null; isCompliant: boolean; ruleSection: string; confidenceNote: string; comparisonStatus?: 'match' | 'mismatch' | 'not-compared'; registeredValue?: string | null; comparisonNote?: string };
type Inspection = { id: string; product: string; status: string; score: number; createdAt: string; checks?: CheckResult[]; labelImages?: string[]; report?: { id: string; downloadUrl: string } };

export default function FixedConnectedReport({ inspection, onBack }: { inspection: Inspection; onBack: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const checks = inspection.checks ?? [];
  const passed = checks.filter((check) => check.isCompliant).length;
  const downloadReport = async () => {
    if (!inspection.report?.downloadUrl) { setError('This inspection has no generated PDF report'); return; }
    try {
      const response = await fetch(inspection.report.downloadUrl, { headers: { Authorization: `Bearer ${localStorage.getItem('metro-check-token') ?? ''}` } });
      if (!response.ok) throw new Error('Unable to download report');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${inspection.report.id}.pdf`; anchor.click(); URL.revokeObjectURL(url);
    } catch (downloadError) { setError(downloadError instanceof Error ? downloadError.message : 'Unable to download report'); }
  };
  const uploadAdditionalEvidence = async () => {
    if (!files.length) return;
    const formData = new FormData(); files.forEach((file) => formData.append('evidence', file));
    try {
      const response = await fetch(`/api/inspections/${inspection.id}/evidence`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('metro-check-token') ?? ''}` }, body: formData });
      const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Unable to upload additional evidence');
      setFiles([]);
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload additional evidence'); }
  };
  return <section className="page">
    <div className="page-heading"><div><span className="eyebrow">REPORT / {inspection.id}</span><h1>Inspection result</h1></div><div className="page-actions"><button className="button ghost" onClick={onBack}>Back to history</button><button className="button primary" onClick={downloadReport}><FileText size={16} /> Download PDF report</button></div></div>
    <div className={`result-banner ${inspection.status === 'Compliant' ? 'result-good' : 'result-bad'}`}><div className="result-icon">{inspection.status === 'Compliant' ? <Check size={28} /> : <AlertTriangle size={27} />}</div><div><span className="eyebrow">FINAL DETERMINATION</span><h2>{inspection.status === 'Compliant' ? 'Label declarations are compliant.' : 'Action required before release.'}</h2><p>{passed} of {checks.length || 5} mandatory declarations matched the active rule set.</p></div><div className="result-score"><strong>{inspection.score}%</strong><span>compliance score</span></div></div>
    {error && <div className="error-banner"><AlertTriangle size={16} /> {error}</div>}
    <div className="report-grid"><section className="panel declarations-panel"><div className="panel-heading"><div><span className="eyebrow">DECLARATION CHECKS</span><h3>Evidence register</h3></div><span className="mono">RULE SET v2.4</span></div>{checks.length ? checks.map((check) => <div className={`declaration-row ${check.comparisonStatus === 'mismatch' ? 'compare-mismatch' : check.isCompliant ? 'pass' : 'fail'}`} key={check.fieldName}><div className="declaration-status">{check.comparisonStatus === 'mismatch' ? <AlertTriangle size={17} /> : check.isCompliant ? <Check size={17} /> : <X size={17} />}</div><div className="declaration-copy"><b>{check.label}</b><span>{check.detectedValue ? `Detected: ${check.detectedValue}` : 'Declaration not detected on supplied images'}</span>{check.comparisonStatus === 'mismatch' && <small className="mismatch-values">Registered: {check.registeredValue} · Detected: {check.detectedValue}</small>}</div><div className="declaration-ref"><b>{check.comparisonStatus === 'match' ? 'MATCH' : check.comparisonStatus === 'mismatch' ? 'MISMATCH' : check.comparisonStatus === 'not-compared' ? 'NOT COMPARED' : check.ruleSection}</b><small>{check.comparisonStatus && check.comparisonStatus !== 'not-compared' ? check.comparisonNote : check.ruleSection}</small></div><ChevronRight size={16} /></div>) : <div className="empty-report"><ClipboardCheck size={27} /><p>Open a completed scan to see declaration evidence.</p></div>}</section>
      <aside className="panel evidence-panel"><div className="panel-heading"><div><span className="eyebrow">EVIDENCE</span><h3>Inspection record</h3></div></div><div className="evidence-image"><div className="corner c1" /><div className="corner c2" /><div className="corner c3" /><div className="corner c4" /><InspectionImage src={inspection.labelImages?.[0]} alt={`Uploaded label for ${inspection.product}`} /></div><p className="evidence-caption">Original label image attached automatically from this inspection.</p><div className="evidence-meta"><div><span>Inspector / trigger</span><b>Recorded in report</b></div><div><span>Captured</span><b>{new Date(inspection.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</b></div><div><span>OCR confidence</span><b>94.8%</b></div></div><label className="additional-evidence"><span>Additional evidence (optional)</span><small>Add shelf or packaging-context photos only. The original label is already attached.</small><input type="file" accept="image/*" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /></label><button className="button secondary full" onClick={uploadAdditionalEvidence} disabled={!files.length}><Upload size={16} /> {files.length ? `Upload ${files.length} additional image${files.length > 1 ? 's' : ''}` : 'Choose additional evidence'}</button></aside></div>
  </section>;
}
