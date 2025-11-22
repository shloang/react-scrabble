import { readFileSync } from 'fs';
import { join } from 'path';

let wordSet: Set<string> | null = null;

/**
 * Load words from the text file into memory
 */
export function loadWordDictionary(filePath?: string): Set<string> {
  if (wordSet) {
    return wordSet;
  }

  try {
    // Try multiple possible paths
    const possiblePaths = filePath 
      ? [filePath]
      : [
          join(process.cwd(), 'attached_assets', 'russian-mnemonic-words.txt'),
          join(process.cwd(), 'russian-mnemonic-words.txt'),
        ];
    
    let content: string | null = null;
    let usedPath: string | null = null;
    
    for (const path of possiblePaths) {
      try {
        content = readFileSync(path, 'utf-8');
        usedPath = path;
        break;
      } catch (err) {
        // Try next path
        continue;
      }
    }
    
    if (!content) {
      throw new Error(`Could not find word dictionary file. Tried: ${possiblePaths.join(', ')}`);
    }
    
    const words = content
      .split(/[\n ]+/)
      .map(line => line.trim().toLowerCase())
      .filter(line => line.length > 0);
    
    wordSet = new Set(words);
    console.log(`[wordDictionary] Loaded ${wordSet.size} words from ${usedPath}`);
    return wordSet;
  } catch (error) {
    console.error('[wordDictionary] Failed to load word dictionary:', error);
    // Return empty set if file can't be loaded
    wordSet = new Set();
    return wordSet;
  }
}

/**
 * Check if a word exists in the dictionary
 */
export function isWordValid(word: string): boolean {
  if (!wordSet) {
    loadWordDictionary();
  }
  return wordSet?.has(word.toLowerCase()) ?? false;
}

/**
 * Get word count in dictionary
 */
export function getWordCount(): number {
  return wordSet?.size ?? 0;
}
