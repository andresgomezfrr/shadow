import { useState, useEffect, useRef } from 'react';

type Props = {
  text: string;
  visible: boolean;
  onDone: () => void;
  durationMs?: number;
};

export function SpeechBubble({ text, visible, onDone, durationMs = 6000 }: Props) {
  const [show, setShow] = useState(false);
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (visible && text) {
      setShow(true);
      setExiting(false);
      // Start exit after duration
      timerRef.current = setTimeout(() => {
        setExiting(true);
        // Remove after exit animation
        setTimeout(() => {
          setShow(false);
          setExiting(false);
          onDone();
        }, 300);
      }, durationMs);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [visible, text, durationMs, onDone]);

  if (!show || !text) return null;

  return (
    <div
      className={`absolute bottom-[52px] left-[64px] z-[70] max-w-[200px] ${exiting ? 'animate-bubble-out' : 'animate-bubble-in'}`}
    >
      <div className="bg-card border border-border rounded-lg px-3 py-2 text-[11px] text-text-dim italic leading-relaxed shadow-lg relative">
        {`"${text}"`}
        {/* Speech bubble tail */}
        <div className="absolute -bottom-[6px] left-3 w-3 h-3 bg-card border-b border-r border-border rotate-45" />
      </div>
    </div>
  );
}
