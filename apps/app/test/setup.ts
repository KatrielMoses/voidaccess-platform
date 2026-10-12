import { vi } from "vitest";

vi.mock("@/lib/auth/session", async () => await import("./session-state"));
