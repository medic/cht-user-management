import { ChtApi, PlacePayload } from '../lib/cht-api';
import Place from './place';
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

    const updatedPlaceId = await this.chtApi.updatePlace(payload, contactId);
    const disabledUsers = await this.chtApi.disableUsersWithPlace(placeId);
    place.creationDetails.disabledUsers = disabledUsers;

    // (optional) mute and rename contacts associated to the disabled users
    return updatedPlaceId;
  };

  linkContactAndPlace = async (place: Place, placeId: string): Promise<void> => {
    const contactId = await this.chtApi.updateContactParent(placeId);
    place.creationDetails.contactId = contactId;
  };
}
