'use client';

import { useEffect } from 'react';

export function useScrollReveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('fx-reveal--visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08 }
    );

    const observe = () => {
      const els = document.querySelectorAll<HTMLElement>(
        '.fx-reveal:not(.fx-reveal--visible)'
      );
      for (const el of els) {
        observer.observe(el);
      }
    };

    observe();

    if (!document.body) return;
    const mo = new MutationObserver(observe);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      observer.disconnect();
    };
  }, []);
}
