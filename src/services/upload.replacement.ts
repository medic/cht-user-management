import { ChtApi, PlacePayload } from '../lib/cht-api';
import Place from './place';
import { retryOnUpdateConflict } from '../lib/retry-logic';
import { Uploader } from './upload-manager';

export class UploadReplacementPlace implements Uploader {
  private readonly chtApi: ChtApi;

  constructor(chtApi: ChtApi) {
    this.chtApi = chtApi;
  }

  handleContact = async (payload: PlacePayload): Promise<string | undefined> => {
    return await this.chtApi.createContact(payload);
  };

  handlePlacePayload = async (place: Place, payload: PlacePayload): Promise<string> => {
    const contactId = place.creationDetails?.contactId;
    const placeId = place.resolvedHierarchy[0]?.id;

    if (!contactId || !placeId) {
      throw Error('contactId and placeId are required');
    }

    const updatedPlaceDoc = await retryOnUpdateConflict<any>(() => this.chtApi.updatePlace(payload, contactId));
    const toDelete = updatedPlaceDoc.user_attribution.previousPrimaryContacts?.pop();
    if (toDelete) {
      await retryOnUpdateConflict<any>(() => this.chtApi.deleteDoc(toDelete));
    }

    const disabledUsers = await this.chtApi.disableUsersWithPlace(placeId);
    place.creationDetails.disabledUsers = disabledUsers;

    return updatedPlaceDoc._id;
  };

  linkContactAndPlace = async (place: Place, placeId: string): Promise<void> => {
    const contactId = await this.chtApi.updateContactParent(placeId);
    place.creationDetails.contactId = contactId;
  };
}
