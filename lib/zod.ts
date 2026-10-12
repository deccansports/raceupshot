import { z } from "zod";

// Cloudflare Workers prohibit runtime code generation. Zod's object-schema JIT
// can otherwise compile validators with `Function(...)` during a request.
z.config({ jitless: true });

export { z };
