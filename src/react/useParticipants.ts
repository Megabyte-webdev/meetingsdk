import { useEffect, useState } from "react";
import { useMeetingContext } from "./MeetingProvider";
import { Participant } from "../types/meeting";

export const useParticipants = () => {
  const { state } = useMeetingContext();
  const [participants, setParticipants] = useState<Participant[]>([]);

  useEffect(() => {
    setParticipants(state.getParticipants());

    const unsub = state.subscribe(() => {
      setParticipants(state.getParticipants());
    });

    return () => unsub();
  }, [state]);

  return participants;
};
