import 'fastify';

import type { FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    nonce?: string;
  }
  interface FastifyInstance {
    /**
     * Optional authentication hook to be used by the taujs SSRServer.
     * This method must be decorated by the user when using auth middleware in `taujs.config.ts`.
     *
     * Example usage:
     * ```ts
     * fastify.decorate('authenticate', async function (req, reply) {
     *   await req.jwtVerify();
     * });
     * ```
     */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
