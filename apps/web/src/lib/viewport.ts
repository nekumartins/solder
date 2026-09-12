/**
 * Keeps the shell the size of what the phone is actually showing.
 *
 * A mobile keyboard opens by shrinking the *visual* viewport and leaving the
 * layout viewport alone, so `100dvh` goes on claiming the whole screen and the
 * browser scrolls the document to reveal the focused field instead — taking
 * the header off the top and putting the send button behind the keys.
 *
 * Measuring `visualViewport` gives the shell a height that matches what is
 * visible, which removes the browser's reason to scroll, and putting the page
 * back at the top undoes any scrolling it managed first.
 */
export function trackViewport(): void {
  const viewport = window.visualViewport;
  if (!viewport) return;

  const apply = (): void => {
    document.documentElement.style.setProperty('--app-h', `${Math.round(viewport.height)}px`);
    // Nothing in this app scrolls the document itself, so any offset here is
    // the browser making room for a keyboard we have already made room for.
    if (window.scrollY !== 0) window.scrollTo(0, 0);
  };

  apply();
  viewport.addEventListener('resize', apply);
  viewport.addEventListener('scroll', apply);
}
