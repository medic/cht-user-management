import { ChtApi, PlacePayload } from "../lib/cht-api";
import Place from "./place";
import { Uploader } from "./upload-manager";

export class UploadNewPlace implements Uploader {
  private readonly chtApi: ChtApi;

  constructor(chtApi: ChtApi) {
    this.chtApi = chtApi;
  }

  handleContact = async function (payload: PlacePayload): Promise<string | undefined> {
    return;
  }

  handlePlacePayload = async (place: Place, payload: PlacePayload): Promise<string> => {
    return await this.chtApi.createPlace(payload);
  };

  //  we don't get a contact id when we create a place with a contact defined
  // 
  linkContactAndPlace = async (place: Place, placeId: string): Promise<void> => {
    if (place.creationDetails?.contactId) {
      return;
    }

    const contactId = await this.chtApi.getPlaceContactId(placeId);
    await this.chtApi.updateContactParent(contactId, placeId);
    place.creationDetails.contactId = contactId;
  };
};
