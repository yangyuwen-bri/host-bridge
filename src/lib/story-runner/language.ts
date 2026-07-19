const LATIN_LETTER_PATTERN = /[A-Za-z]/u

export function containsLatinLetters(input: string): boolean {
  return LATIN_LETTER_PATTERN.test(input)
}
