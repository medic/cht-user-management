import { FastifyInstance } from "fastify";

import { Config } from "../lib/config";
import { ChtApi } from "../lib/cht-api";
import PlaceFactory from "../services/place-factory";
import SessionCache from "../services/session-cache";

export default async function place(fastify: FastifyInstance) {
  // you want to create a place? replace a contact? you'll have to go through me first
  fastify.post("/place", async (req, resp) => {
    const { op, type: placeType } = req.query as any;

    const contactType = Config.getContactType(placeType);
    const sessionCache: SessionCache = req.sessionCache;
    const chtApi = new ChtApi(req.chtSession);
    if (op === "new" || op === "replace") {
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
    
    throw new Error("unknown op");
  });

  fastify.post("/place/form/update", async (req, resp) => {
    const data: any = req.body;
    const placeType: string = data.type;
    const op = data.op || "new";
    resp.header("HX-Replace-Url", `?type=${placeType}&op=${op}`);
    const contactType = Config.getContactType(placeType);

    return resp.view("src/public/components/form_switch.html", {
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
      throw new Error("unknown place or place is already created");
    }
    
    const data = place.asFormData();

    const tmplData = {
      view: "edit",
      op: "edit",
      place,
      contactType: place.type,
      backend: `/place/edit/${id}`,
      data,
    };

    resp.header("HX-Push-Url", `/place/edit/${id}`);
    return resp.view("src/public/app/view.html", tmplData);
  });

  fastify.post("/place/edit/:id", async (req, resp) => {
    const { id } = req.params as any;
    const data: any = req.body;
    const sessionCache: SessionCache = req.sessionCache;
    const chtApi = new ChtApi(req.chtSession);

    await PlaceFactory.editOne(id, data, sessionCache, chtApi);

    // back to places list
    resp.header("HX-Redirect", `/`);
  });
}
