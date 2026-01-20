export function createApiError({
  message,
  status = 500,
  endpoint,
  code,
  userSafeMessage,
  debugDetails
}) {
  const error = new Error(message || "Request failed");
  error.name = "ApiError";
  error.status = status;
  error.endpoint = endpoint;
  error.code = code;
  error.userSafeMessage = userSafeMessage;
  if (import.meta.env?.DEV) {
    error.debugDetails = debugDetails;
  }
  error.isApiError = true;
  return error;
}

export function isApiError(error) {
  return Boolean(error?.isApiError || error?.name === "ApiError");
}
