import { useEffect, useState } from "react";

const KEY = "cosign.show_agent_activity";
const EVT = "cosign:settings";

/** "Show agent activity" (Orchestra map, chat replay, typing animation). ON by default (a stored "0" turns it off); kept as a study condition. */
export function useAgentActivity(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const read = () => setOn(window.localStorage.getItem(KEY) !== "0");
    read();
    window.addEventListener(EVT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(EVT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return [
    on,
    (v) => {
      window.localStorage.setItem(KEY, v ? "1" : "0");
      window.dispatchEvent(new Event(EVT));
    },
  ];
}
