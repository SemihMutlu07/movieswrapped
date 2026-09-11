/** English indefinite article for cinema-scale labels that stay in English. */
export function indefiniteArticle(word: string): 'a' | 'an' {
  const letter = word.trim().match(/[a-z]/i)?.[0] ?? '';
  return /^[aeiou]$/i.test(letter) ? 'an' : 'a';
}
