import { useEffect, useRef, useState } from 'react';

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined' || !(window as any).ResizeObserver) return;

    const update = (width: number, height: number) => {
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };

    const ro = new (window as any).ResizeObserver((entries: any) => {
      const entry = entries[0];
      if (!entry) return;
      update(entry.contentRect.width, entry.contentRect.height);
    });

    ro.observe(el);
    const rect = el.getBoundingClientRect();
    update(rect.width, rect.height);

    return () => ro.disconnect();
  }, []);

  return { ref, size };
}
