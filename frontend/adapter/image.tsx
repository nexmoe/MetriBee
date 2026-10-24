import type { ImgHTMLAttributes } from 'react';
export default function Image({ src, priority, unoptimized, fill, quality, ...props }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean; unoptimized?: boolean; fill?: boolean; quality?: number }) {
  return <img {...props} src={src} loading={priority ? 'eager' : props.loading} />;
}
