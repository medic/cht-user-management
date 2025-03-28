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
}
