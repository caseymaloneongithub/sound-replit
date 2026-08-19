import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { storage } from "./storage";
import { startBillingCron } from "./billing-cron";
import { scheduleDataRetentionJobs } from "./data-retention-cron";

const app = express();

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      // Deliberately does NOT log response bodies — they routinely contain customer
      // PII, tokens and order details that shouldn't land in server logs.
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  await storage.seedData();
  
  const server = await registerRoutes(app);

  // Background jobs. Gated so preview/staging deployments never charge cards or
  // delete customer data. The gate wraps the whole call on purpose: both starters
  // also kick off an immediate run a few seconds after boot, so scheduling alone
  // isn't the only thing to suppress — a container restart would otherwise fire a
  // real billing run.
  if (process.env.DISABLE_CRON === "true") {
    log("background jobs disabled (DISABLE_CRON=true)");
  } else {
    startBillingCron();
    scheduleDataRetentionJobs();
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Log server-side; do NOT re-throw — the response is already sent, and throwing
    // here surfaces as an unhandledRejection that can crash the process.
    console.error("Unhandled request error:", err);
    res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  // Explicit check: an unset NODE_ENV should mean "production" for a built artifact
  // (app.get("env") defaults to "development", which would try to boot Vite in prod).
  if (process.env.NODE_ENV === "development") {
    // Development mode relaxes real security controls, so say so loudly: if this line
    // ever shows up in logs on an internet-reachable host, the deploy is misconfigured
    // (most likely a copied .env that still says NODE_ENV=development).
    console.warn("⚠️  NODE_ENV=development: staff/admin login 2FA is DISABLED and cookies are not secure-only. Never run production this way.");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  // reusePort is not supported on Windows (throws ENOTSUP), so only enable it elsewhere.
  const listenOptions: { port: number; host: string; reusePort?: boolean } = {
    port,
    host: "0.0.0.0",
  };
  if (process.platform !== "win32") {
    listenOptions.reusePort = true;
  }
  server.listen(listenOptions, () => {
    log(`serving on port ${port}`);
  });
})();
