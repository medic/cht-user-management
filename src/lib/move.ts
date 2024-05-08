import { ContactType } from '../config';
import SessionCache from '../services/session-cache';
import { ChtApi } from '../lib/cht-api';
import RemotePlaceResolver from '../lib/remote-place-resolver';
import Place from '../services/place';

export default class MoveLib {
  constructor() {}

  public static async move(formData: any, contactType: ContactType, sessionCache: SessionCache, chtApi: ChtApi) {
    const fromLineage = await resolve('from_', formData, contactType, sessionCache, chtApi);
    const toLineage = await resolve('to_', formData, contactType, sessionCache, chtApi);

    const toId = toLineage[1]?.id;
    const fromId = fromLineage[0]?.id;
    if (!toId || !fromId) {
      throw Error('Unexpected error: Move failed');
    }

    if (toId === fromLineage[1]?.id) {
      throw Error(`Place "${fromLineage[0]?.name.original}" already has "${toLineage[1]?.name.original}" as parent`);
    }
    
    const { authInfo } = chtApi.chtSession;
    const url = `http${authInfo.useHttp ? '' : 's'}://${chtApi.chtSession.username}:password@${authInfo.domain}`;

    fromLineage.reverse(); // ordered from big to small for UI
    return {
      command: `npx cht --url=${url} move-contacts upload-docs -- --contacts=${fromId} --parent=${toId}`,
      fromLineage,
      toLineage,
    };
  }
}

async function resolve(prefix: string, formData: any, contactType: ContactType, sessionCache: SessionCache, chtApi: ChtApi) {
  const place = new Place(contactType);
  place.setPropertiesFromFormData(formData, prefix);
  await RemotePlaceResolver.resolveOne(place, sessionCache, chtApi, { fuzz: true });
  place.validate();

  const validationError = place.validationErrors && Object.keys(place.validationErrors).find(err => err.startsWith(prefix));
  if (validationError) {
    throw Error(place.validationErrors?.[validationError]);
  }

  return place.resolvedHierarchy;
}
