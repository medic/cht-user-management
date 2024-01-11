/*
 * This is a bunch logic required for Kenya eCHIS which doesn't generalize while. This handles the
 * stuff that eCHIS needs that others probably "shouldn't do" or are unlikely to do
 */

import { ChtApi, PlacePayload } from "../../lib/cht-api";
import { Config } from "..";

export default async function mutate(payload: PlacePayload, chtApi: ChtApi, isReplacement: boolean): Promise<PlacePayload> {
  if (payload.contact_type !== 'd_community_health_volunteer_area') {
    // during replacement, the name is optional
    if (payload.name) {
      payload.name += ' Community Health Unit';
    }

    return payload;
  }

  payload.name += ' Area';

  // if it is a replacement, the information is already set
  if (isReplacement || !payload.parent) {
    return payload;
  }

  const scapeToPayload = (chpKey: string, chuKey: string = chpKey) => {
    const result = chu?.[chuKey] || sibling?.[chpKey];
    if (!result) {
      throw Error(`eCHIS logic cant find existing data for ${chpKey}`);
    }

    payload[chpKey] = result;
  };

  const contactType = Config.getContactType(payload.contact_type);
  const { parent: chu, sibling } = await chtApi.getParentAndSibling(payload.parent, contactType);
  if (!chu && !sibling) {
    throw Error(`CHU does not exist`);
  }

  scapeToPayload('link_facility_code');
  scapeToPayload('link_facility_name');
  scapeToPayload('chu_name', 'name');
  scapeToPayload('chu_code', 'code');
  return payload;
};
