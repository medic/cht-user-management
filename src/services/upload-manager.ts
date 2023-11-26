import EventEmitter from "events";
import { ChtApi, ChtSession, UserPayload } from "../lib/cht";
import { MemCache } from "./cache";
import {
  workBookState,
  uploadState,
  place,
  workbookuploadState,
  userCredentials,
} from "./models";
import { Payloads } from "./payloads";

import { Config } from "../lib/config";

type batch = {
  workbookId: string;
  placeType: string;
  placeIds: string[];
};

export type jobState = {
  workbookId: string;
  placeId: string;
  state: uploadState;
};

export class UploadManager extends EventEmitter {
  private cache: MemCache;

  constructor(cache: MemCache) {
    super();
    this.cache = cache;
  }

  doUpload = (workbookId: string, chtSession: ChtSession) => {
    const batches = this.prepareUpload(this.cache.getWorkbook(workbookId));
    const chtApi = new ChtApi(chtSession);
    this.upload(batches, chtApi);
  };

  private prepareUpload = (workbook: workBookState): batch[] => {
    const batches: batch[] = [];
    const placeTypes = Config.contactTypes();
    for (const placeType of placeTypes) {
      const batch: batch = {
        workbookId: workbook.id,
        placeType: placeType.name,
        placeIds:
          workbook.places.get(placeType.name)?.filter((placeId: string) => {
            const state = this.cache.getJobState(placeId);
            return state && state.status === uploadState.SCHEDULED;
          }) ?? [],
      };
      batches.push(batch);
    }
    return batches;
  };

  private upload = async (batches: batch[], chtApi: ChtApi) => {
    let state: workbookuploadState = {
      id: batches[0].workbookId,
      state: "in_progress",
    };
    this.cache.setWorkbookUploadState(state.id, state);
    this.emitWorkbookStateChange(state);

    for (const batch of batches) {
      await this.uploadBatch(batch, chtApi);
    }

    state.state = "done";
    this.cache.setWorkbookUploadState(state.id, state);
    this.emitWorkbookStateChange(state);
  };

  private uploadBatch = async (job: batch, chtApi: ChtApi) => {
    for (const placeId of job.placeIds) {
      this.cache.setJobState(placeId, uploadState.IN_PROGESS);
      this.emitJobStateChange(job.workbookId, placeId, uploadState.IN_PROGESS);
      const place = this.cache.getPlace(placeId);
      if (!place) {
        throw Error(`Upload Failure: Could not find place "${placeId}"`);
      }
      try {
        const creds = await this.uploadPlace(place, chtApi);
        this.cache.setUserCredentials(placeId, creds);
        this.cache.setJobState(placeId, uploadState.SUCCESS);
        this.emitJobStateChange(job.workbookId, place.id, uploadState.SUCCESS);
      } catch (err) {
        console.error(err);
        this.cache.setJobState(placeId, uploadState.FAILURE);
        this.emitJobStateChange(job.workbookId, place.id, uploadState.FAILURE);
      }
    }
  };

  private uploadPlace = async (
    placeData: place,
    chtApi: ChtApi
  ): Promise<userCredentials> => {
    const contact = this.cache.getPerson(placeData.contact);
    if (!contact) {
      throw Error(
        `Upload Failure: Could not find parent contact "${placeData.contact}"`
      );
    }
    let placeId = this.cache.getRemoteId(placeData.id);
    if (!placeId) {
      const place = Config.getContactType(placeData.type);
      const contactState = Payloads.buildContactPayload(
        contact,
        place.contact_type
      );
      const parentRemoteId =
        placeData?.parent?.id ?? this.cache.getRemoteId(placeData.id);
      const placePayload = Payloads.buildPlacePayload(
        placeData,
        contactState,
        parentRemoteId
      );
      placeId = await chtApi.createPlace(placePayload);
      this.cache.setRemoteId(placeData.id, placeId);
    }

    // why...we don't get a contact id when we create a place with a contact defined.
    // then the created contact doesn't get a parent assigned so we can't create a user for it
    const contactId: string = await chtApi.getPlaceContactId(placeId);
    this.cache.setRemoteId(contact.id, contactId);
    await chtApi.updateContactParent(contactId, placeId);

    const userPayload: UserPayload = Payloads.buildUserPayload(
      placeId,
      contactId,
      contact.properties.name,
      contact.properties.role
    );
    const { username, pass } = await this.tryCreateUser(userPayload, chtApi);
    return {
      place: placeId,
      contact: contactId,
      user: username,
      pass: pass,
    };
  };

  private tryCreateUser = async (
    userPayload: UserPayload,
    chtApi: ChtApi
  ): Promise<{ username: string; pass: string }> => {
    let retryCount = 0;
    let username = userPayload.username;
    do {
      try {
        await chtApi.createUser(userPayload);
        return { username: userPayload.username, pass: userPayload.password };
      } catch (err: any) {
        retryCount++;
        console.error("upload manager", err.response.data);
        if (err?.response?.status === 400) {
          const msg = err.response.data;
          if (msg.includes("already taken")) {
            const randomNumber = Math.floor(
              Math.random() * (10 ^ (retryCount + 1))
            );
            username = username.concat(randomNumber.toString());
            userPayload.username = username;
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
    } while (retryCount < 5);
    throw new Error("could not create user " + userPayload.contact);
  };

  private emitJobStateChange = (
    workbookId: string,
    placeId: string,
    state: uploadState
  ) => {
    const event: jobState = {
      workbookId: workbookId,
      placeId: placeId,
      state: state,
    };
    this.emit("state", event);
  };

  private emitWorkbookStateChange = (state: workbookuploadState) => {
    this.emit("workbook_state", state);
  };
}
