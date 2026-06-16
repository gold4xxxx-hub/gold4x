'use client';

import { useEffect, useRef } from 'react';

const MIN_ALPHA = 0.75;
const MAX_ALPHA = 0.82;
const RANGE = MAX_ALPHA - MIN_ALPHA;

export function useScrollShadow() {
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const root = document.documentElement;

    const update = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? Math.min(scrollTop / docHeight, 1) : 0;
      const alpha = MIN_ALPHA + progress * RANGE;
      root.style.setProperty('--fx-shadow-alpha', alpha.toFixed(3));
    };

    const handleScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      cancelAnimationFrame(rafRef.current);
      root.style.removeProperty('--fx-shadow-alpha');
    };
  }, []);
}
