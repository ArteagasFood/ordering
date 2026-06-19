import { useEffect, useRef, useState } from 'react';

/**
 * Measure a container's pixel width so an SVG chart can render responsively.
 *
 * D3 needs concrete pixel extents to compute scales; rather than hard-code a width we
 * observe the wrapping element and re-render on resize. Returns a ref to attach to the
 * container and the current measured width (0 until first measured, so callers should
 * guard against a non-positive width before drawing).
 */
export function useChartWidth<T extends HTMLElement = HTMLDivElement>(): [
  React.RefObject<T>,
  number,
] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
