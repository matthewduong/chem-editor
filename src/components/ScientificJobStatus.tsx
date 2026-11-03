import { useEffect, useState } from 'react';
export function ScientificJobStatus({ label, cancel }: { label: string; cancel: () => void }) {
  const [seconds, setSeconds] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span>
      {label} · {seconds}s{' '}
      <button
        disabled={cancelling}
        onClick={() => {
          setCancelling(true);
          cancel();
        }}
      >
        {cancelling ? 'Cancelling…' : 'Cancel'}
      </button>
    </span>
  );
}
