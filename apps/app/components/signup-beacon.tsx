"use client";
import { useEffect } from "react";

/** Fires the anonymous `signup_started` event once per page view. Failures are ignored. */
export function SignupBeacon() {
  useEffect(() => {
    fetch("/api/events/signup-started", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "signup_started" }),
      keepalive: true,
    }).catch(() => {});
  }, []);
  return null;
}
