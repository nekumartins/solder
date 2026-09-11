import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { badRequest, conflict } from '../errors.js';
import { publishBalance } from '../notify.js';
import { requireUser } from '../session.js';
import { asObject, micros } from '../validate.js';

const MAX_TOP_UP = 500_000_000n; // $500 a go

/**
 * Demo money, only on the local simulated ledger. On a real cluster the
 * adapter cannot mint anything, so this route is not registered at all.
 */
export async function devRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { store, chain } = ctx;
  if (!chain.canFund || !chain.fund) return;

  app.post('/api/dev/fund', async (request) => {
    const user = requireUser(store, request);
    if (!user.pubkey) throw conflict('setup_incomplete', 'Finish setting up your account first');

    const body = asObject(request.body ?? {});
    const amount = body['micros'] === undefined ? 25_000_000n : micros(body['micros'], 'amount');
    if (amount > MAX_TOP_UP) throw badRequest('too_much', 'That is more than the demo allows');

    await chain.fund!(user.pubkey, amount);
    await publishBalance(ctx, user.id);
    return { balanceMicros: (await chain.getBalance(user.pubkey)).toString() };
  });
}
