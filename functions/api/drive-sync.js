// POST /api/drive-sync : see _lib/handler.js. Kept as a thin route so only `onRequest` is exposed.
import { handle } from "../_lib/handler.js";

export const onRequest = ({ request, env }) => handle(request, env);
