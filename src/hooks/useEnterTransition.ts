import { useEffect, useState } from 'react';

// Returns true one animation frame after mount. Used to trigger a CSS transition
// from an initial (entering) state to a final (entered) state on mount.
//
// NOTE: this only animates entry, not exit — the element still unmounts/removes
// instantly when its parent stops rendering it (React Router route swaps, closing
// a modal). A true exit transition would require keeping the old element mounted
// during removal (e.g. via a library like framer-motion or react-transition-group),
// which wasn't installed for this scope.
export function useEnterTransition(deps: React.DependencyList = []): boolean {
  const [entered, setEntered] = useState(false);
  const depKey = JSON.stringify(deps);

  useEffect(() => {
    setEntered(false);
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [depKey]);

  return entered;
}
