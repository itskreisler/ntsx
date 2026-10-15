import React, { useEffect, useRef, useState } from 'react';
import { useSprings, animated } from '@react-spring/web';

export default function SplitText({
  text = '',
  className = '',
  delay = 30,
  animationFrom = { opacity: 0, transform: 'translate3d(0,25px,0)' },
  animationTo = { opacity: 1, transform: 'translate3d(0,0,0)' },
  threshold = 0.1,
  rootMargin = '-50px',
  textAlign = 'left',
  onLetterAnimationComplete,
}) {
  const words = text.split(' ');
  const letters = text.split('');
  const [inView, setInView] = useState(false);
  const ref = useRef(null);
  const animatedCount = useRef(0);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (ref.current) {
            observer.unobserve(ref.current);
          }
        }
      },
      { threshold, rootMargin }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  const springs = useSprings(
    letters.length,
    letters.map((_, i) => ({
      from: animationFrom,
      to: inView
        ? async (next) => {
            await next(animationTo);
            animatedCount.current += 1;
            if (animatedCount.current === letters.length && onLetterAnimationComplete) {
              onLetterAnimationComplete();
            }
          }
        : animationFrom,
      delay: i * delay,
    }))
  );

  let globalIndex = 0;

  return (
    <span
      ref={ref}
      className={`inline-block ${className}`}
      style={{ textAlign, whiteSpace: 'normal', wordWrap: 'break-word' }}
    >
      {words.map((word, wordIndex) => {
        const wordLetters = word.split('');
        const wordStartIndex = globalIndex;
        globalIndex += word.length + 1; // +1 for the space

        return (
          <span
            key={wordIndex}
            style={{ display: 'inline-block', whiteSpace: 'nowrap' }}
          >
            {wordLetters.map((char, charIndex) => {
              const letterIndex = wordStartIndex + charIndex;
              return (
                <animated.span
                  key={charIndex}
                  style={{
                    ...springs[letterIndex],
                    display: 'inline-block',
                    willChange: 'transform, opacity',
                  }}
                >
                  {char}
                </animated.span>
              );
            })}
            {wordIndex < words.length - 1 && (
              <span style={{ display: 'inline-block' }}>&nbsp;</span>
            )}
          </span>
        );
      })}
    </span>
  );
}
