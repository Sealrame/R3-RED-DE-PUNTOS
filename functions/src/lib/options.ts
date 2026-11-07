import { CallableOptions } from "firebase-functions/v2/https";

/** Opciones comunes de las funciones invocables. */
export const callableOpts: CallableOptions = {
  // Activa App Check en producción (ENFORCE_APP_CHECK=true en functions/.env) para frenar abuso del registro público.
  enforceAppCheck: process.env.ENFORCE_APP_CHECK === "true",
  cors: true,
};
