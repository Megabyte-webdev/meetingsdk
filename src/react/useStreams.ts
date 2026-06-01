import { useEffect, useState } from "react";
import { useMeetingContext } from "./MeetingProvider";

export const useStreams = () => {
  const { state } = useMeetingContext();
  const [streams, setStreams] = useState<Map<string, MediaStream>>(new Map());

  useEffect(() => {
    setStreams(new Map(state.streams));

    const unsub = state.subscribe(() => {
      setStreams(new Map(state.streams));
    });

    return () => unsub();
  }, [state]);

  return streams;
};
