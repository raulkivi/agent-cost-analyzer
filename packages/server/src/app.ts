import express, { type Express, type NextFunction, type Request, type Response } from "express";
import {
  createStandaloneApiService,
  type StandaloneApiServiceOptions,
} from "./composition/create-standalone-api-service.js";
import { ApiError, statusForApiError } from "./services/api/api-errors.js";
import { createLoopbackHostGuard } from "./http/loopback-host-guard.js";

export interface CreateAppOptions extends StandaloneApiServiceOptions {
  // Ports a request's Host header may name (DNS-rebinding guard,
  // architecture.md §11.2): the server's own port plus the Vite dev server's,
  // whose proxy forwards the browser's Host unchanged. Omitted (tests on an
  // ephemeral port) accepts any port, still on a loopback hostname only.
  allowedHostPorts?: readonly number[];
}

// Route params arrive as strings; Record<string, string> accepts every
// route's own typed params.
type Respond = (req: Request<Record<string, string>>, res: Response) => Promise<void>;

// Sends ApiService's typed errors as `{ error }` with their status; any
// other error goes to Express's default error handler, as it always has.
function route(respond: Respond) {
  return async (req: Request<Record<string, string>>, res: Response, next: NextFunction): Promise<void> => {
    try {
      await respond(req, res);
    } catch (error) {
      if (error instanceof ApiError) {
        res.status(statusForApiError(error)).json({ error: error.message });
        return;
      }
      next(error);
    }
  };
}

// Thin HTTP adapter over ApiService (vscode-extension.md D2): each route
// only picks its inputs out of the request and sends the result. Request
// validation, not-found handling and error wording live in ApiService, so
// the VS Code extension's message dispatcher behaves identically.
export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const { allowedHostPorts, ...serviceOptions } = options;
  const api = createStandaloneApiService(serviceOptions);

  // First, before any route or body parsing touches session data.
  app.use(createLoopbackHostGuard({ allowedPorts: allowedHostPorts }));
  app.use(express.json());

  app.get("/api/health", route(async (_req, res) => {
    res.json(await api.getHealth());
  }));

  app.get("/api/product", route(async (_req, res) => {
    res.json(await api.getProductProfile());
  }));

  app.get("/api/config/status", route(async (_req, res) => {
    res.json(await api.getConfigStatus());
  }));

  app.put("/api/config/retention-threshold", route(async (req, res) => {
    const { value } = (req.body ?? {}) as { value?: unknown };
    res.json(await api.setRetentionThreshold(value));
  }));

  app.get("/api/learn/scenarios", route(async (_req, res) => {
    res.json(await api.listLearnScenarios());
  }));

  app.get("/api/learn/scenarios/:id", route(async (req, res) => {
    res.json(await api.getLearnScenario(req.params.id));
  }));

  app.get("/api/log-providers", route(async (_req, res) => {
    res.json(await api.getLogProviderStatus());
  }));

  app.put("/api/log-providers/active", route(async (req, res) => {
    const { id } = (req.body ?? {}) as { id?: unknown };
    res.json(await api.setActiveLogProvider(id));
  }));

  app.get("/api/sessions", route(async (_req, res) => {
    res.json(await api.listSessions());
  }));

  app.get("/api/sessions/:id", route(async (req, res) => {
    res.json(await api.getSession(req.params.id));
  }));

  app.get("/api/sessions/:id/audit", route(async (req, res) => {
    res.json(await api.getSessionAudit(req.params.id, req.query));
  }));

  app.get("/api/sessions/:id/tool-calls", route(async (req, res) => {
    res.json(await api.listToolCalls(req.params.id, req.query));
  }));

  app.get("/api/audit", route(async (req, res) => {
    res.json(await api.getAuditRollup(req.query));
  }));

  app.get("/api/insights", route(async (req, res) => {
    res.json(await api.getInsights(req.query));
  }));

  app.get("/api/sessions/:id/turns/:turnIndex", route(async (req, res) => {
    res.json(await api.getTurnDetail(req.params.id, req.params.turnIndex));
  }));

  app.get("/api/sessions/:id/system-prompt", route(async (req, res) => {
    // Read first: setting the type before a 404 would send its JSON body as text/plain.
    const text = await api.getSystemPromptText(req.params.id);
    res.type("text/plain").send(text);
  }));

  return app;
}
