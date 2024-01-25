import { PlacePayload } from '../../lib/cht-api';

export default async function mutate(payload: PlacePayload): Promise<PlacePayload> {
  if (payload.contact_type == 'health_center') {
    // during replacement, the name is optional
    if (payload.name) {
      payload.name += ' Area (village)';
    }
  }

  return payload;
}
