'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** A QR code as inline SVG, drawn in ink so it sits on paper. */
export function QrCode({ url, className }: { url: string; className?: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let cancelled = false;
    QRCode.toString(url, {
      type: 'svg',
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: '#241713', light: '#0000' },
    }).then((markup) => !cancelled && setSvg(markup));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return <div className={className} role="img" aria-label="QR code to join" dangerouslySetInnerHTML={{ __html: svg }} />;
}
