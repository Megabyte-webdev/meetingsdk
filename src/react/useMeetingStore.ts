import { useEffect, useState } from "react";
import { StateScope } from "../types/meeting";
import { MeetingState } from "../core/MeetingState";

export function useMeetingStore<T>(
  stateManager: MeetingState,
  scope: StateScope,
  selector: (state: MeetingState) => T,
): T {
  const [state, setState] = useState(() => selector(stateManager));

  useEffect(() => {
    // Update local react state whenever the SDK notifies this scope
    const unsubscribe = stateManager.subscribe(scope, () => {
      setState(selector(stateManager));
    });

    return unsubscribe;
  }, [stateManager, scope, selector]);

  return state;
}
