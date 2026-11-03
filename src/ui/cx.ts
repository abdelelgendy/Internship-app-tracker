/** Joins class names, skipping falsy parts. Use className props for layout, not to restyle a primitive. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
