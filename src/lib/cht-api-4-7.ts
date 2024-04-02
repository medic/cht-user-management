import { ChtApi } from './cht-api';

export class ChtApi_4_7 extends ChtApi {
  protected override async getUsersAtPlace(placeId: string): Promise<string[]> {
    const url = `api/v2/users?facility_id=${placeId}`;
    console.log('axios.post', url);
    const resp = await this.axiosInstance.get(url);
    return resp.data
      ?.filter((d : any) => !d.inactive)
      ?.map((d: any) => d.id);
  }
}
