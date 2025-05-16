import Place from './place';
import { UploadSuperset } from './upload-superset';
import { SupersetApi } from '../lib/superset-api';
import SupersetSession from '../lib/superset-session';

export interface ISupersetIntegration {
  handlePlace(place: Place): Promise<{ username: string; password: string; supersetUserId: number } | void>;
  handleGroup(places: Place[]): Promise<void>;
}

export class SupersetIntegration implements ISupersetIntegration {
  constructor(private uploadSuperset: UploadSuperset) {}

  handlePlace(place: Place) {
    return this.uploadSuperset.handlePlace(place);
  }

  handleGroup(places: Place[]) {
    return this.uploadSuperset.handleGroup(places);
  }
}

export async function createSupersetIntegration(
  opts?: { supersetApi?: SupersetApi; uploadSuperset?: UploadSuperset }
): Promise<ISupersetIntegration> {
  let api = opts?.supersetApi;
  if (!api) {
    const session = await SupersetSession.create();
    api = new SupersetApi(session);
  }
  const uploader = opts?.uploadSuperset || new UploadSuperset(api);
  return new SupersetIntegration(uploader);
}
