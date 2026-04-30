import { useEffect, useRef, useState } from 'react';

export function useLocalStorage<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    try { localStorage.setItem(keyRef.current, JSON.stringify(value)); } catch { /* ignore */ }
  }, [value]);

  return [value, setValue];
}
