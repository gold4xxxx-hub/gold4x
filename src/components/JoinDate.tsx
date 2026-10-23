'use client';

import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';

/**
 * The join date, rolling into place.
 *
 * The dashboard's number tiles count up from zero when they come into view.
 * The date does the same thing, one wheel per character: the day and the year
 * roll 0 -> their real value, and each letter of the month climbs the alphabet
 * until it reaches its own letter - "A" to "O", "a" to "c", "a" to "t" for
 * "Oct". The run keeps the case of the letter it lands on, so the month's
 * initial rolls in capitals and the rest in lowercase.
 *
 * Every wheel is a vertical strip behind a one-line window, scrolled upwards
 * with a CSS transition. Once the last wheel has landed, a single gold
 * highlight runs across the date.
 *
 * The strip is pure markup plus a transform, so there is no timer per frame:
 * the browser does the scrolling, and the only timers here are the one that
 * starts the roll and the one that fires the sweep.
 */

/**
 * How long every wheel takes to roll. All wheels share one length and one
 * start, so the whole date moves as a single line instead of a jumble of
 * characters at different heights. The left-to-right wave comes from the
 * highlight after the roll.
 */
const DUR_S = 1.45;
/**
 * Quick off the mark, then a long, slow settle: most of the distance is
 * covered early, and the last few characters tick over slowly, so the date
 * eases onto its real value instead of snapping to it.
 */
const ROLL_EASE = 'cubic-bezier(0.33, 1, 0.68, 1)';
/** The roll waits this long before it starts. */
const START_S = 0.05;
/** Spacing between wheels when the highlight sweeps over them. */
const SWEEP_STEP_S = 0.07;
/** Extra beat after the wheels stop before the gold highlight starts. */
const SETTLE_PAD_MS = 60;

interface JoinDateProps {
  /** The finished date, for example "16 Mar '26". */
  value: string | null;
  /** Wait this long before it starts. */
  delay?: number;
  /** Class for the outer element - the size and weight live here. */
  className?: string;
}

interface DateParts {
  day: number;
  month: string;
  quote: string;
  year: number;
}

/**
 * Split "16 Mar '26" into the parts the wheels need.
 *
 * Anything unexpected (another locale, a different format) returns null so
 * the date is shown plainly rather than half-animated.
 */
function parseDateParts(value: string): DateParts | null {
  const tokens = value.trim().split(/\s+/);
  const dayIndex = tokens.findIndex((token) => /^\d{1,2}$/.test(token));
  const monthIndex = tokens.findIndex((token) => /^[A-Za-z]{3,9}$/.test(token));
  // The year is the remaining two-digit token. The apostrophe in "16 Mar '26"
  // is optional, so the day ("16") must be ruled out first.
  const yearIndex = tokens.findIndex(
    (token, i) => i !== dayIndex && i !== monthIndex && /^['’]?\d{2}$/.test(token),
  );

  if (dayIndex === -1 || monthIndex === -1 || yearIndex === -1) return null;

  const yearToken = tokens[yearIndex];
  const day = Number(tokens[dayIndex]);
  const year = Number(yearToken.replace(/^['’]/, ''));
  if (!Number.isFinite(day) || !Number.isFinite(year)) return null;

  const quote = /^['’]/.test(yearToken) ? yearToken[0] : '';

  return { day, month: tokens[monthIndex], quote, year };
}

/**
 * Every wheel rolls the same distance, so the characters stay on one line
 * while they move. Short stacks are padded at the top with their first
 * character - a letter that is already "a" simply holds still while the rest
 * of the date catches up.
 */
function padStack(items: string[], steps: number): string[] {
  const missing = steps - (items.length - 1);
  if (missing <= 0) return items;
  return [...Array.from({ length: missing }, () => items[0]), ...items];
}

/** 0, 1, 2 ... target - the same run the number tiles make. */
function numberStack(target: number, steps: number): string[] {
  const items: string[] = [];
  for (let value = 0; value <= target; value += 1) items.push(String(value));
  return padStack(items, steps);
}

/**
 * "a", "b", "c" ... up to the letter itself.
 *
 * The run keeps the case of the letter it lands on, so the month's initial
 * climbs "A, B, C ... O" while the rest of the name stays lowercase.
 */
function letterStack(letter: string, steps: number): string[] {
  const position = letter.toLowerCase().charCodeAt(0) - 96;
  if (position < 1 || position > 26) return padStack([letter], steps);

  const upper = letter === letter.toUpperCase();
  const items: string[] = [];
  for (let step = 1; step <= position; step += 1) {
    const character = String.fromCharCode(96 + step);
    items.push(upper ? character.toUpperCase() : character);
  }
  // Land on the real character, keeping the month's capital "M" or "O".
  items[items.length - 1] = letter;
  return padStack(items, steps);
}

interface WheelProps {
  items: string[];
  /** Position in the date, left to right. Sets the sweep timing. */
  index: number;
  /** The distance every wheel rolls, so they all move together. */
  total: number;
  /** The roll transition is live. */
  rolling: boolean;
  /** Everything has come to rest at the final value. */
  landed: boolean;
  /**
   * Widths differ between letters, so the wheel is as wide as the character
   * it settles on. Wide characters passing through get squeezed to that
   * width instead of being sliced off at the edges.
   */
  fit?: boolean;
}

function Wheel({ items, index, total, rolling, landed, fit }: WheelProps) {
  const final = items[items.length - 1];

  const style = {
    '--jd-i': `${(index * SWEEP_STEP_S).toFixed(2)}s`,
  } as CSSProperties;

  const stripStyle: CSSProperties = {
    transform: `translateY(calc(var(--jd-cell) * ${rolling ? -total : 0}))`,
    transition:
      rolling && !landed
        ? `transform ${DUR_S}s ${ROLL_EASE} ${START_S}s`
        : 'none',
  };

  return (
    <span className="fx-join-wheel" style={style} {...(fit ? { 'data-jd-fit': '' } : {})}>
      {/* An invisible copy of the final character. It is the only thing in
          normal flow, so the wheel settles at exactly the width of the real
          character and the finished date spaces like plain text. */}
      <span className="fx-join-sizer" aria-hidden="true">
        {final}
      </span>
      <span className="fx-join-strip" style={stripStyle} aria-hidden="true">
        {items.map((item, step) => (
          <span className="fx-join-cell" key={step}>
            {item}
          </span>
        ))}
      </span>
    </span>
  );
}

export function JoinDate({ value, delay = 150, className }: JoinDateProps) {
  const [rolling, setRolling] = useState(false);
  const [landed, setLanded] = useState(false);
  const [swept, setSwept] = useState(false);
  const hasPlayed = useRef(false);
  const elRef = useRef<HTMLSpanElement>(null);

  const parts = value ? parseDateParts(value) : null;

  useEffect(() => {
    if (!value) return;
    if (hasPlayed.current) return;

    if (!parseDateParts(value)) return;

    const el = elRef.current;
    if (!el) return;

    let cancelled = false;
    let startTimer: ReturnType<typeof setTimeout> | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // Every wheel rolls the same distance at the same pace, so they all come
    // to rest together.
    const settleMs = Math.round((START_S + DUR_S) * 1000) + SETTLE_PAD_MS;

    const play = () => {
      startTimer = setTimeout(() => {
        if (cancelled) return;

        // Only mark it as played once it really starts. Setting this earlier
        // would let React's development double-mount cancel the first timer
        // and then skip the second run, so nothing would ever play.
        hasPlayed.current = true;

        if (reducedMotion) {
          // No roll: drop straight onto the real date.
          setRolling(true);
          setLanded(true);
          return;
        }

        setRolling(true);
        settleTimer = setTimeout(() => {
          if (cancelled) return;
          setLanded(true);
          setSwept(true);
        }, settleMs);
      }, delay);
    };

    // If it is already on screen, start now rather than waiting for the
    // observer's first callback, which can be a frame or two later.
    const rect = el.getBoundingClientRect();
    const onScreen =
      typeof window !== 'undefined' &&
      rect.top < window.innerHeight &&
      rect.bottom > 0 &&
      rect.width > 0;

    let observer: IntersectionObserver | null = null;
    if (onScreen) {
      play();
    } else {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting || cancelled) return;
          observer?.disconnect();
          play();
        },
        { threshold: 0.08 },
      );
      observer.observe(el);
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (startTimer !== null) clearTimeout(startTimer);
      if (settleTimer !== null) clearTimeout(settleTimer);
    };
  }, [value, delay]);

  // Squeeze any character wider than the wheel's final character, so nothing
  // is sliced off at the sides while it scrolls past. Digits are tabular, so
  // only the month letters need this.
  useEffect(() => {
    if (!value) return;
    const root = elRef.current;
    if (!root) return;

    let cancelled = false;

    const widthOf = (node: Node | null) => {
      if (!node) return 0;
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect().width;
    };

    const fitWheels = () => {
      if (cancelled) return;
      root.querySelectorAll<HTMLElement>('[data-jd-fit]').forEach((wheel) => {
        const sizer = wheel.querySelector<HTMLElement>('.fx-join-sizer');
        const cells = [...wheel.querySelectorAll<HTMLElement>('.fx-join-cell')];

        // Measure untransformed glyphs - otherwise a second pass (after the
        // web font loads) would measure the squeezed result and shrink it
        // again, and again.
        cells.forEach((cell) => {
          cell.style.transform = '';
        });

        const finalWidth = widthOf(sizer?.firstChild ?? null);
        if (!finalWidth) return;

        const widths = cells.map((cell) => widthOf(cell.firstChild));
        cells.forEach((cell, i) => {
          const width = widths[i];
          cell.style.transform =
            width > finalWidth + 0.01
              ? `scaleX(${(finalWidth / width).toFixed(3)})`
              : '';
        });
      });
    };

    fitWheels();

    // The web font can land after the first paint - measure again once it has.
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(fitWheels, () => undefined);
    }

    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!value) return null;

  // A format the wheels do not recognise: show the date plainly.
  if (!parts) {
    return (
      <span ref={elRef} className={className}>
        <span className="fx-gold-emboss">{value}</span>
      </span>
    );
  }

  const yearIndex = 1 + parts.month.length;

  // Every wheel travels the same number of rows. The longest climb decides
  // it - usually the year - and the shorter ones hold their first character
  // until their own run begins.
  const monthPositions = parts.month
    .toLowerCase()
    .split('')
    .map((letter) => Math.min(26, Math.max(1, letter.charCodeAt(0) - 96)));
  const totalSteps = Math.max(parts.day, parts.year, ...monthPositions);

  return (
    <span
      ref={elRef}
      className={`${className ?? ''} fx-join-wheels${
        rolling && !landed ? ' fx-join-rolling' : ''
      }${swept ? ' fx-join-swept' : ''}`.trim()}
    >
      <Wheel
        items={numberStack(parts.day, totalSteps)}
        index={0}
        total={totalSteps}
        rolling={rolling}
        landed={landed}
      />

      <span
        className="fx-join-static"
        style={{ '--jd-i': '0.04s' } as CSSProperties}
        aria-hidden="true"
      >
        {' '}
      </span>

      {parts.month.split('').map((letter, i) => (
        <Wheel
          key={`letter-${i}`}
          items={letterStack(letter, totalSteps)}
          index={1 + i}
          total={totalSteps}
          rolling={rolling}
          landed={landed}
          fit
        />
      ))}

      {/* The space belongs to the quote: the date reads "16 Mar '26". */}
      <span
        className="fx-join-static"
        style={{ '--jd-i': `${(yearIndex * SWEEP_STEP_S).toFixed(2)}s` } as CSSProperties}
        aria-hidden="true"
      >
        {' '}
        {parts.quote}
      </span>

      <Wheel
        items={numberStack(parts.year, totalSteps)}
        index={yearIndex}
        total={totalSteps}
        rolling={rolling}
        landed={landed}
      />

      {/* The wheels are decoration; assistive tech reads the real date. */}
      <span
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          clipPath: 'inset(50%)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {value}
      </span>
    </span>
  );
}
