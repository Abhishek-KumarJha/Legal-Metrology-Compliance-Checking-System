import { useEffect, useState } from 'react';
import { Image as ImageIcon, LoaderCircle } from 'lucide-react';

type BoundingBox = { x: number; y: number; width: number; height: number };

export default function InspectionImage({ src, alt, boundingBox, coordinateWidth, coordinateHeight }: { src?: string; alt: string; boundingBox?: BoundingBox; coordinateWidth?: number; coordinateHeight?: number }) {
  const [objectUrl, setObjectUrl] = useState('');
  const [loading, setLoading] = useState(Boolean(src));
  const [failed, setFailed] = useState(!src);

  useEffect(() => {
    if (!src) { setLoading(false); setFailed(true); return; }
    let active = true;
    setLoading(true); setFailed(false);
    fetch(src, { headers: { Authorization: `Bearer ${localStorage.getItem('metro-check-token') ?? ''}` } })
      .then((response) => { if (!response.ok) throw new Error('Image unavailable'); return response.blob(); })
      .then((blob) => { if (active) setObjectUrl(URL.createObjectURL(blob)); })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [src]);

  if (loading) return <div className="image-loading"><LoaderCircle size={24} className="spin" /><span>Loading label image...</span></div>;
  if (failed || !objectUrl) return <div className="image-fallback"><ImageIcon size={38} /><span>No label image attached</span></div>;
  const canHighlight = boundingBox && coordinateWidth && coordinateHeight;
  return <div className="image-region"><img className="label-preview" src={objectUrl} alt={alt} />{canHighlight && <span className="evidence-highlight" aria-label="Detected text region" style={{ left: `${(boundingBox.x / coordinateWidth) * 100}%`, top: `${(boundingBox.y / coordinateHeight) * 100}%`, width: `${(boundingBox.width / coordinateWidth) * 100}%`, height: `${(boundingBox.height / coordinateHeight) * 100}%` }} />}</div>;
}
