import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Camera, Check, ChevronDown, FileText, Search, ShieldCheck, Upload, X } from 'lucide-react';

type Product = { id: string; name: string; category: string; companyId: string; companyName?: string; declaredMrp?: number; declaredNetQuantity?: number; declaredNetUnit?: string; manufacturerDetails?: string; consumerCareDetails?: string };
type PanelSlot = 'principal' | 'declarations';

type Props = {
  onComplete: (inspection: any) => void;
  companyProductMode?: boolean;
  initialProductId?: string;
  resubmissionOf?: string;
};

export default function ProductAwareScan({ onComplete, companyProductMode = false, initialProductId = '', resubmissionOf }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState(initialProductId);
  const [productQuery, setProductQuery] = useState('');
  const [scaleMmPerPixel, setScaleMmPerPixel] = useState('');
  const [panelFiles, setPanelFiles] = useState<[File | null, File | null]>([null, null]);
  const [previewUrls, setPreviewUrls] = useState<[string, string]>(['', '']);
  const [activeSlot, setActiveSlot] = useState<PanelSlot>('principal');
  const [dragSlot, setDragSlot] = useState<PanelSlot | null>(null);
  const [showCaptureMenu, setShowCaptureMenu] = useState(false);
  const [cameraMessage, setCameraMessage] = useState('');
  const [awaitingCamera, setAwaitingCamera] = useState(false);
  const [showMatches, setShowMatches] = useState(false);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const filteredProducts = products.filter((product) => `${product.name} ${product.companyName ?? ''} ${product.companyId}`.toLowerCase().includes(productQuery.toLowerCase())).slice(0, 6);
  const selectedProduct = products.find((product) => product.id === productId);
  const files = panelFiles.filter((file): file is File => Boolean(file));

  useEffect(() => {
    fetch('/api/products', { headers: { Authorization: `Bearer ${localStorage.getItem('metro-check-token') ?? ''}` } })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? 'Unable to load registered products');
        if (!Array.isArray(body)) throw new Error('Product list is unavailable');
        return body as Product[];
      })
      .then(setProducts)
      .catch((loadError) => {
        setProducts([]);
        setError(loadError instanceof Error ? loadError.message : 'Unable to load registered products');
      });
  }, []);

  useEffect(() => {
    const urls = panelFiles.map((file) => file ? URL.createObjectURL(file) : '') as [string, string];
    setPreviewUrls(urls);
    return () => urls.forEach((url) => { if (url) URL.revokeObjectURL(url); });
  }, [panelFiles]);

  const isMobile = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches;
  const chooseFiles = (slot: PanelSlot) => {
    setActiveSlot(slot);
    setCameraMessage('');
    if (isMobile()) setShowCaptureMenu(true);
    else inputRef.current?.click();
  };

  const chooseSource = (source: 'camera' | 'gallery') => {
    setShowCaptureMenu(false);
    setCameraMessage('');
    if (source === 'camera') {
      setAwaitingCamera(true);
      cameraInputRef.current?.click();
      window.setTimeout(() => {
        setAwaitingCamera((waiting) => {
          if (waiting) setCameraMessage('Camera access denied - choose from gallery instead.');
          return false;
        });
      }, 1400);
    } else {
      inputRef.current?.click();
    }
  };

  const setSlotFile = (slot: PanelSlot, file?: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    setPanelFiles((current) => slot === 'principal' ? [file, current[1]] : [current[0], file]);
  };

  const slotIndex = (slot: PanelSlot) => slot === 'principal' ? 0 : 1;
  const slotLabel = (slot: PanelSlot) => slot === 'principal' ? 'Principal Display Panel' : 'Declarations Panel';
  const handleDrop = (event: React.DragEvent<HTMLDivElement>, slot: PanelSlot) => {
    event.preventDefault();
    setDragSlot(null);
    setSlotFile(slot, event.dataTransfer.files[0]);
  };

  const selectProduct = (product: Product) => {
    setProductId(product.id);
    setProductQuery(product.name);
    setShowMatches(false);
  };

  const submit = async () => {
    if (!files.length) return;
    setProcessing(true);
    setError('');
    const form = new FormData();
    panelFiles.forEach((file, index) => { if (file) { form.append('images', file); form.append('panel', index === 0 ? 'principal' : 'declarations'); } });
    if (productId) form.append('productId', productId);
    if (scaleMmPerPixel) form.append('scaleMmPerPixel', scaleMmPerPixel);
    if (resubmissionOf) form.append('resubmissionOf', resubmissionOf);
    try {
      const response = await fetch('/api/scan', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('metro-check-token') ?? ''}` }, body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? 'Scan failed');
      onComplete(body);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Scan failed');
    } finally {
      setProcessing(false);
    }
  };

  return <section className="page scan-page">
    <div className="page-heading"><div><span className="eyebrow">{companyProductMode ? 'COMPANY SELF-CHECK / PRE-DISPATCH' : 'OFFICER WORKFLOW'}</span><h1>{companyProductMode ? 'Validate a label before dispatch.' : 'Inspect a packaged commodity.'}</h1></div><div className="scan-stepper" aria-label="Inspection steps"><span className="active"><b>01</b> Capture</span><i /><span><b>02</b> Match</span><i /><span><b>03</b> Review</span></div></div>
    <div className="scanner-layout">
      <div className="scanner-card">
        <div className="scanner-top"><div><span className="eyebrow">LABEL CAPTURE / STEP 1 OF 3</span><h2>Capture both display panels</h2><p>Use one clear image for each panel. You can continue with one image, but both panels give the strongest result.</p></div><Camera size={28} /></div>
        {error && <div className="error-banner"><AlertTriangle size={16} /> {error}</div>}
        <label className="product-select-label"><span>Find registered product <small>Optional - link a product to compare official values</small></span><div className="product-search-wrap"><div className={`search-field ${showMatches ? 'search-focused' : ''}`}><Search size={16} /><input value={productQuery} onFocus={() => setShowMatches(true)} onChange={(event) => { setProductQuery(event.target.value); setProductId(''); setShowMatches(true); }} placeholder="Search product or company" aria-label="Search product or company" /><button type="button" className="search-clear" aria-label="Clear product search" onClick={() => { setProductQuery(''); setProductId(''); setShowMatches(false); }}><X size={14} /></button></div>{showMatches && productQuery && <div className="product-results" role="listbox">{filteredProducts.length ? filteredProducts.map((product) => <button type="button" role="option" className="product-result" key={product.id} onClick={() => selectProduct(product)}><span><b>{product.name}</b><small>{product.companyName ?? product.companyId} · {product.category}</small></span><ChevronDown size={15} /></button>) : <div className="product-result-empty">No registered product matches this search.</div>}</div>}</div><div className="select-wrap"><select value={productId} onChange={(event) => { setProductId(event.target.value); const product = products.find((item) => item.id === event.target.value); setProductQuery(product?.name ?? ''); }} aria-label="Registered product"><option value="">No registered product - presence checks only</option>{products.map((product) => <option value={product.id} key={product.id}>{product.name} · {product.companyName ?? product.companyId}</option>)}</select><ChevronDown size={16} /></div><small className="field-help"><ShieldCheck size={13} /> Presence checks only means Metro-Check verifies declarations found on the image without comparing them to registered product values.</small></label>
        <label className="calibration-field"><span>Calibrated scale for Rule 8 <small>Optional, required for legal mm measurement</small></span><div><input type="number" min="0.0001" step="0.0001" value={scaleMmPerPixel} onChange={(event) => setScaleMmPerPixel(event.target.value)} placeholder="e.g. 0.08" /><span>mm / pixel</span></div><small className="field-help">Enter a validated scale from a reference marker or calibrated camera. Without it, font size remains advisory.</small></label>
        {cameraMessage && <div className="camera-message" role="status"><AlertTriangle size={15} /> {cameraMessage}</div>}
        <div className="capture-slots"><CaptureSlot slot="principal" file={panelFiles[0]} previewUrl={previewUrls[0]} active={dragSlot === 'principal'} processing={processing} onChoose={chooseFiles} onRemove={() => setPanelFiles(([_, declarations]) => [null, declarations])} onDragEnter={() => setDragSlot('principal')} onDragLeave={() => setDragSlot(null)} onDrop={handleDrop} /><CaptureSlot slot="declarations" file={panelFiles[1]} previewUrl={previewUrls[1]} active={dragSlot === 'declarations'} processing={processing} onChoose={chooseFiles} onRemove={() => setPanelFiles(([principal]) => [principal, null])} onDragEnter={() => setDragSlot('declarations')} onDragLeave={() => setDragSlot(null)} onDrop={handleDrop} /></div>
        <input ref={inputRef} className="visually-hidden-input" type="file" accept="image/*" onChange={(event) => { setSlotFile(activeSlot, event.target.files?.[0]); event.currentTarget.value = ''; }} />
        <input ref={cameraInputRef} className="visually-hidden-input" type="file" accept="image/*" capture="environment" onChange={(event) => { setAwaitingCamera(false); setSlotFile(activeSlot, event.target.files?.[0]); event.currentTarget.value = ''; }} />
        {showCaptureMenu && <CaptureSourceSheet onChoose={chooseSource} onClose={() => setShowCaptureMenu(false)} />}
      </div>
      <aside className={`scan-aside ${selectedProduct ? 'has-match' : 'no-match'}`}><div className="matching-header"><span className="eyebrow">MATCHING LAYER / STEP 2</span><span className={`match-state ${selectedProduct ? 'linked' : ''}`}>{selectedProduct ? 'Linked' : 'Optional'}</span></div><h3>{selectedProduct ? 'Official values will be compared' : 'Presence checks only'}</h3>{selectedProduct ? <ProductSummary product={selectedProduct} /> : <><div className="match-empty-visual"><Search size={26} /><span>Link a registered product to preview its official declarations here.</span></div><div className="legal-note"><FileText size={18} /><p>Without a link, the scan still checks whether mandatory declarations are present and readable.</p></div></>}<div className="legal-note"><ShieldCheck size={18} /><p>Original uploaded labels are attached automatically to the inspection report.</p></div></aside>
    </div>
    {processing && <section className="processing-image-panel panel"><span className="eyebrow">UPLOADED EVIDENCE</span><h3>Analyzing label panels</h3><div className="upload-progress"><i /></div><div className="scan-image-list processing-image-list">{previewUrls.filter(Boolean).map((url, index) => <img src={url} alt={`Label being checked ${index + 1}`} key={url} />)}</div></section>}
    <div className="scan-footer scan-footer-sticky"><span><ShieldCheck size={16} /> Evidence is encrypted and audit logged</span><button className="button primary scan-submit" disabled={!files.length || processing} onClick={submit}>{processing ? 'Checking label...' : 'Analyze labels'} <ArrowUpRight size={17} /></button></div>
  </section>;
}

function CaptureSlot({ slot, file, previewUrl, active, processing, onChoose, onRemove, onDragEnter, onDragLeave, onDrop }: { slot: PanelSlot; file: File | null; previewUrl: string; active: boolean; processing: boolean; onChoose: (slot: PanelSlot) => void; onRemove: () => void; onDragEnter: () => void; onDragLeave: () => void; onDrop: (event: React.DragEvent<HTMLDivElement>, slot: PanelSlot) => void }) {
  const title = slot === 'principal' ? 'Principal Display Panel' : 'Declarations Panel';
  const hint = slot === 'principal' ? 'Brand, product name, MRP' : 'Quantity, dates, consumer care';
  return <div className={`capture-slot ${active ? 'drag-active' : ''} ${file ? 'has-file' : ''}`} onDragOver={(event) => { event.preventDefault(); onDragEnter(); }} onDragLeave={onDragLeave} onDrop={(event) => onDrop(event, slot)}><div className="capture-slot-heading"><span className="slot-number">{slot === 'principal' ? '01' : '02'}</span><div><b>{title}</b><small>{hint}</small></div></div>{file && previewUrl ? <div className="capture-preview"><img src={previewUrl} alt={`${title} preview`} /><div className="capture-preview-overlay"><span>{file.name}</span><button type="button" className="capture-retake" aria-label={`Retake ${title}`} onClick={() => onChoose(slot)}><Camera size={14} /> Retake</button><button type="button" aria-label={`Remove ${title}`} onClick={onRemove}><X size={15} /></button></div>{processing && <div className="slot-progress"><i /></div>}</div> : <div className="capture-empty"><Upload size={21} /><span>Drop image here</span><small>or</small><button type="button" className="button secondary capture-button" onClick={() => onChoose(slot)}><Camera size={15} /> Choose image</button></div>}</div>;
}

function CaptureSourceSheet({ onChoose, onClose }: { onChoose: (source: 'camera' | 'gallery') => void; onClose: () => void }) {
  return <div className="capture-sheet-backdrop" role="presentation" onMouseDown={onClose}><section className="capture-source-sheet" role="dialog" aria-modal="true" aria-labelledby="capture-source-title" onMouseDown={(event) => event.stopPropagation()}><div className="sheet-handle" /><span className="eyebrow">ADD LABEL IMAGE</span><h2 id="capture-source-title">Choose how to add this panel</h2><p>Take a fresh photo or select an existing label image.</p><button type="button" className="capture-source-option" onClick={() => onChoose('camera')}><span className="source-icon"><Camera size={19} /></span><span><b>Take Photo</b><small>Use the device camera</small></span><ArrowUpRight size={16} /></button><button type="button" className="capture-source-option" onClick={() => onChoose('gallery')}><span className="source-icon"><Upload size={19} /></span><span><b>Choose from Gallery</b><small>Select an existing image</small></span><ArrowUpRight size={16} /></button><button type="button" className="button ghost sheet-cancel" onClick={onClose}>Cancel</button></section></div>;
}

function ProductSummary({ product }: { product: Product }) { const declarations = [['MRP', product.declaredMrp ? `Rs. ${product.declaredMrp}` : 'Not registered'], ['Net quantity', product.declaredNetQuantity && product.declaredNetUnit ? `${product.declaredNetQuantity} ${product.declaredNetUnit}` : 'Not registered'], ['Manufacturer', product.manufacturerDetails || 'Not registered'], ['Consumer care', product.consumerCareDetails || 'Not registered']]; return <div className="product-summary"><div className="product-summary-title"><Check size={17} /><div><b>{product.name}</b><small>{product.companyName ?? product.companyId} · {product.category}</small></div></div><dl>{declarations.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><small className="summary-note">Date marking remains batch-specific.</small></div>; }
