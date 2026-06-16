'use client';

import { useEffect, useRef, useState } from 'react';

interface ProgressBarProps {
  percent: number;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ percent }) => {
  const [visible, setVisible] = useState(false);
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.08 }
    );

    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={elRef}>
      <div className="fx-progress">
        <div
          className="fx-progress__bar"
          style={{ width: visible ? `${percent}%` : '0%' }}
        >
          <div className="fx-progress__dot" />
        </div>
      </div>
    </div>
  );
};

export default ProgressBar;
