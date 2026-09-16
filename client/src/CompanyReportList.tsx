import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Check, FileText } from 'lucide-react';

type CompanyReport = { id: string; inspectionId: string; productName: string; productCategory: string; generatedAt: string; verdict: string; score: number; downloadUrl: string };
type CompanyUser = { orgId: string };

export default function CompanyReportList({ user }: { user: CompanyUser }) {
  const [reports, setReports] = useState<CompanyReport[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const token = localStorage.getItem('metro-check-token') ?? '';
    const loadReports = () => fetch(`/api/companies/${user.orgId}/reports`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.message ?? 'Unable to load reports'); return body as CompanyReport[]; })
      .then(setReports)
      .catch((requestError: Error) => setError(requestError.message));
    void loadReports();
    const interval = window.setInterval(loadReports, 3000);
    return () => window.clearInterval(interval);
  }, [user.orgId]);
  const download = async (report: CompanyReport) => {
    const response = await fetch(report.downloadUrl, { headers: { Authorization: `Bearer ${localStorage.getItem('metro-check-token') ?? ''}` } });
    if (!response.ok) { setError('Unable to download report'); return; }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${report.id}.pdf`; anchor.click(); URL.revokeObjectURL(url);
  };
  return <section className="panel company-reports"><div className="panel-heading"><div><span className="eyebrow">AUTOMATIC REPORTS</span><h3>Inspection reports for your company</h3></div><FileText size={17} /></div>{error && <div className="error-banner"><AlertTriangle size={16} /> {error}</div>}{reports.length === 0 ? <p className="company-reports-empty">Reports generated from officer inspections and self-checks will appear here automatically.</p> : reports.map((report) => <div className="company-report-row" key={report.id}><div className={`report-status ${report.verdict === 'Compliant' ? 'pass' : 'fail'}`}>{report.verdict === 'Compliant' ? <Check size={16} /> : <AlertTriangle size={16} />}</div><div><b>{report.productName}</b><small>{report.productCategory} · {report.inspectionId} · {new Date(report.generatedAt).toLocaleString('en-IN')}</small></div><strong>{report.score}%</strong><button className="button ghost" onClick={() => download(report)}>Download PDF <ArrowUpRight size={14} /></button></div>)}</section>;
}
