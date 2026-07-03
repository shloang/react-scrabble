import { memo, useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { validateWord } from '@/lib/gameApi';
import { ensureWordListLoaded, isWordLocal } from '@/lib/wordLocal';

type WordCheckResult = {
  word: string;
  valid: boolean;
  extract?: string | null;
};

type WordCheckerProps = {
  disabled?: boolean;
};

function WordChecker({ disabled }: WordCheckerProps) {
  const [wordToCheck, setWordToCheck] = useState('');
  const [isCheckingWord, setIsCheckingWord] = useState(false);
  const [wordCheckResult, setWordCheckResult] = useState<WordCheckResult | null>(null);

  const handleCheckWord = useCallback(async () => {
    const w = wordToCheck.trim();
    if (!w) return;

    setIsCheckingWord(true);
    setWordCheckResult(null);

    try {
      await ensureWordListLoaded();
      const local = isWordLocal(w.toLowerCase());
      if (local !== null) {
        setWordCheckResult({ word: w, valid: local, extract: null });
      } else {
        const res = await validateWord(w.toLowerCase());
        setWordCheckResult({ word: w, valid: res.isValid, extract: res.extract || null });
      }
    } catch {
      setWordCheckResult({ word: w, valid: false, extract: null });
    } finally {
      setIsCheckingWord(false);
    }
  }, [wordToCheck]);

  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold mb-2">Проверить слово</h3>
      <div className="flex gap-2">
        <Input
          placeholder="Введите слово"
          value={wordToCheck}
          onChange={(e) => setWordToCheck(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleCheckWord();
            }
          }}
          data-testid="input-check-word"
        />
        <Button
          onClick={handleCheckWord}
          disabled={isCheckingWord || disabled}
        >
          {isCheckingWord ? 'Проверка...' : 'Проверить'}
        </Button>
      </div>
      {wordCheckResult && (
        <div className={`mt-2 text-sm font-medium ${wordCheckResult.valid ? 'text-green-700' : 'text-red-700'}`} data-testid="check-result">
          <div>{wordCheckResult.word} — {wordCheckResult.valid ? 'В словаре' : 'Не найдено'}</div>
          {wordCheckResult.extract ? (
            <>
              <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{wordCheckResult.extract}</div>
              <div className="mt-1 text-xs">
                <a
                  href={`https://ru.wiktionary.org/wiki/${encodeURIComponent(wordCheckResult.word.toLowerCase())}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline"
                  data-testid="link-more"
                >
                  Подробнее
                </a>
              </div>
            </>
          ) : (
            <div className="mt-1 text-xs">
              <a
                href={`https://ru.wiktionary.org/wiki/${encodeURIComponent(wordCheckResult.word)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary underline"
                data-testid="link-more"
              >
                Подробнее
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(WordChecker);
