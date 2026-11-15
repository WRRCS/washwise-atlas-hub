// Lets mouse users highlight text inside buttons/links without the drag also "clicking" them.
export const SELECT_DRAG_PX = 5;

export function isSelectionDrag(dx: number, dy: number, selectedText: string): boolean {
  return Math.hypot(dx, dy) > SELECT_DRAG_PX && selectedText.trim().length > 0;
}

export function installSelectableClicks(): () => void {
  let start: { x: number; y: number } | null = null;
  const onDown = (e: MouseEvent) => { start = e.button === 0 ? { x: e.clientX, y: e.clientY } : null; };
  const onClick = (e: MouseEvent) => {
    const s = start; start = null;
    if (!s) return;
    const sel = window.getSelection();
    if (!sel || !isSelectionDrag(e.clientX - s.x, e.clientY - s.y, sel.toString())) return;
    const target = e.target as Node | null;
    if (target && !sel.containsNode(target, true)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("click", onClick, true);
  return () => {
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("click", onClick, true);
  };
}
