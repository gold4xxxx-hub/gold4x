'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAccount } from 'wagmi';

const PORTFOLIO_ID = 'portfolio';
const COUNTDOWN_ID = 'cycle-countdown';
const MAX_WAIT_MS = 8_000;
const SETTLE_MS = 180;
const MIN_SCROLL_DISTANCE = 120;
const SCROLL_GAP = 12;

function getNavHeight() {
  return document.querySelector<HTMLElement>('.fx-topnav')?.getBoundingClientRect().height ?? 0;
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Scrolls so the target sits just below the sticky top navigation. */
function scrollToElement(target: HTMLElement) {
  const top = Math.max(0, window.scrollY + target.getBoundingClientRect().top - getNavHeight() - SCROLL_GAP);

  if (prefersReducedMotion()) {
    // `behavior: auto` would still honour the global CSS smooth scrolling,
    // so force an instant jump for users who asked for reduced motion.
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo({ top });
    root.style.scrollBehavior = previous;
    return;
  }

  window.scrollTo({ top, behavior: 'smooth' });
}

/**
 * Scrolls a freshly connected wallet down to the portfolio view.
 *
 * Deliberately one-shot per connection: it waits for the lazy-loaded
 * dashboard anchor to exist, then scrolls once. If the user has already
 * scrolled to (or past) the portfolio, the viewport is left untouched.
 */
export function PortfolioAutoScroll() {
  const { isConnected } = useAccount();
  const pathname = usePathname();
  const handledRef = useRef(false);

  useEffect(() => {
    if (!isConnected) {
      handledRef.current = false;
      return;
    }

    // Only the dashboard route has a portfolio, and only the first
    // connection of this page load should move the viewport.
    if (handledRef.current || pathname !== '/') return;

    let cancelled = false;
    let frameId = 0;
    let settleTimer: number | undefined;
    const startedAt = performance.now();

    const scrollWhenReady = () => {
      if (cancelled) return;

      const target = document.getElementById(PORTFOLIO_ID);
      if (!target) {
        if (performance.now() - startedAt < MAX_WAIT_MS) {
          frameId = window.requestAnimationFrame(scrollWhenReady);
        }
        return;
      }

      // Let the wallet dialog finish closing and the dashboard finish its
      // first layout pass before moving the page.
      settleTimer = window.setTimeout(() => {
        if (cancelled) return;
        const portfolio = document.getElementById(PORTFOLIO_ID);
        if (!portfolio) return;

        // Line the cycle countdown up with the top edge of the viewport,
        // directly below the sticky nav. Fall back to the portfolio card if
        // the countdown is not rendered.
        const countdown = document.getElementById(COUNTDOWN_ID);
        const target = countdown ?? portfolio;
        const navHeight = getNavHeight();
        const targetTop = window.scrollY + target.getBoundingClientRect().top;
        const desiredScrollTop = targetTop - navHeight - SCROLL_GAP;

        // Already at or past the target (e.g. the user scrolled while the
        // wallet was connecting) — don't pull them back.
        if (window.scrollY >= desiredScrollTop - MIN_SCROLL_DISTANCE) {
          handledRef.current = true;
          return;
        }

        handledRef.current = true;
        scrollToElement(target);
      }, SETTLE_MS);
    };

    frameId = window.requestAnimationFrame(scrollWhenReady);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
    };
  }, [isConnected, pathname]);

  return null;
}
