/**
 * The one signal this app uses to tell a phone from a desktop.
 *
 * Tailwind's `sm:` breakpoints handle the chrome, but *behaviour* — hit slop,
 * node radius, whether hover exists at all, which view a cold open shows — keys
 * off pointer type rather than width, because a wide tablet has a thumb and a
 * narrow desktop window has a mouse.
 */
export function isCoarsePointer(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}
