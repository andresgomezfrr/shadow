import { useEffect } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  src: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
};

export function ChronicleLightbox({ src, title, subtitle, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-card border-2 border-accent/40 rounded-2xl shadow-2xl p-6 w-[28rem] max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={title}
          className="w-full h-auto rounded-xl mb-4 bg-bg"
        />
        <div className="text-center">
          {subtitle && (
            <p className="text-accent text-[10px] uppercase tracking-wider mb-0.5">{subtitle}</p>
          )}
          <h3 className="text-text text-lg font-semibold">{title}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full mt-4 text-text-muted text-[11px] hover:text-accent transition-colors"
        >
          Close · Esc
        </button>
      </div>
    </div>,
    document.body,
  );
}
