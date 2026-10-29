import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { assertProductionOriginConfiguration, configuredFrontendOrigins, createCsrfProtection, createStrictCorsMiddleware } from "./lib/request-security";

const app: Express = express();
const frontendOrigins = configuredFrontendOrigins();
assertProductionOriginConfiguration(process.env.NODE_ENV, frontendOrigins);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(createStrictCorsMiddleware(frontendOrigins, process.env.NODE_ENV));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(createCsrfProtection(frontendOrigins, process.env.NODE_ENV));

app.use("/api", router);

export default app;
