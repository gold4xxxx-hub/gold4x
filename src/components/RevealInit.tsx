'use client';

import { useScrollReveal } from '@/hooks/useScrollReveal';
import { useParallaxBackground } from '@/hooks/useParallaxBackground';
import { useRippleEffect } from '@/hooks/useRippleEffect';
import { useScrollShadow } from '@/hooks/useScrollShadow';

export function RevealInit() {
  useScrollReveal();
  useParallaxBackground(0.93);
  useRippleEffect();
  useScrollShadow();
  return null;
}
