import { FastifyInstance } from "fastify";

import { Config } from "../lib/config";
import { ChtApi } from "../lib/cht-api";
import PlaceFactory from "../services/place-factory";
import SessionCache from "../services/session-cache";
import ParentComparator from "../lib/parent-comparator";

export default async function place(fastify: FastifyInstance) {
  // re-render the whole form with a hidden input that has the place id/name
  // when we select a place from search results
  // for user replacements
  fastify.post("/place/replace", async (req, resp) => {
    const queryParams: any = req.query;
    const { op, id: placeId } = queryParams;
    const data: any = req.body;

    if (!ParentComparator.isParentIdValid(placeId) || !op) {
      throw new Error('placeId is invalid or op is undefined');
    }

    const sessionCache: SessionCache = req.sessionCache;
    const contactType = Config.getContactType(data.place_type);
    const place = sessionCache.getKnownParent(placeId);
    data.place_id = place?.id;
    data.place_PARENT = place?.name;
    
    return resp.view("src/public/components/place_create_form.html", {
      op,
      data,
      contactType,
    });
  });

  // you want to create a place? replace a contact? you'll have to go through me first
  fastify.post("/place", async (req, resp) => {
    const { op, type: placeType } = req.query as any;

    const contactType = Config.getContactType(placeType);
    const sessionCache: SessionCache = req.sessionCache;
    const chtApi = new ChtApi(req.chtSession);
    if (op === "new") {
      await PlaceFactory.createOne(req.body, contactType, sessionCache, chtApi);
      resp.header("HX-Redirect", `/`);
      return;
    }
    
    if (op === "bulk") {
      // read the date we uploaded
      const fileData = await req.file();
      if (!fileData) {
        throw Error('no file data');
      }
      try {
        const csvBuf = await fileData.toBuffer();
        await PlaceFactory.createBulk(csvBuf, contactType, sessionCache, chtApi);
      } catch (error) {
        return fastify.view("src/public/place/bulk_create_form.html", {
          contactType,
          errors: {
            message: error,
          },
        });
      }
      
      // back to places list
      resp.header("HX-Redirect", `/`);
      return;
    }
    
    if (op === "replace") {
      throw new Error("not implmented");
    }
    
    throw new Error("unknown op");
  });

  fastify.post("/place/form/update", async (req, resp) => {
    const queryParams: any = req.query;
    const data: any = req.body;
    const placeType: string = data.type;
    const op = data.op || "new";
    resp.header("HX-Replace-Url", `?type=${placeType}&op=${op}`);
    const contactType = Config.getContactType(placeType);

    return resp.view("src/public/components/place_create_form.html", {
      op,
      contactType,
    });
  });

  fastify.get("/place/edit/:id", async (req, resp) => {
    const params: any = req.params;
    const { id } = params;
  
    const sessionCache: SessionCache = req.sessionCache;
    const place = sessionCache.getPlace(id);
    if (!place || place.isCreated) {
      throw new Error("unknonwn place or place is already created");
    }
    
    const data = place.asFormData();

    const tmplData = {
      view: "edit",
      op: "edit",
      place,
      contactType: place.type,
      backend: `/place/edit/${id}`,
      data,
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
      return resp.view("src/public/app/fragment_edit_form.html", tmplData);
    }
    return resp.view("src/public/app/view.html", tmplData);
  });

  fastify.post("/place/edit/:id", async (req, resp) => {
    const { id } = req.params as any;
    const data: any = req.body;
    const sessionCache: SessionCache = req.sessionCache;
    const chtApi = new ChtApi(req.chtSession);

    PlaceFactory.editOne(id, data, sessionCache, chtApi);

    // back to places list
    resp.header("HX-Redirect", `/`);
  });
}
