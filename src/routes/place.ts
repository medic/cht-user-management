import { FastifyInstance, FastifyReply } from "fastify";
import { isValidNumberForRegion } from "libphonenumber-js";
import { v4 as uuidv4 } from "uuid";
import { parse } from "csv";
import { once } from "events";
import { MultipartFile, MultipartValue } from "@fastify/multipart";

import { Config } from "../lib/config";
import { jobState } from "../services/upload-manager";
import { uploadState, workBookState, place, person } from "../services/models";
import { illegalNameCharRegex, LOCALES } from "../services/cache";
import { ChtApi } from "../lib/cht";

export default async function place(fastify: FastifyInstance) {
  const { cache } = fastify;

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

  // search for a place's possible parents given its type
  // return search results dropdown
  fastify.post("/search/parent", async (req, resp) => {
    const queryParams: any = req.query;
    const contactType = Config.getContactType(queryParams.type);
    const parentType = contactType.parent_type;
    const workbookId = queryParams.workbook;
    const op = queryParams.op;

    const data: any = req.body;
    const searchString = data.place_search;

    const localResults = await cache.findPlace(
      workbookId,
      parentType,
      searchString
    );
    const chtApi = new ChtApi(req.chtSession);
    const remoteResults = await chtApi.searchPlace(parentType, searchString);
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
    const op = params.op; 

    if (placeId === "na" || !op) {
      throw new Error('placeId is "na" or op is undefined');
    }

    const place = cache.getCachedSearchResult(placeId, workbookId);
    data.place_parent = place.id;
    data.place_search = place.name;

    const contactType = Config.getContactType(data.place_type);
    return resp.view("src/public/components/place_create_form.html", {
      workbookId,
      op,
      data,
      pagePlaceType: data.place_type!!,
      userRoles: contactType.roles,
      hasParent: !!contactType.parent_type,
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
      workbookId,
      op,
      data,
      userRoles: contactType.roles,
      pagePlaceType: contactType.name,
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
      return createPlaces(workbookId, queryParams.type, fileData!!, resp);
    } else if (op === "replace") {
      return replaceContact(workbookId, req.body, resp);
    } else {
      throw new Error('unknown op');
    }
  });

  // handles the "new" place form, expects to create only one place
  const createPlace = async (
    workbookId: string,
    data: any,
    resp: FastifyReply
  ): Promise<any> => {
    // validate fields here
    const workbook = cache.getWorkbook(workbookId);
    const contactType = Config.getContactType(data.place_type);
    const isMissingParent = contactType.parent_type && !data.place_parent;
    const isPhoneValid = isValidNumberForRegion(
      data.contact_phone,
      workbook.locale
    );
    if (!isPhoneValid || isMissingParent) {
      return resp.view("src/public/place/create_form.html", {
        workbookId,
        pagePlaceType: contactType.name,
        userRoles: contactType.roles,
        hasParent: !!contactType.parent_type,
        data,
        errors: {
          phoneInvalid: !isPhoneValid,
          missingParent: isMissingParent,
        },
      });
    }
    // build the place object, and save it.
    const id = uuidv4();
    const contactData: person = {
      id: "person::" + id,
      name: data.contact_name,
      phone: data.contact_phone,
      sex: data.contact_sex,
      role: data.contact_role,
    };
    const placeData: place = {
      id: "place::" + id,
      name: data.place_name,
      type: data.place_type,
      action: "create",
      contact: contactData.id,
      workbookId,
    };
    // set parent if any
    if (data.place_parent) {
      const parent = cache.getCachedSearchResult(
        data.place_parent,
        workbookId
      );
      placeData.parent = {
        id: parent.id,
        name: parent.name,
      };
    }
    // save the place
    cache.savePlace(workbookId, placeData, contactData);
    // back to places list
    resp.header("HX-Replace-Url", `/workbook/${workbookId}`);
    return fastify.view("src/public/workbook/content_places.html", {
      oob: true,
      places: cache.getPlacesForDisplay(workbookId),
      workbookId,
      workbookState: cache.getWorkbookState(workbookId)?.state,
      scheduledJobCount: cache.getPlaceByUploadState(
        workbookId,
        uploadState.SCHEDULED
      ).length,
    });
  };

  // handle bulk place load
  const createPlaces = async (
    workbookId: string,
    placeType: string,
    fileData: MultipartFile,
    resp: FastifyReply
  ): Promise<any> => {
    // read the csv we uploaded
    const csvBuf = await fileData.toBuffer();
    const parser = parse(csvBuf, { delimiter: ",", from_line: 1 });
    const userRole = (fileData.fields["contact_role"] as MultipartValue<string>)
      .value;

    let parent: any = undefined;
    // TOFIX: what is this?
    if (fileData.fields["place_parent"]) {
      const result = cache.getCachedSearchResult(
        (fileData.fields["place_parent"] as MultipartValue<string>).value,
        workbookId
      )!!;
      parent = {
        id: result.id,
        name: result.name,
      };
    }

    let columns: string[];
    const contactTypes = Config.contactTypes();
    const placeTypeConfig = Config.getContactType(placeType);
    
    const placePropeties = placeTypeConfig.place_properties.map(p => ({ [p.csv_name]: p.doc_name }));
    const mapPlaceCsvnameDocName  = Object.assign({}, ...placePropeties);

    // todo: again or put in func
    const mapContactCsvnameDocName = placeTypeConfig.contact_properties.map((p) => {
      return {[p.csv_name]: p.doc_name};
    }).reduce((acc, curr) => {
      return {...acc, ...curr};
    }, {});

    let line = 0;
    parser.on("data", function (row: string[]) {
      if (line === 0) {
        // validate the header
        const missingColumns = [...Object.keys(mapPlaceCsvnameDocName), ...Object.keys(mapContactCsvnameDocName)]
          .filter((csvName) => !row.includes(csvName));
        if (missingColumns.length > 0) {
          throw new Error(`Missing columns: ${missingColumns.join(", ")}`);
        }
        columns = row;
      } else {
        const id = uuidv4();
        const contact: person = {
          id: "person::" + id,
          role: userRole,
        };
        const contactColumns = Object.keys(mapContactCsvnameDocName);
        for (const contactColumn of contactColumns) {
          const docName = mapContactCsvnameDocName[contactColumn];
          contact[docName] = row[columns.indexOf(contactColumn)];
        }
        const placeData: place = {
          id: "place::" + id,
          type: placeType,
          action: "create",
          contact: contact.id,
          parent: parent,
          workbookId,
        };
        // todo: func?
        const placeColumns = Object.keys(mapPlaceCsvnameDocName);
        for (const placeColumn of placeColumns) {
          const docName = mapPlaceCsvnameDocName[placeColumn];
          placeData[docName] = row[columns.indexOf(placeColumn)];
        }
        cache.savePlace(workbookId, placeData, contact);
      }
      line++;
    });
    // wait
    await once(parser, "finish");
    // back to places list
    resp.header("HX-Replace-Url", `/workbook/${workbookId}`);
    return fastify.view("src/public/workbook/content_places.html", {
      oob: true,
      places: cache.getPlacesForDisplay(workbookId),
      contactTypes,
      workbookId,
      workbookState: cache.getWorkbookState(workbookId)?.state,
      scheduledJobCount: cache.getPlaceByUploadState(
        workbookId,
        uploadState.SCHEDULED
      ).length,
    });
  };

  const replaceContact = async (
    workbookId: string,
    data: any,
    resp: FastifyReply
  ) => {
    // kind of like a layout "event" trigger where we just return the form with the data
    const contactType = Config.getContactType(data.place_type);
    if (data.layout) {
      return resp.view("src/public/place/replace_user_form.html", {
        workbookId,
        pagePlaceType: contactType.name,
        userRoles: contactType.roles,
        data,
      });
    }
    const workbook = cache.getWorkbook(workbookId);
    // validate the inputs here
    const isPhoneValid = isValidNumberForRegion(
      data.contact_phone,
      workbook.locale
    );
    if (!isPhoneValid || !data.place_id) {
      if (!data.place_id) data.place_search = "";
      return resp.view("src/public/place/replace_user_form.html", {
        workbookId,
        pagePlaceType: contactType.name,
        userRoles: contactType.roles,
        data,
        errors: {
          phoneInvalid: !isPhoneValid,
          missingPlace: !data.place_id,
        },
      });
    }
    // build the models
    const id = uuidv4();
    const contact: person = {
      id: "person::" + id,
      name: data.contact_name,
      phone: data.contact_phone,
      sex: data.contact_sex,
      role: data.contact_role,
    };
    const placeData: place = {
      id: data.place_id,
      name: data.place_search,
      type: data.place_type,
      action: "replace_contact",
      contact: contact.id,
      workbookId,
    };
    // save the place and contact
    cache.savePlace(workbookId, placeData, contact);
    // back to places list
    resp.header("HX-Replace-Url", `/workbook/${workbookId}`);
    return fastify.view("src/public/workbook/content_places.html", {
      oob: true,
      places: cache.getPlacesForDisplay(workbookId),
      workbookId,
      workbookState: cache.getWorkbookState(workbookId)?.state,
      scheduledJobCount: cache.getPlaceByUploadState(
        workbookId,
        uploadState.SCHEDULED
      ).length,
    });
  };

  fastify.get("/place/form", async (req, resp) => {
    const queryParams: any = req.query;
    const contactTypes = Config.contactTypes();
    const pagePlaceType = contactTypes[0].name;
    const op = queryParams.op || "new";
    resp.header("HX-Push-Url", `/workbook/${queryParams.workbook}/add`);
    const contactType = Config.getContactType(pagePlaceType);
    return resp.view("src/public/workbook/fragment_form.html", {
      op,
      workbookId: queryParams.workbook,
      hierarchy: contactTypes.map(type => type.name),
      pagePlaceType,
      userRoles: contactType.roles,
      hasParent: !!contactType.parent_type,
    });
  });

  fastify.post("/place/form/update", async (req, resp) => {
    const queryParams: any = req.query;
    const data: any = req.body;
    const placeType = data.type;
    const op = data.op || "new";
    resp.header("HX-Replace-Url", `?type=${placeType}&op=${op}`);
    const contactType = Config.getContactType(placeType);
    return resp.view("src/public/components/place_create_form.html", {
      workbookId: queryParams.workbook,
      op,
      pagePlaceType: placeType,
      userRoles: contactType.roles,
      hasParent: !!contactType.parent_type,
    });
  });

  fastify.get("/place/edit/:id", async (req, resp) => {
    const params: any = req.params;
    const id = params.id;

    const place = cache.getPlace(id);
    if (!place || place.remoteId) {
      throw new Error('unknonwn place or place has remoteId');
    }
    const person = cache.getPerson(place.contact)!!;
    const workbook = cache.getWorkbook(place.workbookId);
    const contactType = Config.getContactType(place.type);
    const tmplData = {
      view: "edit",
      workbookId: place.workbookId,
      locales: LOCALES,
      workbook_locale: workbook.locale,
      op: "edit",
      pagePlaceType: place.type,
      hasParent: !!contactType.parent_type,
      backend: `/place/edit/${id}`,
      userRoles: contactType.roles,
      data: {
        place_name: place.name,
        contact_name: person.name,
        contact_sex: person.sex,
        contact_phone: person.phone,
        contact_role: person.role,
        place_search: place.parent?.name,
        place_parent: place.parent?.id,
      },
      errors: {
        phoneInvalid: !isValidNumberForRegion(person.phone, workbook.locale),
        placeNameInvalid: place.name.match(illegalNameCharRegex),
        contactNameInvalid: person.name.match(illegalNameCharRegex),
        contactSexInvalid: !["male", "female"].some(
          (item) => item === person.sex?.toLowerCase()
        ),
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
      throw new Error('unknonwn place or place has remoteId');
    }

    const person = cache.getPerson(place.contact)!!;
    const data: any = req.body;

    const workbook = cache.getWorkbook(place.workbookId);
    const contactType = Config.getContactType(data.place_type);
    const isMissingParent = contactType.parent_type && !data.place_parent;
    const isPhoneValid = isValidNumberForRegion(data.contact_phone, workbook.locale);
    if (!isPhoneValid || isMissingParent) {
      return resp.view("src/public/place/create_form.html", {
        workbookId: place.workbookId,
        backend: `/place/edit/${id}`,
        pagePlaceType: data.place_type,
        userRoles: contactType.roles,
        hasParent: !!contactType.parent_type,
        data,
        errors: {
          phoneInvalid: !isPhoneValid,
          missingParent: isMissingParent,
        },
      });
    }

    place.name = data.place_name;
    person.name = data.contact_name;
    person.phone = data.contact_phone;
    person.role = data.contact_role;
    person.sex = data.contact_sex;
    // set or update parent if any
    if (data.place_parent) {
      const parent = cache.getCachedSearchResult(
        data.place_parent,
        place.workbookId
      )!!;
      place.parent = {
        id: parent.id,
        name: parent.name,
      };
    }
    // update place and person
    cache.updatePlace(place.workbookId, place, person);
    // back to places list
    resp.header("HX-Replace-Url", `/workbook/${place.workbookId}`);
    return fastify.view("src/public/workbook/content_places.html", {
      oob: true,
      places: cache.getPlacesForDisplay(place.workbookId),
      workbookId: place.workbookId,
      workbookState: cache.getWorkbookState(place.workbookId)?.state,
      scheduledJobCount: cache.getPlaceByUploadState(
        place.workbookId,
        uploadState.SCHEDULED
      ).length,
    });
  });

  fastify.get("/places", async (req, resp) => {
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook!!;
    return resp.view("src/public/place/list.html", {
      places: cache.getPlacesForDisplay(workbookId),
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
