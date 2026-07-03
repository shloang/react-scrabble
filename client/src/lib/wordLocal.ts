let wordSet: Set<string> | null = null;
let wordListLoadPromise: Promise<void> | null = null;

export async function ensureWordListLoaded(): Promise<void> {
  if (wordSet !== null) return;
  if (wordListLoadPromise) return wordListLoadPromise;

  wordListLoadPromise = (async () => {
    try {
      const res = await fetch('/api/wordlist');
      if (!res.ok) {
        wordSet = null;
        return;
      }
      const txt = await res.text();
      const lines = txt.split(/\r?\n/).map(l => l.trim().toLowerCase()).filter(Boolean);
      wordSet = new Set(lines);
    } catch (err) {
      wordSet = null;
    } finally {
      wordListLoadPromise = null;
    }
  })();

  return wordListLoadPromise;
}

export function isWordLoaded(): boolean {
  return wordSet !== null;
}

export function isWordLocal(word: string): boolean | null {
  if (wordSet === null) return null;
  return wordSet.has(word.toLowerCase());
}
