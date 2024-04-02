import { ChtApi } from './cht-api';
import ChtSession from './cht-session';

export class ChtApi_4_7 extends ChtApi {
  public constructor(session: ChtSession) {
    super(session);
  }

  protected override async getUsersAtPlace(placeId: string): Promise<string[]> {
    const url = `api/v2/users?facility_id=${placeId}`;
    console.log('axios.get', url);
    const resp = await this.axiosInstance.get(url);
    return resp.data
      ?.filter((d : any) => !d.inactive)
      ?.map((d: any) => d.id);
  }
}
