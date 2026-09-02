import "server-only";

import { CeloxError } from "./client.server";
import type { CeloxErrorResponse } from "./types";

export function jsonError(status: number, body: CeloxErrorResponse) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (body.retryAfterSeconds !== undefined) {
    headers.set("Retry-After", body.retryAfterSeconds.toString());
  }
  return Response.json(body, { status, headers });
}

function routeStatus(error: CeloxError) {
  switch (error.code) {
    case "invalid_request":
      return 400;
    case "configuration_error":
      return 500;
    case "unauthenticated":
      return 401;
    case "c2c_not_enabled_for_organisation":
      return 403;
    case "not_found":
      return 404;
    case "reference_id_conflict":
    case "c2c_busy":
    case "c2c_already_matched":
      return 409;
    case "validation_failed":
    case "split_not_supported":
    case "c2c_disabled":
    case "c2c_duplicate_destination":
    case "c2c_insufficient_balance":
    case "invalid_transaction_state":
    case "file_required":
    case "file_invalid":
    case "deposit_expired":
    case "deposit_not_awaiting_transfer":
    case "slip_already_submitted":
    case "slip_verification_failed":
      return 422;
    case "c2c_org_limit_reached":
    case "rate_limited":
      return 429;
    case "request_timeout":
      return 504;
    case "network_error":
    case "invalid_response":
    case "upstream_error":
      return 502;
    default:
      return error.httpStatus >= 400 && error.httpStatus <= 599 ? error.httpStatus : 502;
  }
}

export function celoxErrorResponse(error: CeloxError) {
  return jsonError(routeStatus(error), {
    error: error.message,
    code: error.code,
    retryable: error.retryable,
    ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    ...(error.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: error.retryAfterSeconds }
      : {}),
    ...(error.details ? { details: error.details } : {}),
  });
}
