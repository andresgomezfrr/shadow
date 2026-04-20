import { useState } from 'react';

type PlayOnceVideoProps = {
  src: string;
  poster: string;
  className?: string;
  alt?: string;
};

export function PlayOnceVideo({ src, poster, className, alt = '' }: PlayOnceVideoProps) {
  const [ended, setEnded] = useState(false);
  if (ended) {
    return <img src={poster} alt={alt} className={className} />;
  }
  return (
    <video
      autoPlay
      muted
      playsInline
      poster={poster}
      onEnded={() => setEnded(true)}
      className={className}
      src={src}
    />
  );
}
