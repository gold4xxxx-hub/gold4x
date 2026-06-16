'use client';

import { useEffect, useRef } from 'react';

export function useParallaxBackground(factor = 0.93) {
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const body = document.body;
    if (!body) return;
    // Skip parallax on mobile — JS-driven backgroundPosition repaints kill scroll smoothness
    if (window.innerWidth < 768) return;
    let ticking = false;

    const update = () => {
      const y = window.scrollY;
      body.style.backgroundPositionY = `${-y * factor}px`;
      ticking = false;
    };

    const handleScroll = () => {
      if (!ticking) {
        rafRef.current = requestAnimationFrame(update);
        ticking = true;
      }
    };

    update();

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      cancelAnimationFrame(rafRef.current);
      body.style.backgroundPositionY = '';
    };
  }, [factor]);
}
