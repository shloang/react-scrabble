let wordSet: Set<string> | null = null;

export async function ensureWordListLoaded(): Promise<void> {
  if (wordSet !== null) return;
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
  }
}

export function isWordLoaded(): boolean {
  return wordSet !== null;
}

export function isWordLocal(word: string): boolean | null {
  if (wordSet === null) return null;
  return wordSet.has(word.toLowerCase());
}
