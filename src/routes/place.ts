import { FastifyInstance, FastifyReply } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { parse } from "csv";
import { once } from "events";
import { MultipartFile } from "@fastify/multipart";

import { Config, ContactType } from "../lib/config";
import { jobState } from "../services/upload-manager";
import { uploadState, workBookState, person, place } from "../services/models";
import { LOCALES, MemCache } from "../services/cache";
import { ChtApi } from "../lib/cht";
import { getFormProperties } from "./utils";

export default async function place(fastify: FastifyInstance) {
  const cache: MemCache = fastify.cache;

  // search for a place given its type and name
  // return search results dropdown
  fastify.post("/search/replace", async (req, resp) => {
    const queryParams: any = req.query;
    const placeType = queryParams.type!!;
    const workbookId = queryParams.workbook;

    const data: any = req.body;
    const searchString = data.place_search;

    const chtApi = new ChtApi(req.chtSession);
    const results = await chtApi.searchPlace(placeType, searchString);
    cache.cacheRemoteSearchResult(results);
    if (results.length === 0) {
      results.push({ id: "na", name: "Place Not Found" });
    }
    return resp.view("src/public/components/replace_user_search_results.html", {
      workbookId,
      results: results,
    });
  });

  // returns search results dropdown
  fastify.post("/place/search", async (req, resp) => {
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook;
    const op = queryParams.op;

    const data: any = req.body;
    const searchString = data.place_search;

    const localResults = await cache.findPlace(
      workbookId,
      queryParams.type,
      searchString
    );
    const chtApi = new ChtApi(req.chtSession);
    const remoteResults = await chtApi.searchPlace(
      queryParams.type,
      searchString
    );
    cache.cacheRemoteSearchResult(remoteResults);

    const results = localResults.concat(remoteResults);
    if (results.length === 0) {
      results.push({ id: "na", name: "Place Not Found" });
    }
    return resp.view("src/public/components/search_results.html", {
      workbookId,
      op,
      pagePlaceType: data.place_type,
      results: results,
    });
  });

  // re-render the whole form with a hidden input that has the place id/name
  // when we select a place from search results
  // for the new place's parent
  fastify.post("/place/parent", async (req, resp) => {
    const data: any = req.body;
    const params: any = req.query;

    const placeId = params.id;
    const workbookId = params.workbook;
    if (placeId === "na") {
      throw new Error('placeId cannot be "na"');
    }

    const place = cache.getCachedSearchResult(placeId, workbookId);
    data.place_parent = place?.id;
    data.place_search = place?.name;

    const contactType = Config.getContactType(data.place_type);
    // to avoid key collisions between place and person keys
    const {
      placeProps: placeFormProperties,
      contactProps: contactFormProperties,
    } = getFormProperties(contactType);
    return resp.view("src/public/components/place_create_form.html", {
      workbookId: workbookId,
      op: "new",
      data: data,
      placeProperties: placeFormProperties,
      contactProperties: contactFormProperties,
      pagePlaceType: data.place_type!!,
      placeParentType: contactType.parent_type,
    });
  });

  // re-render the whole form with a hidden input that has the place id/name
  // when we select a place from search results
  // for user replacements
  fastify.post("/place/replace", async (req, resp) => {
    const queryParams: any = req.query;
    const { op, id: placeId, workbook: workbookId } = queryParams;
    const data: any = req.body;

    if (placeId === "na" || !op) {
      throw new Error('placeId is "na" or op is undefined');
    }

    const place = cache.getCachedSearchResult(placeId, workbookId);
    data.place_id = place!!.id;
    data.place_search = place!!.name;
    const contactType = Config.getContactType(data.place_type);
    return resp.view("src/public/components/place_create_form.html", {
      workbookId: workbookId,
      op,
      data,
      pagePlaceType: data.place_type!!,
      placeParentType: contactType.parent_type,
      placeProperties: Config.contactTypes().find(
        (item) => item.name === data.place_type
      )?.place_properties,
      contactProperties: Config.contactTypes().find(
        (item) => item.name === data.place_type
      )?.contact_properties,
    });
  });

  // you want to create a place? replace a contact? you'll have to go through me first
  fastify.post("/place", async (req, resp) => {
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook as string;
    const op = queryParams.op as string;
    if (op === "new") {
      return createPlace(workbookId, req.body, resp);
    } else if (op === "bulk") {
      // read the date we uploaded
      const fileData = await req.file();
      return createPlaces(
        workbookId,
        queryParams.type,
        fileData!!,
        resp,
        new ChtApi(req.chtSession)
      );
    } else if (op === "replace") {
      throw new Error("not implmented");
    } else {
      throw new Error("unknown op");
    }
  });

  // handles the "new" place form, expects to create only one place
  const createPlace = async (
    workbookId: string,
    data: any,
    resp: FastifyReply
  ): Promise<any> => {
    // @TODO validate fields here
    //
    const contactType = Config.getContactType(data.place_type);
    const userRole = contactType.contact_role;
    const placeProperties = contactType.place_properties;
    const contactProperties = contactType.contact_properties;
    // to avoid key collisions between place and person keys
    const {
      placeProps: placeFormProperties,
      contactProps: contactFormProperties,
    } = getFormProperties(contactType);
    const personData: { [key: string]: string } = { role: userRole };
    contactFormProperties.forEach((prop, idx) => {
      if (data[prop.doc_name]) {
        personData[contactProperties[idx].doc_name] = data[prop.doc_name];
      }
    });
    const placeData: { [key: string]: string } = {};
    placeFormProperties.forEach((prop, idx) => {
      if (data[prop.doc_name]) {
        placeData[placeProperties[idx].doc_name] = data[prop.doc_name];
      }
    });
    // build the place object, and save it.
    const id = uuidv4();
    const person: person = {
      id: "person::" + id,
      properties: personData,
    };
    const place: place = {
      id: "place::" + id,
      type: data.place_type,
      contact: person.id,
      workbookId,
      properties: placeData,
    };
    // set parent if any
    if (data.place_parent) {
      const parent = cache.getCachedSearchResult(
        data.place_parent,
        workbookId
      )!;
      const configParentKey = placeProperties.find(
        (item) => item.type === "parent"
      )!.doc_name;
      place.properties[configParentKey] = parent.name; // so we can see the name on the UI
      place.parent = {
        id: parent.id,
        name: parent.name,
      };
    }
    // save the place
    cache.savePlace(workbookId, place, person);
    // back to places list
    resp.header("HX-Redirect", `/workbook/${workbookId}`);
  };

  const readCsv = async (
    csvBuf: Buffer,
    workbookId: string,
    placeType: string
  ): Promise<{ place: place; contact: person }[]> => {
    const contactType = Config.getContactType(placeType);
    const userRole = contactType.contact_role;
    const mapPlaceCsvnameDocName = Config.getCSVNameDocNameMap(
      contactType.place_properties
    );
    const mapContactCsvnameDocName = Config.getCSVNameDocNameMap(
      contactType.contact_properties
    );
    const contactColumns = Object.keys(mapContactCsvnameDocName);
    const placeColumns = Object.keys(mapPlaceCsvnameDocName);

    const csvColumns: string[] = [];
    const places: { place: place; contact: person }[] = [];

    const parser = parse(csvBuf, { delimiter: ",", from_line: 1 });
    parser.on("data", function (row: string[]) {
      if (csvColumns.length === 0) {
        const missingColumns = [
          ...Object.keys(mapPlaceCsvnameDocName),
          ...Object.keys(mapContactCsvnameDocName),
        ].filter((csvName) => !row.includes(csvName));
        if (missingColumns.length > 0) {
          throw new Error(`Missing columns: ${missingColumns.join(", ")}`);
        }
        csvColumns.push(...row);
      } else {
        const personData: { [key: string]: string } = { role: userRole };
        for (const contactColumn of contactColumns) {
          const docName = mapContactCsvnameDocName[contactColumn];
          personData[docName] = row[csvColumns.indexOf(contactColumn)];
        }
        const placeData: { [key: string]: string } = {};
        for (const placeColumn of placeColumns) {
          const docName = mapPlaceCsvnameDocName[placeColumn];
          placeData[docName] = row[csvColumns.indexOf(placeColumn)];
        }
        const id = uuidv4();
        const person: person = {
          id: "person::" + id,
          properties: personData,
        };
        const place: place = {
          id: "place::" + id,
          type: placeType,
          contact: person.id,
          workbookId: workbookId,
          properties: placeData,
        };
        places.push({ place: place, contact: person });
      }
    });
    // wait till dones
    await once(parser, "finish");
    return places;
  };

  const getParents = async (
    places: { place: place; contact: person }[],
    workbookId: string,
    contactType: ContactType,
    cht: ChtApi
  ): Promise<Map<string, string>> => {
    const configParentKey = contactType!!.place_properties.find(
      (item) => item.type === "parent"
    )!!.doc_name;
    const parents: Set<string> = new Set(
      places.map((place) => place.place.properties[configParentKey])
    );

    const parentMap = new Map<string, string>();

    const nonLocalParents = Array.from(parents).filter((name) => {
      const results = cache.findPlace(
        workbookId,
        contactType.parent_type,
        name,
        { exact: true }
      );
      if (results.length > 1) {
        throw new Error("multiple parents found with name: " + name);
      }
      if (results.length === 1) {
        parentMap.set(name, results[0].id);
      }
      return results.length === 0;
    });

    const remoteResults = await cht.searchPlace(
      contactType.parent_type,
      nonLocalParents
    );
    if (remoteResults.length != nonLocalParents.length) {
      const remoteNames = remoteResults.map((i) => i.name);
      throw new Error(
        `Missing ${
          contactType.parent_type
        } on instance: ${nonLocalParents.filter(
          (x) => !remoteNames.includes(x)
        )}. Fix ${contactType.parent_type}(s) in CSV and retry upload`
      );
    }
    remoteResults.forEach((result) => parentMap.set(result.name, result.id));
    cache.cacheRemoteSearchResult(remoteResults);

    return parentMap;
  };

  // handle bulk place load
  const createPlaces = async (
    workbookId: string,
    placeType: string,
    fileData: MultipartFile,
    resp: FastifyReply,
    cht: ChtApi
  ): Promise<any> => {
    // read the csv
    const csvBuf = await fileData.toBuffer();
    const places = await readCsv(csvBuf, workbookId, placeType);

    const placeTypeConfig = Config.getContactType(placeType);
    let parentMap: Map<string, string>;
    if (placeTypeConfig.parent_type) {
      try {
        parentMap = await getParents(places, workbookId, placeTypeConfig, cht);
      } catch (error) {
        return fastify.view("src/public/place/bulk_create_form.html", {
          workbookId: workbookId,
          pagePlaceType: placeType,
          errors: {
            message: error,
          },
        });
      }
    }
    const parentKey = placeTypeConfig?.place_properties.find(
      (item) => item.type === "parent"
    )?.doc_name;
    //save the places
    places.forEach(({ place, contact }) => {
      if (placeTypeConfig.parent_type) {
        if (!parentKey || !parentMap) {
          throw new Error("error getting parents");
        }
        place.parent = {
          id: parentMap.get(place.properties[parentKey])!,
          name: place.properties[parentKey],
        };
      }
      cache.savePlace(workbookId, place, contact);
    });
    // back to places list
    resp.header("HX-Redirect", `/workbook/${workbookId}`);
  };

  fastify.post("/place/form/update", async (req, resp) => {
    const queryParams: any = req.query;
    const data: any = req.body;
    const placeType: string = data.type;
    const op = data.op || "new";
    resp.header("HX-Replace-Url", `?type=${placeType}&op=${op}`);
    const contactType = Config.getContactType(placeType);
    const {
      placeProps: placeFormProperties,
      contactProps: contactFormProperties,
    } = getFormProperties(contactType);
    return resp.view("src/public/components/place_create_form.html", {
      workbookId: queryParams.workbook,
      op,
      pagePlaceType: placeType,
      placeProperties: placeFormProperties,
      contactProperties: contactFormProperties,
      placeParentType: contactType.parent_type,
    });
  });

  fastify.get("/place/edit/:id", async (req, resp) => {
    const params: any = req.params;
    const id = params.id;

    const place = cache.getPlace(id);
    if (!place || place.remoteId) {
      throw new Error("unknonwn place or place has remoteId");
    }
    const person = cache.getPerson(place.contact)!!;
    const workbook = cache.getWorkbook(place.workbookId);

    const contactType = Config.getContactType(place.type);
    const placeProperties = contactType.place_properties;
    const contactProperties = contactType.contact_properties;
    // to avoid key collisions between place and person keys
    const {
      placeProps: placeFormProperties,
      contactProps: contactFormProperties,
    } = getFormProperties(contactType);

    const formData: any = {};
    contactFormProperties?.forEach((prop, idx) => {
      formData[prop.doc_name] =
        person.properties[contactProperties[idx].doc_name];
    });
    placeFormProperties?.forEach((prop, idx) => {
      formData[prop.doc_name] = place.properties[placeProperties[idx].doc_name];
    });
    if (place.parent) {
      formData.place_parent = place.parent.id;
      formData.place_search = place.parent.name;
    }

    const tmplData = {
      view: "edit",
      workbookId: place.workbookId,
      locales: LOCALES,
      workbook_locale: workbook.locale,
      op: "edit",
      pagePlaceType: place.type,
      placeParentType: contactType.parent_type,
      placeProperties: placeFormProperties,
      contactProperties: contactFormProperties,
      backend: `/place/edit/${id}`,
      data: formData,
      errors: {
        phoneInvalid: false,
        placeNameInvalid: false,
        contactNameInvalid: false,
        contactSexInvalid: false,
      },
    };
    resp.header("HX-Push-Url", `/place/edit/${id}`);
    const isHxReq = req.headers["hx-request"];
    if (isHxReq) {
      return resp.view("src/public/workbook/fragment_edit_form.html", tmplData);
    }
    return resp.view("src/public/workbook/view.html", tmplData);
  });

  fastify.post("/place/edit/:id", async (req, resp) => {
    const params: any = req.params;
    const id = params.id;

    const place = cache.getPlace(id);
    if (!place || place.remoteId) {
      throw new Error("unknonwn place or place has remoteId");
    }

    const person = cache.getPerson(place.contact)!!;
    const data: any = req.body;

    const contactType = Config.getContactType(place.type);
    const placeProperties = contactType.place_properties;
    const contactProperties = contactType.contact_properties;
    // to avoid key collisions between place and person keys
    const {
      placeProps: placeFormProperties,
      contactProps: contactFormProperties,
    } = getFormProperties(contactType);

    placeFormProperties.forEach((prop, idx) => {
      if (data[prop.doc_name]) {
        place.properties[placeProperties[idx].doc_name] = data[prop.doc_name];
      }
    });
    contactFormProperties.forEach((prop, idx) => {
      if (data[prop.doc_name]) {
        person.properties[contactProperties[idx].doc_name] =
          data[prop.doc_name];
      }
    });
    // set or update parent if any
    if (data.place_parent) {
      const parent = cache.getCachedSearchResult(
        data.place_parent,
        place.workbookId
      )!;
      const configParentKey = placeProperties.find(
        (item) => item.type === "parent"
      )!.doc_name;
      place.properties[configParentKey] = parent.name;
      place.parent = {
        id: parent.id,
        name: parent.name,
      };
    }
    // update place and person
    cache.updatePlace(place.workbookId, place, person);
    // back to places list
    resp.header("HX-Redirect", `/workbook/${place.workbookId}`);
  });

  fastify.get("/places", async (req, resp) => {
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook!!;
    const contactTypes = Config.contactTypes();
    const placeData = contactTypes.map((item) => {
      return {
        ...item,
        places: cache.getPlacesForDisplay(workbookId, item.name),
      };
    });
    return resp.view("src/public/place/list.html", {
      contactTypes: placeData,
    });
  });

  fastify.get("/places/controls", async (req, resp) => {
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook!!;
    const failed = cache.getPlaceByUploadState(workbookId, uploadState.FAILURE);
    const scheduledJobs = cache.getPlaceByUploadState(
      workbookId,
      uploadState.SCHEDULED
    );
    const hasFailedJobs = failed.length > 0;
    return resp.view("src/public/place/controls.html", {
      workbookId,
      workbookState: cache.getWorkbookState(workbookId)?.state,
      hasFailedJobs: hasFailedJobs,
      failedJobCount: failed.length,
      scheduledJobCount: scheduledJobs.length,
    });
  });

  fastify.get("/place/job/status", async (req, resp) => {
    const { uploadManager } = fastify;
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook!!;
    resp.hijack();
    const jobListener = (arg: jobState) => {
      if (arg.workbookId === workbookId)
        resp.sse({ event: "state_change", data: arg.placeId });
    };
    uploadManager.on("state", jobListener);
    const workbookStateListener = (arg: workBookState) => {
      if (arg.id === workbookId)
        resp.sse({ event: "workbook_state_change", data: arg.id });
    };
    uploadManager.on("workbook_state", workbookStateListener);
    req.socket.on("close", () => {
      uploadManager.removeListener("state", jobListener);
      uploadManager.removeListener("workbook_state", workbookStateListener);
    });
  });
}
