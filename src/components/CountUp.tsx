'use client';

import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  value: number | null;
  duration?: number;
  startDelay?: number;
  format: (n: number) => string;
  className?: string;
}

export function CountUp({ value, duration = 1200, startDelay = 100, format, className }: CountUpProps) {
  const [display, setDisplay] = useState<string>('-');
  const hasAnimated = useRef(false);
  const elRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (value === null) {
      setDisplay('-');
      return;
    }

    const v = value;

    if (hasAnimated.current) {
      setDisplay(format(v));
      return;
    }

    const el = elRef.current;
    if (!el) return;

    let cancelled = false;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || cancelled) return;
        observer.disconnect();
        hasAnimated.current = true;

        timer = setTimeout(() => {
          if (cancelled) return;

          let start: number | null = null;

          function step(now: number) {
            if (cancelled) return;
            if (start === null) start = now;
            const t = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            setDisplay(format(eased * v));
            if (t < 1) {
              raf = requestAnimationFrame(step);
            }
          }

          raf = requestAnimationFrame(step);
        }, startDelay);
      },
      { threshold: 0.08 }
    );

    observer.observe(el);

    return () => {
      cancelled = true;
      observer.disconnect();
      cancelAnimationFrame(raf);
      if (timer !== null) clearTimeout(timer);
    };
  }, [value, duration, startDelay, format]);

  return <span ref={elRef} className={className}>{display}</span>;
}
