import { ChtApi, CreatedPlaceResult, PlacePayload } from '../lib/cht-api';
import Place from './place';
import { Uploader } from './upload-manager';

export class UploadNewPlace implements Uploader {
  private readonly chtApi: ChtApi;

  constructor(chtApi: ChtApi) {
    this.chtApi = chtApi;
  }

  handleContact = async function (): Promise<string | undefined> {
    return;
  };

  handlePlacePayload = async (place: Place, payload: PlacePayload): Promise<CreatedPlaceResult> => {
    return await this.chtApi.createPlace(payload);
  };

  //  we don't get a contact id when we create a place with a contact defined prior to cht 4.6
  //  https://github.com/medic/cht-core/issues/8674
  linkContactAndPlace = async (place: Place, placeId: string): Promise<void> => {
    const contactId = await this.chtApi.updateContactParent(placeId);
    place.creationDetails.contactId = contactId;
  };
}
