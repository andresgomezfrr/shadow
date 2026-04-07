import { useState, useEffect, useRef } from 'react';

type Props = {
  text: string;
  visible: boolean;
  onDone: () => void;
  mood?: string;
  durationMs?: number;
};

export function SpeechBubble({ text, visible, onDone, mood, durationMs = 10000 }: Props) {
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
      className={`absolute top-0 left-[52px] z-[70] w-max max-w-[45vw] ${exiting ? 'animate-bubble-out' : 'animate-bubble-in'}`}
    >
      <div className="bg-card rounded-lg px-3 py-2 text-[11px] text-text-dim italic leading-relaxed relative ghost-glow" data-mood={mood}>
        {`"${text}"`}
        {/* Speech bubble tail pointing left */}
        <div className="absolute top-3 -left-[6px] w-3 h-3 bg-card rotate-45" />
      </div>
    </div>
  );
}
