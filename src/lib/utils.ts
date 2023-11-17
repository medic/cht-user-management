import { AppSettings } from "./cht";

type hierarchyPlace = {
  contactType: string;
  personContactType?: string;
  parentPlaceContactType?: string;
};

export type Hierarchy = {
  [key: string]: hierarchyPlace;
};

// https://docs.communityhealthtoolkit.org/apps/reference/app-settings/hierarchy/
export const getHierarchy = (settings: AppSettings): Hierarchy => {
  const places: Hierarchy = {};
  settings.hierarchy.forEach((item) => {
    if (!item.person) {
      places[item.id] = {
        contactType: item.id,
        parentPlaceContactType: item.parents?.[0],
      };
    } else {
      item.parents?.forEach((place) => {
        places[place].personContactType = item.id;
      });
    }
  });
  return places;
};

export const getRoles = (settings: AppSettings): string[] => {
  return settings.roles;
};
