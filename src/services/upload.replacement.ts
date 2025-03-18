import { ChtApi, CreatedPlaceResult, PlacePayload } from '../lib/cht-api';
import { MultiplaceUsers } from '../lib/multiplace-users';
import Place from './place';
import { retryOnUpdateConflict } from '../lib/retry-logic';
import { UploadOptions, Uploader } from './upload-manager';

export class UploadReplacementWithDeletion implements Uploader {
  private readonly chtApi: ChtApi;
  private readonly uploadOptions: UploadOptions;

  constructor(chtApi: ChtApi, uploadOptions: UploadOptions) {
    this.chtApi = chtApi;
    this.uploadOptions = uploadOptions;
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
    const previousPrimaryContact = updatedPlaceDoc.user_attribution?.previousPrimaryContacts?.pop();
    if (previousPrimaryContact) {
      await retryOnUpdateConflict<any>(() => this.chtApi.deleteDoc(previousPrimaryContact));
    }

    if (!this.uploadOptions.contactsOnly) {
      await MultiplaceUsers.disableUsersAt(placeId, this.chtApi);
    }
    return { placeId, contactId };
  };
}
