import { ChtApi, CreatedPlaceResult, PlacePayload } from '../lib/cht-api';
import { DisableUsers } from '../lib/disable-users';
import Place from './place';
import { retryOnUpdateConflict } from '../lib/retry-logic';
import { Uploader } from './upload-manager';

export class UploadReplacementWithDeactivation implements Uploader {
  private readonly chtApi: ChtApi;

  constructor(chtApi: ChtApi) {
    this.chtApi = chtApi;
  }

  handleContact = async (payload: PlacePayload): Promise<string | undefined> => {
    return await this.chtApi.createContact(payload);
  };

  handlePlacePayload = async (place: Place, payload: PlacePayload): Promise<CreatedPlaceResult> => {
    const contactId = place.creationDetails?.contactId;
    const placeId = place.resolvedHierarchy[0]?.id;

    if (!contactId || !placeId) {
      throw Error('contactId and placeId are required');
    }

    const updatedPlaceDoc = await retryOnUpdateConflict<any>(() => this.chtApi.updatePlace(payload, contactId));
    await DisableUsers.deactivateUsersAt(placeId, this.chtApi);
    return {
      placeId: updatedPlaceDoc._id,
      contactId,
    };
  };
}
