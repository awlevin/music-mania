import { resolveFeedback } from '@/lib/feedback/store';
import type { FeedbackStatus } from '@/lib/feedback/types';

import { isAdmin } from '../admin';

export const dynamic = 'force-dynamic';

const STATUSES: FeedbackStatus[] = ['open', 'fixed', 'declined'];

/** Close (or reopen) an item. Only the queue worker may. */
export async function PATCH(request: Request, ctx: RouteContext<'/api/feedback/[id]'>): Promise<Response> {
  if (!isAdmin(request)) return Response.json({ error: 'Not allowed.' }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as {
    status?: FeedbackStatus;
    resolution?: string;
    commit?: string;
  } | null;
  if (!body?.status || !STATUSES.includes(body.status)) {
    return Response.json({ error: `status must be one of ${STATUSES.join(', ')}.` }, { status: 400 });
  }
  if (body.status !== 'open' && !body.resolution?.trim()) {
    return Response.json({ error: 'Say what was done, in a sentence.' }, { status: 400 });
  }
  const item = await resolveFeedback(id.toUpperCase(), {
    status: body.status,
    resolution: body.resolution?.trim().slice(0, 500),
    commit: body.commit?.trim().slice(0, 40),
  });
  if (!item) return Response.json({ error: 'No such feedback.' }, { status: 404 });
  return Response.json({ item });
}
