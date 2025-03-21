import { ChtApi, CouchDoc, CreatedPlaceResult, PlacePayload } from '../lib/cht-api';
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
    
    let placeIds: string[] = [];
    const previousPrimaryContact = updatedPlaceDoc.user_attribution?.previousPrimaryContacts?.pop();
    if (previousPrimaryContact) {
      const user = await this.chtApi.getUser(previousPrimaryContact);
      if (Array.isArray(user.place) && user.place.length > 1) {
        const places = (user.place as CouchDoc[]).map(p => p._id);
        for (let i = 0; i < places.length; i++) {
          await this.chtApi.updatePlace(places[i], contactId);
        }
        placeIds = places;
      }
    }
    placeIds =  placeIds.filter(id => id !== placeId);
    await DisableUsers.deactivateUsersAt([placeId, ...placeIds], this.chtApi);
    return {
      placeId: updatedPlaceDoc._id,
      placeIds,
      contactId,
    };
  };
}
