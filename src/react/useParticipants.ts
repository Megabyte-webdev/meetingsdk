import { useEffect, useState } from "react";
import { useMeetingContext } from "./MeetingProvider";
import { Participant } from "../types/meeting";

export const useParticipants = () => {
  const { sdk } = useMeetingContext();

  const [participants, setParticipants] = useState<Participant[]>(() =>
    sdk.state.getParticipants(),
  );

  useEffect(() => {
    const update = () => {
      setParticipants(sdk.state.getParticipants());
    };

    update();

    const unsub = sdk.state.subscribe("participants", update);

    return unsub;
  }, [sdk]);

  return participants;
};
