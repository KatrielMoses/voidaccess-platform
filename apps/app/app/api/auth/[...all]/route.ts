import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth/auth";

const handler = (method: "GET" | "POST") => (req: Request) => toNextJsHandler(getAuth())[method](req);
export const GET = handler("GET");
export const POST = handler("POST");
