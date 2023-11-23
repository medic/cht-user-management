import { CountryCode } from "libphonenumber-js";
import {
  PersonPayload,
  PlacePayload,
  PlaceSearchResult,
  UserPayload,
} from "../lib/cht";

import {
  workBookState,
  uploadState,
  place,
  person,
  workbookuploadState,
  userCredentials,
  placeWithCreds,
  jobState,
  displayPlace,
} from "./models";

import { Config } from '../lib/config';

export const illegalNameCharRegex = new RegExp(`[^a-zA-Z'\\s]`);
export const LOCALES: CountryCode[] = ["KE", "UG"]; //for now

export class MemCache {
  private workbooks: Map<string, workBookState>;
  private places: Map<string, place> = new Map();
  private people: Map<string, person> = new Map();

  private searchResultCache: Map<string, PlaceSearchResult> = new Map();
  private jobState: Map<string, jobState> = new Map();
  private credList: Map<string, userCredentials> = new Map();

  constructor() {
    this.workbooks = new Map();
  }

  /**
   *
   * @param name workbook name
   * @returns workbook id
   */
  saveWorkbook = (name: string): string => {
    const id = name.toLowerCase().split(" ").join("");
    const workflowState: workBookState = {
      id: id,
      places: new Map(),
      locale: LOCALES[0],
    };

    this.workbooks.set(id, workflowState);
    return id;
  };

  /**
   *
   * @param id workbook id
   * @returns workBookState
   */
  getWorkbook = (id: string): workBookState => {
    const workbook = this.workbooks.get(id);
    if (!workbook) {
      throw new Error("workbook does not exist");
    }
    return workbook;
  };

  setLocale = (workbookId: string, locale: CountryCode) => {
    this.getWorkbook(workbookId)!!.locale = locale;
  };

  /**
   *
   * @returns a list of workbook ids
   */
  getWorkbooks = (): string[] => {
    return Array.from(this.workbooks.keys());
  };

  /**
   *
   * @param workbookId
   * @param data place data
   */
  savePlace = (workbookId: string, placeData: place, personData: person) => {
    const workbook = this.workbooks.get(workbookId);
    if (!workbook) {
      throw new Error("workbook does not exist");
    }
    // add teh data to a map
    this.places.set(placeData.id, placeData);
    this.people.set(personData.id, personData);
    // add place reference to teh workbook state
    const places = workbook.places.get(placeData.type) || [];
    places.push(placeData.id);
    workbook.places.set(placeData.type, places);
    // if we had previous state, update it
    if (workbook.state) {
      workbook.state.state = "pending";
    }
    if (this.isPlaceValid(placeData, personData, workbook.locale)) {
      this.setJobState(placeData.id, uploadState.SCHEDULED);
    } else {
      this.setJobState(placeData.id, uploadState.PENDING);
    }
  };

  updatePlace = (workbookId: string, placeData: place, personData: person) => {
    const workbook = this.workbooks.get(workbookId);
    if (!workbook) {
      throw new Error("workbook does not exist");
    }
    // add teh data to a map
    this.places.set(placeData.id, placeData);
    this.people.set(personData.id, personData);
    // if we had previous state, update it
    if (workbook.state) {
      workbook.state.state = "pending";
    }
    if (this.isPlaceValid(placeData, personData, workbook.locale)) {
      this.setJobState(placeData.id, uploadState.SCHEDULED);
    } else {
      this.setJobState(placeData.id, uploadState.PENDING);
    }
  };

  /**
   * @param id
   * @returns place
   */
  getPlace = (id: string) => this.places.get(id);

  /**
   * @param id
   * @returns place
   */
  getPerson = (id: string) => this.people.get(id);

  /**
   * @param id
   * @returns job status
   */
  getJobState = (id: string) => this.jobState.get(id);

  /**
   * @param workbookId
   * @returns list of places in the workbook
   */
  getPlaces = (workbookId: string): place[] => {
    const workbook = this.workbooks.get(workbookId);
    if (!workbook) {
      throw new Error("workbook does not exist");
    }
    const places: place[] = [];

    const placeTypes = Config.contactTypes();
    for (const placeType of placeTypes) {
      const data = workbook.places.get(placeType.name) || [];
      data.forEach((placeId: string) => {
        places.push(this.getPlace(placeId)!!);
      });
    }
    return places;
  };

  isPlaceValid = (
    place: place,
    person: person,
    locale: CountryCode
  ): boolean => {
    // TODO: Implement validation
    return true;
  };

  /**
   * @param workbookId
   * @returns list of places in the workbook
   */
  getPlacesForDisplay = (workbookId: string): displayPlace[] => {
    const workbook = this.workbooks.get(workbookId);
    if (!workbook) {
      throw new Error("workbook does not exist");
    }
    const places: displayPlace[] = [];
    const placeTypes = Config.contactTypes();
    for (const placeType of placeTypes) {
      const data = workbook.places.get(placeType.name) || [];
      data.forEach((placeId: string) => {
        const place = this.getPlace(placeId)!!;
        const person = this.getPerson(place.contact)!!;
        const isValid = this.isPlaceValid(place, person, workbook.locale);
        const state = this.getJobState(place.id)!!;
        places.push({
          place: place,
          contact: person,
          state: state,
          valid: isValid,
        });
      });
    }
    return places;
  };

  findPlace = async (
    workbookId: string,
    placeType: string,
    searchStr: string
  ): Promise<PlaceSearchResult[]> => {
    const workbook = this.getWorkbook(workbookId);
    const placesOfType = workbook.places.get(placeType) || [];
    return placesOfType
      .filter((placeId: string) => {
        const place = this.getPlace(placeId)!!;
        return (
          place.name.toUpperCase().includes(searchStr.toUpperCase()) &&
          !place.remoteId
        );
      })
      .map((placeId: string) => {
        const place = this.getPlace(placeId)!!;
        return { id: place.id, name: place.name };
      });
  };

  cacheRemoteSearchResult = (results: PlaceSearchResult[]) => {
    results.forEach((place) => {
      this.setRemoteId(place.id, place.id);
      this.searchResultCache.set(place.id, place);
    });
  };

  getCachedSearchResult = (id: string, workbook: string): PlaceSearchResult | undefined => {
    let result = this.searchResultCache.get(id);
    if (!result) {
      const place = this.getPlaces(workbook).find(
        (place) => !this.getRemoteId(place.id!!) && place.id === id
      );
      if (place) result = { id: place.id!!, name: place.name };
    }
    return result;
  };

  setRemoteId = (localId: string, id: string) => {
    if (this.places.has(localId)) this.places.get(localId)!!.remoteId = id;
    if (this.people.has(localId)) this.people.get(localId)!!.remoteId = id;
  };

  getRemoteId = (id: string): string | undefined => {
    return this.places.get(id)?.remoteId ?? this.people.get(id)?.remoteId;
  };

  setJobState = (jobId: string, status: uploadState) => {
    if (!this.jobState.has(jobId)) {
      this.jobState.set(jobId, { id: jobId, status: status });
    } else {
      this.jobState.get(jobId)!!.status = status;
    }
  };

  setUserCredentials = (placeId: string, creds: userCredentials) => {
    this.credList.set(placeId, creds);
  };

  getUserCredentials = (workbookId: string): placeWithCreds[] => {
    return this.getPlaces(workbookId)
      .filter(
        (place) => this.getJobState(place.id)?.status === uploadState.SUCCESS
      )
      .map((place) => {
        const contact = this.people.get(place.contact)!!;
        return {
          placeName: place.name,
          placeType: place.type,
          placeParent: place.parent?.name,
          contactName: contact.name,
          creds: this.credList.get(place.id!!)!!,
        } as placeWithCreds;
      });
  };

  setWorkbookUploadState = (id: string, state: workbookuploadState) => {
    this.workbooks.get(id)!!.state = state;
  };

  getWorkbookState = (id: string): workbookuploadState | undefined => {
    return this.workbooks.get(id)!!.state;
  };

  getPlaceByUploadState = (workbookId: string, state: uploadState): place[] => {
    return this.getPlaces(workbookId).filter((place) => {
      return this.getJobState(place.id)?.status === state;
    });
  };

  buildUserPayload = (
    placeId: string,
    contactId: string,
    contactName: string,
    role: string
  ): UserPayload => {
    const data: UserPayload = {
      username: contactName.toLowerCase().split(" ").join("_"),
      password: "medic@1234!",
      type: role,
      place: placeId,
      contact: contactId,
    };
    return data;
  };

  buildContactPayload = (
    person: person,
    contactType: string,
    parent?: string
  ): PersonPayload => {
    return {
      name: person.name,
      phone: person.phone,
      sex: person.sex,
      type: "contact",
      contact_type: contactType,
      place: parent,
    };
  };

  buildPlacePayload = (place: place, person: person): PlacePayload => {
    const data: PlacePayload = {
      name: place.name,
      type: "contact",
      contact_type: place.type,
      contact: this.buildContactPayload(
        person,
        Config.getContactType(place.type).contact_type as string,
        place.action === "replace_contact" ? place.id : undefined
      ),
    };
    if (place.parent) {
      if (place.parent.id.startsWith("place::")) {
        data.parent = this.getRemoteId(place.parent.id);
      } else {
        data.parent = place.parent.id;
      }
    }
    return data;
  };
}
