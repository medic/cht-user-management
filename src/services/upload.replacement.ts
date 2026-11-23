import { ChtApi, CouchDoc, CreatedPlaceResult, PlacePayload } from '../lib/cht-api';
import { DisableUsers } from '../lib/disable-users';
import Place from './place';
import { retryOnUpdateConflict } from '../lib/retry-logic';
import { Uploader } from './upload-manager';

export class UploadReplacementWithDeletion implements Uploader {
  private readonly chtApi: ChtApi;

  constructor(chtApi: ChtApi) {
    this.chtApi = chtApi;
  }

  handleContact = async (payload: PlacePayload): Promise<string | undefined> => {
    return await this.chtApi.createContact(payload);
  };

  private updatePlace = async(payload: PlacePayload | string, contactId: string) => {
    const updatedPlaceDoc = await retryOnUpdateConflict<any>(() => this.chtApi.updatePlace(payload, contactId));
    // a retried replacement records the new contact as "previous" too, so it must never be returned
    const previousContacts: string[] = updatedPlaceDoc.user_attribution?.previousPrimaryContacts ?? [];
    return previousContacts.filter(id => id !== contactId).pop();
  };

  handlePlacePayload = async (place: Place, payload: PlacePayload): Promise<CreatedPlaceResult> => {
    const contactId = place.creationDetails?.contactId;
    const placeId = place.resolvedHierarchy[0]?.id;

    if (!contactId || !placeId) {
      throw Error('contactId and placeId are required');
    }

    let placeIds: string[] = [];
    const previousPrimaryContact = await this.updatePlace(payload, contactId);
    if (previousPrimaryContact) {
      const user = await this.chtApi.getUser(previousPrimaryContact);
      if (Array.isArray(user?.place) && user.place.length > 1) {
        const places = (user.place as CouchDoc[]).map(p => p._id);
        for (let i = 0; i < places.length; i++) {
          await this.updatePlace(places[i], contactId);
        }
        placeIds = places;
      }
    }
    placeIds =  placeIds.filter(id => id !== placeId);
    await DisableUsers.disableUsersAt([placeId, ...placeIds], this.chtApi);

    // Only delete the outgoing contact once no user references it: deleting first (or while a user
    // remains) leaves that user with a contact that does not exist
    if (previousPrimaryContact && !(await this.chtApi.getUser(previousPrimaryContact))) {
      await retryOnUpdateConflict<any>(() => this.chtApi.deleteDoc(previousPrimaryContact));
    }
    return { placeId, placeIds, contactId };
  };
}
