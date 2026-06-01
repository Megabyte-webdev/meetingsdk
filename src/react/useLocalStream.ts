import { useMeetingContext } from "./MeetingProvider";

export const useLocalStream = () => {
  const { state } = useMeetingContext();
  return state.localStream;
};
