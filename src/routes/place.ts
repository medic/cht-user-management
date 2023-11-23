import { FastifyInstance, FastifyReply } from "fastify";
import { isValidNumberForRegion } from "libphonenumber-js";
import { v4 as uuidv4 } from "uuid";
import { parse } from "csv";
import { once } from "events";
import { MultipartFile, MultipartValue } from "@fastify/multipart";

import { Config } from "../lib/config";
import { jobState } from "../services/job";
import { uploadState, workBookState, place, person } from "../services/models";
import { illegalNameCharRegex, LOCALES } from "../services/cache";

export default async function place(fastify: FastifyInstance) {
  const { cache, cht, jobManager } = fastify;

  // search for a place given its type and name
  // return search results dropdown
  fastify.post("/search/replace", async (req, resp) => {
    const queryParams: any = req.query;
    const placeType = queryParams.type!!;
    const workbookId = queryParams.workbook;

    const data: any = req.body;
    const searchString = data.place_search;

    const results = await cht.searchPlace(placeType, searchString);
    cache.cacheRemoteSearchResult(results);
    if (results.length === 0) {
      results.push({ id: "na", name: "Place Not Found" });
    }
    return resp.view("src/public/components/replace_user_search_results.html", {
      workbookId: workbookId,
      results: results,
    });
  });

  // search for a place's possible parents given its type
  // return search results dropdown
  fastify.post("/search/parent", async (req, resp) => {
    const queryParams: any = req.query;
    const placeType = cache.getParentType(queryParams.type)!!;
    const workbookId = queryParams.workbook;

    const data: any = req.body;
    const searchString = data.place_search;

    const localResults = await cache.findPlace(
      workbookId,
      placeType,
      searchString
    );
    const remoteResults = await cht.searchPlace(placeType, searchString);
    cache.cacheRemoteSearchResult(remoteResults);

    const results = localResults.concat(remoteResults);
    if (results.length === 0) {
      results.push({ id: "na", name: "Place Not Found" });
    }
    return resp.view("src/public/components/search_results.html", {
      workbookId: workbookId,
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
    const location: URL = new URL(req.headers.referer!!);
    if (placeId === "na" || !location.searchParams.has("op")) {
      resp.status(400);
      return;
    }
    const place = cache.getCachedSearchResult(placeId, workbookId);
    data.place_parent = place!!.id;
    data.place_search = place!!.name;
    return resp.view("src/public/components/place_create_form.html", {
      workbookId: workbookId,
      op: location.searchParams.get("op"),
      data: data,
      pagePlaceType: data.place_type!!,
      userRoles: cache.getUserRoles(),
      hasParent: cache.getParentType(data.place_type!!),
    });
  });

  // re-render the whole form with a hidden input that has the place id/name
  // when we select a place from search results
  // for user replacements
  fastify.post("/place/replace", async (req, resp) => {
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook;
    const placeId = queryParams.id;

    const data: any = req.body;

    const location = new URL(req.headers.referer!!);
    if (placeId === "na" || !location.searchParams.has("op")) {
      resp.status(400);
      return;
    }
    const place = cache.getCachedSearchResult(placeId, workbookId);
    data.place_id = place!!.id;
    data.place_search = place!!.name;
    return resp.view("src/public/components/place_create_form.html", {
      workbookId: workbookId,
      op: location.searchParams.get("op"),
      data: data,
      userRoles: cache.getUserRoles(),
      pagePlaceType: data.place_type!!,
    });
  });

  // you want to create a place? replace a contact? you'll have to go through me first
  fastify.post("/place", async (req, resp) => {
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook!!;
    const op = queryParams.op!!;
    if (op === "new") {
      return createPlace(workbookId, req.body, resp);
    } else if (op === "bulk") {
      // read the date we uploaded
      const fileData = await req.file();
      return createPlaces(workbookId, queryParams.type, fileData!!, resp);
    } else if (op === "replace") {
      return replaceContact(workbookId, req.body, resp);
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
    const isMissingParent =
      cache.getParentType(data.place_type) && !data.place_parent;
    const isPhoneValid = isValidNumberForRegion(
      data.contact_phone,
      workbook.locale
    );
    if (!isPhoneValid || isMissingParent) {
      return resp.view("src/public/place/create_form.html", {
        workbookId: workbookId,
        pagePlaceType: data.place_type,
        userRoles: cache.getUserRoles(),
        hasParent: cache.getParentType(data.place_type),
        data: data,
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
      workbookId: workbookId,
    };
    // set parent if any
    if (data.place_parent) {
      const parent = cache.getCachedSearchResult(
        data.place_parent,
        workbookId
      )!!;
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
      workbookId: workbookId,
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
    const placeTypeConfig = contactTypes.find((ct) => ct.name === placeType);
    
    const placePropeties = (placeTypeConfig?.place_properties)!
      .map(p => ({ [p.csv_name]: p.doc_name }));
    const mapPlaceCsvnameDocName  = Object.assign({}, ...placePropeties);

    // todo: again or put in func
    const mapContactCsvnameDocName = (placeTypeConfig?.contact_properties)!!.map((p) => {
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
          resp.code(400);
          resp.send(`Missing columns: ${missingColumns.join(", ")}`);
          return;
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
          workbookId: workbookId,
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
      workbookId: workbookId,
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
    if (data.layout) {
      return resp.view("src/public/place/replace_user_form.html", {
        workbookId: workbookId,
        pagePlaceType: data.place_type!!,
        userRoles: cache.getUserRoles(),
        data: data,
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
        workbookId: workbookId,
        pagePlaceType: data.place_type!!,
        userRoles: cache.getUserRoles(),
        data: data,
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
      workbookId: workbookId,
    };
    // save the place and contact
    cache.savePlace(workbookId, placeData, contact);
    // back to places list
    resp.header("HX-Replace-Url", `/workbook/${workbookId}`);
    return fastify.view("src/public/workbook/content_places.html", {
      oob: true,
      places: cache.getPlacesForDisplay(workbookId),
      workbookId: workbookId,
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
    const placeType = cache.getPlaceTypes()[0];
    const op = queryParams.op || "new";
    resp.header("HX-Push-Url", `/workbook/${queryParams.workbook}/add`);
    return resp.view("src/public/workbook/fragment_form.html", {
      op: op,
      workbookId: queryParams.workbook,
      hierarchy: contactTypes.map(type => type.name),
      pagePlaceType: placeType,
      userRoles: cache.getUserRoles()
    });
  });

  fastify.post("/place/form/update", async (req, resp) => {
    const queryParams: any = req.query;
    const data: any = req.body;
    const placeType = data.type;
    const op = data.op || "new";
    resp.header("HX-Replace-Url", `?type=${placeType}&op=${op}`);
    return resp.view("src/public/components/place_create_form.html", {
      workbookId: queryParams.workbook,
      op: op,
      pagePlaceType: placeType,
      userRoles: cache.getUserRoles(),
      hasParent: cache.getParentType(placeType),
    });
  });

  fastify.get("/place/edit/:id", async (req, resp) => {
    const params: any = req.params;
    const id = params.id;

    const place = cache.getPlace(id);
    if (!place || place.remoteId) {
      resp.code(400);
      return;
    }
    const person = cache.getPerson(place.contact)!!;
    const workbook = cache.getWorkbook(place.workbookId);
    const tmplData = {
      view: "edit",
      workbookId: place.workbookId,
      connected: true,
      locales: LOCALES,
      workbook_locale: workbook.locale,
      op: "edit",
      pagePlaceType: place.type,
      hasParent: cache.getParentType(place.type),
      backend: `/place/edit/${id}`,
      userRoles: cache.getUserRoles(),
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
          (item) => item === person.sex.toLowerCase()
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
      resp.code(400);
      return;
    }
    const person = cache.getPerson(place.contact)!!;
    const data: any = req.body;

    const workbook = cache.getWorkbook(place.workbookId);
    const isMissingParent =
      cache.getParentType(data.place_type) && !data.place_parent;
    const isPhoneValid = isValidNumberForRegion(
      data.contact_phone,
      workbook.locale
    );
    if (!isPhoneValid || isMissingParent) {
      return resp.view("src/public/place/create_form.html", {
        workbookId: place.workbookId,
        backend: `/place/edit/${id}`,
        pagePlaceType: data.place_type,
        userRoles: cache.getUserRoles(),
        hasParent: cache.getParentType(data.place_type),
        data: data,
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
      workbookId: workbookId,
      workbookState: cache.getWorkbookState(workbookId)?.state,
      hasFailedJobs: hasFailedJobs,
      failedJobCount: failed.length,
      scheduledJobCount: scheduledJobs.length,
    });
  });

  fastify.get("/place/job/status", async (req, resp) => {
    const queryParams: any = req.query;
    const workbookId = queryParams.workbook!!;
    resp.hijack();
    const jobListener = (arg: jobState) => {
      if (arg.workbookId === workbookId)
        resp.sse({ event: "state_change", data: arg.placeId });
    };
    jobManager.on("state", jobListener);
    const workbookStateListener = (arg: workBookState) => {
      if (arg.id === workbookId)
        resp.sse({ event: "workbook_state_change", data: arg.id });
    };
    jobManager.on("workbook_state", workbookStateListener);
    req.socket.on("close", () => {
      jobManager.removeListener("state", jobListener);
      jobManager.removeListener("workbook_state", workbookStateListener);
    });
  });
}
