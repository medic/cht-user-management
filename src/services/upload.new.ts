import { ChtApi, PlacePayload } from '../lib/cht-api';
import Place from './place';
import { Uploader } from './upload-manager';

export class UploadNewPlace implements Uploader {
  private readonly chtApi: ChtApi;

  constructor(chtApi: ChtApi) {
    this.chtApi = chtApi;
  }

  handleContact = async function (payload: PlacePayload): Promise<string | undefined> {
    return;
  };

  handlePlacePayload = async (place: Place, payload: PlacePayload): Promise<string> => {
    return await this.chtApi.createPlace(payload);
  };

  //  we don't get a contact id when we create a place with a contact defined
  //  https://github.com/medic/cht-core/issues/8674
  linkContactAndPlace = async (place: Place, placeId: string): Promise<void> => {
    if (place.creationDetails?.contactId) {
      return;
    }

    const contactId = await this.chtApi.updateContactParent(placeId);
    place.creationDetails.contactId = contactId;
  };
}
