import { useEffect, useState } from 'react';
import { Image as ImageIcon, LoaderCircle } from 'lucide-react';

export default function InspectionImage({ src, alt }: { src?: string; alt: string }) {
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
  return <img className="label-preview" src={objectUrl} alt={alt} />;
}
