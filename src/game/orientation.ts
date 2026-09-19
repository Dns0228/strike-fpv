export function lockLandscape(): void {
  const ori = screen.orientation as { lock?: (mode: string) => Promise<void> } | undefined;
  if (typeof ori?.lock === "function") {
    void ori.lock("landscape").catch(() => {
      /* browsers only allow this in fullscreen / installed PWA */
    });
  }
}

export function coarsePointer(): boolean {
  return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}
