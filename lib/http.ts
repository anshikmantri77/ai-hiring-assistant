export function message(err: unknown): string {
  return err instanceof Error ? err.message : 'Unexpected server error.';
}
