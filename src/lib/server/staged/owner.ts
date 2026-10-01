import type { OperationContext } from '../places/context';
import type { ListOwner } from './types';

export function ownerOf(context: OperationContext): ListOwner {
  return { instanceId: context.session.instanceId, username: context.session.username };
}
