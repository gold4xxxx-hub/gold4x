'use client';

import { useEffect } from 'react';

const RIPPLE_SELECTOR = '.fx-btn-sweep, .fx-button, .fx-button--gold';

export function useRippleEffect() {
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!(e.target instanceof Element)) return;
      const btn = e.target.closest<HTMLElement>(RIPPLE_SELECTOR);
      if (!btn) return;

      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const ripple = document.createElement('span');
      ripple.className = 'fx-ripple__el';
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      btn.appendChild(ripple);

      ripple.addEventListener('animationend', () => {
        ripple.remove();
      });
    }

    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);
}
